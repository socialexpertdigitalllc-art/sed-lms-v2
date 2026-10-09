import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/common/Toast";
import { AssistantProvider } from "@/providers/AssistantProvider";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";
import { AssistantHeaderButton } from "@/components/assistant/AssistantHeaderButton";
import AssistantPanel from "@/components/assistant/AssistantPanel";
import type { AssistantStreamEvent } from "@/lib/assistant/types";

/**
 * The assistant everywhere: the header entry, the floating button on every
 * screen, and the chat it opens in front of the page — all under the name
 * this user gave it, and never under a vendor's.
 */

const nav = vi.hoisted(() => ({ path: "/dashboard" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function withProviders(ui: React.ReactNode, opts: { enabled?: boolean; name?: string | null } = {}) {
  return (
    <ToastProvider>
      <AssistantProvider
        enabled={opts.enabled ?? true}
        userId="sam"
        displayName="Sam Khan"
        initialName={opts.name === undefined ? "Nova" : opts.name}
      >
        {ui}
      </AssistantProvider>
    </ToastProvider>
  );
}

const conversation = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Pipeline check",
  pinned: false,
  created_at: "2026-10-09T10:00:00Z",
  updated_at: "2026-10-09T10:00:00Z",
  last_message_at: "2026-10-09T10:00:00Z",
};

function ndjson(list: AssistantStreamEvent[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const e of list) c.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
        c.close();
      },
    }),
    { status: 200 },
  );
}

beforeEach(() => {
  nav.path = "/dashboard";
  window.localStorage.clear();
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

describe("header entry", () => {
  it("shows the user's own name for the assistant and opens the full page", () => {
    render(withProviders(<AssistantHeaderButton />));
    const link = screen.getByRole("link", { name: "Open Nova" });
    expect(link).toHaveAttribute("href", "/assistant");
    expect(link).toHaveTextContent("Nova");
  });

  it("is the SED Assistant until the user names it", () => {
    render(withProviders(<AssistantHeaderButton />, { name: null }));
    expect(screen.getByRole("link", { name: "Open SED Assistant" })).toHaveTextContent("SED Assistant");
  });

  it("does not exist for someone without access", () => {
    render(withProviders(<AssistantHeaderButton />, { enabled: false }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("floating assistant", () => {
  it("sits on every screen and opens the chat in front of the page", async () => {
    render(withProviders(<AssistantWidget />));
    const launcher = screen.getByRole("button", { name: "Ask Nova" });
    await userEvent.click(launcher);
    expect(await screen.findByRole("dialog", { name: "Nova chat" })).toBeInTheDocument();
    // Closing it hands focus back to the floating button.
    await userEvent.click(screen.getByRole("button", { name: "Close Nova" }));
    expect(screen.queryByRole("dialog", { name: "Nova chat" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask Nova" })).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: "Ask Nova" }));
    expect(screen.getByRole("dialog", { name: "Nova chat" })).toBeInTheDocument();
    // The floating button now hides the chat — and says so.
    await userEvent.click(screen.getByRole("button", { name: "Hide Nova" }));
    expect(screen.queryByRole("dialog", { name: "Nova chat" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask Nova" })).toBeInTheDocument();
  });

  it("stays out of the way on the full Assistant page, and for someone without access", () => {
    nav.path = "/assistant";
    const { unmount } = render(withProviders(<AssistantWidget />));
    expect(screen.queryByRole("button", { name: /Ask/ })).not.toBeInTheDocument();
    unmount();
    nav.path = "/leads";
    render(withProviders(<AssistantWidget />, { enabled: false }));
    expect(screen.queryByRole("button", { name: /Ask/ })).not.toBeInTheDocument();
  });
});

describe("the floating chat", () => {
  it("asks for a name the first time, then greets the user with it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, ui_preferences: { assistantName: "Sage" } }), { status: 200 })),
    );
    render(withProviders(<AssistantPanel hidden={false} onClose={() => {}} />, { name: null }));
    expect(screen.getByText("Meet your SED Assistant")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sage" }));
    await userEvent.click(screen.getByRole("button", { name: "Save and start" }));
    expect(await screen.findByText("Hi Sam, I'm Sage.")).toBeInTheDocument();
  });

  it("chats right there, remembers the open conversation, and never names a model", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/assistant/chat" && init?.method === "POST") {
        return ndjson([
          { type: "start", conversation, userMessageId: "turn-1" },
          { type: "tool_start", callId: "c1", name: "get_pipeline_summary", label: "Reading the pipeline", args: {} },
          { type: "tool_end", callId: "c1", name: "get_pipeline_summary", ok: true, summary: "12 leads · 3 closed", durationMs: 20 },
          { type: "text", delta: "You have **3** closes." },
          { type: "done", messageId: "a1", stopped: false },
        ]);
      }
      if (url === `/api/assistant/conversations/${conversation.id}`) {
        return new Response(
          JSON.stringify({
            conversation,
            running: false,
            messages: [
              { id: "turn-1", turn_id: "turn-1", role: "user", content: "How many closes?", reasoning: null, tool_calls: null, tool_call_id: null, tool_name: null, meta: null, status: "complete", error: null, created_at: "" },
              { id: "a0", turn_id: "turn-1", role: "assistant", content: "", reasoning: null, tool_calls: [{ id: "c1", name: "get_pipeline_summary" }], tool_call_id: null, tool_name: null, meta: null, status: "complete", error: null, created_at: "" },
              { id: "t0", turn_id: "turn-1", role: "tool", content: "{}", reasoning: null, tool_calls: null, tool_call_id: "c1", tool_name: "get_pipeline_summary", meta: { label: "Reading the pipeline", ok: true, summary: "12 leads · 3 closed", duration_ms: 20 }, status: "complete", error: null, created_at: "" },
              { id: "a1", turn_id: "turn-1", role: "assistant", content: "You have **3** closes.", reasoning: null, tool_calls: null, tool_call_id: null, tool_name: null, meta: null, status: "complete", error: null, created_at: "" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    render(withProviders(<AssistantPanel hidden={false} onClose={onClose} />));

    expect(screen.getByText("Hi Sam, I'm Nova.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Message the assistant"), "How many closes?{Enter}");

    expect(await screen.findByText("closes.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Reading the pipeline")).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem("sed-assistant:open-chat:sam")).toBe(conversation.id));
    expect(screen.getByRole("link", { name: "Open full screen" })).toHaveAttribute("href", `/assistant?c=${conversation.id}`);
    expect(document.body.textContent).not.toMatch(/minimax|gemini/i);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("reopens the chat it had open last time", async () => {
    window.localStorage.setItem("sed-assistant:open-chat:sam", conversation.id);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            conversation,
            running: false,
            messages: [
              { id: "turn-1", turn_id: "turn-1", role: "user", content: "Earlier question", reasoning: null, tool_calls: null, tool_call_id: null, tool_name: null, meta: null, status: "complete", error: null, created_at: "" },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(withProviders(<AssistantPanel hidden={false} onClose={() => {}} />));
    expect(await screen.findByText("Earlier question")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/assistant/conversations/${conversation.id}`, { cache: "no-store" });
  });

  it("starts fresh when the remembered chat was deleted", async () => {
    window.localStorage.setItem("sed-assistant:open-chat:sam", conversation.id);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404 })));
    render(withProviders(<AssistantPanel hidden={false} onClose={() => {}} />));
    await waitFor(() => expect(window.localStorage.getItem("sed-assistant:open-chat:sam")).toBeNull());
    expect(await screen.findByText("Hi Sam, I'm Nova.")).toBeInTheDocument();
  });
});
