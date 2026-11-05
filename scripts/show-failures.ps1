# Show the failure logs: pipeline heartbeat, incident tray, and recent events.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\show-failures.ps1
#   ... -Events 50        # more raw events
#   ... -Open             # open the log folder in Explorer
param(
    [int]$Events = 15,
    [switch]$Open
)

$ErrorActionPreference = 'SilentlyContinue'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'UTF8'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'server\logs'

if ($Open) { explorer $logDir; return }

if (-not (Test-Path $logDir)) {
    Write-Output "No failure log yet: $logDir"
    Write-Output "Start the server (cd server; npm start) and generate a failure."
    return
}

Write-Output "=== PIPELINE ==============================================="
$status = Join-Path $logDir 'monitor-status.json'
if (Test-Path $status) {
    $s = Get-Content $status -Raw | ConvertFrom-Json
    Write-Output ("Last drain      : {0}" -f $s.lastRunAt)
    Write-Output ("Events read     : {0}   signatures: {1}   new incidents: {2}" -f $s.eventsRead, $s.signatureCount, $s.inboxNew)
    $age = ((Get-Date).ToUniversalTime() - ([datetime]$s.lastRunAt).ToUniversalTime()).TotalMinutes
    Write-Output ("Heartbeat       : {0:N0} min old{1}" -f $age, $(if ($age -gt 45) { '  <-- STALE, drainer may be dead' } else { '' }))
} else {
    Write-Output "No monitor-status.json yet - run: cd server; node failure-drain.js"
}

Write-Output ""
Write-Output "=== INCIDENT TRAY (server\logs\inbox) ======================"
$inbox = Get-ChildItem (Join-Path $logDir 'inbox\FAIL-*.json') | ForEach-Object {
    $j = Get-Content $_.FullName -Raw | ConvertFrom-Json
    [pscustomobject]@{
        Signature = $j.sig
        Class     = $j.cls
        Sev       = $j.sev
        Events    = $j.count
        Installs  = $j.installs
        Status    = $j.status
        LastSeen  = $j.lastSeen
    }
}
if ($inbox) {
    $inbox | Format-Table -AutoSize
    $openItems = @($inbox | Where-Object { @('new', 'regressed', 'open') -contains $_.Status })
    $verifiedItems = @($inbox | Where-Object { $_.Status -eq 'verified' })
    Write-Output ("Open items: {0}  |  verified: {1}" -f $openItems.Count, $verifiedItems.Count)
} else {
    Write-Output "No incidents (tray empty = nothing crossed a threshold)."
}

Write-Output ""
Write-Output "=== RECENT EVENTS (last $Events) ==========================="
$today = Join-Path $logDir ("telemetry-{0}.jsonl" -f (Get-Date -Format 'yyyy-MM-dd'))
$eventsFiles = Get-ChildItem (Join-Path $logDir 'telemetry-*.jsonl') | Sort-Object Name
if ($eventsFiles) {
    $all = foreach ($f in $eventsFiles) {
        Get-Content $f.FullName | ForEach-Object {
            try { $_ | ConvertFrom-Json } catch { }
        }
    }
    $all | Where-Object { -not ($_.cls -eq 'api_error' -and $_.kind -eq 'probe') } | Select-Object -Last $Events | ForEach-Object {
        $what = (@($_.cls, $_.kind, $_.code) | Where-Object { $_ }) -join ' / '
        $who = (@($_.platform, $_.appVersion) | Where-Object { $_ }) -join ' / '
        $detail = if ($_.detail) { $_.detail } elseif ($_.msg) { $_.msg } elseif ($_.route) { $_.route } else { '' }
        "{0}  {1,-24} {2,-16} {3}" -f `
            ([datetime]$_.ts).ToLocalTime().ToString('HH:mm:ss'), $what, $who, $detail
    }
} else {
    Write-Output "No telemetry events yet."
}

Write-Output ""
Write-Output "Raw paths:"
Write-Output "  events   : $logDir\telemetry-<date>.jsonl"
Write-Output "  incidents: $logDir\inbox\"
Write-Output "  heartbeat: $logDir\monitor-status.json"
Write-Output "  memory   : $root\docs\error-register.md"
