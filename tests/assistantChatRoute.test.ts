// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetRuns } from "@/lib/assistant/runs";
import type { AssistantConversation } from "@/lib/assistant/types";

/**
 * Asking again: "Regenerate" and "Edit" replace the chat's LATEST turn —
 * never an older one, never while another answer is being written — and an
 * edited first question renames a chat still named after it. Plus the
 * thumbs up/down endpoint.
 */

const CONV = "11111111-1111-4111-8111-111111111111";
const TURN = "22222222-2222-4222-8222-222222222222";
const OLDER = "33333333-3333-4333-8333-333333333333";
const ANSWER = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  conversation: null as AssistantConversation | null,
  latest: null as { turnId: string; content: string } | null,
  calls: [] as string[],
  turnText: [] as string[],
  feedbackFound: true,
}));

vi.mock("@/lib/assistant/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assistant/http")>()),
  assistantGuard: async () => ({
    ok: true,
    caller: { user: { id: "sam" }, perms: new Set(["assistant.use"]), supabase: {}, displayName: "Sam", assistantName: "Nova" },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/assistant/store", () => ({
  getConversation: async () => h.conversation,
  createConversation: async () => h.conversation,
  latestQuestion: async () => {
    h.calls.push("latest");
    return h.latest;
  },
  deleteTurn: async (_a: unknown, _u: string, _c: string, turnId: string) => {
    h.calls.push(`delete:${turnId}`);
    return 3;
  },
  updateConversation: async (_a: unknown, _u: string, _c: string, patch: { title?: string }) => {
    h.calls.push(`title:${patch.title}`);
    return h.conversation && { ...h.conversation, ...patch };
  },
  setAnswerFeedback: async (_a: unknown, userId: string, id: string, feedback: string | null) => {
    h.calls.push(`feedback:${userId}:${id}:${feedback}`);
    return h.feedbackFound;
  },
}));
vi.mock("@/lib/assistant/engine", () => ({
  runTurn: async (input: { text: string; conversation: AssistantConversation; emit: (e: unknown) => void }) => {
    h.calls.push("run");
    h.turnText.push(input.text);
    input.emit({ type: "start", conversation: input.conversation, userMessageId: "x" });
    input.emit({ type: "done", messageId: "m", stopped: false });
  },
}));

import { POST } from "@/app/api/assistant/chat/route";
import { POST as FEEDBACK } from "@/app/api/assistant/messages/[id]/feedback/route";

const ask = (body: Record<string, unknown>) =>
  POST(new Request("http://test.local/api/assistant/chat", { method: "POST", body: JSON.stringify(body) }));

async function drain(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeEach(() => {
  resetRuns();
  h.conversation = {
    id: CONV,
    title: "How am I doing",
    pinned: false,
    last_provider: null,
    last_model: null,
    created_at: "",
    updated_at: "",
    last_message_at: "",
  };
  h.latest = { turnId: TURN, content: "How am I doing?" };
  h.calls = [];
  h.turnText = [];
  h.feedbackFound = true;
});

describe("asking the latest question again", () => {
  it("replaces the latest turn — removing it before answering again", async () => {
    const res = await ask({ conversationId: CONV, message: "How am I doing?", replaceTurnId: TURN });
    expect(res.status).toBe(200);
    await drain(res);
    expect(h.calls).toEqual(["latest", `delete:${TURN}`, "run"]);
    expect(h.turnText).toEqual(["How am I doing?"]);
  });

  it("refuses to replace anything but the latest turn, and frees the chat again", async () => {
    const res = await ask({ conversationId: CONV, message: "Old question", replaceTurnId: OLDER });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/latest question/);
    expect(h.calls).toEqual(["latest"]);
    // The refused request released the conversation: a normal question goes through.
    const next = await ask({ conversationId: CONV, message: "Hello" });
    expect(next.status).toBe(200);
    await drain(next);
  });

  it("renames a chat still named after the question that was edited", async () => {
    const res = await ask({ conversationId: CONV, message: "Which leads should I call first today?", replaceTurnId: TURN });
    const events = await drain(res);
    expect(h.calls).toContain("title:Which leads should I call first today");
    expect((events[0].conversation as { title: string }).title).toBe("Which leads should I call first today");
  });

  it("keeps a title the user chose", async () => {
    h.conversation!.title = "Q4 plan";
    await drain(await ask({ conversationId: CONV, message: "Something else entirely", replaceTurnId: TURN }));
    expect(h.calls.some((c) => c.startsWith("title:"))).toBe(false);
  });

  it("needs the chat it is replacing in", async () => {
    const res = await ask({ message: "Hi", replaceTurnId: TURN });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("Pick the chat to answer again.");
  });
});

describe("rating an answer", () => {
  const rate = (id: string, body: unknown) =>
    FEEDBACK(new Request(`http://test.local/api/assistant/messages/${id}/feedback`, { method: "POST", body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    });

  it("saves thumbs up, down, or clears it — on the caller's own answer", async () => {
    expect((await rate(ANSWER, { feedback: "up" })).status).toBe(200);
    expect((await rate(ANSWER, { feedback: null })).status).toBe(200);
    expect(h.calls).toEqual([`feedback:sam:${ANSWER}:up`, `feedback:sam:${ANSWER}:null`]);
  });

  it("rejects anything else, and someone else's answer reads as not found", async () => {
    expect((await rate(ANSWER, { feedback: "love" })).status).toBe(422);
    expect((await rate("not-a-uuid", { feedback: "up" })).status).toBe(404);
    h.feedbackFound = false;
    expect((await rate(ANSWER, { feedback: "up" })).status).toBe(404);
  });
});
