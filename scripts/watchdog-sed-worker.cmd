@echo off
rem Runs the SED-LMS agent-worker watchdog. Launched every 3 minutes by the
rem Scheduled Task "SED-LMS-agent-worker-watchdog" through run-hidden.vbs so
rem no console window ever flashes (operator complaint, 2026-09-14).
rem Deployed copy: %USERPROFILE%\.pm2\watchdog-sed-worker.cmd (edit in the
rem repo's scripts\, then copy there). Setup: docs/sops/ticket-agent-worker.md.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.pm2\watchdog-sed-worker.ps1"
