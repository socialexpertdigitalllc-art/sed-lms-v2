// Next.js instrumentation: runs once on server startup (nodejs runtime).
// A lightweight poller kicks the WGE processor so queued generations drain
// even if an enqueue kick was lost (e.g., across a restart).
import { createAdminClient } from "@/lib/supabase/admin";

let started = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (started) return; // guard against dev HMR double-registration
  started = true;

  // Poller cadences: every tick below runs DB queries (often writes), and the
  // aggregate was a meaningful slice of the shared instance's disk-IO burst
  // budget. All of these are RECOVERY sweeps, not the primary delivery path —
  // enqueue kicks and realtime handle the interactive cases — so minutes-scale
  // lag is acceptable everywhere here.

  // Close sessions left open past the idle timeout (e.g. tab closed without logout).
  setInterval(async () => {
    try {
      await createAdminClient().rpc("close_stale_sessions");
    } catch {
      // best-effort
    }
  }, 300_000);

  const origin = process.env.WGE_SELF_ORIGIN || "http://localhost:3000";
  const secret = process.env.WGE_PROCESSOR_SECRET || "";
  if (!secret) return; // not configured → no poller

  setInterval(() => {
    fetch(`${origin}/api/ai-tools/wge/process`, { method: "POST", headers: { "x-wge-secret": secret } }).catch(() => {});
  }, 300_000);

  setInterval(() => {
    fetch(`${origin}/api/notifications/generate`, { method: "POST", headers: { "x-wge-secret": secret } }).catch(() => {});
  }, 180_000);

  setInterval(() => {
    fetch(`${origin}/api/tickets/maintenance`, { method: "POST", headers: { "x-wge-secret": secret } }).catch(() => {});
  }, 900_000);

  // Site Builder processor: starts queued runs and resumes parked ones
  // (failed + due resume_at + auto_resume on). Single-flight per tick.
  setInterval(() => {
    fetch(`${origin}/api/site-builder/process`, { method: "POST", headers: { "x-wge-secret": secret } }).catch(() => {});
  }, 180_000);
}
