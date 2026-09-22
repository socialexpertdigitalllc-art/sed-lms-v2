SED LMS - AI developer worker kit
=================================

Any device can run the AI developer (Ticket Agent) once it has:
  1. Node.js 20 or newer            https://nodejs.org
  2. Antigravity CLI (agy), signed in with socialexpertdigitalllc@gmail.com
  3. This folder, with agent-worker.env filled in (copy agent-worker.env.example)

Several devices can run it at the same time. Each run is claimed by exactly
one device, and the dashboard shows "online" while any device is running.

Windows
  Right-click install-windows.ps1 > Run with PowerShell.
  It starts now and at every logon, and restarts itself within 3 minutes if it
  stops. The log is %LOCALAPPDATA%\sed-agent-worker\worker.log.
  Remove it with uninstall-windows.ps1.

macOS / Linux
  sh start-worker.sh        (the log is worker.log in this folder)
  For auto-start, add the two cron lines shown at the top of start-worker.sh.

Check a new device first (read-only, never starts agy or takes a run)
  node agent-worker.mjs --check

Try it in the foreground
  node agent-worker.mjs     (Ctrl+C stops it)

What a healthy log looks like
  ... started - agy: C:\...\agy.exe; env: ...\agent-worker.env
  ... agy healthy (11 models available) - taking runs.

If the log says "agy did not answer", open a terminal, run agy, and finish the
sign-in. The worker keeps checking every minute and does not take any run
while agy is unhealthy, so a signed-out device never fails your runs.

agent-worker.env holds the database service key: keep this kit inside the
company and never commit it.
