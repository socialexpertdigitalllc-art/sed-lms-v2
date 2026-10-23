/**
 * pm2 process file for the LMS — CLUSTER mode.
 *
 * NOT USED ON THE CURRENT HOSTING. lms.sedsolutions.online runs on Hostinger's
 * managed Node.js hosting, which builds from GitHub and runs the Next server
 * itself (one process, no pm2, no shell). This file is for the day the LMS
 * moves to a VPS or a Cloud plan; see docs/sops/scaling-and-load-balancing.md.
 *
 * Until now the app ran as ONE Node process (`pm2 start ... sed-lms`). Node
 * serves requests on a single thread, so one slow render (the dashboard
 * serialising every lead for one tab) made every other person's click wait,
 * and a burst — a realtime event refreshing twenty open tabs at once — queued
 * up behind it until the gateway returned 504s. That is the "stuck" dashboard.
 *
 * Cluster mode starts several copies of the server on the SAME port and
 * balances connections between them (Node's cluster module, managed by pm2):
 * one slow render now occupies one worker while the others keep serving, and
 * a worker that dies or is restarted for memory is replaced while the rest
 * carry on — the site no longer goes down with a single process.
 *
 * Switching over (once per server, then plain `pm2 reload sed-lms`):
 *   pm2 delete sed-lms
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 * See docs/sops/scaling-and-load-balancing.md for the full runbook.
 */
module.exports = {
  apps: [
    {
      name: "sed-lms",
      script: "node_modules/next/dist/bin/next",
      args: "start -p " + (process.env.PORT || 3000),
      cwd: __dirname,
      exec_mode: "cluster",
      // Workers. Two is right for a 2–4 vCPU box with ~4 GB: each Next worker
      // sits around 400–700 MB. Raise with `SED_LMS_INSTANCES=4` (or "max",
      // one per CPU) once memory allows — see the SOP for how to check.
      instances: process.env.SED_LMS_INSTANCES || 2,
      // A worker that leaks past this is recycled on its own, one at a time,
      // instead of taking the whole site down when the box runs out of RAM.
      max_memory_restart: process.env.SED_LMS_MAX_MEMORY || "1200M",
      // Zero-downtime `pm2 reload`: the new worker has this long to come up
      // before the old one is told to stop, which then has kill_timeout to
      // finish in-flight requests (uploads, AI streams).
      listen_timeout: 30_000,
      kill_timeout: 15_000,
      // Crash-loop protection: never restart faster than this.
      min_uptime: "20s",
      max_restarts: 10,
      restart_delay: 2_000,
      exp_backoff_restart_delay: 500,
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
        // Per-worker heap ceiling, below max_memory_restart so V8 collects
        // before pm2 has to recycle.
        NODE_OPTIONS: "--max-old-space-size=1024",
      },
    },
  ],
};
