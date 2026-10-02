import { publicKeyGate, publicJson } from "@/lib/website-cms/public";
import { getWebsiteSettings } from "@/lib/website-cms/settings";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = await publicKeyGate(req);
  if (denied) return denied;
  const settings = await getWebsiteSettings();
  return publicJson({ stats: settings.stats });
}
