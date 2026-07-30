// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callWithProvider, type ProviderSpec } from "@/lib/ai-tools/run";
import { CALL_TIMEOUT_MARKER, isRetryableError } from "@/lib/ai-tools/providers/errors";
import { getGate, resetGates } from "@/lib/ai-tools/providers/gate";

/**
 * The streaming path of `attemptCall` (lib/ai-tools/run.ts): OpenAI-style SSE
 * accumulation, the idle-vs-total timeout split, and the promise that a caller
 * who passes no `onChunk` gets the exact non-streaming request it always got.
 * Hermetic — every "stream" here is a Response built over a string body or a
 * hand-pushed ReadableStream; nothing touches the network.
 */

const spec: ProviderSpec = {
  label: "Test Provider m1",
  endpoint: "https://api.example.com/v1/chat/completions",
  apiKey: "k",
  maxOutputTokens: 8000,
  providerKey: "testprov",
};

const enc = new TextEncoder();

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}`;
const deltaFrame = (content: string) => frame({ choices: [{ delta: { content } }] });
const usageFrame = (usage: unknown) => frame({ choices: [{ delta: {} }], usage });

/** A whole SSE reply as one string body — undici happily streams it back out
 *  of `res.body` in this environment. */
function sseResponse(lines: string[]): Response {
  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** A stream the TEST pushes into, for the timing cases: nothing arrives until
 *  the test says so, which is what "goes silent" means. */
function pushStream() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return {
    response: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    push: (s: string) => ctrl.enqueue(enc.encode(s)),
    close: () => ctrl.close(),
  };
}

const okBody = {
  choices: [{ message: { content: "hello" } }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

const call = (opts: Partial<Parameters<typeof callWithProvider>[4]> = {}) =>
  callWithProvider(spec, "m1", "sys", "user", { maxTokens: 100, temperature: 0, ...opts });

describe("streaming accumulation", () => {
  beforeEach(() => resetGates());
  afterEach(() => vi.restoreAllMocks());

  it("accumulates the deltas in order and emits every one of them to onChunk", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        deltaFrame("<html>"),
        deltaFrame("hello "),
        frame({ choices: [{ delta: {} }] }), // a role/empty frame carries no content
        deltaFrame("world</html>"),
        "data: [DONE]",
      ]),
    );
    const seen: string[] = [];

    const out = await call({ onChunk: (d) => seen.push(d) });

    expect(seen).toEqual(["<html>", "hello ", "world</html>"]);
    expect(out.text).toBe("<html>hello world</html>");
    expect(out.text).toBe(seen.join(""));
  });

  it("captures usage from the final chunk when the vendor sends one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        deltaFrame("ab"),
        usageFrame({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
        "data: [DONE]",
      ]),
    );

    const out = await call({ onChunk: () => {} });

    expect(out.text).toBe("ab");
    expect(out.tokens).toBe(15);
  });

  it("absent usage falls back to the text-length estimate and the gate settles without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([deltaFrame("x".repeat(41)), "data: [DONE]"]),
    );

    const out = await call({ onChunk: () => {} });

    expect(out.tokens).toBe(Math.ceil(41 / 4));
    // The slot settled with usage: null — nothing left in flight, no throw.
    expect(getGate("testprov").snapshot().inFlight).toBe(0);
  });

  it("[DONE] terminates cleanly and a malformed mid-stream line is skipped, never fatal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        deltaFrame("a"),
        "data: {this is not json",
        ": an SSE comment line",
        deltaFrame("b"),
        "data: [DONE]",
        deltaFrame("MUST NOT APPEAR"), // past the terminator
      ]),
    );
    const seen: string[] = [];

    const out = await call({ onChunk: (d) => seen.push(d) });

    expect(out.text).toBe("ab");
    expect(seen).toEqual(["a", "b"]);
  });

  it("sends stream: true with stream_options only when onChunk is present", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([deltaFrame("x"), "data: [DONE]"]),
    );

    await call({ onChunk: () => {} });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("a non-streaming call sends NO stream key at all", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(okBody), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const out = await call();

    expect(out).toEqual({ text: "hello", tokens: 150 });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect("stream" in body).toBe(false);
    expect("stream_options" in body).toBe(false);
  });
});

describe("streaming timeouts — idle, not total", () => {
  beforeEach(() => {
    resetGates();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a stream that goes silent aborts after idleTimeoutMs with a retryable timeout", async () => {
    const s = pushStream();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(s.response);

    const outcome = call({ onChunk: () => {}, idleTimeoutMs: 1000, maxAttempts: 1 }).catch((e) => e);
    s.push(deltaFrame("partial") + "\n");
    await vi.advanceTimersByTimeAsync(0); // the chunk lands, the idle timer re-arms
    await vi.advanceTimersByTimeAsync(1000); // …then nothing more arrives

    const err = await outcome;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(CALL_TIMEOUT_MARKER);
    // Worded through callTimedOutMessage with the IDLE duration, so the
    // classifier treats a stall exactly like the old whole-call timeout.
    expect((err as Error).message).toContain("1s");
    expect(isRetryableError(err)).toBe(true);
  });

  it("an idle-timed-out attempt is retried by callWithProvider", async () => {
    const s = pushStream();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(s.response)
      .mockResolvedValueOnce(sseResponse([deltaFrame("recovered"), "data: [DONE]"]));

    const promise = call({ onChunk: () => {}, idleTimeoutMs: 1000 });
    s.push(deltaFrame("partial") + "\n");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000); // idle fires → retryable failure
    await vi.advanceTimersByTimeAsync(5000); // …backoff, then the second attempt

    const out = await promise;
    expect(out.text).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a stream still sending past the old 300s total is NOT killed", async () => {
    // The point of idle-vs-total: seven chunks a minute apart put the call at
    // 420s of wall clock — past the non-streaming 300s ceiling — with every
    // silence far inside the 90s idle window. It must finish.
    const s = pushStream();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(s.response);
    const seen: string[] = [];

    const promise = call({ onChunk: (d) => seen.push(d) });
    for (let i = 0; i < 7; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      s.push(deltaFrame(`part${i};`) + "\n");
      await vi.advanceTimersByTimeAsync(0); // let the read settle and re-arm idle
    }
    s.push("data: [DONE]\n");
    s.close();

    const out = await promise;
    expect(out.text).toBe("part0;part1;part2;part3;part4;part5;part6;");
    expect(seen.join("")).toBe(out.text);
  });
});
