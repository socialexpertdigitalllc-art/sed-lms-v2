// Next.js instrumentation: runs once on server startup (nodejs runtime).
// A lightweight poller kicks the WGE processor so queued generations drain
// even if an enqueue kick was lost (e.g., across a restart).
import { createAdminClient } from "@/lib/supabase/admin";

let started = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (started) return; // guard against dev HMR double-registration
  started = true;

  // Close sessions left open past the idle timeout (e.g. tab closed without logout).
  setInterval(async () => {
    try {
      await createAdminClient().rpc("close_stale_sessions");
    } catch {
      // best-effort
    }
  }, 120_000);

  const origin = process.env.WGE_SELF_ORIGIN || "http://localhost:3000";
  const secret = process.env.WGE_PROCESSOR_SECRET || "";
  if (!secret) return; // not configured → no poller

  setInterval(() => {
    fetch(`${origin}/api/ai-tools/wge/process`, { method: "POST", headers: { "x-wge-secret": secret } }).catch(() => {});
  }, 120_000);

  setInterval(() => {
    fetch(`${origin}/api/notifications/generate`, { method: "POST", headers: { "x-wge-secret": secret } }).catch(() => {});
  }, 60_000);
}
