import { describe, it, expect } from "vitest";
import { parseJsonLoose } from "@/lib/ai/json";

describe("parseJsonLoose", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips ```json fences (Gemini's default shape)", () => {
    expect(parseJsonLoose('```json\n{"people":true}\n```')).toEqual({ people: true });
  });
  it("strips bare ``` fences", () => {
    expect(parseJsonLoose('```\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
  });
  it("extracts JSON embedded in prose", () => {
    expect(parseJsonLoose('Here you go:\n{"a":"b"}\nHope that helps!')).toEqual({ a: "b" });
  });
  it("returns null for unparseable input instead of throwing", () => {
    expect(parseJsonLoose("not json at all")).toBeNull();
    expect(parseJsonLoose("")).toBeNull();
  });
  it("prefers the outermost object", () => {
    expect(parseJsonLoose('{"outer":{"inner":1}}')).toEqual({ outer: { inner: 1 } });
  });
});
