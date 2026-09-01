// app/api/tickets/[id]/agent-runs/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { allowedTicketScope, canActOnTicket } from "@/lib/tickets/scope";
import { fetchLiveSiteZip, prepareSiteZip, siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { isProtectedDomain } from "@/lib/site-studio/deploy/protected";
import { AGENT_SITES_BUCKET, AGENT_RUN_ACTIVE_STATUSES, originalZipPath } from "@/lib/site-agent/types";

export const runtime = "nodejs";
// fetchLiveSiteZip can take a while on a slow DA archive.
export const maxDuration = 120;

const ALLOWED_PERMS = ["studio.manage", "tickets.resolve"];

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — "Send to AI": create a queued agent run for this ticket. The site
 * is bound HERE, from the lead's website_link (the same no-picker rule as
 * the manual upload button: edits can never land on the wrong lead's site),
 * and the live files are fetched NOW by prod — the worker box can't reach
 * custom-domain files, and a run whose site can't be fetched should fail at
 * the click, not minutes later on the worker.
 */
export async function POST(_req: Request, ctx: Ctx) {
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
  if (isProtectedDomain(host)) return NextResponse.json({ error: "That host is protected infrastructure." }, { status: 403 });

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

  const { data: run, error: insErr } = await admin
    .from("site_agent_runs")
    .insert({ ticket_id: ticketId, lead_id: ticket.lead_id, site_host: fetched.host, created_by: user.id })
    .select()
    .single();
  if (insErr || !run) return NextResponse.json({ error: insErr?.message ?? "Could not create the run" }, { status: 409 });

  const { error: upErr } = await admin.storage
    .from(AGENT_SITES_BUCKET)
    .upload(originalZipPath(run.id as string), prepared.zip, { upsert: true, contentType: "application/zip" });
  if (upErr) {
    const { error: flipErr } = await admin.from("site_agent_runs").update({ status: "failed", error: `Could not store the site copy: ${upErr.message}` }).eq("id", run.id);
    if (flipErr) console.warn(`[site-agent] failed to mark run ${run.id} failed after upload error: ${flipErr.message}`);
    return NextResponse.json({ error: `Could not store the site copy: ${upErr.message}` }, { status: 502 });
  }

  await admin.from("activity_log").insert({
    user_id: user.id, action: "site_agent.run.created", entity_type: "ticket", entity_id: ticketId,
    new_value: { run_id: run.id, site_host: fetched.host },
  });
  return NextResponse.json({ run }, { status: 201 });
}

/** GET — this ticket's runs, newest first (the panel's history list). Scoped
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
  return NextResponse.json({ runs: data ?? [] });
}
