import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { recordBuilderImage } from "@/lib/site-builder/imageLibrary";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST: turn an operator's image pick into the URL that will sit in the run's
 * `images: [{url, purpose}]` array and, from there, directly into the site's
 * HTML.
 *
 * NOTHING IS DOWNLOADED OR REHOSTED. A pick resolves to the image's own
 * public link — a Pexels CDN URL, a link already stored in the library, or
 * the client's own photo link — and that exact string is what the generated
 * page references.
 *
 * This replaced a rehost-into-a-private-bucket design whose long-lived
 * *signed* URLs (`…/object/sign/…?token=<JWT>`) shipped inside client sites:
 * the model truncated the mandatory token when writing `<img src>`, and those
 * images 400'd with "querystring must have required property 'token'". A
 * plain public URL has no token to lose.
 *
 * The pick is also recorded in the library (see `imageLibrary.ts`) against the
 * service it was found for, so the same service searched later — or the same
 * photo used for another client — resolves without another API call. That
 * write is best-effort: a library hiccup must never cost the operator a pick
 * whose URL is already perfectly good.
 */

/** Only a genuine http(s) URL may be stored or put on a page. Blocks the
 *  obvious smuggling shapes (`javascript:`, `data:`, `file:`) that would
 *  otherwise reach a client site's markup. */
function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Restricts a Pexels pick to Pexels' own hosts — the same domain fence the
 *  rehosting version applied, kept because a client-supplied `download_url`
 *  is otherwise an open invitation to point a client's site anywhere. */
function isPexelsHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "pexels.com" || host.endsWith(".pexels.com");
  } catch {
    return false;
  }
}

interface PickBody {
  kind?: unknown;
  lead_id?: unknown;
  url?: unknown;
  subject?: unknown;
  pexels?: {
    download_url?: unknown;
    thumb_url?: unknown;
    subject?: unknown;
    pexels_id?: unknown;
    width?: unknown;
    height?: unknown;
    photographer?: unknown;
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const body = (await req.json().catch(() => null)) as PickBody | null;
  const kind = body?.kind;
  if (kind !== "link" && kind !== "pexels" && kind !== "client") {
    return NextResponse.json({ error: "kind must be link, pexels, or client" }, { status: 422 });
  }

  const admin = createAdminClient();

  // "link" — a URL the operator already has: one picked out of the library,
  // or one pasted in by hand. Used as-is and remembered against its service.
  if (kind === "link") {
    const url = str(body?.url);
    if (!url || !isPublicHttpUrl(url)) {
      return NextResponse.json({ error: "Enter a valid http(s) image URL" }, { status: 422 });
    }
    await recordBuilderImage(admin, { url, source: "pexels", subject: str(body?.subject), createdBy: auth.userId });
    return NextResponse.json({ url });
  }

  if (kind === "pexels") {
    const p = body?.pexels;
    const url = str(p?.download_url);
    if (!url || !isPexelsHost(url) || !isPublicHttpUrl(url)) {
      return NextResponse.json({ error: "A valid Pexels download_url is required" }, { status: 422 });
    }
    const thumb = str(p?.thumb_url);
    await recordBuilderImage(admin, {
      url,
      thumbUrl: thumb && isPublicHttpUrl(thumb) ? thumb : null,
      subject: str(p?.subject),
      source: "pexels",
      pexelsId: num(p?.pexels_id) ?? null,
      photographer: str(p?.photographer) || null,
      width: num(p?.width) ?? 0,
      height: num(p?.height) ?? 0,
      createdBy: auth.userId,
    });
    return NextResponse.json({ url });
  }

  // kind === "client" — one of the lead's OWN photo links, used untouched.
  const leadId = str(body?.lead_id);
  const photoUrl = str(body?.url);
  if (!leadId || !photoUrl) return NextResponse.json({ error: "lead_id and url are required" }, { status: 422 });
  if (!isPublicHttpUrl(photoUrl)) return NextResponse.json({ error: "That photo link is not a usable URL" }, { status: 422 });

  // The fence: only a link this lead actually has on file may be used for it.
  const { data: lead, error: leadErr } = await admin.from("leads").select("image_links").eq("id", leadId).single();
  if (leadErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const clientPhotos = Array.isArray(lead.image_links) ? (lead.image_links as string[]) : [];
  if (!clientPhotos.includes(photoUrl)) {
    return NextResponse.json({ error: "That photo is not one of this lead's own client photos" }, { status: 422 });
  }

  await recordBuilderImage(admin, {
    url: photoUrl,
    subject: str(body?.subject) || "client photo",
    source: "client_link",
    leadId,
    createdBy: auth.userId,
  });
  return NextResponse.json({ url: photoUrl });
}
