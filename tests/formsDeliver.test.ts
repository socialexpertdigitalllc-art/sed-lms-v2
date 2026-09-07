// tests/formsDeliver.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";

const holder = vi.hoisted(() => ({
  submission: null as Partial<FormSubmissionRow> | null,
  endpoint: null as Partial<FormEndpointRow> | null,
  settings: { form_default_mailbox_id: null as string | null },
  mailboxes: {} as Record<string, { id: string; address: string; displayName: string }>,
  updates: [] as Record<string, unknown>[],
  notified: [] as { key: string; opts: Record<string, unknown> }[],
  /** When true, the optimistic claim update matches zero rows (another worker won). */
  claimLost: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "form_submissions" ? holder.submission : table === "form_endpoints" ? holder.endpoint : table === "leads" ? { id: "l1", agent_id: "agent-1", closed_by: null } : null,
          }),
        }),
      }),
      // Chainable update supporting both `await ...update().eq()` and the
      // claim's `...update().eq().eq().eq().select()`.
      update: (patch: Record<string, unknown>) => {
        holder.updates.push({ table, ...patch });
        const chain = {
          eq: () => chain,
          select: async () => ({ data: holder.claimLost ? [] : [{ id: "s1" }], error: null }),
          then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("@/lib/settings/appSettings", () => ({ getAppSettings: async () => holder.settings }));
vi.mock("@/lib/mail/mailbox", () => ({ getMailboxById: async (id: string) => holder.mailboxes[id] ?? null }));
vi.mock("@/lib/notifications/notify", () => ({ notify: async (key: string, _ctx: unknown, opts: Record<string, unknown>) => { holder.notified.push({ key, opts }); } }));

import { deliverSubmission } from "@/lib/forms/deliver";

beforeEach(() => {
  holder.submission = {
    id: "s1", endpoint_id: "e1", lead_id: "l1", is_spam: false, delivery_status: "pending", delivery_attempts: 0,
    payload: [{ key: "message", value: "Need a roof" }], subject: "New lead", submitter_email: "ann@x.co", origin: "acme.com", created_at: "2026-09-05T10:00:00Z",
  };
  holder.endpoint = { id: "e1", name: "Acme", to_emails: ["owner@acme.com"], mailbox_id: null, lead_id: "l1" };
  holder.settings = { form_default_mailbox_id: "mb-default" };
  holder.mailboxes = { "mb-default": { id: "mb-default", address: "forms@sed.co", displayName: "SED Forms" }, "mb-x": { id: "mb-x", address: "x@sed.co", displayName: "X" } };
  holder.updates = [];
  holder.notified = [];
  holder.claimLost = false;
});

describe("deliverSubmission", () => {
  it("sends from the default mailbox, marks sent, notifies the lead agent", async () => {
    const send = vi.fn(async () => {});
    const r = await deliverSubmission("s1", { send });
    expect(r).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    const [msg, mailbox] = send.mock.calls[0] as unknown as [Record<string, unknown>, { id: string }];
    expect(mailbox.id).toBe("mb-default");
    expect(msg.to).toEqual(["owner@acme.com"]);
    expect(msg.replyTo).toBe("ann@x.co");
    expect(msg.subject).toBe("New lead");
    expect(holder.updates.at(-1)).toMatchObject({ table: "form_submissions", delivery_status: "sent", mailbox_id: "mb-default" });
    expect(holder.notified[0]?.key).toBe("form_submission_received");
    expect(holder.notified[0]?.opts.targetUrl).toBe("/forms?submission=s1");
  });

  it("prefers the endpoint's own mailbox", async () => {
    holder.endpoint!.mailbox_id = "mb-x";
    const send = vi.fn(async () => {});
    await deliverSubmission("s1", { send });
    expect((send.mock.calls[0] as unknown as [unknown, { id: string }])[1].id).toBe("mb-x");
  });

  it("fails clearly with no sender anywhere", async () => {
    holder.settings = { form_default_mailbox_id: null };
    const send = vi.fn(async () => {});
    const r = await deliverSubmission("s1", { send });
    expect(r).toEqual({ status: "failed", error: "No sender mailbox configured" });
    expect(send).not.toHaveBeenCalled();
    expect(holder.updates.at(-1)).toMatchObject({ delivery_status: "failed", delivery_attempts: 1, last_error: "No sender mailbox configured" });
  });

  it("records an SMTP failure and bumps attempts", async () => {
    holder.submission!.delivery_attempts = 2;
    const send = vi.fn(async () => { throw new Error("SMTP 535"); });
    const r = await deliverSubmission("s1", { send });
    expect(r).toEqual({ status: "failed", error: "SMTP 535" });
    expect(holder.updates.at(-1)).toMatchObject({ delivery_status: "failed", delivery_attempts: 3, last_error: "SMTP 535" });
  });

  it("backs off without sending when another worker claimed the row first", async () => {
    holder.claimLost = true;
    const send = vi.fn(async () => {});
    expect(await deliverSubmission("s1", { send })).toEqual({ status: "skipped" });
    expect(send).not.toHaveBeenCalled();
    expect(holder.notified).toEqual([]);
  });

  it("skips spam and already-sent rows", async () => {
    holder.submission!.is_spam = true;
    const send = vi.fn(async () => {});
    expect(await deliverSubmission("s1", { send })).toEqual({ status: "skipped" });
    holder.submission!.is_spam = false;
    holder.submission!.delivery_status = "sent";
    expect(await deliverSubmission("s1", { send })).toEqual({ status: "skipped" });
    expect(send).not.toHaveBeenCalled();
  });
});
