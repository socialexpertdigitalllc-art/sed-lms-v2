// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FORM_ACTIONS, originHost } from "@/lib/assistant/actions/defs/forms";
import { missingFields, normalizeFields } from "@/lib/assistant/actions/fields";
import { RouteError } from "@/lib/assistant/actions/invoke";
import type { ActionContext, ActionDef, StoredAction, Values } from "@/lib/assistant/actions/types";

/**
 * Client contact forms. The Forms endpoints scope a manager to leads they
 * are the agent or closer of (unless leads.view_all): the actions say so
 * before confirming. The resend endpoint answers 200 even when the email
 * fails, so the action reads its result.
 */

const h = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn(), resend: vi.fn() }));
vi.mock("@/app/api/forms/endpoints/route", () => ({ POST: h.create }));
vi.mock("@/app/api/forms/endpoints/[id]/route", () => ({ DELETE: h.remove }));
vi.mock("@/app/api/forms/submissions/[id]/resend/route", () => ({ POST: h.resend }));
vi.mock("@/lib/assistant/actions/checks", () => ({ checkEmail: vi.fn(async () => ({ problems: [], warnings: [], notes: [] })) }));

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const like = (v: unknown, p: string) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i").test(String(v ?? ""));
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let limit: number | null = null;
      let single = false;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        order: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
        or: (expr: string) => {
          const parts = expr.split(",").map((s) => s.split("."));
          filters.push((r) => parts.some(([c, op, ...v]) => (op === "ilike" ? like(r[c], v.join(".")) : String(r[c]) === v.join("."))));
          return b;
        },
        limit: (n: number) => ((limit = n), b),
        maybeSingle: () => ((single = true), b),
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).map((r) => structuredClone(r));
          if (limit !== null) rows = rows.slice(0, limit);
          return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }).then(resolve, reject);
        },
      });
      return b;
    },
  } as unknown as SupabaseClient;
}

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "aaaaaaaa-0000-4000-8000-000000000002";
const LEAD = "11111111-1111-4111-8111-111111111111";
const OTHERS_LEAD = "22222222-2222-4222-8222-222222222222";
const ENDPOINT = "33333333-3333-4333-8333-333333333333";
const SUB = "44444444-4444-4444-8444-444444444444";
const SPAM = "55555555-5555-4555-8555-555555555555";
const OTHERS_SUB = "66666666-6666-4666-8666-666666666666";
const BOX = "77777777-7777-4777-8777-777777777777";

function fixtures(): Record<string, Row[]> {
  return {
    leads: [
      { id: LEAD, business_name: "Acme Roofing", business_email: "Owner@AcmeRoofing.com", no_email: false, website_link: "https://www.acmeroofing.com/", agent_id: ME, closed_by: null, status: "Closed", deleted_at: null },
      { id: OTHERS_LEAD, business_name: "Other Co", business_email: "x@other.com", no_email: false, website_link: null, agent_id: OTHER, closed_by: null, status: "Ready", deleted_at: null },
    ],
    form_endpoints: [{ id: ENDPOINT, lead_id: LEAD, name: "Acme Roofing – contact", status: "active", to_emails: ["owner@acmeroofing.com"] }],
    form_submissions: [
      { id: SUB, endpoint_id: ENDPOINT, lead_id: LEAD, subject: "Quote please", submitter_name: "Jo Visitor", submitter_email: "jo@visitor.com", is_spam: false, delivery_status: "failed", delivered_at: null, created_at: "2026-10-13T10:00:00Z" },
      { id: SPAM, endpoint_id: ENDPOINT, lead_id: LEAD, subject: "Buy now", submitter_name: "Bot", submitter_email: "bot@spam.com", is_spam: true, delivery_status: "skipped", delivered_at: null, created_at: "2026-10-13T11:00:00Z" },
      { id: OTHERS_SUB, endpoint_id: "ep-other", lead_id: OTHERS_LEAD, subject: "Hello", submitter_name: "Kim", submitter_email: "kim@x.com", is_spam: false, delivery_status: "sent", delivered_at: "2026-10-12T10:00:00Z", created_at: "2026-10-12T10:00:00Z" },
    ],
    company_mailboxes: [{ id: BOX, email_address: "forms@sed.com", display_name: "SED Forms", user_id: OTHER, status: "verified" }],
    profiles: [{ id: ME, display_name: "Sam Khan" }],
  };
}

function ctxFor(over: Partial<ActionContext> = {}, tables = fixtures()): ActionContext {
  const db = fakeDb(tables);
  return { userId: ME, displayName: "Sam Khan", perms: new Set(["forms.manage", "forms.view"]), db, admin: db, timezone: "Asia/Karachi", now: new Date("2026-10-14T07:00:00Z"), isAdmin: false, ...over };
}

const def = (key: string): ActionDef => FORM_ACTIONS.find((x) => x.key === key)!;
const INFO = { actionId: "act-1", origin: "https://dashboard.example" };
const json = (body: unknown, status = 200) => Response.json(body, { status });

async function propose(d: ActionDef, raw: Values, ctx: ActionContext) {
  const n = await normalizeFields(d, raw, ctx);
  const missing = missingFields(d, n.values, n.problems).map((f) => f.name);
  const r = (await d.check?.(n.values, ctx)) ?? {};
  Object.assign(n.values, r.values ?? {});
  return { values: n.values, missing, problems: [...n.problems, ...(r.problems ?? [])], warnings: r.warnings ?? [] };
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
});

describe("who may", () => {
  it("needs Manage Form Endpoints, like the endpoints", () => {
    const viewer = ctxFor({ perms: new Set(["forms.view"]) });
    for (const d of FORM_ACTIONS) {
      expect(d.allowed(viewer)).toBe("Your account doesn't have “Manage Form Endpoints”.");
      expect(d.allowed(ctxFor())).toBeNull();
    }
  });
});

describe("form.setup", () => {
  const d = def("form.setup");

  it("asks for a name and recipients only when there is no lead to take them from", async () => {
    const ctx = ctxFor();
    const none = await normalizeFields(d, {}, ctx);
    expect(missingFields(d, none.values, none.problems).map((f) => f.name)).toEqual(["name", "to_emails"]);
    const p = await propose(d, { lead: LEAD, allowed_origins: "*.acmeroofing.com" }, ctx);
    expect(p.missing).toEqual([]);
    expect(p.problems).toEqual([]);
    expect(p.values).toMatchObject({ name: "Acme Roofing – contact", to_emails: ["owner@acmeroofing.com"], daily_limit: 200, status: "active" });
    expect(p.warnings).toEqual(['Acme Roofing already has a contact form, "Acme Roofing – contact" (active) — this adds another.']);
  });

  it("keeps a manager without leads.view_all to leads they work, as the endpoint does", async () => {
    const p = await propose(d, { lead: OTHERS_LEAD }, ctxFor());
    expect(p.problems).toEqual([{ field: "lead", message: "You can only add a form to a lead you are the agent or closer of." }]);
    const all = await propose(d, { lead: OTHERS_LEAD }, ctxFor({ perms: new Set(["forms.manage", "leads.view_all"]) }));
    expect(all.problems).toEqual([]);
  });

  it("turns pasted addresses into hostnames, and warns about what they leave out", async () => {
    expect(originHost("https://www.AcmeRoofing.com/contact?x=1")).toBe("www.acmeroofing.com");
    expect(originHost("acmeroofing.com/")).toBe("acmeroofing.com");
    // The list field drops a leading "*" as if it were a bullet: the wildcard is put back.
    expect(originHost(".acmeroofing.com")).toBe("*.acmeroofing.com");
    const ctx = ctxFor();
    const p = await propose(d, { lead: LEAD, allowed_origins: ["https://acmeroofing.com/contact"] }, ctx);
    expect(p.values.allowed_origins).toEqual(["acmeroofing.com"]);
    expect(p.warnings).toContain("acmeroofing.com does not cover www.acmeroofing.com — use *.acmeroofing.com if the site is also served with www.");
    const open = await propose(d, { lead: LEAD }, ctx);
    expect(open.warnings).toContain("Any website can post to this form — add acmeroofing.com as an allowed site to keep spam out.");
    const bad = await propose(d, { lead: LEAD, allowed_origins: ["not a host"], timezone: "Mars/Olympus", to_emails: "owner@acme, ok@acme.com" }, ctx);
    expect(bad.problems.map((x) => x.field).sort()).toEqual(["allowed_origins", "timezone", "to_emails"]);
  });

  it("posts the endpoint editor's payload and hands back the access key and snippet", async () => {
    h.create.mockImplementation(async (req: Request) => {
      const body = await req.json();
      return json({ endpoint: { ...body, id: "ep-new", access_key: "k3y-abc" } }, 201);
    });
    const ctx = ctxFor();
    const p = await propose(d, { lead: LEAD, allowed_origins: "*.acmeroofing.com", mailbox: "forms@sed.com", timezone: "America/Chicago" }, ctx);
    expect(p.problems).toEqual([]);
    const out = await d.execute(p.values, ctx, INFO);
    const [req] = h.create.mock.calls[0] as [Request];
    expect(new URL(req.url).pathname).toBe("/api/forms/endpoints");
    expect(out.message).toContain("Access key: k3y-abc");
    expect(out.data).toMatchObject({ id: "ep-new", kind: "form_endpoint", access_key: "k3y-abc", html_snippet: expect.stringContaining('value="k3y-abc"') });
    expect(out.link).toEqual({ href: "/forms/endpoints/ep-new", label: "Open the form & its snippet" });
    expect(d.produces).toBe("form_endpoint");
  });

  it("sends exactly the editor's fields", async () => {
    let body: unknown = null;
    h.create.mockImplementation(async (req: Request) => {
      body = await req.json();
      return json({ endpoint: { id: "ep-new", name: "x", access_key: "k" } }, 201);
    });
    const ctx = ctxFor();
    const p = await propose(d, { lead: LEAD, allowed_origins: "*.acmeroofing.com", mailbox: "forms@sed.com", timezone: "America/Chicago" }, ctx);
    await d.execute(p.values, ctx, INFO);
    expect(body).toEqual({
      name: "Acme Roofing – contact",
      lead_id: LEAD,
      to_emails: ["owner@acmeroofing.com"],
      subject_template: "",
      mailbox_id: BOX,
      allowed_origins: ["*.acmeroofing.com"],
      daily_limit: 200,
      success_redirect_url: null,
      timezone: "America/Chicago",
      status: "active",
    });
  });

  it("undo deletes the new form — but never one that already has submissions", async () => {
    h.remove.mockImplementation(async () => json({ ok: true }));
    const done = (id: string) => ({ input: {}, result: { message: "", data: { id } } }) as unknown as StoredAction;
    await d.undo!.run(done("ep-new"), ctxFor());
    const [req, routeCtx] = h.remove.mock.calls[0] as [Request, { params: Promise<Record<string, string>> }];
    expect(new URL(req.url).pathname).toBe("/api/forms/endpoints/ep-new");
    expect(await routeCtx.params).toEqual({ id: "ep-new" });
    await expect(d.undo!.run(done(ENDPOINT), ctxFor())).rejects.toThrow("already received a submission");
    expect(h.remove).toHaveBeenCalledTimes(1);
  });
});

describe("form.resend", () => {
  const d = def("form.resend");

  it("needs the submission", async () => {
    const n = await normalizeFields(d, {}, ctxFor());
    expect(missingFields(d, n.values, n.problems).map((f) => f.name)).toEqual(["submission"]);
  });

  it("refuses spam and submissions outside the person's leads, as the endpoint does", async () => {
    const spam = await propose(d, { submission: SPAM }, ctxFor());
    expect(spam.problems).toEqual([{ field: "submission", message: "It is marked as spam — mark it as not spam first (that also delivers it)." }]);
    const theirs = await propose(d, { submission: OTHERS_SUB }, ctxFor());
    expect(theirs.problems).toEqual([{ field: "submission", message: "That submission is not visible to you." }]);
  });

  it("re-sends through the resend endpoint and reads its result", async () => {
    const ctx = ctxFor();
    const p = await propose(d, { submission: SUB }, ctx);
    expect(p.problems).toEqual([]);
    const card = await d.preview!(p.values, ctx);
    expect(card.title).toBe("Re-send Jo Visitor — “Quote please” to owner@acmeroofing.com");

    h.resend.mockImplementation(async () => json({ result: { status: "sent" } }));
    const out = await d.execute(p.values, ctx, INFO);
    const [req, routeCtx] = h.resend.mock.calls[0] as [Request, { params: Promise<Record<string, string>> }];
    expect(new URL(req.url).pathname).toBe(`/api/forms/submissions/${SUB}/resend`);
    expect(await routeCtx.params).toEqual({ id: SUB });
    expect(out.message).toBe("Re-sent the submission from Jo Visitor to owner@acmeroofing.com.");

    // 200 with a failed delivery is a failure, in the endpoint's words.
    h.resend.mockImplementation(async () => json({ result: { status: "failed", error: "SMTP 535 auth failed" } }));
    const err = await d.execute(p.values, ctx, INFO).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RouteError);
    expect((err as RouteError).message).toBe("It could not be sent: SMTP 535 auth failed.");
    expect(d.risk).toBe("sensitive");
    expect(d.undo).toBeUndefined();
  });
});
