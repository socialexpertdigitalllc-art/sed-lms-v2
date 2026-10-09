import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/common/Toast";
import { AssistantApp, type AssistantAppProps } from "@/components/assistant/AssistantApp";
import { AssistantProvider } from "@/providers/AssistantProvider";
import type { AssistantStreamEvent } from "@/lib/assistant/types";
import type { UiMessage } from "@/lib/assistant/view";

/**
 * The chat page's client logic: a question streams in as NDJSON events and
 * is drawn as it arrives — lookups, words, a memory saved — then swapped for
 * the saved copy. The network is scripted; React is real.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/assistant" }));

const conversation = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "How am I doing",
  pinned: false,
  created_at: "2026-10-09T10:00:00Z",
  updated_at: "2026-10-09T10:00:00Z",
  last_message_at: "2026-10-09T10:00:00Z",
};

const props: AssistantAppProps = {
  scope: ["Leads: your own leads only."],
  suggestions: ["How am I doing this month compared with last month?"],
  initialConversations: [],
  initialMemories: [],
  initialConversationId: null,
  initialMessages: [],
  initialRunning: false,
};

const events: AssistantStreamEvent[] = [
  { type: "start", conversation, userMessageId: "turn-1" },
  { type: "reasoning", delta: "Check the pipeline first." },
  { type: "tool_start", callId: "c1", name: "get_pipeline_summary", label: "Reading the pipeline", args: {} },
  { type: "tool_end", callId: "c1", name: "get_pipeline_summary", ok: true, summary: "42 leads · 6 closed", durationMs: 30 },
  { type: "memory", action: "saved", memory: { id: "m1", content: "Target: 10 closes a month", kind: "goal", source: "assistant", conversation_id: conversation.id, created_at: "", updated_at: "" } },
  { type: "text", delta: "You closed **6** deals " },
  { type: "text", delta: "this month." },
  { type: "done", messageId: "a2", stopped: false },
];

const saved: UiMessage[] = [
  { id: "turn-1", turn_id: "turn-1", role: "user", content: "How am I doing?", reasoning: null, tool_calls: null, tool_call_id: null, tool_name: null, meta: null, status: "complete", error: null, created_at: "" },
  { id: "a1", turn_id: "turn-1", role: "assistant", content: "", reasoning: "Check the pipeline first.", tool_calls: [{ id: "c1", name: "get_pipeline_summary" }], tool_call_id: null, tool_name: null, meta: null, status: "complete", error: null, created_at: "" },
  { id: "t1", turn_id: "turn-1", role: "tool", content: "{}", reasoning: null, tool_calls: null, tool_call_id: "c1", tool_name: "get_pipeline_summary", meta: { label: "Reading the pipeline", ok: true, summary: "42 leads · 6 closed", duration_ms: 30 }, status: "complete", error: null, created_at: "" },
  { id: "a2", turn_id: "turn-1", role: "assistant", content: "You closed **6** deals this month.", reasoning: null, tool_calls: null, tool_call_id: null, tool_name: null, meta: null, status: "complete", error: null, created_at: "" },
];

function renderApp(name: string | null = "Nova", over: Partial<AssistantAppProps> = {}) {
  return render(
    <ToastProvider>
      <AssistantProvider enabled userId="sam" displayName="Sam Khan" initialName={name}>
        <AssistantApp {...props} {...over} />
      </AssistantProvider>
    </ToastProvider>,
  );
}

/** The chat as saved: one answered question. */
const savedChat: Partial<AssistantAppProps> = {
  initialConversations: [conversation],
  initialConversationId: conversation.id,
  initialMessages: saved,
};

function ndjson(list: AssistantStreamEvent[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of list) c.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
}

describe("AssistantApp", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streams an answer with its lookups, saves the memory it learned, then shows the saved copy", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/assistant/chat" && init?.method === "POST") return ndjson(events);
      if (url === `/api/assistant/conversations/${conversation.id}`) {
        return new Response(JSON.stringify({ conversation, messages: saved, running: false }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();
    expect(screen.getByRole("heading", { name: "Hi Sam, I'm Nova" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Message the assistant"), "How am I doing?{Enter}");

    expect(await screen.findByText("this month.", { exact: false })).toBeInTheDocument();
    // What it did is folded into one line, and unfolds to the lookups.
    await userEvent.click(await screen.findByRole("button", { name: /1 lookup/ }));
    expect(screen.getByText("Reading the pipeline")).toBeInTheDocument();
    expect(screen.getByText(/42 leads · 6 closed/)).toBeInTheDocument();
    // Bold rendered as an element, not as asterisks.
    expect(screen.getByText("6", { selector: "strong" })).toBeInTheDocument();
    // The memory the assistant saved shows up in the header count at once.
    expect(within(screen.getByRole("button", { name: "Memory" })).getByText("1")).toBeInTheDocument();
    // The new chat joins the list and the URL points at it.
    expect(screen.getAllByText("How am I doing").length).toBeGreaterThan(0);
    expect(window.location.search).toBe(`?c=${conversation.id}`);

    // The question went out with no conversation (a new chat)…
    const [, init] = fetchMock.mock.calls.find(([u]) => u === "/api/assistant/chat")!;
    expect(JSON.parse(String(init!.body))).toEqual({ conversationId: null, message: "How am I doing?" });
    // …and the saved copy replaced the live one.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/assistant/conversations/${conversation.id}`, { cache: "no-store" }));
    await waitFor(() => expect(screen.getAllByText("How am I doing?")).toHaveLength(1));
    // Replies carry the assistant's name — and nothing says which model wrote them.
    expect(screen.getAllByText("Nova").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/minimax|gemini/i);
  });

  it("asks a first-time user to name their assistant before anything else", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/me/preferences" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ ok: true, ui_preferences: { assistantName: "Atlas" } }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp(null);

    expect(screen.getByText("Meet your SED Assistant")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message the assistant")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Assistant name"), "Atlas");
    await userEvent.click(screen.getByRole("button", { name: "Save and start" }));

    expect(await screen.findByRole("heading", { name: "Hi Sam, I'm Atlas" })).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls.find(([u]) => u === "/api/me/preferences")!;
    expect(JSON.parse(String(init!.body))).toEqual({ assistantName: "Atlas" });
  });

  it("shows a refused request as an error the user can retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "That's 60 messages in the last hour." }), { status: 429 })),
    );
    renderApp();
    await userEvent.type(screen.getByLabelText("Message the assistant"), "hi{Enter}");
    expect(await screen.findByText("That's 60 messages in the last hour.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("keeps a refused message on screen in an ongoing chat — and editing it asks anew, replacing nothing", async () => {
    let refuse = true;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/assistant/chat" && init?.method === "POST") {
        if (refuse) return new Response(JSON.stringify({ error: "That's 60 messages in the last hour." }), { status: 429 });
        return ndjson(events);
      }
      return new Response(JSON.stringify({ conversation, messages: saved, running: false }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp("Nova", savedChat);

    await userEvent.type(screen.getByLabelText("Message the assistant"), "And last week?{Enter}");
    expect(await screen.findByText("That's 60 messages in the last hour.")).toBeInTheDocument();
    // Nothing was saved, so there is nothing to reload over it.
    expect(fetchMock.mock.calls.filter(([u]) => u === `/api/assistant/conversations/${conversation.id}`)).toHaveLength(0);

    refuse = false;
    const edits = screen.getAllByRole("button", { name: "Edit question" });
    await userEvent.click(edits[edits.length - 1]);
    const box = screen.getByLabelText("Edit your question");
    await userEvent.clear(box);
    await userEvent.type(box, "And the week before?{Enter}");
    const posts = fetchMock.mock.calls.filter(([u]) => u === "/api/assistant/chat");
    expect(JSON.parse(String(posts[posts.length - 1][1]!.body))).toEqual({ conversationId: conversation.id, message: "And the week before?" });
  });

  it("regenerates the latest answer in its place", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/assistant/chat" && init?.method === "POST") return ndjson(events);
      if (url === `/api/assistant/conversations/${conversation.id}`) {
        return new Response(JSON.stringify({ conversation, messages: saved, running: false }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp("Nova", savedChat);

    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    const [, init] = fetchMock.mock.calls.find(([u]) => u === "/api/assistant/chat")!;
    expect(JSON.parse(String(init!.body))).toEqual({ conversationId: conversation.id, message: "How am I doing?", replaceTurnId: "turn-1" });
    // Replaced, not added: the question is still there exactly once.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/assistant/conversations/${conversation.id}`, { cache: "no-store" }));
    await waitFor(() => expect(screen.getAllByText("How am I doing?")).toHaveLength(1));
  });

  it("edits the latest question and answers the new one", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/assistant/chat" && init?.method === "POST") return ndjson(events);
      return new Response(JSON.stringify({ conversation, messages: saved, running: false }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp("Nova", savedChat);

    await userEvent.click(screen.getByRole("button", { name: "Edit question" }));
    const box = screen.getByLabelText("Edit your question");
    await userEvent.clear(box);
    await userEvent.type(box, "How did I do last week?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    const [, init] = fetchMock.mock.calls.find(([u]) => u === "/api/assistant/chat")!;
    expect(JSON.parse(String(init!.body))).toEqual({ conversationId: conversation.id, message: "How did I do last week?", replaceTurnId: "turn-1" });
  });

  it("puts the answer back when the server will not regenerate it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Still answering your previous message in this chat." }), { status: 409 })),
    );
    renderApp("Nova", savedChat);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Still answering your previous message in this chat.");
    expect(screen.getByText("this month.", { exact: false })).toBeInTheDocument();
  });

  it("rates an answer, and takes the rating back", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderApp("Nova", savedChat);

    const up = screen.getByRole("button", { name: "Good answer" });
    await userEvent.click(up);
    expect(up).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).toHaveBeenCalledWith("/api/assistant/messages/a2/feedback", expect.objectContaining({ method: "POST", body: JSON.stringify({ feedback: "up" }) }));
    await userEvent.click(up);
    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/assistant/messages/a2/feedback", expect.objectContaining({ body: JSON.stringify({ feedback: null }) }));
  });

  it("asks in the app — not a browser popup — before deleting a chat", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm");
    renderApp("Nova", { initialConversations: [conversation] });

    await userEvent.click(screen.getByRole("button", { name: "Delete chat" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this chat?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/assistant/conversations/${conversation.id}`, { method: "DELETE" });
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(conversation.title)).not.toBeInTheDocument());
  });
});
