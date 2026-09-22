# Installs the SED LMS agent worker on this Windows device.
# ASCII only on purpose: Windows PowerShell 5.1 misreads BOM-less UTF-8.
#
#   Right-click > Run with PowerShell, or:
#   powershell -ExecutionPolicy Bypass -File install-windows.ps1
#
# Copies the kit to %LOCALAPPDATA%\sed-agent-worker and registers a per-user
# scheduled task that starts the worker at logon and re-checks it every
# 3 minutes (a second copy exits at once, so this is an auto-restart).
$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA "sed-agent-worker"
$task = "SED-Agent-Worker"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js is not installed (need version 20 or newer): https://nodejs.org" }
$major = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($major -lt 20) { throw "Node.js $major found - version 20 or newer is required." }

$envSrc = Join-Path $src "agent-worker.env"
$envDest = Join-Path $dest "agent-worker.env"
if (-not (Test-Path $envSrc) -and -not (Test-Path $envDest)) {
  throw "agent-worker.env is missing. Copy agent-worker.env.example to agent-worker.env and fill in the service key."
}

New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($f in @("agent-worker.mjs", "run-worker.cmd", "run-hidden.vbs", "uninstall-windows.ps1", "README.txt", "agent-worker.env.example")) {
  Copy-Item (Join-Path $src $f) (Join-Path $dest $f) -Force
}
if (Test-Path $envSrc) { Copy-Item $envSrc $envDest -Force }

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ("`"" + (Join-Path $dest "run-hidden.vbs") + "`" `"" + (Join-Path $dest "run-worker.cmd") + "`"") -WorkingDirectory $dest
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$every3 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 3)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $task -Action $action -Trigger @($atLogon, $every3) -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $task

Write-Host ""
Write-Host "Installed to $dest"
Write-Host "Scheduled task '$task' registered and started."
Write-Host "Log: $dest\worker.log  (look for 'agy healthy ... taking runs')"
Write-Host "The worker only runs while you are logged in to Windows, and agy must stay signed in."
