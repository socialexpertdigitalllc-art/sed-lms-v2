// tests/siteAgentAgyParse.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseAgyEventLine, summarizeEventForTail } from "@/lib/site-agent/agy";

const lines = (f: string) =>
  readFileSync(`tests/fixtures/agy/${f}`, "utf8").split(/\r?\n/).filter(Boolean);

describe("parseAgyEventLine", () => {
  it("parses every line of the REAL error-run capture without throwing", () => {
    const evs = lines("error-run.ndjson").map(parseAgyEventLine);
    expect(evs.every((e) => e !== null)).toBe(true);
    const kinds = evs.map((e) => e!.kind);
    expect(kinds[0]).toBe("init");
    expect(kinds[kinds.length - 1]).toBe("result");
  });

  it("extracts conversation_id and result fields from the success fixture", () => {
    // Values pinned from the REAL capture (agy 1.1.22, consumer sign-in,
    // 2026-09-01: the Phase-0 phone-number edit run end-to-end).
    const evs = lines("success-run.ndjson").map(parseAgyEventLine);
    const init = evs.find((e) => e?.kind === "init");
    expect(init && init.kind === "init" && init.conversationId).toBe("555a257f-16ca-48cd-9a18-15991c59acb3");
    const result = evs.find((e) => e?.kind === "result");
    expect(result && result.kind === "result" && result.status).toBe("SUCCESS");
    expect(result && result.kind === "result" && result.usage?.total_tokens).toBe(128158);
  });

  it("the real error run yields status ERROR with the error text", () => {
    const evs = lines("error-run.ndjson").map(parseAgyEventLine);
    const result = evs.find((e) => e?.kind === "result");
    expect(result && result.kind === "result" && result.status).toBe("ERROR");
    expect(result && result.kind === "result" && result.error).toMatch(/terminated/i);
  });

  it("unknown event kinds degrade to 'other', not null, not a throw", () => {
    const e = parseAgyEventLine('{"event":"totally_new_thing","x":1}');
    expect(e).toMatchObject({ kind: "other" });
  });

  it("garbage lines return null", () => {
    expect(parseAgyEventLine("not json")).toBeNull();
    expect(parseAgyEventLine("")).toBeNull();
  });
});

describe("summarizeEventForTail", () => {
  it("turns step updates into short human lines and passes text through", () => {
    // The real capture's step types are "tool" and "agent_response" (the
    // earlier synthetic fixture guessed "tool_call") and the final response
    // names the edit it made.
    const evs = lines("success-run.ndjson").map(parseAgyEventLine);
    const tails = evs.map((e) => (e ? summarizeEventForTail(e) : null)).filter(Boolean);
    expect(tails.join("\n")).toMatch(/\[tool\]/);
    expect(tails.join("\n")).toMatch(/987-6543/);
  });
});
