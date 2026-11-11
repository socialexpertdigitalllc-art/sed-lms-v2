import { describe, it, expect } from "vitest";
import {
  formatInstructions,
  parseInstructions,
  instructionsError,
  toInstructionItems,
  wordCount,
  MAX_INSTRUCTION_ITEMS,
  MAX_INSTRUCTION_WORDS,
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

  it("each item is at most 50 words; at most 15 items", () => {
    expect(wordCount(words(MAX_INSTRUCTION_WORDS))).toBe(50);
    expect(instructionsError([words(50)])).toBeNull();
    expect(instructionsError(["ok", words(51)])).toMatch(/Instruction 2 is 51 words/);
    expect(instructionsError(Array.from({ length: MAX_INSTRUCTION_ITEMS + 1 }, () => "x"))).toMatch(/At most 15/);
  });

  it("free text (SED AI) becomes items that each fit, without losing a word", () => {
    const text = `${words(30)}. ${words(30)}. ${words(120)}`;
    const items = toInstructionItems(text);
    expect(items.every((i) => wordCount(i) <= MAX_INSTRUCTION_WORDS)).toBe(true);
    expect(items.join(" ").split(/\s+/).length).toBe(180);
    expect(toInstructionItems("1. Short one\n2. Another")).toEqual(["Short one", "Another"]);
  });
});
