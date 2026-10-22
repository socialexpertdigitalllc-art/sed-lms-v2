import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@/components/common/Toast";
import { LogoField, awaitingDecision, sameAgain } from "@/components/leads/logo/LogoField";
import { withChip } from "@/components/leads/logo/LogoRetryDialog";
import type { LogoGenerationView } from "@/lib/logos/store";

/**
 * The lead page: "Generate logo" by the logo field → designs appear under it →
 * Accept puts the chosen one in the field; Retry changes it or tries a new idea.
 */

afterEach(() => vi.unstubAllGlobals());

const GEN = "11111111-1111-4111-8111-111111111111";
const colors = { present: ["#1e3a8a"], missing: [], offPalette: 0, dominant: [] };
const cand = (index: number, verdict: "exact" | "misspelled", read = "ABC ROOFING") => ({
  index, concept: index, round: 1 as const, url: `https://cdn/${index + 1}.png`, width: 900, height: 300, aspect: 3, horizontal: true, transparent: true, background: "removed" as const,
  colors, check: { verdict, read, extra: [], issues: [], quality: 8 }, score: verdict === "exact" ? 150 : 40,
});
const gen = (over: Partial<LogoGenerationView> = {}): LogoGenerationView => ({
  id: GEN, mode: "new", parentId: null, parentIndex: null, instructions: null, logoText: "ABC Roofing", status: "ready", stage: null,
  concepts: [
    { title: "Roof peak", idea: "A roof peak beside the name.", symbol: "roof", typography: "bold", layout: "icon-left", colorUse: "c" },
    { title: "Clean wordmark", idea: "Just the name.", symbol: "", typography: "bold", layout: "wordmark", colorUse: "c" },
  ],
  candidates: [cand(0, "exact"), cand(1, "misspelled", "ABC ROFING")],
  notes: [], error: null, acceptedIndex: null, acceptedUrl: null, acceptedAt: null, createdAt: new Date().toISOString(), finishedAt: null, userId: "U1", ...over,
});
const brief = { logoText: "ABC Roofing", trade: "Roofing", colors: [{ hex: "#1e3a8a", name: "navy blue", role: "main" }, { hex: "#ea580c", name: "bright orange", role: "accent" }] };

function api(routes: Record<string, (init?: RequestInit) => unknown>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = routes[key];
    if (!handler) return Response.json({ error: `no route ${key}` }, { status: 404 });
    const out = handler(init);
    return out instanceof Response ? out : Response.json(out);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderField(props: Partial<React.ComponentProps<typeof LogoField>> = {}) {
  const onSaved = vi.fn();
  render(
    <ToastProvider>
      <div className="grid">
        <LogoField leadId="L1" logoLink={null} logoViaSms={false} canEdit onSave={vi.fn()} onSaved={onSaved} {...props} />
      </div>
    </ToastProvider>,
  );
  return { onSaved };
}

describe("LogoField", () => {
  it("no logo yet: Generate logo starts a round and shows its progress", async () => {
    const fetchMock = api({
      "GET /api/leads/L1/logo": () => ({ generations: [], brief, budget: { used: 8, limit: 100 } }),
      "POST /api/leads/L1/logo": () => ({ created: true, generation: gen({ status: "running", stage: "drawing", candidates: [cand(0, "exact")] }) }),
    });
    renderField();
    fireEvent.click(await screen.findByRole("button", { name: /Generate logo/ }));
    expect(await screen.findByRole("region", { name: "AI logo generator" })).toBeTruthy();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ mode: "new" });
    expect(screen.getByText(/Drawing the designs/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Progress" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Stop/ })).toBeTruthy();
    // one drawn, three on their way
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    await waitFor(() => expect(screen.getByText(/Today: 8 of 100 designs used/)).toBeTruthy());
  });

  it("designs waiting for a decision open by themselves; the best is shown first; Accept fills the field", async () => {
    const fetchMock = api({
      "GET /api/leads/L1/logo": () => ({ generations: [gen()], brief, budget: { used: 4, limit: 100 } }),
      [`POST /api/leads/L1/logo/${GEN}/accept`]: () => ({ url: "https://i.ibb.co/x/abc-roofing-logo.png", host: "imgbb" }),
    });
    const { onSaved } = renderField();
    const panel = await screen.findByRole("region", { name: "AI logo generator" });
    expect(within(panel).getByText(/Design 1 — Roof peak/)).toBeTruthy();
    expect(within(panel).getByText("A roof peak beside the name.")).toBeTruthy();
    expect(within(panel).getAllByText(/Spelling checked|Spelled right/).length).toBeGreaterThan(0);
    // the misspelled one says what it reads
    fireEvent.click(within(panel).getByRole("radio", { name: "Design 2" }));
    expect(within(panel).getByText(/Reads “ABC ROFING”/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("radio", { name: "Design 1" }));
    // white background chosen
    fireEvent.change(within(panel).getByRole("combobox"), { target: { value: "white" } });
    fireEvent.click(within(panel).getByRole("button", { name: /^Accept$/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/accept"))!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ index: 0, background: "white" });
    expect(await screen.findByText("Logo saved")).toBeTruthy();
  });

  it("replacing a logo the lead already has asks first", async () => {
    const fetchMock = api({
      "GET /api/leads/L1/logo": () => ({ generations: [gen()], brief }),
      [`POST /api/leads/L1/logo/${GEN}/accept`]: () => ({ url: "https://i.ibb.co/new.png", host: "imgbb" }),
    });
    renderField({ logoLink: "https://i.ibb.co/old.png" });
    expect(screen.getByAltText("Current logo")).toBeTruthy();
    expect(screen.getByRole("button", { name: /New logo with AI/ })).toBeTruthy();
    const panel = await screen.findByRole("region", { name: "AI logo generator" });
    fireEvent.click(within(panel).getByRole("button", { name: /^Accept$/ }));
    expect(within(panel).getByText(/replaces the lead's current logo link/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/accept"))).toBe(false);
    fireEvent.click(within(panel).getByRole("button", { name: /Replace it/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/accept"))).toBe(true));
  });

  it("Retry → change this design: says what to change (chips help), then a refine of that design", async () => {
    const fetchMock = api({
      "GET /api/leads/L1/logo": () => ({ generations: [gen()], brief }),
      "POST /api/leads/L1/logo": () => ({ created: true, generation: gen({ id: "22222222-2222-4222-8222-222222222222", status: "running", stage: "concepts", candidates: [], mode: "refine" }) }),
    });
    renderField();
    const panel = await screen.findByRole("region", { name: "AI logo generator" });
    fireEvent.click(within(panel).getByRole("button", { name: /Retry/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("tab", { name: "Change this design" }).getAttribute("aria-selected")).toBe("true");
    const send = within(dialog).getByRole("button", { name: /Draw 4 versions/ }) as HTMLButtonElement;
    expect(send.disabled).toBe(true); // nothing said yet
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpler" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "More bright orange" }));
    expect((within(dialog).getByLabelText("What should change?") as HTMLTextAreaElement).value).toBe("Simpler, more bright orange");
    expect((within(dialog).getByLabelText("Words on the logo") as HTMLInputElement).value).toBe("ABC Roofing");
    fireEvent.click(send);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ mode: "refine", instructions: "Simpler, more bright orange", logoText: "ABC Roofing", parentId: GEN, parentIndex: 0 });
  });

  it("Retry → a new idea (or nothing typed = fresh designs); a refused start shows the reason in the popup", async () => {
    const bodies: unknown[] = [];
    api({
      "GET /api/leads/L1/logo": () => ({ generations: [gen()], brief }),
      "POST /api/leads/L1/logo": (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ error: "That's 15 logo rounds in the last hour — the most one person can run. Try again a little later." }, { status: 429 });
      },
    });
    renderField();
    const panel = await screen.findByRole("region", { name: "AI logo generator" });
    fireEvent.click(within(panel).getByRole("button", { name: /Retry/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Try a new idea" }));
    fireEvent.change(within(dialog).getByLabelText(/Describe the logo you want/), { target: { value: "a shield with a hammer" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Draw 4 designs/ }));
    expect(await within(dialog).findByText(/15 logo rounds in the last hour/)).toBeTruthy();
    expect(bodies[0]).toEqual({ mode: "idea", instructions: "a shield with a hammer", logoText: "ABC Roofing" });
  });

  it("a round that failed says why, with Try again", async () => {
    const fetchMock = api({
      "GET /api/leads/L1/logo": () => ({ generations: [gen({ status: "running" })], brief }),
      [`GET /api/leads/L1/logo/${GEN}`]: () => ({ generation: gen({ status: "failed", candidates: [], error: "The MiniMax plan has no image allowance left right now." }) }),
      "POST /api/leads/L1/logo": () => ({ created: true, generation: gen({ status: "running", candidates: [] }) }),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderField();
      await screen.findByRole("region", { name: "AI logo generator" });
      await vi.advanceTimersByTimeAsync(3000);
      expect(await screen.findByText(/no image allowance left/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
      await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    } finally {
      vi.useRealTimers();
    }
  });

  it("people who can't edit the lead see just the field — no button, no requests", () => {
    const fetchMock = api({});
    renderField({ canEdit: false, logoLink: "https://i.ibb.co/old.png" });
    expect(screen.queryByRole("button", { name: /Generate logo|New logo with AI/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy Logo link" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("chips add their words once", () => {
    expect(withChip("", "Simpler")).toBe("Simpler");
    expect(withChip("make it blue.", "Bolder lettering")).toBe("make it blue, bolder lettering");
    expect(withChip("simpler please", "Simpler")).toBe("simpler please");
  });

  it("Try again repeats the same request", () => {
    expect(sameAgain(gen({ mode: "refine", parentId: GEN, parentIndex: 2, instructions: "simpler" }))).toEqual({ mode: "refine", instructions: "simpler", logoText: "ABC Roofing", parentId: GEN, parentIndex: 2 });
    expect(sameAgain(gen({ mode: "idea", instructions: "a shield" }))).toEqual({ mode: "idea", instructions: "a shield", logoText: "ABC Roofing" });
    expect(sameAgain(gen())).toEqual({ mode: "new", logoText: "ABC Roofing" });
  });

  it("designs come back up only while they're recent and nobody accepted one", () => {
    const now = Date.now();
    expect(awaitingDecision(gen(), now)).toBe(true);
    expect(awaitingDecision(gen({ acceptedIndex: 0 }), now)).toBe(false);
    expect(awaitingDecision(gen({ createdAt: new Date(now - 7 * 3_600_000).toISOString() }), now)).toBe(false);
    expect(awaitingDecision(gen({ candidates: [] }), now)).toBe(false);
  });
});
