// scripts/agent-worker.ts
/**
 * Standalone Ticket Agent worker — runs the SAME engine as
 * /api/site-agent/process (lib/site-agent/worker.ts) without the LMS app:
 * no Next build, no pm2, no repo checkout. `npm run build:agent-worker`
 * bundles it into dist/agent-worker/ (one .mjs + env template + installers);
 * any device with Node >= 20 and a signed-in `agy` can run that kit.
 *
 * Several devices may run it at once: the engine's CAS claim + claim_id-
 * guarded writes make every run single-owner, and the dashboard's heartbeat
 * (app_settings.agent_worker_seen_at) is "online" while ANY worker is fresh.
 *
 * Health gate: a worker only polls while `agy models` answers with a
 * non-empty list — the cheapest proof that the CLI is installed AND signed
 * in. A signed-out device that polled anyway would claim runs and fail them
 * ("agy produced no result event"), stealing work from a healthy device.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEVICE = hostname();
const POLL_MS = Math.max(10_000, Number(process.env.AGENT_WORKER_POLL_MS) || 20_000);
const HEALTH_RECHECK_MS = 10 * 60_000;
const UNHEALTHY_RETRY_MS = 60_000;
const BUSY_HEARTBEAT_MS = 60_000;

const log = (msg: string) => console.log(`${new Date().toISOString()} [agent-worker ${DEVICE}] ${msg}`);

// ---------------------------------------------------------------------------
// env: first file found wins; real environment variables always win over it.

function scriptDir(): string {
  try { return dirname(fileURLToPath(import.meta.url)); } catch { return process.cwd(); }
}

function loadEnv(): string | null {
  const argIdx = process.argv.indexOf("--env");
  const candidates = [
    argIdx > -1 ? process.argv[argIdx + 1] : undefined,
    process.env.AGENT_WORKER_ENV,
    join(scriptDir(), "agent-worker.env"),
    join(process.cwd(), "agent-worker.env"),
    join(process.cwd(), ".env.local"),
  ].filter((p): p is string => Boolean(p));
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || raw.trimStart().startsWith("#")) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
    return resolve(file);
  }
  return null;
}

// ---------------------------------------------------------------------------
// agy discovery: explicit AGY_BIN, then the installer's default locations,
// then PATH. The resolved path is written back to AGY_BIN because runAgy and
// listAgyModels read it from there.

function findAgy(): string | null {
  const configured = process.env.AGY_BIN?.trim();
  if (configured && existsSync(configured)) return configured;
  const win = platform() === "win32";
  const known = win
    ? [join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "agy", "bin", "agy.exe")]
    : [join(homedir(), ".local", "bin", "agy"), join(homedir(), ".agy", "bin", "agy"), "/usr/local/bin/agy", "/opt/homebrew/bin/agy"];
  for (const p of known) if (existsSync(p)) return p;
  try {
    const out = execFileSync(win ? "where" : "which", ["agy"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && existsSync(first)) return first;
  } catch { /* not on PATH */ }
  return null;
}

// ---------------------------------------------------------------------------
// One worker per device: a second copy (scheduled-task repetition, a manual
// start) sees a live pid in the lock and exits quietly. Duplicates would be
// SAFE (CAS claims) but pointless.

const LOCK = join(tmpdir(), "sed-agent", "worker.lock");

function acquireLock(): boolean {
  mkdirSync(dirname(LOCK), { recursive: true });
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, "utf8").trim());
    if (pid && pid !== process.pid) {
      try { process.kill(pid, 0); return false; } catch { /* stale lock — process is gone */ }
    }
  }
  writeFileSync(LOCK, String(process.pid));
  return true;
}

function releaseLock(): void {
  try { if (readFileSync(LOCK, "utf8").trim() === String(process.pid)) rmSync(LOCK); } catch { /* already gone */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!acquireLock()) {
    log("another worker is already running on this device — exiting.");
    return;
  }
  const envFile = loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    log(`missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env file: ${envFile ?? "none found"}). ` +
      "Put agent-worker.env next to this file — see agent-worker.env.example.");
    releaseLock();
    process.exitCode = 1;
    return;
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;

  const agyBin = findAgy();
  if (!agyBin) {
    log("agy (Antigravity CLI) not found. Install it and sign in with the company account, or set AGY_BIN in agent-worker.env.");
    releaseLock();
    process.exitCode = 1;
    return;
  }
  process.env.AGY_BIN = agyBin;

  // Imported only after env is in place: these modules read process.env.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { processNextAgentRun } = await import("@/lib/site-agent/worker");
  const { fsWorkspace } = await import("@/lib/site-agent/workspaceFs");
  const { runAgy, listAgyModels } = await import("@/lib/site-agent/agy");
  const { notify } = await import("@/lib/notifications/notify");

  const admin = createAdminClient();

  // --check: setup preflight for a new device. Proves the env, the agy path,
  // the bundle and database reachability with ONE read — never launches agy,
  // never claims or writes anything.
  if (process.argv.includes("--check")) {
    const { data, error } = await admin.from("app_settings").select("agent_worker_seen_at").eq("singleton", true).maybeSingle();
    releaseLock();
    if (error) { log(`CHECK FAILED — database: ${error.message}`); process.exitCode = 1; return; }
    const seen = (data as { agent_worker_seen_at?: string | null } | null)?.agent_worker_seen_at ?? null;
    log(`CHECK OK — env: ${envFile ?? "process environment"}; agy: ${agyBin}; database reachable; last worker heartbeat: ${seen ?? "never"}.`);
    log("Next: run without --check. The worker verifies agy's sign-in (`agy models`) before taking any run.");
    void processNextAgentRun; void fsWorkspace; void runAgy; void notify;
    return;
  }

  log(`started — agy: ${agyBin}; env: ${envFile ?? "process environment"}; poll every ${POLL_MS / 1000}s`);

  let healthyUntil = 0;
  const healthy = async (): Promise<boolean> => {
    if (Date.now() < healthyUntil) return true;
    const models = await listAgyModels().catch(() => []);
    if (!models.length) {
      log("agy did not answer `agy models` — not signed in, updating, or offline. Not taking runs; retrying in 60s.");
      return false;
    }
    if (!healthyUntil) log(`agy healthy (${models.length} models available) — taking runs.`);
    healthyUntil = Date.now() + HEALTH_RECHECK_MS;
    return true;
  };

  let stopping = false;
  let busy = false;
  const onSignal = () => {
    if (stopping || !busy) { releaseLock(); process.exit(0); }
    stopping = true;
    log("stopping after the current run (press Ctrl+C again to quit now — the run is then reclaimed after 20 minutes).");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("exit", releaseLock);

  // The engine heartbeats once per poll; a single run can take 15 minutes,
  // longer than the dashboard's 5-minute staleness window — keep it fresh.
  setInterval(() => {
    if (!busy) return;
    Promise.resolve(admin.from("app_settings").update({ agent_worker_seen_at: new Date().toISOString() }).eq("singleton", true))
      .catch(() => {});
  }, BUSY_HEARTBEAT_MS).unref();

  while (!stopping) {
    if (!(await healthy())) { await sleep(UNHEALTHY_RETRY_MS); continue; }
    busy = true;
    try {
      const out = await processNextAgentRun({ admin, driver: runAgy, workspace: fsWorkspace, notify, listModels: () => listAgyModels() });
      if (out.picked) {
        log(`run ${out.runId}: ${out.outcome}`);
        // A failed run may mean agy itself broke — re-verify before the next claim.
        if (out.outcome === "failed") healthyUntil = 0;
        continue; // queue may hold more work — poll again right away
      }
    } catch (e) {
      log(`poll error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busy = false;
    }
    await sleep(POLL_MS);
  }
  releaseLock();
  log("stopped.");
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  releaseLock();
  process.exitCode = 1;
});
