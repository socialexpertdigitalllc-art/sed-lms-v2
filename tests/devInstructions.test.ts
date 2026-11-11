import { describe, it, expect } from "vitest";
import {
  formatInstructions,
  parseInstructions,
  instructionsError,
  toInstructionItems,
  wordCount,
  MAX_INSTRUCTION_ITEMS,
  MAX_INSTRUCTION_WORDS,
  MAX_INSTRUCTION_CHARS,
  fitsInstruction,
} from "@/lib/leads/devInstructions";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("developer instructions as a list", () => {
  it("formats as a numbered list, one line per item, blanks dropped", () => {
    expect(formatInstructions(["  Sticky header ", "", "Team\nphoto on About"])).toBe("1. Sticky header\n2. Team photo on About");
    expect(formatInstructions(["", "  "])).toBeNull();
  });

  it("reads saved text back into items, whatever the numbering", () => {
    expect(parseInstructions("1. Sticky header\n2) Team photo\n- Big CTA\n• Footer map\nplain line")).toEqual([
      "Sticky header",
      "Team photo",
      "Big CTA",
      "Footer map",
      "plain line",
    ]);
    expect(parseInstructions(null)).toEqual([]);
  });

  it("each item is at most 20 words and 146 characters; at most 15 items", () => {
    expect(MAX_INSTRUCTION_WORDS).toBe(20);
    expect(MAX_INSTRUCTION_CHARS).toBe(146);
    expect(wordCount(words(20))).toBe(20);
    expect(instructionsError([words(20)])).toBeNull();
    expect(instructionsError(["ok", words(21)])).toMatch(/Instruction 2 is 21 words/);
    // Few words, too many characters.
    expect(instructionsError(["x".repeat(146)])).toBeNull();
    expect(instructionsError(["fine", `${"long".repeat(20)} ${"word".repeat(20)}`])).toMatch(/Instruction 2 is 161 characters/);
    expect(instructionsError(Array.from({ length: MAX_INSTRUCTION_ITEMS + 1 }, () => "x"))).toMatch(/At most 15/);
  });

  it("free text (SED AI) becomes items that each fit both limits, without losing a word", () => {
    const text = `${words(12)}. ${words(15)}. ${words(70)} ${"https://example.com/" + "a".repeat(200)}`;
    const items = toInstructionItems(text);
    expect(items.every((i) => fitsInstruction(i))).toBe(true);
    expect(items.join(" ").replace(/\s+/g, "").length).toBe(text.replace(/\s+/g, "").length);
    expect(toInstructionItems("1. Short one\n2. Another")).toEqual(["Short one", "Another"]);
  });
});
