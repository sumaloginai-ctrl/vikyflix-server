# Builds a human-friendly "what was watched" report from the activity log.
#
# Shows: per-device (support code, model, version), what was watched and how
# long, top titles with total watch time, and recent play sessions.
#
# Output: server\logs\watch-report.html  (self-contained, no internet needed)
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\build-watch-report.ps1
#   ... -Open        # build and open in the browser
param([switch]$Open)

$ErrorActionPreference = 'SilentlyContinue'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'UTF8'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'server\logs'
$outFile = Join-Path $logDir 'watch-report.html'

if (-not (Test-Path $logDir)) {
    Write-Output "No logs yet at $logDir. Start the server first."
    return
}

function Html([string]$text) {
    if (-not $text) { return '' }
    return [System.Net.WebUtility]::HtmlEncode($text)
}
function SupportCode([string]$installId) {
    if (-not $installId) { return 'unknown device' }
    $clean = ($installId -replace '[^A-Za-z0-9]', '')
    return 'VF-' + $clean.Substring([Math]::Max(0, $clean.Length - 6)).ToUpper()
}
function PlatformName([string]$p) {
    switch ($p) {
        'android' { return 'Android app' }
        'tv'      { return 'TV app' }
        'web'     { return 'Website' }
        'webos'   { return 'LG TV' }
        default   { return 'Unknown device' }
    }
}
function Format-Duration([int]$seconds) {
    if (-not $seconds -or $seconds -lt 1) { return '0s' }
    $h = [Math]::Floor($seconds / 3600)
    $m = [Math]::Floor(($seconds % 3600) / 60)
    $s = $seconds % 60
    if ($h -gt 0) { return "${h}h ${m}m" }
    if ($m -gt 0) { return "${m}m ${s}s" }
    return "${s}s"
}

# ---------- gather activity ----------
$activity = New-Object System.Collections.ArrayList
Get-ChildItem (Join-Path $logDir 'activity-*.jsonl') | Sort-Object Name | ForEach-Object {
    Get-Content $_.FullName | ForEach-Object {
        try { [void]$activity.Add(($_ | ConvertFrom-Json)) } catch { }
    }
}
$activity = @($activity | Sort-Object { [datetime]$_.ts } -Descending)
$plays = @($activity | Where-Object { $_.type -eq 'play' })
$launches = @($activity | Where-Object { $_.type -eq 'app_open' })

# One play session = play start + its progress/final events (grouped by playId).
$sessionEvents = @($activity | Where-Object {
    $_.playId -and (@('play', 'play_progress', 'play_end') -contains $_.type)
})
$sessions = $sessionEvents | Group-Object { $_.playId } | ForEach-Object {
    $first = $_.Group | Select-Object -First 1
    $maxSeconds = 0
    $maxPercent = 0
    $last = $first
    foreach ($e in $_.Group) {
        if ($e.watchedSeconds -gt $maxSeconds) { $maxSeconds = [int]$e.watchedSeconds }
        if ($e.percent -gt $maxPercent) { $maxPercent = [int]$e.percent }
        if ([datetime]$e.ts -gt [datetime]$last.ts) { $last = $e }
    }
    [pscustomobject]@{
        PlayId    = $_.Name
        MediaId   = if ($first.mediaId) { [string]$first.mediaId } else { '' }
        Title     = if ($first.title) { [string]$first.title } else { 'Untitled' }
        Se        = $first.se
        Ep        = $first.ep
        Device    = if ($first.device) { [string]$first.device } else { 'unknown' }
        Platform  = [string]$first.platform
        InstallId = [string]$first.installId
        Seconds   = $maxSeconds
        Percent   = $maxPercent
        LastSeen  = [datetime]$last.ts
    }
}
$sessions = @($sessions)
$totalWatchSeconds = 0
foreach ($s in $sessions) { $totalWatchSeconds += [int]$s.Seconds }

# One "watch" = same install + same title + same day.
$watched = @{}
$uniquePlays = New-Object System.Collections.ArrayList
foreach ($p in $plays) {
    $day = ([datetime]$p.ts).ToLocalTime().ToString('yyyy-MM-dd')
    $key = "{0}|{1}|{2}|{3}" -f $day, $p.installId, $p.mediaId, $p.title
    if ($watched.ContainsKey($key)) { continue }
    $watched[$key] = $true
    [void]$uniquePlays.Add($p)
}
$uniquePlays = @($uniquePlays)

$titles = $uniquePlays | Group-Object { "{0}|{1}" -f $_.mediaId, $_.title } | ForEach-Object {
    $first = $_.Group | Select-Object -First 1
    $titleSeconds = 0
    foreach ($s in $sessions) {
        if (($first.mediaId -and $s.MediaId -eq [string]$first.mediaId) -or ($s.Title -eq [string]$first.title)) {
            $titleSeconds += [int]$s.Seconds
        }
    }
    [pscustomobject]@{
        Title     = if ($first.title) { [string]$first.title } else { 'Untitled' }
        Watches   = $_.Group.Count
        Devices   = @($_.Group | ForEach-Object { $_.installId } | Select-Object -Unique).Count
        WatchTime = $titleSeconds
        LastSeen  = ($_.Group | ForEach-Object { [datetime]$_.ts } | Measure-Object -Maximum).Maximum
    }
} | Sort-Object Watches, LastSeen -Descending

$devices = $activity | Group-Object { $_.installId } | ForEach-Object {
    $first = $_.Group | Select-Object -First 1
    $withVersion = $_.Group | Where-Object { $_.appVersion } | Select-Object -First 1
    $withDevice = $_.Group | Where-Object { $_.device } | Select-Object -First 1
    $id = [string]$first.installId
    $deviceSeconds = 0
    foreach ($s in $sessions) { if ($s.InstallId -eq $id) { $deviceSeconds += [int]$s.Seconds } }
    [pscustomobject]@{
        Device    = SupportCode $id
        Model     = if ($withDevice) { [string]$withDevice.device } else { 'unknown' }
        Platform  = PlatformName([string]$first.platform)
        Version   = if ($withVersion) { [string]$withVersion.appVersion } else { 'unknown' }
        Launches  = @($_.Group | Where-Object { $_.type -eq 'app_open' }).Count
        Watches   = @($_.Group | Where-Object { $_.type -eq 'play' }).Count
        WatchTime = $deviceSeconds
        LastSeen  = ($_.Group | ForEach-Object { [datetime]$_.ts } | Measure-Object -Maximum).Maximum
    }
} | Sort-Object Watches, LastSeen -Descending

$totalWatches = $uniquePlays.Count
$totalTitles = @($titles).Count
$totalDevices = @($devices).Count
$generated = (Get-Date).ToString('yyyy-MM-dd HH:mm')

# ---------- html rows ----------
$titleRows = foreach ($t in ($titles | Select-Object -First 25)) {
    @"
    <tr>
      <td>$(Html($t.Title))</td>
      <td class="num">$($t.Watches)</td>
      <td class="num">$($t.Devices)</td>
      <td class="num">$(Format-Duration $t.WatchTime)</td>
      <td class="dim">$($t.LastSeen.ToLocalTime().ToString('yyyy-MM-dd HH:mm'))</td>
    </tr>
"@
}
$deviceRows = foreach ($d in $devices) {
    @"
    <tr>
      <td class="mono">$(Html($d.Device))</td>
      <td>$(Html($d.Model))</td>
      <td>$(Html($d.Platform))</td>
      <td class="mono">$(Html($d.Version))</td>
      <td class="num">$($d.Launches)</td>
      <td class="num">$($d.Watches)</td>
      <td class="num">$(Format-Duration $d.WatchTime)</td>
      <td class="dim">$($d.LastSeen.ToLocalTime().ToString('yyyy-MM-dd HH:mm'))</td>
    </tr>
"@
}
$recentRows = foreach ($s in ($sessions | Sort-Object LastSeen -Descending | Select-Object -First 40)) {
    $when = $s.LastSeen.ToLocalTime().ToString('MM-dd HH:mm')
    $ep = if ($s.Se -and $s.Ep) { " S$($s.Se)E$($s.Ep)" } else { '' }
    $pct = if ($s.Percent -gt 0) { " / $($s.Percent)%" } else { '' }
    @"
    <div class="event">
      <span class="ev-time">$when</span>
      <span class="ev-what">$(Html([string]$s.Title))$(Html($ep))</span>
      <span class="ev-where">$(Html($s.Device))</span>
      <span class="ev-detail">$(Format-Duration $s.Seconds)$pct</span>
      <span class="ev-support mono">$(SupportCode $s.InstallId)</span>
    </div>
"@
}

$html = @"
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MovieFlix - what was watched $generated</title>
<style>
  body { margin:0; padding:32px; background:#0b0e14; color:#e7ebf3; font-family:'Segoe UI',system-ui,sans-serif; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:#94a3b8; font-size:13px; margin-bottom:20px; }
  .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
  .stat { background:#151a24; border:1px solid #232a38; border-radius:12px; padding:12px 16px; min-width:130px; }
  .stat b { display:block; font-size:22px; }
  .stat span { color:#94a3b8; font-size:12px; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.08em; color:#94a3b8; margin:26px 0 10px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#94a3b8; font-weight:600; font-size:12px; padding:8px 10px; border-bottom:1px solid #232a38; }
  td { padding:8px 10px; border-bottom:1px solid #1b2230; }
  td.num { text-align:right; width:100px; }
  td.dim { color:#94a3b8; }
  td.mono, .mono { font-family:Consolas,monospace; font-size:12px; }
  .event { display:flex; gap:12px; font-size:13px; padding:6px 0; border-bottom:1px solid #1b2230; align-items:center; }
  .ev-time { color:#94a3b8; width:80px; font-family:Consolas,monospace; }
  .ev-what { flex:1; }
  .ev-where { width:180px; color:#94a3b8; }
  .ev-detail { width:130px; color:#f6c453; font-weight:600; }
  .ev-support { width:100px; color:#64748b; }
  .footer { color:#475569; font-size:12px; margin-top:26px; line-height:1.7; }
  code { background:#101521; padding:1px 5px; border-radius:4px; font-size:11px; }
  .empty { color:#94a3b8; font-size:13px; padding:16px; background:#151a24; border:1px solid #232a38; border-radius:12px; }
</style>
</head>
<body>
  <h1>MovieFlix - what was watched</h1>
  <div class="sub">Anonymous device ids only (last 6 chars). Generated $generated &middot; retention 30 days</div>
  <div class="stats">
    <div class="stat"><b>$totalWatches</b><span>watches</span></div>
    <div class="stat"><b>$totalTitles</b><span>different titles</span></div>
    <div class="stat"><b>$totalDevices</b><span>devices seen</span></div>
    <div class="stat"><b>$(Format-Duration $totalWatchSeconds)</b><span>total watch time</span></div>
    <div class="stat"><b>$($launches.Count)</b><span>app opens</span></div>
  </div>

  <h2>Top titles</h2>
  $(if ($titleRows) { "<table><tr><th>Title</th><th class='num'>Watched</th><th class='num'>Devices</th><th class='num'>Watch time</th><th>Last</th></tr>" + ($titleRows -join "`n") + "</table>" } else { '<div class="empty">Nothing watched yet.</div>' })

  <h2>Devices</h2>
  $(if ($deviceRows) { "<table><tr><th>Device</th><th>Model</th><th>Platform</th><th>Version</th><th class='num'>Opens</th><th class='num'>Plays</th><th class='num'>Watch time</th><th>Last seen</th></tr>" + ($deviceRows -join "`n") + "</table>" } else { '<div class="empty">No devices yet.</div>' })

  <h2>Recent plays</h2>
  $(if ($recentRows) { $recentRows -join "`n" } else { '<div class="empty">No plays recorded yet.</div>' })

  <div class="footer">
    Raw file: <code>server\logs\activity-*.jsonl</code> &middot; rebuild: <code>scripts\build-watch-report.ps1</code><br>
    Watch time counts only real playing time (paused/seeking excluded). A "watch" = same device + same title + same day.
    No names, no IPs; device model comes from the user-agent.
  </div>
</body>
</html>
"@

$html | Out-File -FilePath $outFile -Encoding UTF8
Write-Output "Report written: $outFile"
Write-Output ("Watches: {0}  titles: {1}  devices: {2}  watch time: {3}" -f $totalWatches, $totalTitles, $totalDevices, (Format-Duration $totalWatchSeconds))
if ($Open) { Start-Process $outFile }
