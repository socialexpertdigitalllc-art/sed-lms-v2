// Next.js instrumentation: runs once on server startup (nodejs runtime).
// A lightweight poller kicks the WGE processor so queued generations drain
// even if an enqueue kick was lost (e.g., across a restart).
import { createAdminClient } from "@/lib/supabase/admin";

let started = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (started) return; // guard against dev HMR double-registration
  started = true;

  // Ticket Agent worker poller — gated by ITS OWN env var, independent of
  // WGE_POLLERS_DISABLED: the Windows box disables the recovery sweeps
  // (prod runs those) but IS the one instance that drives `agy`.
  if (process.env.AGENT_WORKER_ENABLED === "1") {
    const agentOrigin = process.env.WGE_SELF_ORIGIN || "http://localhost:3000";
    const agentSecret = process.env.WGE_PROCESSOR_SECRET || "";
    if (agentSecret) {
      setInterval(() => {
        fetch(`${agentOrigin}/api/site-agent/process`, { method: "POST", headers: { "x-wge-secret": agentSecret } }).catch(() => {});
      }, 20_000);
    }
  }

  // EVERY instance sharing the prod database runs these pollers, and the
  // load multiplies: the 2026-08-17 disk-IO budget incident measured ~3x the
  // configured cadences because the local/dev boxes polled alongside the real
  // Hostinger prod. Exactly ONE instance needs the recovery sweeps — set
  // WGE_POLLERS_DISABLED=1 in every other environment's .env.local (the
  // Windows box has it; Hostinger prod must NOT).
  if (process.env.WGE_POLLERS_DISABLED === "1") {
    console.log("[instrumentation] pollers disabled by WGE_POLLERS_DISABLED=1");
    return;
  }

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

  // Form Relay retry sweep: re-attempts pending/failed email deliveries.
  // Primary delivery is the submit route's after(); this only catches
  // SMTP outages and restarts mid-delivery.
  setInterval(() => {
    fetch(`${origin}/api/forms/deliver`, { method: "POST", headers: { "x-wge-secret": secret } }).catch(() => {});
  }, 120_000);

  // Domain pipeline: advances bought/linked domains through DNS, hosting, SSL
  // and go-live. Primary path is the instant kick after a purchase/link; this
  // sweep picks up every wait ("check again in a minute") and the domains
  // waiting for their lead's site. One indexed read of a partial index.
  setInterval(() => {
    fetch(`${origin}/api/domains/process`, { method: "POST", headers: { "x-wge-secret": secret } }).catch(() => {});
  }, 60_000);
}
