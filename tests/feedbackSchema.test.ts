import { describe, it, expect } from "vitest";
import { createFeedbackSchema, resolveFeedbackSchema } from "@/lib/feedback/schema";
describe("createFeedbackSchema", () => {
  it("valid", () => expect(createFeedbackSchema.safeParse({ type: "Bug", title: "Broken", description: "x" }).success).toBe(true));
  it("requires title", () => expect(createFeedbackSchema.safeParse({ type: "Bug", title: "" }).success).toBe(false));
  it("bad type", () => expect(createFeedbackSchema.safeParse({ type: "Nope", title: "x" }).success).toBe(false));
});
describe("resolveFeedbackSchema", () => {
  it("optional note", () => expect(resolveFeedbackSchema.safeParse({}).success).toBe(true));
});
