// app/api/forms/submit/route.ts
import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSubmissionRequest, extractSubmitter, isEmailAddress } from "@/lib/forms/parse";
import { originHost, originAllowed, clientIp, gateSubmission, utcDayStart } from "@/lib/forms/gate";
import { resolveSubject } from "@/lib/forms/email";
import { deliverSubmission } from "@/lib/forms/deliver";
import type { FormEndpointRow, FormSpamReason, PayloadField } from "@/lib/forms/types";

export const runtime = "nodejs";

/**
 * PUBLIC, web3forms-compatible ingest for client websites. Authenticated by
 * the endpoint's access_key, not a user session — this path is allowlisted
 * in lib/supabase/middleware.ts (an unlisted route 307s to /login, which no
 * route test can catch). CORS is handled here; nothing else in the app is
 * cross-origin.
 */

function cors(req: Request, res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", req.headers.get("origin") || "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Vary", "Origin");
  return res;
}

function reply(req: Request, status: number, body: Record<string, unknown>): NextResponse {
  return cors(req, NextResponse.json(body, { status }));
}

const fail = (req: Request, status: number, message: string) => reply(req, status, { success: false, message });

export async function OPTIONS(req: Request) {
  return cors(req, new NextResponse(null, { status: 204 }));
}

function wantsHtml(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

function safeRedirect(url: string | null | undefined): string | null {
  if (!url) return null;
  try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}

/** The REQUEST-supplied redirect is honoured only when its host is one the
 *  endpoint already trusts — otherwise anyone with the (public) access key
 *  can mint 303s from a trusted domain to anywhere. With an allowlist, the
 *  redirect host must pass it. With a BLANK allowlist (web3forms default),
 *  the redirect must go back to the submitting page's own host or to the
 *  endpoint's configured success URL host — a real client form redirecting
 *  to its own thank-you page always passes. */
function requestRedirect(url: string, endpoint: FormEndpointRow, submissionHost: string | null): string | null {
  const safe = safeRedirect(url);
  if (!safe) return null;
  const host = new URL(safe).hostname.toLowerCase();
  if (endpoint.allowed_origins.length > 0) return originAllowed(host, endpoint.allowed_origins) ? safe : null;
  const trusted = new Set<string>();
  if (submissionHost) trusted.add(submissionHost);
  const configured = safeRedirect(endpoint.success_redirect_url);
  if (configured) trusted.add(new URL(configured).hostname.toLowerCase());
  return trusted.has(host) ? safe : null;
}

const THANKS_HTML = `<!doctype html><meta charset="utf-8"><title>Thank you</title><body style="font-family:system-ui;padding:48px;text-align:center"><h1>Thank you!</h1><p>Your message has been sent. We'll be in touch shortly.</p><p><a href="javascript:history.back()">Go back</a></p></body>`;

export async function POST(req: Request) {
  const parsed = await parseSubmissionRequest(req);
  if (!parsed.ok) return fail(req, parsed.status, parsed.message);
  const { reserved, payload } = parsed.value;

  const admin = createAdminClient();
  const { data: ep, error: epError } = await admin.from("form_endpoints").select("*").eq("access_key", reserved.access_key).maybeSingle();
  // Any lookup error is a 503, not a 404: reporting a DB outage as "unknown
  // access key" would send an integrator hunting the wrong bug. The
  // relation-missing case (migration not applied) gets its own message.
  if (epError) return fail(req, 503, /form_endpoints/.test(epError.message) ? "Form relay not ready" : "Form relay unavailable");
  if (!ep) return fail(req, 404, "Unknown access key");
  const endpoint = ep as FormEndpointRow;
  if (endpoint.status === "paused") return fail(req, 410, "This form is paused");

  const host = originHost(req.headers.get("origin"), req.headers.get("referer"));
  const ip = clientIp(req.headers);
  let todayCount = 0;
  try {
    const { count } = await admin
      .from("form_submissions")
      .select("*", { count: "exact", head: true })
      .eq("endpoint_id", endpoint.id)
      .eq("is_spam", false)
      .gte("created_at", utcDayStart());
    todayCount = count ?? 0;
  } catch { /* count failure must not block a real submission */ }

  const verdict = gateSubmission({ originHost: host, endpoint, honeypot: reserved.botcheck, ip, todayCount });
  const submitter = extractSubmitter(payload, reserved);
  const subject = resolveSubject(reserved.subject, endpoint.subject_template ?? "", { site: endpoint.name, name: submitter.name });

  const row = {
    endpoint_id: endpoint.id,
    lead_id: endpoint.lead_id,
    payload: payload as PayloadField[],
    subject,
    submitter_name: submitter.name,
    submitter_email: submitter.email,
    ip,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500) || null,
    origin: host,
    referer: (req.headers.get("referer") ?? "").slice(0, 1000) || null,
    cc_email: isEmailAddress(reserved.ccemail) ? reserved.ccemail.trim() : null,
    is_spam: !verdict.ok,
    spam_reason: verdict.ok ? null : (verdict.reason as FormSpamReason),
    delivery_status: verdict.ok ? "pending" : "skipped",
  };
  const { data: inserted, error: insError } = await admin.from("form_submissions").insert(row).select("id").single();
  if (insError || !inserted) return fail(req, 500, "Could not store submission");

  if (!verdict.ok) {
    if (verdict.status === 200) return successResponse(req, reserved.redirect, endpoint, payload, host); // honeypot: bots learn nothing
    return fail(req, verdict.status, verdict.reason === "origin" ? "Origin not allowed" : "Too many submissions, try again later");
  }

  after(() => deliverSubmission(inserted.id as string));
  return successResponse(req, reserved.redirect, endpoint, payload, host);
}

function successResponse(req: Request, redirect: string, endpoint: FormEndpointRow, payload: PayloadField[], submissionHost: string | null): NextResponse {
  if (wantsHtml(req)) {
    const target = requestRedirect(redirect, endpoint, submissionHost) ?? safeRedirect(endpoint.success_redirect_url);
    if (target) return cors(req, NextResponse.redirect(target, 303));
    return cors(req, new NextResponse(THANKS_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
  }
  const data: Record<string, string> = {};
  for (const f of payload) data[f.key] = f.value;
  return reply(req, 200, { success: true, message: "Form submitted successfully", data });
}
