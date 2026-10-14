// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SED AI's Personal actions: reminders (its own table), marking bell
 * notifications read and sending feedback (through the app's endpoints).
 * The endpoints are mocked; what is checked is that each action asks for
 * what the endpoint needs, refuses what it would refuse, and calls it with
 * the body the app's own screen sends.
 */

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const routes = vi.hoisted(() => ({
  read: vi.fn<Handler>(async () => Response.json({ ok: true })),
  feedback: vi.fn<Handler>(async () => Response.json({ feedback: { id: "fb-1" } }, { status: 201 })),
}));
const uploads = vi.hoisted(() => ({ readUpload: vi.fn() }));

vi.mock("@/app/api/notifications/[id]/read/route", () => ({ POST: routes.read }));
vi.mock("@/app/api/feedback/route", () => ({ POST: routes.feedback }));
vi.mock("@/lib/assistant/uploads", () => ({ readUpload: uploads.readUpload }));

import { PERSONAL_ACTIONS } from "@/lib/assistant/actions/defs/personal";
import { missingFields, normalizeFields } from "@/lib/assistant/actions/fields";
import { RouteError } from "@/lib/assistant/actions/invoke";
import type { ActionContext, ActionDef, StoredAction, Values } from "@/lib/assistant/actions/types";

/* ------------------------------------------------------------ a fake db */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
interface Write {
  table: string;
  op: string;
  values: unknown;
  where: string[];
}

const asTime = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
function compare(a: unknown, b: unknown): number {
  const [ta, tb] = [asTime(a), asTime(b)];
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}
const like = (value: unknown, pattern: string) =>
  new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i").test(String(value ?? ""));

/** A chainable stand-in for supabase-js over fixture rows; writes change the rows and are logged. */
function fakeSupabase(tables: Tables) {
  const writes: Write[] = [];
  let seq = 0;
  const client = {
    from(table: string) {
      const where: { desc: string; test: (r: Row) => boolean }[] = [];
      let op = "select";
      let payload: unknown = null;
      let mode: "many" | "maybe" | "single" = "many";
      let head = false;
      let counted = false;
      let limit: number | null = null;
      const b: Record<string, unknown> = {};
      const filter = (desc: string, test: (r: Row) => boolean) => {
        where.push({ desc, test });
        return b;
      };
      Object.assign(b, {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          counted = Boolean(opts?.count);
          head = Boolean(opts?.head);
          return b;
        },
        insert: (v: unknown) => ((op = "insert"), (payload = v), b),
        update: (v: unknown) => ((op = "update"), (payload = v), b),
        delete: () => ((op = "delete"), b),
        eq: (c: string, v: unknown) => filter(`${c}=${String(v)}`, (r) => r[c] === v),
        neq: (c: string, v: unknown) => filter(`${c}!=${String(v)}`, (r) => r[c] !== v),
        is: (c: string, v: unknown) => filter(`${c} is ${String(v)}`, (r) => (r[c] ?? null) === v),
        in: (c: string, vs: unknown[]) => filter(`${c} in ${vs.join(",")}`, (r) => vs.includes(r[c])),
        lte: (c: string, v: unknown) => filter(`${c}<=${String(v)}`, (r) => compare(r[c], v) <= 0),
        lt: (c: string, v: unknown) => filter(`${c}<${String(v)}`, (r) => compare(r[c], v) < 0),
        gte: (c: string, v: unknown) => filter(`${c}>=${String(v)}`, (r) => compare(r[c], v) >= 0),
        ilike: (c: string, p: string) => filter(`${c}~${p}`, (r) => like(r[c], p)),
        or: (expr: string) =>
          filter(`or(${expr})`, (r) =>
            expr.split(",").some((part) => {
              const [c, kind, ...rest] = part.split(".");
              const v = rest.join(".");
              return kind === "ilike" ? like(r[c], v) : String(r[c]) === v;
            }),
          ),
        order: () => b,
        limit: (n: number) => ((limit = n), b),
        maybeSingle: () => ((mode = "maybe"), b),
        single: () => ((mode = "single"), b),
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          const rows = (tables[table] ??= []);
          const match = () => rows.filter((r) => where.every((w) => w.test(r)));
          let out: Row[];
          if (op === "insert") {
            out = ((Array.isArray(payload) ? payload : [payload]) as Row[]).map((v) => ({ id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, ...v }));
            rows.push(...out);
          } else if (op === "update") {
            out = match();
            for (const r of out) Object.assign(r, payload as Row);
          } else if (op === "delete") {
            out = match();
            tables[table] = rows.filter((r) => !out.includes(r));
          } else {
            out = match();
            if (limit !== null) out = out.slice(0, limit);
          }
          if (op !== "select") writes.push({ table, op, values: payload, where: where.map((w) => w.desc) });
          const data = head ? null : mode === "many" ? out.map((r) => ({ ...r })) : out[0] ? { ...out[0] } : null;
          const error = mode === "single" && !out[0] ? { message: "no rows" } : null;
          return Promise.resolve({ data, error, ...(counted ? { count: out.length } : {}) }).then(resolve, reject);
        },
      });
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, writes };
}

/* --------------------------------------------------------------- fixtures */

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const TICKET = "44444444-4444-4444-8444-444444444444";
const REMINDER = "55555555-5555-4555-8555-555555555555";
const N1 = "66666666-6666-4666-8666-000000000001";
const N2 = "66666666-6666-4666-8666-000000000002";
const N3 = "66666666-6666-4666-8666-000000000003";
const UPLOAD = "77777777-7777-4777-8777-777777777777";
const ACTION = "88888888-8888-4888-8888-888888888888";
/** 10:00 in Karachi (UTC+5). */
const NOW = new Date("2026-10-14T05:00:00Z");

let tables: Tables;
let db: ReturnType<typeof fakeSupabase>;

function fixtures(): Tables {
  return {
    profiles: [
      { id: ME, display_name: "Sam Khan", email: "sam@sed.test", is_active: true },
      { id: OTHER, display_name: "Ali Raza", email: "ali@sed.test", is_active: true },
    ],
    leads: [{ id: LEAD, business_name: "Jumbo's Pizza", status: "Ready", agent_id: ME, deleted_at: null }],
    lead_tickets: [{ id: TICKET, title: "Logo is blurry", status: "Open", lead_id: LEAD, created_by: ME, assigned_to: null, leads: { business_name: "Jumbo's Pizza" } }],
    assistant_actions: [{ id: ACTION, user_id: ME }],
    assistant_reminders: [{ id: REMINDER, user_id: ME, text: "call Jumbo's", remind_at: "2026-10-15T05:00:00Z", status: "pending" }],
    notifications: [
      { id: N1, user_id: ME, title: "New lead submitted", body: "Jumbo's Pizza", read_at: null, bell: "general", deliver_after: "2026-10-14T04:00:00Z" },
      { id: N2, user_id: ME, title: "Website ready", body: "Jumbo's Pizza", read_at: null, bell: "website", deliver_after: "2026-10-14T04:30:00Z" },
      { id: N3, user_id: ME, title: "Ticket resolved", body: "Logo", read_at: "2026-10-13T10:00:00Z", bell: "general", deliver_after: "2026-10-13T09:00:00Z" },
      { id: "66666666-6666-4666-8666-000000000009", user_id: OTHER, title: "Someone else's", body: "", read_at: null, bell: "general", deliver_after: "2026-10-14T04:00:00Z" },
    ],
    assistant_uploads: [{ id: UPLOAD, user_id: ME, name: "shot.png", mime: "image/png", size_bytes: 2048 }],
  };
}

function ctxFor(perms: string[] = [], over: Partial<ActionContext> = {}): ActionContext {
  return {
    userId: ME,
    displayName: "Sam Khan",
    perms: new Set(perms),
    db: db.client,
    admin: db.client,
    timezone: "Asia/Karachi",
    now: NOW,
    isAdmin: false,
    ...over,
  };
}

const def = (key: string): ActionDef => {
  const d = PERSONAL_ACTIONS.find((a) => a.key === key);
  if (!d) throw new Error(`no action ${key}`);
  return d;
};

/** What prepare_action does before drawing a card: normalise, count what is missing, run the check. */
async function prepare(key: string, raw: Values, ctx = ctxFor()) {
  const d = def(key);
  const n = await normalizeFields(d, raw, ctx);
  const missing = missingFields(d, n.values, n.problems).map((f) => f.name);
  const checked = (await d.check?.(n.values, ctx)) ?? {};
  Object.assign(n.values, checked.values ?? {});
  return { values: n.values, display: n.display, missing, problems: [...n.problems, ...(checked.problems ?? [])], warnings: checked.warnings ?? [] };
}

function stored(key: string, input: Values, over: Partial<StoredAction> = {}): StoredAction {
  return {
    id: ACTION,
    user_id: ME,
    conversation_id: null,
    turn_id: null,
    tool_call_id: null,
    plan_id: null,
    plan_index: null,
    plan_title: null,
    action_key: key,
    title: key,
    risk: "standard",
    input,
    card: {},
    before_state: null,
    confirm_phrase: null,
    status: "done",
    result: null,
    error: null,
    source: "chat",
    approver_id: null,
    approval_note: null,
    decided_at: null,
    reported_at: null,
    undo_until: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    executed_at: NOW.toISOString(),
    expires_at: NOW.toISOString(),
    ...over,
  };
}

const info = { actionId: ACTION, origin: "https://dash.test" };
const lastRequest = (fn: { mock: { calls: unknown[][] } }, i = -1) => fn.mock.calls.at(i)?.[0] as Request;
const lastParams = async (fn: { mock: { calls: unknown[][] } }) => (fn.mock.calls.at(-1)?.[1] as { params: Promise<Record<string, string>> }).params;

beforeEach(() => {
  tables = fixtures();
  db = fakeSupabase(tables);
  routes.read.mockClear();
  routes.feedback.mockClear();
  uploads.readUpload.mockReset();
});

/* ----------------------------------------------------------------- tests */

describe("who may use the personal actions", () => {
  it("lets anyone in action mode set and cancel reminders and mark their notifications", () => {
    for (const key of ["reminder.create", "reminder.cancel", "notification.read"]) expect(def(key).allowed(ctxFor())).toBeNull();
  });

  it("needs Submit Feedback for feedback, as the feedback endpoint does", () => {
    expect(def("feedback.submit").allowed(ctxFor())).toBe("Your account doesn't have “Submit Feedback”.");
    expect(def("feedback.submit").allowed(ctxFor(["feedback.submit"]))).toBeNull();
  });

  it("files every action under Personal, with the agreed keys", () => {
    expect(PERSONAL_ACTIONS.map((a) => a.key)).toEqual(["reminder.create", "reminder.cancel", "notification.read", "feedback.submit"]);
    expect(PERSONAL_ACTIONS.every((a) => a.group === "Personal")).toBe(true);
  });
});

describe("reminder.create", () => {
  it("asks for what and when, and nothing else", async () => {
    expect((await prepare("reminder.create", {})).missing).toEqual(["text", "remind_at"]);
    expect((await prepare("reminder.create", { text: "call Jumbo's" })).missing).toEqual(["remind_at"]);
  });

  it("reads a wall-clock time in company time and refuses one that has passed", async () => {
    const ok = await prepare("reminder.create", { text: "call Jumbo's", remind_at: "2026-10-15T10:00" });
    expect(ok.missing).toEqual([]);
    expect(ok.problems).toEqual([]);
    expect(ok.values.remind_at).toBe("2026-10-15T05:00:00.000Z");
    const past = await prepare("reminder.create", { text: "call Jumbo's", remind_at: "2026-10-14T09:00" });
    expect(past.problems[0]).toMatchObject({ field: "remind_at" });
    expect(past.problems[0].message).toMatch(/must be in the future/);
  });

  it("finds the lead it is about by name", async () => {
    const r = await prepare("reminder.create", { text: "call", remind_at: "2026-10-15T10:00", lead: "jumbo's" });
    expect(r.problems).toEqual([]);
    expect(r.values.lead).toBe(LEAD);
    expect(r.display.lead).toBe("Jumbo's Pizza");
  });

  it("saves the reminder for the person who asked, opening the lead", async () => {
    const r = await prepare("reminder.create", { text: "call Jumbo's", remind_at: "2026-10-15T10:00", lead: LEAD });
    const res = await def("reminder.create").execute(r.values, ctxFor(), info);
    const row = tables.assistant_reminders.at(-1)!;
    expect(row).toMatchObject({
      user_id: ME,
      text: "call Jumbo's",
      remind_at: "2026-10-15T05:00:00.000Z",
      lead_id: LEAD,
      ticket_id: null,
      target_url: `/leads/${LEAD}`,
      status: "pending",
      action_id: ACTION,
    });
    expect(res.data).toEqual({ id: row.id, kind: "reminder" });
    expect(res.link).toEqual({ href: `/leads/${LEAD}`, label: "Open lead" });
    expect(res.message).toBe("Reminder set for Thu, Oct 15, 10:00 AM: call Jumbo's.");
  });

  it("opens the ticket when it is about a ticket", async () => {
    const ctx = ctxFor(["tickets.view_all"]);
    const r = await prepare("reminder.create", { text: "check the logo", remind_at: "2026-10-15T10:00", ticket: TICKET }, ctx);
    expect(r.problems).toEqual([]);
    await def("reminder.create").execute(r.values, ctx, info);
    expect(tables.assistant_reminders.at(-1)).toMatchObject({ ticket_id: TICKET, target_url: `/tickets/${TICKET}` });
  });

  it("reminds the requester, not the approver who confirmed it", async () => {
    tables.assistant_actions[0].user_id = OTHER;
    const r = await prepare("reminder.create", { text: "call", remind_at: "2026-10-15T10:00" });
    await def("reminder.create").execute(r.values, ctxFor(), info);
    expect(tables.assistant_reminders.at(-1)).toMatchObject({ user_id: OTHER, target_url: null });
  });

  it("shows when it goes off on the card", async () => {
    const r = await prepare("reminder.create", { text: "call Jumbo's", remind_at: "2026-10-15T10:00", lead: LEAD });
    const p = await def("reminder.create").preview!(r.values, ctxFor());
    expect(p.title).toBe("Remind me Thu, Oct 15, 10:00 AM: call Jumbo's");
    expect(p.notes?.[0]).toContain("that opens the lead");
  });

  it("undo cancels it — unless it already went off", async () => {
    const r = await prepare("reminder.create", { text: "call", remind_at: "2026-10-15T10:00" });
    const res = await def("reminder.create").execute(r.values, ctxFor(), info);
    const s = stored("reminder.create", r.values, { result: res });
    expect(await def("reminder.create").undo!.run(s, ctxFor())).toBe("the reminder is cancelled.");
    expect(tables.assistant_reminders.at(-1)?.status).toBe("cancelled");

    const again = await def("reminder.create").execute(r.values, ctxFor(), info);
    tables.assistant_reminders.at(-1)!.status = "sent";
    await expect(def("reminder.create").undo!.run(stored("reminder.create", r.values, { result: again }), ctxFor())).rejects.toThrow("already gone off");
  });
});

describe("reminder.cancel", () => {
  it("names the reminder and cancels only a pending one", async () => {
    const r = await prepare("reminder.cancel", { reminder: REMINDER });
    expect(r.problems).toEqual([]);
    expect(r.values.__name).toBe("call Jumbo's");
    const res = await def("reminder.cancel").execute(r.values, ctxFor(), info);
    expect(res.message).toBe("Cancelled the reminder “call Jumbo's”.");
    expect(tables.assistant_reminders[0].status).toBe("cancelled");
    expect(db.writes.at(-1)?.where).toEqual([`id=${REMINDER}`, `user_id=${ME}`, "status=pending"]);
  });

  it("says when it already went off or was cancelled", async () => {
    tables.assistant_reminders[0].status = "sent";
    expect((await prepare("reminder.cancel", { reminder: REMINDER })).problems[0].message).toBe("That reminder has already gone off.");
    tables.assistant_reminders[0].status = "cancelled";
    expect((await prepare("reminder.cancel", { reminder: REMINDER })).problems[0].message).toBe("That reminder is already cancelled.");
  });

  it("refuses on confirm if the reminder went off after the card was shown", async () => {
    const r = await prepare("reminder.cancel", { reminder: REMINDER });
    const p = await def("reminder.cancel").preview!(r.values, ctxFor());
    expect(p.title).toBe("Cancel the reminder “call Jumbo's”");
    tables.assistant_reminders[0].status = "sent";
    expect(await def("reminder.cancel").stale!(p.before, r.values, ctxFor())).toBe("it has already gone off.");
    await expect(def("reminder.cancel").execute(r.values, ctxFor(), info)).rejects.toBeInstanceOf(RouteError);
  });

  it("cannot reach someone else's reminder", async () => {
    tables.assistant_reminders[0].user_id = OTHER;
    const r = await prepare("reminder.cancel", { reminder: REMINDER });
    expect(r.problems[0]).toMatchObject({ field: "reminder" });
  });

  it("undo puts it back on", async () => {
    const r = await prepare("reminder.cancel", { reminder: REMINDER });
    await def("reminder.cancel").execute(r.values, ctxFor(), info);
    expect(await def("reminder.cancel").undo!.run(stored("reminder.cancel", r.values), ctxFor())).toBe("the reminder is back on.");
    expect(tables.assistant_reminders[0].status).toBe("pending");
  });
});

describe("notification.read", () => {
  it("asks which notifications unless it is all of them", async () => {
    expect((await prepare("notification.read", {})).missing).toEqual(["notifications"]);
    const all = await prepare("notification.read", { all: true });
    expect(all.missing).toEqual([]);
    expect(all.problems).toEqual([]);
  });

  it("marks all unread through the endpoint's own 'all', scoped to one bell", async () => {
    const r = await prepare("notification.read", { all: true, bell: "Website" });
    expect(r.values.bell).toBe("website");
    const p = await def("notification.read").preview!(r.values, ctxFor());
    expect(p.title).toBe("Mark the 1 unread notification on the website bell read");
    expect((await def("notification.read").preview!({ all: true }, ctxFor())).title).toBe("Mark all 2 unread notifications read");
    const res = await def("notification.read").execute(r.values, ctxFor(), info);
    const req = lastRequest(routes.read);
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/api/notifications/all/read");
    expect(new URL(req.url).searchParams.get("bell")).toBe("website");
    expect(await lastParams(routes.read)).toEqual({ id: "all" });
    expect(res.data).toEqual({ ids: [N2] });
  });

  it("marks particular ones one by one, skipping those already read", async () => {
    const r = await prepare("notification.read", { notifications: [N1, N3] });
    expect(r.problems).toEqual([]);
    const res = await def("notification.read").execute(r.values, ctxFor(), info);
    expect(routes.read).toHaveBeenCalledTimes(1);
    expect(new URL(lastRequest(routes.read).url).pathname).toBe(`/api/notifications/${N1}/read`);
    expect(await lastParams(routes.read)).toEqual({ id: N1 });
    expect(res).toMatchObject({ message: "Marked 1 notification read.", data: { ids: [N1] } });
  });

  it("says so when there is nothing unread", async () => {
    const read = await prepare("notification.read", { notifications: [N3] });
    expect(read.problems[0].message).toBe("That notification is already read.");
    for (const n of tables.notifications) n.read_at = "2026-10-14T04:59:00Z";
    expect((await prepare("notification.read", { all: true })).problems[0].message).toBe("You have no unread notifications.");
  });

  it("cannot name someone else's notification", async () => {
    const r = await prepare("notification.read", { notifications: ["66666666-6666-4666-8666-000000000009"] });
    expect(r.problems[0]).toMatchObject({ field: "notifications" });
  });

  it("undo makes exactly those unread again", async () => {
    const s = stored("notification.read", { notifications: [N1] }, { result: { message: "", data: { ids: [N1] } } });
    tables.notifications[0].read_at = "2026-10-14T05:00:00Z";
    expect(await def("notification.read").undo!.run(s, ctxFor())).toBe("1 notification unread again.");
    expect(tables.notifications[0].read_at).toBeNull();
    expect(db.writes.at(-1)?.where).toEqual([`user_id=${ME}`, `id in ${N1}`]);
  });
});

describe("feedback.submit", () => {
  const ctx = () => ctxFor(["feedback.submit"]);

  it("asks for the type and the title, with the Feedback form's types", async () => {
    expect((await prepare("feedback.submit", {}, ctx())).missing).toEqual(["type", "title"]);
    const r = await prepare("feedback.submit", { type: "feature request", title: "Dark mode" }, ctx());
    expect(r.missing).toEqual([]);
    expect(r.values.type).toBe("Feature request");
    expect((await prepare("feedback.submit", { type: "complaint", title: "x" }, ctx())).problems[0].message).toMatch(/Bug, Feature request, Other/);
  });

  it("sends the Feedback form's multipart request, with the chat screenshot as a file", async () => {
    uploads.readUpload.mockResolvedValue({ row: { name: "shot.png", mime: "image/png" }, blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }) });
    const r = await prepare("feedback.submit", { type: "Bug", title: "Leads page is slow", description: "Takes 10s to load", screenshot: UPLOAD }, ctx());
    expect(r.problems).toEqual([]);
    expect(r.values.screenshot).toBe(`upload:${UPLOAD}`);
    const res = await def("feedback.submit").execute(r.values, ctx(), info);
    expect(uploads.readUpload).toHaveBeenCalledWith(db.client, ME, UPLOAD);
    const form = await lastRequest(routes.feedback).formData();
    expect(JSON.parse(String(form.get("payload")))).toEqual({ type: "Bug", title: "Leads page is slow", description: "Takes 10s to load" });
    const file = form.get("screenshot") as File;
    expect(file.name).toBe("shot.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(4);
    expect(res).toMatchObject({ message: "Sent your bug report “Leads page is slow” to the team.", data: { id: "fb-1" } });
  });

  it("sends no screenshot part and a null description when there are none", async () => {
    const r = await prepare("feedback.submit", { type: "Other", title: "Thanks!" }, ctx());
    await def("feedback.submit").execute(r.values, ctx(), info);
    const form = await lastRequest(routes.feedback).formData();
    expect(JSON.parse(String(form.get("payload")))).toEqual({ type: "Other", title: "Thanks!", description: null });
    expect(form.get("screenshot")).toBeNull();
  });

  it("refuses a screenshot the endpoint would drop", async () => {
    tables.assistant_uploads[0].size_bytes = 6 * 1024 * 1024;
    expect((await prepare("feedback.submit", { type: "Bug", title: "x", screenshot: UPLOAD }, ctx())).problems[0].message).toBe("The screenshot must be 5 MB or smaller.");
    tables.assistant_uploads[0] = { ...tables.assistant_uploads[0], size_bytes: 10, mime: "application/pdf" };
    expect((await prepare("feedback.submit", { type: "Bug", title: "x", screenshot: UPLOAD }, ctx())).problems[0].message).toBe("The screenshot must be an image.");
    const link = await prepare("feedback.submit", { type: "Bug", title: "x", screenshot: "https://imgur.com/abc.png" }, ctx());
    expect(link.problems[0].message).toMatch(/Attach the screenshot as a file/);
  });

  it("lets the endpoint's own refusal through", async () => {
    routes.feedback.mockResolvedValueOnce(Response.json({ error: "Forbidden" }, { status: 403 }));
    const r = await prepare("feedback.submit", { type: "Bug", title: "x" }, ctx());
    await expect(def("feedback.submit").execute(r.values, ctx(), info)).rejects.toThrow("Forbidden");
  });
});
