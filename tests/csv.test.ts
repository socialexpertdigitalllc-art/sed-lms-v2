import { describe, it, expect } from "vitest";
import { toCsv } from "@/lib/leads/csv";

const cols = [{ key: "name", label: "Name" }, { key: "note", label: "Note" }];

describe("toCsv", () => {
  it("emits a header row then data rows", () => {
    expect(toCsv([{ name: "Acme", note: "ok" }], cols)).toBe('Name,Note\r\nAcme,ok');
  });
  it("quotes values containing comma, quote, or newline", () => {
    expect(toCsv([{ name: "A,B", note: 'he said "hi"' }], cols)).toBe('Name,Note\r\n"A,B","he said ""hi"""');
    expect(toCsv([{ name: "line1\nline2", note: "" }], cols)).toBe('Name,Note\r\n"line1\nline2",');
  });
  it("renders null/undefined as empty and arrays joined by '; '", () => {
    expect(toCsv([{ name: null, note: ["a", "b"] }], cols)).toBe('Name,Note\r\n,a; b');
  });
  it("emits header-only for an empty set", () => {
    expect(toCsv([], cols)).toBe("Name,Note");
  });
});
