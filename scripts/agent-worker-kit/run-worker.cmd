@echo off
rem Launched hidden by the "SED-Agent-Worker" scheduled task (via run-hidden.vbs).
rem The worker exits at once when another copy already runs on this device,
rem so the task's 3-minute repetition is a cheap auto-restart.
cd /d "%~dp0"
for %%F in (worker.log) do if %%~zF GTR 5000000 move /y worker.log worker.log.1 >nul
node agent-worker.mjs >> worker.log 2>&1
