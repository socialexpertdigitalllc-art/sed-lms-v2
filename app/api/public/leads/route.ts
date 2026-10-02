import { after } from "next/server";
import { clientIp } from "@/lib/forms/gate";
import { notify } from "@/lib/notifications/notify";
import { publicKeyGate } from "@/lib/website-cms/public";
import { intakeWebsiteLead } from "@/lib/website-cms/intake";

export const runtime = "nodejs";

// Server-to-server only: the agency website's /api/leads relays every form
// submission here (no CORS — browsers never call this directly).
export async function POST(req: Request) {
  const denied = await publicKeyGate(req);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const result = await intakeWebsiteLead(body, clientIp(req.headers));
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error, ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) },
      { status: result.status },
    );
  }

  // A bot must not be able to tell rejection from success.
  if (!result.spam && result.id) {
    const id = result.id;
    const b = body as { name?: string; service_slug?: string | null; email?: string };
    after(() =>
      notify("website_lead_received", {}, {
        title: `New website lead: ${b.name ?? "visitor"}`,
        body: [b.service_slug ? `Interested in ${b.service_slug}` : "General enquiry", b.email].filter(Boolean).join(" · "),
        dedupKey: `website_lead:${id}`,
        targetUrl: "/website/leads",
      }),
    );
  }

  return Response.json({ ok: true, reference: result.id ? result.id.slice(0, 8) : "received" });
}
