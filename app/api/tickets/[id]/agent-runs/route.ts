// app/api/tickets/[id]/agent-runs/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { allowedTicketScope, canActOnTicket } from "@/lib/tickets/scope";
import { fetchLiveSiteZip, prepareSiteZip, siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { isProtectedDomain } from "@/lib/site-studio/deploy/protected";
import { subFromWebsiteLink } from "@/lib/template-engine/directadmin";
import { AGENT_SITES_BUCKET, AGENT_RUN_ACTIVE_STATUSES, originalZipPath } from "@/lib/site-agent/types";
import { resolveModelChoice, workerStatus } from "@/lib/site-agent/workerStatus";

export const runtime = "nodejs";
// fetchLiveSiteZip can take a while on a slow DA archive.
export const maxDuration = 120;

const ALLOWED_PERMS = ["studio.manage", "tickets.resolve"];

type Ctx = { params: Promise<{ id: string }> };

type CreateBody = { item_ids?: unknown; task_text?: unknown; model?: unknown };

/**
 * POST — "Send to AI": create a queued agent run for this ticket. The site
 * is bound HERE, from the lead's website_link (the same no-picker rule as
 * the manual upload button: edits can never land on the wrong lead's site),
 * and the live files are fetched NOW by prod — the worker box can't reach
 * custom-domain files, and a run whose site can't be fetched should fail at
 * the click, not minutes later on the worker.
 *
 * Ordering matters: original.zip is uploaded BEFORE the row is inserted (the
 * id is minted app-side). The worker polls every 20s with no age grace, so a
 * queued row must never be visible while its zip is still in flight.
 *
 * v2 (F1/F4): the body may scope the run to selected UNDONE items
 * (`item_ids` — null on the row ALWAYS means whole ticket, so selecting all
 * undone items normalizes to null), carry an operator-edited `task_text`
 * (used verbatim by the worker as the fenced block), and pick a `model` from
 * the worker's live-published list. (F3): creating a run on an Assigned
 * ticket auto-starts it with the manual Start action's exact writes.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: ticketId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!ALLOWED_PERMS.some((p) => perms.has(p))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: ticket } = await admin
    .from("lead_tickets")
    .select("id, status, lead_id, created_by, assigned_to, title, lead:leads(website_link, business_name)")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  if (!perms.has("studio.manage")) {
    const scope = await allowedTicketScope(admin, user.id, perms);
    if (!canActOnTicket(ticket, user.id, scope)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (ticket.status !== "Assigned" && ticket.status !== "In Progress") {
    return NextResponse.json({ error: `The ticket is "${ticket.status}" — assign it first.` }, { status: 409 });
  }
  const lead = ticket.lead as unknown as { website_link: string | null } | null;
  const link = lead?.website_link ?? null;
  const host = link ? siteHostFrom(link) : null;
  if (!host) return NextResponse.json({ error: "This lead has no website link — nothing to edit." }, { status: 422 });
  // CHECK ORDER IS LOAD-BEARING (same precedence as fetchLiveSiteZip): the
  // staging apex is ALWAYS on the protected list, so a bare
  // isProtectedDomain() would refuse every {sub}.DA_DOMAIN client site.
  // A staging subdomain of ours is exactly what this feature edits; only
  // NON-staging hosts go through the protected-infrastructure refusal.
  const stagingSub = subFromWebsiteLink(link, process.env.DA_DOMAIN ?? "");
  if (!stagingSub && isProtectedDomain(host)) {
    return NextResponse.json({ error: "That host is protected infrastructure." }, { status: 403 });
  }

  const body: CreateBody = (await req.json().catch(() => ({}))) ?? {};

  // F1 — run scope: a subset of this ticket's UNDONE items, or the whole
  // ticket (absent). Done items are never offered and never accepted.
  let itemIds: string[] | null = null;
  if (body.item_ids !== undefined && body.item_ids !== null) {
    if (!Array.isArray(body.item_ids)) {
      return NextResponse.json({ error: "item_ids must be an array of item ids" }, { status: 422 });
    }
    const provided = [...new Set(body.item_ids.filter((v): v is string => typeof v === "string" && v.length > 0))];
    if (!provided.length) {
      return NextResponse.json({ error: "Select at least one change to send." }, { status: 422 });
    }
    const { data: itemRows } = await admin
      .from("ticket_items")
      .select("id, is_done")
      .eq("ticket_id", ticketId);
    const items = (itemRows ?? []) as { id: string; is_done: boolean }[];
    const undone = new Set(items.filter((i) => !i.is_done).map((i) => i.id));
    for (const itemId of provided) {
      if (undone.has(itemId)) continue;
      const known = items.some((i) => i.id === itemId);
      return NextResponse.json(
        { error: known ? `Item ${itemId} is already done.` : `Item ${itemId} is not on this ticket.` },
        { status: 422 },
      );
    }
    // Selecting EVERY undone item IS the whole ticket — normalize to null so
    // "whole ticket" has exactly one representation on the row.
    itemIds = provided.length === undone.size ? null : provided;
  }

  // F4 — operator-edited task text: trimmed, capped, null when untouched.
  if (body.task_text !== undefined && body.task_text !== null && typeof body.task_text !== "string") {
    return NextResponse.json({ error: "task_text must be a string" }, { status: 422 });
  }
  const trimmedTask = typeof body.task_text === "string" ? body.task_text.trim() : "";
  if (trimmedTask.length > 4000) {
    return NextResponse.json({ error: "The task text is too long (4000 characters max)." }, { status: 422 });
  }
  const taskText = trimmedTask || null;

  // F2 — model choice, validated against the worker's live-published list.
  const modelChoice = await resolveModelChoice(admin, body.model);
  if (!modelChoice.ok) return NextResponse.json({ error: modelChoice.message }, { status: 422 });

  const { data: active } = await admin
    .from("site_agent_runs")
    .select("id, status")
    .eq("ticket_id", ticketId)
    .in("status", [...AGENT_RUN_ACTIVE_STATUSES])
    .maybeSingle();
  if (active) return NextResponse.json({ error: "An AI run is already in flight for this ticket." }, { status: 409 });

  const fetched = await fetchLiveSiteZip(link!);
  if (!fetched.ok) return NextResponse.json({ error: `Could not fetch the live site: ${fetched.error}` }, { status: fetched.status });
  // Normalize: DA archives nest under "public_html/", and index.html must exist.
  const prepared = prepareSiteZip(fetched.zip);
  if (!prepared.ok) return NextResponse.json({ error: `The live site is not editable: ${prepared.message}` }, { status: 422 });

  const runId = crypto.randomUUID();
  const { error: upErr } = await admin.storage
    .from(AGENT_SITES_BUCKET)
    .upload(originalZipPath(runId), prepared.zip, { upsert: true, contentType: "application/zip" });
  if (upErr) return NextResponse.json({ error: `Could not store the site copy: ${upErr.message}` }, { status: 502 });

  const { data: run, error: insErr } = await admin
    .from("site_agent_runs")
    .insert({
      id: runId, ticket_id: ticketId, lead_id: ticket.lead_id, site_host: fetched.host,
      created_by: user.id, item_ids: itemIds, task_text: taskText, model: modelChoice.model,
    })
    .select()
    .single();
  if (insErr || !run) {
    // The zip is orphaned if we stop here — remove it best-effort (the
    // one-active-run 409 race lands here).
    await admin.storage.from(AGENT_SITES_BUCKET).remove([originalZipPath(runId)]).catch(() => {});
    return NextResponse.json({ error: insErr?.message ?? "Could not create the run" }, { status: 409 });
  }

  await admin.from("activity_log").insert({
    user_id: user.id, action: "site_agent.run.created", entity_type: "ticket", entity_id: ticketId,
    new_value: { run_id: run.id, site_host: fetched.host },
  });

  // F3 — auto-start: sending work to the AI IS starting the ticket. This
  // mirrors the manual PATCH "start" action's writes EXACTLY (the same
  // lead_tickets update fields and the same `ticket.started` activity row —
  // the manual action sends no notification, so neither do we), with
  // `auto: true` stamped on the activity so history shows nobody clicked
  // Start. Best-effort: the run already exists, and a failed start must
  // never fail it.
  if (ticket.status === "Assigned") {
    try {
      const startedAt = new Date().toISOString();
      const { error: startErr } = await admin
        .from("lead_tickets")
        .update({ status: "In Progress", updated_at: startedAt })
        .eq("id", ticketId)
        .select("*")
        .single();
      if (startErr) throw new Error(startErr.message);
      await admin.from("activity_log").insert({
        user_id: user.id,
        action: "ticket.started",
        entity_type: "ticket",
        entity_id: ticketId,
        new_value: { status: "In Progress", auto: true },
      });
    } catch (e) {
      console.warn(`[site-agent] auto-start of ticket ${ticketId} failed:`, e);
    }
  }

  return NextResponse.json({ run }, { status: 201 });
}

/** GET — this ticket's runs, newest first (the panel's history list), plus
 *  the worker status + published model list (v2: the pre-send dialog opens
 *  BEFORE any run exists, so the list must ride the list response). Scoped
 *  exactly like POST: a tickets.resolve holder only sees runs on tickets they
 *  could act on; studio.manage sees everything. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: ticketId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!ALLOWED_PERMS.some((p) => perms.has(p))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = createAdminClient();
  const { data: ticket } = await admin
    .from("lead_tickets")
    .select("id, created_by, lead_id, assigned_to")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  if (!perms.has("studio.manage")) {
    const scope = await allowedTicketScope(admin, user.id, perms);
    if (!canActOnTicket(ticket, user.id, scope)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  const { data, error } = await admin
    .from("site_agent_runs")
    .select("id, status, site_host, files, summary, error, created_by, created_at, updated_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const status = await workerStatus(admin);
  return NextResponse.json({ runs: data ?? [], workerOnline: status.workerOnline, models: status.models });
}
