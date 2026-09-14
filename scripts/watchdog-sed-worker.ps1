# SED-LMS agent-worker watchdog (ASCII only - PS 5.1 reads BOM-less files as ANSI)
#
# REPO COPY for review/history. The DEPLOYED copy the Scheduled Task actually
# runs is <user home>\.pm2\watchdog-sed-worker.ps1 on the worker Windows box -
# after editing here, copy it there. Setup + operation: docs/sops/ticket-agent-worker.md.
# Paths derive from the running user's profile, so the same file works on any
# worker box (it moved machines on 2026-09-11).
#
# Runs every 3 minutes from the Scheduled Task "SED-LMS-agent-worker-watchdog".
# If nothing is listening on port 3000 (the pm2-served local LMS that feeds the
# agent-worker heartbeat), it force-restarts sed-lms via pm2 and re-saves the
# dump once the app is confirmed back up.
#
# Safety valves:
#  - touch <user home>\.pm2\watchdog-disabled to pause the watchdog during
#    deliberate maintenance (stop/build/start); delete it to resume.
#  - it refuses to restart while D:\sed-lms-v2\.next\BUILD_ID is missing
#    (a build is in progress / was wiped - restarting would crash-loop).
#  - 10-minute cooldown between restart attempts so a slow cold start is not
#    mistaken for another outage.
# Log: <user home>\.pm2\watchdog-sed-worker.log (healthy probes are not logged).

param(
    [int]$Port = 3000,
    [switch]$DryRun
)

$pm2Home  = Join-Path $env:USERPROFILE '.pm2'
$pm2      = Join-Path $env:APPDATA 'npm\pm2.cmd'
$log      = Join-Path $pm2Home 'watchdog-sed-worker.log'
$state    = Join-Path $pm2Home 'watchdog-sed-worker.state'
$disable  = Join-Path $pm2Home 'watchdog-disabled'
$buildId  = 'D:\sed-lms-v2\.next\BUILD_ID'

function Write-Log([string]$msg) {
    $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    try {
        Add-Content -Path $log -Value $line -ErrorAction Stop
    } catch {
        # A reader holding the log (e.g. a Unix-style tail -f) denies writers on
        # Windows. Never lose the record - spill to a side file instead.
        try { Add-Content -Path ($log + '.2') -Value $line -ErrorAction Stop } catch {}
    }
}

function Test-Port([int]$p) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $p, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne(5000) -and $client.Connected) {
            $client.EndConnect($iar)
            return $true
        }
        return $false
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

# Rotate the log if it grows past 1 MB (keep the last 300 lines).
try {
    if ((Test-Path $log) -and ((Get-Item $log).Length -gt 1MB)) {
        $tail = Get-Content $log -Tail 300
        Set-Content -Path $log -Value $tail
    }
} catch {}

if (Test-Path $disable) { exit 0 }

if (Test-Port $Port) { exit 0 }   # healthy - stay silent

# Port is down. Honor the restart cooldown.
if (Test-Path $state) {
    try {
        $last = [datetime]::Parse((Get-Content $state -TotalCount 1))
        if (((Get-Date) - $last) -lt [TimeSpan]::FromMinutes(10)) {
            Write-Log "port $Port down, but last restart was $last - inside cooldown, skipping"
            exit 0
        }
    } catch {}
}

# The repo lives on a USB disk that spins down when idle; the first touch
# after sleep can fail while it wakes (this held the watchdog off for hours
# on 2026-09-14). Probe up to 3 times over ~10s before declaring the build
# missing - a genuinely wiped build still fails all three.
$buildIdPresent = $false
for ($i = 0; $i -lt 3; $i++) {
    if (Test-Path $buildId) { $buildIdPresent = $true; break }
    Start-Sleep -Seconds 5
}
if (-not $buildIdPresent) {
    Write-Log "port $Port down but $buildId is missing (build wiped or in progress) - NOT restarting; run 'npm run build' then 'pm2 restart sed-lms'"
    exit 0
}

Write-Log "port $Port not listening - restarting sed-lms via pm2"
if ($DryRun) { Write-Log 'dry-run: would run pm2 restart sed-lms'; exit 0 }

Get-Date -Format o | Set-Content $state

& $pm2 restart sed-lms | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Log "pm2 restart failed (exit $LASTEXITCODE) - trying pm2 resurrect + restart"
    & $pm2 resurrect | Out-Null
    & $pm2 restart sed-lms | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Log "pm2 restart still failing (exit $LASTEXITCODE) - giving up this cycle"
        exit 1
    }
}

# Wait up to 150s for the app to actually serve, then save the good state.
$deadline = (Get-Date).AddSeconds(150)
$up = $false
while ((Get-Date) -lt $deadline) {
    if (Test-Port $Port) { $up = $true; break }
    Start-Sleep -Seconds 5
}

if ($up) {
    Write-Log "sed-lms is back up on port $Port - running pm2 save"
    & $pm2 save | Out-Null
    Write-Log 'restart + save complete'
} else {
    Write-Log 'sed-lms still not listening 150s after restart - leaving it (cooldown holds next cycle); check pm2 logs sed-lms'
}
