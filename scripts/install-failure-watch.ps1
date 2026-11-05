# Registers the deterministic failure drainer as a Windows scheduled task.
#
# Why: incident files are created in real time by the server sink
# (server/telemetry.js), but the drainer adds the heartbeat/state file the
# failure-monitor role reads and re-scans JSONL after a restart.
#
# Usage (from PowerShell, no admin needed):
#   powershell -ExecutionPolicy Bypass -File scripts\install-failure-watch.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-failure-watch.ps1 -Uninstall
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$taskName = 'MovieFlixFailureDrain'

if ($Uninstall) {
    schtasks /Delete /TN $taskName /F 2>$null | Out-Null
    Write-Output "Removed scheduled task '$taskName'."
    exit 0
}

$root = Split-Path -Parent $PSScriptRoot
$drainer = Join-Path $root 'server\failure-drain.js'
if (-not (Test-Path $drainer)) { throw "failure-drain.js not found at $drainer" }
$node = (Get-Command node).Source

$action = '"' + $node + '" "' + $drainer + '"'
schtasks /Create /TN $taskName /SC MINUTE /MO 15 /TR $action /F | Out-Host
Write-Output "Registered '$taskName' every 15 minutes."
Write-Output "The failure-monitor role still needs a DSH session (or the 'Failure watch' prompt) to triage and fix incidents."
