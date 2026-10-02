import { publicKeyGate, publicJson, loadSiteContent } from "@/lib/website-cms/public";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = await publicKeyGate(req);
  if (denied) return denied;
  try {
    return publicJson(await loadSiteContent());
  } catch {
    // Missing table (migration not applied yet) or DB hiccup — the website
    // falls back to its baked-in content on any non-200.
    return Response.json({ error: "Content unavailable" }, { status: 503 });
  }
}
