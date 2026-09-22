# Removes the SED LMS agent worker from this Windows device. ASCII only.
$ErrorActionPreference = "Continue"
$dest = Join-Path $env:LOCALAPPDATA "sed-agent-worker"
Unregister-ScheduledTask -TaskName "SED-Agent-Worker" -Confirm:$false -ErrorAction SilentlyContinue
$lock = Join-Path $env:TEMP "sed-agent\worker.lock"
if (Test-Path $lock) {
  $workerPid = [int](Get-Content $lock -Raw).Trim()
  Stop-Process -Id $workerPid -Force -ErrorAction SilentlyContinue
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "SED agent worker removed from this device."
