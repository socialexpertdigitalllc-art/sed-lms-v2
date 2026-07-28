import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { failCapture, saveHarvest, startCapture } from "@/lib/photo-capture/store";
import { isGoogleProfileLink } from "@/lib/photo-capture/googleLink";

export const runtime = "nodejs";

/**
 * The PAGE reports what the extension harvested — the extension never talks to
 * this API itself, so there is no extension credential to leak (design §4).
 */
const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), profileLink: z.string().url().max(2000) }),
  z.object({
    kind: z.literal("done"),
    profileLink: z.string().url().max(2000),
    extensionVersion: z.string().max(32).nullish(),
    photos: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(256),
          thumbUrl: z.string().url().max(2000),
          sourceUrl: z.string().url().max(2000),
        })
      )
      .max(30),
  }),
  z.object({ kind: z.literal("failed"), error: z.string().max(500) }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  try {
    if (parsed.data.kind === "failed") {
      await failCapture(id, parsed.data.error);
      return NextResponse.json({ status: "failed" });
    }

    // Only a Google profile link may be recorded — it is what the auto-capture
    // comparison in the Images group is keyed on.
    if (!isGoogleProfileLink(parsed.data.profileLink)) {
      return NextResponse.json({ error: "Not a Google Business Profile link" }, { status: 422 });
    }

    if (parsed.data.kind === "started") {
      await startCapture(id, user.id, parsed.data.profileLink);
      return NextResponse.json({ status: "pending" });
    }

    // Only Google photo URLs may be stored: the source URL is fetched by our
    // server (and by imgbb) later, so an arbitrary URL here would be an SSRF.
    const allowed = parsed.data.photos.filter(
      (p) => /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(p.sourceUrl) &&
             /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(p.thumbUrl)
    );

    const result = await saveHarvest(id, allowed, {
      extensionVersion: parsed.data.extensionVersion ?? null,
      profileLink: parsed.data.profileLink,
    });
    return NextResponse.json(result);
  } catch (e) {
    // Log the real error server-side; never hand raw database error text back
    // to the browser.
    console.error(`[photo-capture] candidates POST failed for lead ${id}:`, e);
    return NextResponse.json({ error: "Photo capture is unavailable" }, { status: 500 });
  }
}
