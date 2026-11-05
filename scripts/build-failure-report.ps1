# Builds a human-friendly HTML report of what went wrong and what was fixed.
#
# Output: server\logs\failure-report.html  (self-contained, no internet needed)
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\build-failure-report.ps1
#   ... -Open        # build and open in the default browser
param([switch]$Open)

$ErrorActionPreference = 'SilentlyContinue'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'UTF8'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'server\logs'
$outFile = Join-Path $logDir 'failure-report.html'

if (-not (Test-Path $logDir)) {
    Write-Output "No logs yet at $logDir. Start the server first."
    return
}

function Html([string]$text) {
    if (-not $text) { return '' }
    return [System.Net.WebUtility]::HtmlEncode($text)
}

# Turn machine classes into plain English.
$classHuman = @{
    'subtitle_failed'      = 'Subtitles'
    'player_error'         = 'Video playback'
    'stream_resolve_failed'= 'Finding the video stream'
    'proxy_upstream_error' = 'Video source connection'
    'catalog_fetch_failed' = 'Loading the catalogue'
    'api_error'            = 'Server / API'
    'update_download_failed'= 'App update download'
    'update_install_failed'= 'App update install'
    'app_error'            = 'App crashed'
    'app_restart'          = 'App restarted'
}
function ClassName([string]$cls) {
    if ($classHuman.ContainsKey($cls)) { return $classHuman[$cls] }
    if ($cls) { return $cls.Replace('_', ' ') }
    return 'Unknown'
}
function PlatformName([string]$p) {
    switch ($p) {
        'server'  { return 'on the server' }
        'web'     { return 'on the website' }
        'android' { return 'on Android' }
        'tv'      { return 'on the TV' }
        'webos'   { return 'on LG TV' }
        default   { return 'device unknown' }
    }
}

# ---------- gather events ----------
$eventList = New-Object System.Collections.ArrayList
Get-ChildItem (Join-Path $logDir 'telemetry-*.jsonl') | Sort-Object Name | ForEach-Object {
    Get-Content $_.FullName | ForEach-Object {
        try { [void]$eventList.Add(($_ | ConvertFrom-Json)) } catch { }
    }
}
$events = @($eventList) | Where-Object { -not ($_.cls -eq 'api_error' -and $_.kind -eq 'probe') } |
    Sort-Object { [datetime]$_.ts } -Descending
$recent = @($events | Select-Object -First 100)

# Fallback map: the clearest "what broke" text for each incident signature.
$detailBySig = @{}
foreach ($ev in $events) {
    $sigKey = [string]$ev.sig
    if ($sigKey -and -not $detailBySig.ContainsKey($sigKey)) {
        $d = if ($ev.detail) { $ev.detail } elseif ($ev.msg) { $ev.msg } else { '' }
        if ($d) { $detailBySig[$sigKey] = $d }
    }
}

# ---------- gather incidents ----------
$incidents = Get-ChildItem (Join-Path $logDir 'inbox\FAIL-*.json') | ForEach-Object {
    try { Get-Content $_.FullName -Raw | ConvertFrom-Json } catch { }
}
$incidents = @($incidents | Sort-Object { [datetime]$_.lastSeen } -Descending)

# ---------- pipeline status ----------
$status = Get-Content (Join-Path $logDir 'monitor-status.json') -Raw | ConvertFrom-Json
$heartbeatAge = 'unknown'
$stale = $false
if ($status) {
    $span = (Get-Date).ToUniversalTime() - ([datetime]$status.lastRunAt).ToUniversalTime()
    $heartbeatAge = "{0:N0} min ago" -f $span.TotalMinutes
    $stale = $span.TotalMinutes -gt 45
}
$openIncidents = @($incidents | Where-Object { @('new', 'regressed', 'open') -contains $_.status }).Count
$verifiedIncidents = @($incidents | Where-Object { $_.status -eq 'verified' }).Count
$generated = (Get-Date).ToString('yyyy-MM-dd HH:mm')

# ---------- build html ----------
$badge = @{ 'verified' = '#22c55e'; 'fixed' = '#eab308'; 'open' = '#ef4444'; 'new' = '#ef4444'; 'regressed' = '#f97316'; 'dispatch' = '#60a5fa' }
$sevColor = @{ 'P0' = '#ef4444'; 'P1' = '#f97316'; 'P2' = '#eab308'; 'P3' = '#94a3b8' }

$incidentCards = foreach ($inc in $incidents) {
    $statusName = if ($inc.status) { $inc.status } else { 'new' }
    $statusColor = if ($badge.ContainsKey($statusName)) { $badge[$statusName] } else { '#94a3b8' }
    $sevName = if ($inc.sev) { $inc.sev } else { 'P3' }
    $sevColorValue = if ($sevColor.ContainsKey($sevName)) { $sevColor[$sevName] } else { '#94a3b8' }
    $isServerSide = ($inc.platforms -and $inc.platforms.server -gt 0)
    $clsLabel = if ($inc.cls -eq 'app_error' -and $isServerSide) { 'Server error' } else { ClassName([string]$inc.cls) }
    $reason = ''
    foreach ($s in @($inc.samples)) {
        if ($s.msg) { $reason = $s.msg; break }
        if ($s.detail) { $reason = $s.detail; break }
        if ($s.code) { $reason = $s.code; break }
    }
    if (-not $reason -and $detailBySig.ContainsKey([string]$inc.sig)) { $reason = $detailBySig[[string]$inc.sig] }
    if (-not $reason) { $reason = 'see the raw log for details' }
    $fixedNote = if ($inc.notes) { Html([string]$inc.notes) } else { 'Still being investigated.' }
    if ($inc.installs -gt 1) { $installText = "{0} installs" -f $inc.installs }
    elseif ($inc.installs -eq 1) { $installText = "1 install" }
    else { $installText = "the server itself" }
    $lastSeen = ([datetime]$inc.lastSeen).ToLocalTime().ToString('yyyy-MM-dd HH:mm')
    @"
    <div class="card">
      <div class="card-top">
        <div class="card-title">$(Html($clsLabel))</div>
        <div class="pills">
          <span class="pill" style="background:$statusColor">$(Html($statusName))</span>
          <span class="pill" style="background:$sevColorValue">$(Html($sevName))</span>
        </div>
      </div>
      <div class="card-meta">Happened <b>$($inc.count)</b> time(s) from $installText &middot; last seen $lastSeen</div>
      <div class="card-row"><span class="label">What broke</span><span>$(Html($reason))</span></div>
      <div class="card-row"><span class="label">What we did</span><span>$fixedNote</span></div>
      <div class="card-sig">id: $(Html([string]$inc.sig))</div>
    </div>
"@
}

$timeline = foreach ($ev in $recent) {
    $when = ([datetime]$ev.ts).ToLocalTime().ToString('HH:mm')
    $whatLabel = if ($ev.cls -eq 'app_error' -and [string]$ev.platform -eq 'server') { 'Server error' } else { ClassName([string]$ev.cls) }
    $detail = if ($ev.detail) { $ev.detail } elseif ($ev.msg) { $ev.msg } elseif ($ev.route) { $ev.route } else { '' }
    @"
    <div class="event">
      <span class="ev-time">$when</span>
      <span class="ev-what">$(Html($whatLabel))</span>
      <span class="ev-where">$(Html(PlatformName([string]$ev.platform)))</span>
      <span class="ev-detail">$(Html([string]$detail))</span>
    </div>
"@
}

$staleBanner = if ($stale) { '<div class="banner warn">The watch job has not run recently - incidents may be missing. Run: cd server; node failure-drain.js</div>' } else { '' }
$openBanner = if ($openIncidents -gt 0) { "<div class='banner alert'>$openIncidents problem(s) need attention.</div>" } else { '<div class="banner ok">Nothing needs attention right now.</div>' }

$html = @"
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MovieFlix - failure report $generated</title>
<style>
  body { margin:0; padding:32px; background:#0b0e14; color:#e7ebf3; font-family:'Segoe UI',system-ui,sans-serif; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:#94a3b8; font-size:13px; margin-bottom:20px; }
  .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
  .stat { background:#151a24; border:1px solid #232a38; border-radius:12px; padding:12px 16px; min-width:120px; }
  .stat b { display:block; font-size:22px; }
  .stat span { color:#94a3b8; font-size:12px; }
  .banner { padding:10px 14px; border-radius:10px; margin-bottom:18px; font-size:14px; }
  .banner.ok { background:#0f2a1d; border:1px solid #1d5c3c; color:#86efac; }
  .banner.alert { background:#2b1216; border:1px solid #7f1d1d; color:#fca5a5; }
  .banner.warn { background:#2a2410; border:1px solid #6b5a12; color:#fde68a; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.08em; color:#94a3b8; margin:26px 0 10px; }
  .card { background:#151a24; border:1px solid #232a38; border-radius:14px; padding:16px; margin-bottom:12px; }
  .card-top { display:flex; justify-content:space-between; gap:10px; align-items:center; }
  .card-title { font-size:16px; font-weight:600; }
  .pill { color:#08101f; font-weight:700; font-size:11px; padding:3px 9px; border-radius:99px; }
  .pills { display:flex; gap:6px; }
  .card-meta { color:#94a3b8; font-size:12px; margin:6px 0 10px; }
  .card-row { display:flex; gap:10px; font-size:13px; padding:4px 0; border-top:1px dashed #232a38; }
  .label { color:#94a3b8; min-width:100px; }
  .card-sig { color:#475569; font-family:Consolas,monospace; font-size:11px; margin-top:8px; }
  .event { display:flex; gap:12px; font-size:13px; padding:6px 0; border-bottom:1px solid #1b2230; }
  .ev-time { color:#94a3b8; width:52px; font-family:Consolas,monospace; }
  .ev-what { width:210px; }
  .ev-where { width:130px; color:#94a3b8; }
  .ev-detail { color:#cbd5e1; }
  .footer { color:#475569; font-size:12px; margin-top:26px; line-height:1.7; }
  code { background:#101521; padding:1px 5px; border-radius:4px; font-size:11px; }
</style>
</head>
<body>
  <h1>MovieFlix - what went wrong</h1>
  <div class="sub">Readable report generated $generated &middot; raw logs stay in server\logs</div>
  $openBanner
  $staleBanner
  <div class="stats">
    <div class="stat"><b>$($events.Count)</b><span>recorded failures</span></div>
    <div class="stat"><b>$($incidents.Count)</b><span>incidents</span></div>
    <div class="stat"><b>$openIncidents</b><span>need attention</span></div>
    <div class="stat"><b>$verifiedIncidents</b><span>fixed and verified</span></div>
    <div class="stat"><b>$heartbeatAge</b><span>last watch run</span></div>
  </div>

  <h2>Problems found</h2>
  $(if ($incidentCards) { $incidentCards -join "`n" } else { '<div class="card"><div class="card-meta">No incidents yet - nothing has crossed the alert threshold.</div></div>' })

  <h2>Recent activity (newest first)</h2>
  $(if ($timeline) { $timeline -join "`n" } else { '<div class="card"><div class="card-meta">No events recorded yet.</div></div>' })

  <div class="footer">
    Raw files: <code>server\logs\telemetry-*.jsonl</code> (events) &middot;
    <code>server\logs\inbox\</code> (incidents) &middot;
    <code>docs\error-register.md</code> (memory)<br>
    Console view: <code>scripts\show-failures.ps1</code> &middot; rebuild this report: <code>scripts\build-failure-report.ps1</code>
  </div>
</body>
</html>
"@

$html | Out-File -FilePath $outFile -Encoding UTF8
Write-Output "Report written: $outFile"
Write-Output ("Failures: {0}  incidents: {1}  open: {2}  verified: {3}" -f $events.Count, $incidents.Count, $openIncidents, $verifiedIncidents)
if ($Open) { Start-Process $outFile }
