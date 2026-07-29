import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rankByPeople, parsePeopleVerdicts, imageRankPrompt, IMAGE_RANK_SYSTEM } from "@/lib/site-builder/imageRank";
import { callForTask } from "@/lib/ai-tools/providers/run";

// Site Builder's image ranking routes through the same per-task model
// router as everything else — the network call itself is what we stub.
vi.mock("@/lib/ai-tools/providers/run", () => ({
  callForTask: vi.fn(),
}));

describe("IMAGE_RANK_SYSTEM / imageRankPrompt", () => {
  it("is a non-empty system instruction", () => {
    expect(typeof IMAGE_RANK_SYSTEM).toBe("string");
    expect(IMAGE_RANK_SYSTEM.length).toBeGreaterThan(20);
  });

  it("asks for exactly n booleans, in order, and is conservative about people", () => {
    const p = imageRankPrompt(3).toLowerCase();
    expect(p).toContain("3");
    expect(p).toContain("json array");
    expect(p).toMatch(/hand|arm|face|body part/);
  });
});

describe("parsePeopleVerdicts", () => {
  it("parses a well-formed JSON array of booleans as-is", () => {
    expect(parsePeopleVerdicts(JSON.stringify([false, true, false]), 3)).toEqual([false, true, false]);
  });

  it("parses fenced JSON", () => {
    const fenced = "```json\n" + JSON.stringify([true, false]) + "\n```";
    expect(parsePeopleVerdicts(fenced, 2)).toEqual([true, false]);
  });

  it("accepts {people: bool} objects too", () => {
    expect(parsePeopleVerdicts(JSON.stringify([{ people: false }, { people: true }]), 2)).toEqual([false, true]);
  });

  it("pads a short or malformed array with the conservative default (true — assume a person present)", () => {
    expect(parsePeopleVerdicts(JSON.stringify([false]), 3)).toEqual([false, true, true]);
    expect(parsePeopleVerdicts("not json at all", 2)).toEqual([true, true]);
  });
});

describe("rankByPeople", () => {
  const mockCall = vi.mocked(callForTask);
  const answer = (text: string) => ({ text, tokens: 50, providerKey: "minimax", model: "MiniMax-M3" });
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockCall.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("orders no-people candidates first, stably preserving relative order within each group", async () => {
    // people flags, in order: a=has people, b and c do not.
    mockCall.mockResolvedValue(answer(JSON.stringify([true, false, false])));
    const order = await rankByPeople([
      { key: "a", url: "https://example.com/a.jpg" },
      { key: "b", url: "https://example.com/b.jpg" },
      { key: "c", url: "https://example.com/c.jpg" },
    ]);
    expect(order).toEqual(["b", "c", "a"]);
  });

  it("returns every candidate — ranking never discards", async () => {
    mockCall.mockResolvedValue(answer(JSON.stringify([true, true, false])));
    const order = await rankByPeople([
      { key: "x", url: "u1" },
      { key: "y", url: "u2" },
      { key: "z", url: "u3" },
    ]);
    expect(order.sort()).toEqual(["x", "y", "z"]);
    expect(order).toHaveLength(3);
  });

  it("sends one image_url part per candidate, in the given order", async () => {
    mockCall.mockResolvedValue(answer(JSON.stringify([false, false])));
    await rankByPeople([
      { key: "a", url: "https://example.com/a.jpg" },
      { key: "b", url: "https://example.com/b.jpg" },
    ]);
    expect(mockCall).toHaveBeenCalledTimes(1);
    const [task, , , opts] = mockCall.mock.calls[0];
    expect(task).toBe("image_rank");
    expect(opts.images).toEqual(["https://example.com/a.jpg", "https://example.com/b.jpg"]);
  });

  it("asks for exactly ONE attempt — this route cannot afford the shared retry loop", async () => {
    // The seam gained a 4-attempt retry loop with the rate limiter, silently
    // contradicting this module's "deliberately no retry" contract and turning
    // a 20s best-effort call into ~87s of timeout-plus-backoff inside a route
    // that declares maxDuration = 60. Drop `maxAttempts: 1` and the sourcing
    // request dies to improve an ordering it is happy to do without.
    mockCall.mockResolvedValue(answer(JSON.stringify([false, false])));
    await rankByPeople([
      { key: "a", url: "u1" },
      { key: "b", url: "u2" },
    ]);
    const [, , , opts] = mockCall.mock.calls[0];
    expect(opts.maxAttempts).toBe(1);
    // and the tight per-call timeout is still the other half of that budget
    expect(opts.timeoutMs).toBe(20000);
  });

  it("a failing vision call leaves the original order untouched and still returns every candidate", async () => {
    mockCall.mockRejectedValue(new Error("HTTP 500"));
    const order = await rankByPeople([
      { key: "a", url: "u1" },
      { key: "b", url: "u2" },
      { key: "c", url: "u3" },
    ]);
    expect(order).toEqual(["a", "b", "c"]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("an unconfigured model (resolveTaskModel throwing) also leaves order untouched, never blocking sourcing", async () => {
    mockCall.mockRejectedValue(new Error("MiniMax is not configured (missing MINIMAX_API_KEY)."));
    const order = await rankByPeople([
      { key: "a", url: "u1" },
      { key: "b", url: "u2" },
    ]);
    expect(order).toEqual(["a", "b"]);
  });

  it("an unparseable response degrades to the conservative default (order unchanged) without throwing", async () => {
    mockCall.mockResolvedValue(answer("not json at all, sorry"));
    const order = await rankByPeople([
      { key: "a", url: "u1" },
      { key: "b", url: "u2" },
    ]);
    // Both default to "person present" (true) -> equal rank -> stable order kept.
    expect(order).toEqual(["a", "b"]);
  });

  it("does not call the model for fewer than 2 candidates", async () => {
    expect(await rankByPeople([])).toEqual([]);
    expect(await rankByPeople([{ key: "a", url: "u1" }])).toEqual(["a"]);
    expect(mockCall).not.toHaveBeenCalled();
  });
});
