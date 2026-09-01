// app/api/leads/[id]/agent-runs/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { fetchLiveSiteZip, prepareSiteZip, siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { isProtectedDomain } from "@/lib/site-studio/deploy/protected";
import { subFromWebsiteLink } from "@/lib/template-engine/directadmin";
import { AGENT_SITES_BUCKET, originalZipPath } from "@/lib/site-agent/types";
import { resolveModelChoice, workerStatus } from "@/lib/site-agent/workerStatus";

export const runtime = "nodejs";
// fetchLiveSiteZip can take a while on a slow DA archive.
export const maxDuration = 120;

const ALLOWED_PERMS = ["studio.manage", "tickets.resolve"];

type Ctx = { params: Promise<{ id: string }> };

type CreateBody = { task_text?: unknown; model?: unknown };

/**
 * POST — v2 F5 "AI edit site": a TICKETLESS direct edit on a lead's live
 * site. Mirrors the ticket create route (site bound from the lead's
 * website_link, live zip fetched NOW by prod, original.zip stored BEFORE the
 * row is inserted so the worker's 20s poll never sees a zipless queued row)
 * minus the ticket logic: no status/scope machinery, `task_text` REQUIRED
 * (there is no ticket to compose a task from), `ticket_id` stays null. The
 * one-active-run guard is the 0072 partial unique index (per LEAD, null
 * tickets only) — a violation surfaces on the insert as a 409.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: leadId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!ALLOWED_PERMS.some((p) => perms.has(p))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, website_link, business_name")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const link = (lead.website_link as string | null) ?? null;
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
  if (body.task_text !== undefined && body.task_text !== null && typeof body.task_text !== "string") {
    return NextResponse.json({ error: "task_text must be a string" }, { status: 422 });
  }
  const taskText = typeof body.task_text === "string" ? body.task_text.trim() : "";
  if (!taskText) {
    return NextResponse.json({ error: "Describe the change you want — the task text is required." }, { status: 422 });
  }
  if (taskText.length > 4000) {
    return NextResponse.json({ error: "The task text is too long (4000 characters max)." }, { status: 422 });
  }
  const modelChoice = await resolveModelChoice(admin, body.model);
  if (!modelChoice.ok) return NextResponse.json({ error: modelChoice.message }, { status: 422 });

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
      id: runId, ticket_id: null, lead_id: leadId, site_host: fetched.host,
      task_text: taskText, model: modelChoice.model, created_by: user.id,
    })
    .select()
    .single();
  if (insErr || !run) {
    // The zip is orphaned if we stop here — remove it best-effort (the
    // one-active-run-per-lead unique-index race lands here).
    await admin.storage.from(AGENT_SITES_BUCKET).remove([originalZipPath(runId)]).catch(() => {});
    const duplicate = (insErr as { code?: string } | null)?.code === "23505";
    return NextResponse.json(
      { error: duplicate ? "An AI run is already in flight for this lead." : insErr?.message ?? "Could not create the run" },
      { status: 409 },
    );
  }

  await admin.from("activity_log").insert({
    user_id: user.id, action: "site_agent.run.created", entity_type: "lead", entity_id: leadId,
    new_value: { run_id: run.id, site_host: fetched.host },
  });
  return NextResponse.json({ run }, { status: 201 });
}

/** GET — this lead's TICKETLESS runs, newest first, plus the worker status +
 *  published model list (the dialog opens before any run exists). Scope is
 *  perms-only: a null-ticket run has no ticket object to scope by, and the
 *  panel is for studio/tech users — the same loosening as the access gate. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: leadId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!ALLOWED_PERMS.some((p) => perms.has(p))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("site_agent_runs")
    .select("id, status, site_host, files, summary, error, created_by, created_at, updated_at")
    .eq("lead_id", leadId)
    .is("ticket_id", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const status = await workerStatus(admin);
  return NextResponse.json({ runs: data ?? [], workerOnline: status.workerOnline, models: status.models });
}
