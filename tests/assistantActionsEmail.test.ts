// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_ACTIONS } from "@/lib/assistant/actions/defs/email";
import { missingFields, normalizeFields } from "@/lib/assistant/actions/fields";
import type { ActionContext, ActionDef, Values } from "@/lib/assistant/actions/types";

/**
 * email.send: the card is the draft, the email goes from the person's own
 * mailbox (never another), and nothing else may slip in as the sender.
 */

const h = vi.hoisted(() => ({ send: vi.fn(), readUpload: vi.fn() }));
vi.mock("@/app/api/mail/send/route", () => ({ POST: h.send }));
vi.mock("@/lib/assistant/uploads", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/assistant/uploads")>()), readUpload: h.readUpload }));
vi.mock("@/lib/assistant/actions/checks", () => ({
  checkEmail: vi.fn(async (field: string, email: string) =>
    email.endsWith("@gmial.com") ? { problems: [], warnings: [`${email} may be a typo — did the customer mean ${email.replace("gmial", "gmail")}?`], notes: [] } : { problems: [], warnings: [], notes: [] },
  ),
}));

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
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
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
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
const APPROVER = "aaaaaaaa-0000-4000-8000-000000000002";
const MY_BOX = "66666666-6666-4666-8666-666666666666";
const THEIR_BOX = "77777777-7777-4777-8777-777777777777";
const FILE = "88888888-8888-4888-8888-888888888888";

function fixtures(): Record<string, Row[]> {
  return {
    company_mailboxes: [
      { id: MY_BOX, email_address: "sam@sed.com", display_name: "Sam Khan", user_id: ME, status: "verified", created_at: "2026-01-01T00:00:00Z" },
      { id: THEIR_BOX, email_address: "boss@sed.com", display_name: "The Boss", user_id: APPROVER, status: "verified", created_at: "2026-01-01T00:00:00Z" },
    ],
    assistant_uploads: [{ id: FILE, user_id: ME, name: "quote.pdf", mime: "application/pdf", size_bytes: 5 }],
  };
}

function ctxFor(over: Partial<ActionContext> = {}, tables = fixtures()): ActionContext {
  const db = fakeDb(tables);
  return { userId: ME, displayName: "Sam Khan", perms: new Set(), db, admin: db, timezone: "Asia/Karachi", now: new Date("2026-10-14T07:00:00Z"), isAdmin: false, ...over };
}

const d: ActionDef = EMAIL_ACTIONS.find((x) => x.key === "email.send")!;
const INFO = { actionId: "act-1", origin: "https://dashboard.example" };

async function propose(raw: Values, ctx: ActionContext) {
  const n = await normalizeFields(d, raw, ctx);
  const missing = missingFields(d, n.values, n.problems).map((f) => f.name);
  const r = (await d.check?.(n.values, ctx)) ?? {};
  Object.assign(n.values, r.values ?? {});
  return { values: n.values, missing, problems: [...n.problems, ...(r.problems ?? [])], warnings: r.warnings ?? [] };
}

beforeEach(() => {
  h.send.mockReset();
  h.readUpload.mockReset();
});

describe("email.send", () => {
  it("is the only email action — the card is the draft", () => {
    expect(EMAIL_ACTIONS.map((x) => x.key)).toEqual(["email.send"]);
    expect(d.risk).toBe("sensitive");
    expect(d.undo).toBeUndefined();
    // No permission key: having a mailbox of your own is what counts.
    expect(d.allowed(ctxFor())).toBeNull();
  });

  it("needs only the recipient; subject and message are the model's to write", async () => {
    const ctx = ctxFor();
    const none = await normalizeFields(d, {}, ctx);
    expect(missingFields(d, none.values, none.problems).map((f) => f.name)).toEqual(["to"]);
    const p = await propose({ to: "Client@Example.com" }, ctx);
    expect(p.missing).toEqual([]);
    expect(p.values.to).toBe("client@example.com");
    expect(p.warnings).toEqual(["There is no subject line.", "The message is empty."]);
  });

  it("refuses up front when the person has no verified mailbox of their own", async () => {
    const tables = fixtures();
    tables.company_mailboxes = tables.company_mailboxes.filter((m) => m.user_id !== ME);
    const p = await propose({ to: "client@example.com", subject: "Hi", body: "Hello" }, ctxFor({}, tables));
    expect(p.problems).toEqual([expect.objectContaining({ field: "_", message: expect.stringContaining("no verified mailbox of your own") })]);
  });

  it("checks the Cc addresses and that attachments are chat files", async () => {
    const p = await propose({ to: "client@example.com", subject: "Hi", body: "Hello", cc: "boss@client.com, not-an-email", attachments: ["https://example.com/a.pdf"] }, ctxFor());
    expect(p.problems.map((x) => x.field).sort()).toEqual(["attachments", "cc"]);
    const typo = await propose({ to: "client@gmial.com", subject: "Hi", body: "Hello" }, ctxFor());
    expect(typo.warnings).toEqual(["client@gmial.com may be a typo — did the customer mean client@gmail.com?"]);
  });

  it("shows the whole email on the card, From first, with the message editable", async () => {
    const ctx = ctxFor();
    const p = await propose({ to: "client@example.com", cc: ["boss@client.com"], subject: "Your website", body: "Hi Jo,\n\nIt is live.\n\nSam" }, ctx);
    const card = await d.preview!(p.values, ctx);
    expect(card.title).toBe("Email client@example.com — Your website");
    expect((card.fields ?? []).map((f) => [f.label, f.value])).toEqual([
      ["From", "Sam Khan <sam@sed.com>"],
      ["To", "client@example.com"],
      ["Cc", "boss@client.com"],
      ["Subject", "Your website"],
      ["Message", "Hi Jo,\n\nIt is live.\n\nSam"],
    ]);
    expect(card.fields?.find((f) => f.name === "body")?.edit).toEqual({ type: "longtext", raw: "Hi Jo,\n\nIt is live.\n\nSam" });
    expect(card.fields?.find((f) => f.name === "from")?.edit).toBeNull();
    expect(card.before).toEqual({ mailbox_id: MY_BOX, from: "Sam Khan <sam@sed.com>" });
  });

  it("will not let someone else's Confirm send it from their own mailbox", async () => {
    const ctx = ctxFor();
    const p = await propose({ to: "client@example.com", subject: "Hi", body: "Hello" }, ctx);
    const card = await d.preview!(p.values, ctx);
    expect(await d.stale!(card.before, p.values, ctx)).toBeNull();
    const approver = ctxFor({ userId: APPROVER, displayName: "The Boss" });
    expect(await d.stale!(card.before, p.values, approver)).toBe("it would now go out from The Boss <boss@sed.com>, not Sam Khan <sam@sed.com>.");
  });

  it("posts the compose drawer's payload, chat files as base64 attachments", async () => {
    h.send.mockImplementation(async () => Response.json({ ok: true }));
    h.readUpload.mockImplementation(async () => ({ row: { name: "quote.pdf", mime: "application/pdf" }, blob: new Blob(["hello"]) }));
    const ctx = ctxFor();
    const p = await propose({ to: "client@example.com", cc: ["boss@client.com", "ops@client.com"], subject: "Your quote", body: "Attached.", attachments: [`upload:${FILE}`] }, ctx);
    expect(p.problems).toEqual([]);
    const out = await d.execute(p.values, ctx, INFO);
    const [req] = h.send.mock.calls[0] as [Request];
    expect(new URL(req.url).pathname).toBe("/api/mail/send");
    expect(await req.json()).toEqual({
      to: "client@example.com",
      cc: "boss@client.com, ops@client.com",
      subject: "Your quote",
      body: "Attached.",
      attachments: [{ filename: "quote.pdf", contentBase64: "aGVsbG8=", contentType: "application/pdf" }],
    });
    expect(h.readUpload).toHaveBeenCalledWith(ctx.admin, ME, FILE);
    expect(out.message).toBe("Sent “Your quote” to client@example.com (cc boss@client.com, ops@client.com).");
  });
});
