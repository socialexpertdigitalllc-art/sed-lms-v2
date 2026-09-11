import type { SupabaseClient } from "@supabase/supabase-js";
import { generateAccessKey } from "@/lib/forms/schema";
import { relaySubmitUrl } from "@/lib/forms/snippet";
import type { FormEndpointRow } from "@/lib/forms/types";

/**
 * Form Relay × Site Builder (form-relay design, "Site Builder integration"):
 * every generation gets a working submission endpoint at generation time, so
 * a deployed site's forms are live the moment the site is — no manual
 * "create endpoint, paste the key" step per client.
 *
 * Two halves, used together by lib/site-builder/generateRun.ts:
 *  - `ensureFormEndpoint` finds (or creates) the lead's endpoint and returns
 *    the submit URL + access key the prompts hand to the model;
 *  - `rewriteFormTargets` is the deterministic safety net over the finished
 *    files — the model is TOLD the endpoint, but a stale web3forms URL or a
 *    template's own access_key must not be able to survive to deploy.
 */

/** What a generated site needs to submit forms — goes into the brief. */
export interface FormRelayTarget {
  submit_url: string;
  access_key: string;
}

/**
 * The lead's form endpoint, created on first use.
 *
 * Reuses the lead's existing endpoint (active preferred) rather than minting
 * one per run — a lead is regenerated many times, and the key already baked
 * into an earlier deploy must keep working. A paused endpoint whose only
 * problem was "lead had no email yet" is revived here when the email has
 * since arrived. Never throws, returns null on any failure: the endpoint is
 * an enhancement and must not be able to fail a generation.
 */
export async function ensureFormEndpoint(
  admin: SupabaseClient,
  lead: Record<string, unknown>,
  createdBy: string | null,
): Promise<FormRelayTarget | null> {
  try {
    const leadId = typeof lead.id === "string" ? lead.id : "";
    if (!leadId) return null;
    const email = typeof lead.business_email === "string" ? lead.business_email.trim() : "";
    const name = String(lead.business_name ?? "").trim() || "Website";

    const { data } = await admin
      .from("form_endpoints")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as FormEndpointRow[];

    const active = rows.find((e) => e.status === "active");
    if (active) return { submit_url: relaySubmitUrl(), access_key: active.access_key };

    const paused = rows[0];
    if (paused) {
      // Paused-for-no-recipient endpoints self-heal once the lead has an
      // email; a deliberately paused endpoint with recipients stays paused
      // (the operator turned it off) but its key is still the one the site
      // should carry — reactivating is then a one-click dashboard action.
      if (email && paused.to_emails.length === 0) {
        await admin
          .from("form_endpoints")
          .update({ to_emails: [email], status: "active", updated_at: new Date().toISOString() })
          .eq("id", paused.id);
      }
      return { submit_url: relaySubmitUrl(), access_key: paused.access_key };
    }

    // No endpoint yet — create it. A lead without an email still gets one
    // (paused, no recipients) so the site ships with a working key; the
    // dashboard's Forms card shows it paused for the agent to finish.
    const { data: created, error } = await admin
      .from("form_endpoints")
      .insert({
        lead_id: leadId,
        name,
        access_key: generateAccessKey(),
        to_emails: email ? [email] : [],
        status: email ? "active" : "paused",
        created_by: createdBy,
      })
      .select("*")
      .single();
    if (error || !created) return null;
    await admin.from("activity_log").insert({
      user_id: createdBy,
      action: "form_endpoint.created",
      entity_type: "form_endpoint",
      entity_id: created.id,
      new_value: { name, lead_id: leadId, auto: "site_builder" },
    });
    return { submit_url: relaySubmitUrl(), access_key: (created as FormEndpointRow).access_key };
  } catch {
    return null;
  }
}

/** Extensions worth sweeping — text files that can carry a form destination.
 *  Binary assets (images, fonts) must never be decoded and re-encoded. */
const SWEEPABLE_RE = /\.(html?|js|mjs|json)$/i;

export const isSweepableFile = (file: string): boolean => SWEEPABLE_RE.test(file);

/**
 * Deterministic replacement of form destinations in ONE text file — the
 * safety net under the prompt instruction. Replaces:
 *  - any web3forms submit URL with the relay URL;
 *  - any `"access_key": "…"` (JSON / object literal, either quote style);
 *  - any `<input … name="access_key" … value="…">` (attribute order agnostic);
 *  - any `formData.append("access_key", "…")`.
 * The model cannot leave a stale key or the template's old destination
 * behind, whatever it did with the instruction.
 */
export function rewriteFormTargets(source: string, target: FormRelayTarget): string {
  let out = source;

  // Destination URL: web3forms in any of its spellings.
  out = out.replace(/https?:\/\/api\.web3forms\.com\/submit\/?/gi, target.submit_url);

  // JSON / object literal: "access_key": "…" (' or ").
  out = out.replace(
    /(["'])access_key\1(\s*:\s*)(["'])[^"']*\3/g,
    (_m, q1: string, sep: string, q2: string) => `${q1}access_key${q1}${sep}${q2}${target.access_key}${q2}`,
  );

  // formData.append("access_key", "…") — also covers URLSearchParams.append.
  out = out.replace(
    /(\.append\(\s*(["'])access_key\2\s*,\s*(["']))[^"']*(\3)/g,
    (_m, head: string, _q1: string, _q2: string, tail: string) => `${head}${target.access_key}${tail}`,
  );

  // Hidden input: rewrite the value attribute of any <input> whose name is
  // access_key, whichever attribute comes first.
  out = out.replace(/<input\b[^>]*>/gi, (tag) => {
    if (!/name\s*=\s*(["'])access_key\1/i.test(tag)) return tag;
    return tag.replace(/(value\s*=\s*)(["'])[^"']*\2/i, (_m, head: string, q: string) => `${head}${q}${target.access_key}${q}`);
  });

  return out;
}
