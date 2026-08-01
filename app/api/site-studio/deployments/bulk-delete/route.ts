import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { daConfigured, deleteSubdomain, subdomainExists } from "@/lib/template-engine/directadmin";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BATCH = 50;

/**
 * POST /api/site-studio/deployments/bulk-delete  body { subdomains: string[] }
 *
 * Delete staging subdomains (tracked or untracked) from the hosting, retire
 * their board rows, and clear any lead website_link still pointing at them.
 * Custom domains are never deletable through this route. Per-item fail-soft.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  if (!daConfigured()) return NextResponse.json({ error: "Deployment is not configured." }, { status: 422 });

  const body = (await req.json().catch(() => ({}))) as { subdomains?: unknown };
  const subs = Array.isArray(body.subdomains)
    ? body.subdomains.filter((s): s is string => typeof s === "string" && /^[a-z0-9-]{1,63}$/.test(s))
    : [];
  if (!subs.length) return NextResponse.json({ error: "Pick at least one subdomain" }, { status: 422 });
  if (subs.length > MAX_BATCH) return NextResponse.json({ error: `Max ${MAX_BATCH} subdomains per batch` }, { status: 422 });

  const daDomain = process.env.DA_DOMAIN ?? "";
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const results: { subdomain: string; ok: boolean; message?: string }[] = [];

  for (const sub of subs) {
    const exists = await subdomainExists(sub);
    let ok = true;
    let message: string | undefined;
    if (exists) {
      const removed = await deleteSubdomain(sub);
      ok = !removed.error;
      if (!ok) message = removed.text || removed.details || "delete failed";
    }
    if (ok) {
      const url = `https://${sub}.${daDomain}`;
      const { data: row } = await admin
        .from("studio_deployments")
        .select("id, lead_id, url")
        .eq("subdomain", sub)
        .maybeSingle();
      if (row) {
        await admin
          .from("studio_deployments")
          .update({ status: "taken_down", taken_down_at: now, updated_at: now })
          .eq("id", row.id);
        if (row.lead_id) {
          // clear the lead link only if it still points at this site
          await admin.from("leads").update({ website_link: null }).eq("id", row.lead_id).eq("website_link", row.url ?? url);
        }
      }
    }
    results.push({ subdomain: sub, ok, message });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.deployment.bulk_deleted",
    entity_type: "studio_deployment",
    entity_id: null,
    new_value: { subdomains: subs, failed: results.filter((r) => !r.ok).map((r) => r.subdomain) },
  });

  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({ ok: failed.length === 0, results });
}
