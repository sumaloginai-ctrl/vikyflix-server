# Android emulator APK test loop — launch, install, start, logcat, stop.
#
# Uses the existing AVD + built debug APKs. Safe: installs a DEBUG build only
# (never touches release/signing), never modifies project files.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\android-emulator.ps1 -Action test
#   ... -Action test -Flavor tv          # Android TV debug APK
#   ... -Action start                    # just boot the emulator
#   ... -Action install -Apk <path>      # install a specific APK (e.g. release candidate)
#   ... -Action logcat -LogcatSeconds 20
#   ... -Action stop
#
# Physical phone instead of emulator: plug it in, enable USB debugging, accept
# the prompt, then run with -Action install (adb targets the device).
param(
    [ValidateSet('test', 'start', 'stop', 'install', 'launch', 'logcat', 'status')]
    [string]$Action = 'test',
    [string]$Avd = 'vixa_qa',
    [ValidateSet('mobile', 'tv')]
    [string]$Flavor = 'mobile',
    [string]$Apk,
    [int]$LogcatSeconds = 8,
    [switch]$ShowWindow
)

$ErrorActionPreference = 'Stop'

function Find-Sdk {
    if ($env:ANDROID_SDK_ROOT -and (Test-Path $env:ANDROID_SDK_ROOT)) { return $env:ANDROID_SDK_ROOT }
    if ($env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) { return $env:ANDROID_HOME }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
        'C:\Android\Sdk',
        'C:\Users\Public\Android\Sdk'
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    throw 'Android SDK not found. Set ANDROID_HOME or install the SDK.'
}

$sdk = Find-Sdk
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$emulator = Join-Path $sdk 'emulator\emulator.exe'
if (-not (Test-Path $adb)) { throw "adb not found at $adb" }

# Hardware acceleration (WHPX / AEHD / HAXM) is optional for a smoke test.
# When no hypervisor driver is installed the emulator refuses to start unless
# it is told to fall back to software emulation — which is slow, so the boot
# timeout has to be much longer.
$accelArgs = @()
$bootTimeout = 240
try {
    $accel = (& $emulator -accel-check 2>&1 | Out-String)
    if ($accel -match 'not installed|requires hardware acceleration|HAXM is not installed') {
        $accelArgs = @('-accel', 'off')
        $bootTimeout = 600
    }
} catch {
    $accelArgs = @('-accel', 'off')
    $bootTimeout = 600
}

# The emulator must write under %USERPROFILE%\.android; the DSH sandbox denies
# that (error 5), so fail early with a clear message instead of hanging.
if ($Action -in @('start', 'test')) {
    $probe = Join-Path $env:USERPROFILE '.android\.emu-write-probe'
    try {
        New-Item -ItemType File -Path $probe -Force -ErrorAction Stop | Out-Null
        Remove-Item $probe -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Warning "Cannot write to $env:USERPROFILE\.android - the Android emulator needs it. You are probably running inside the DSH sandbox; run this script from a normal PowerShell window."
        exit 2
    }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$flavorDir = if ($Flavor -eq 'tv') { 'tv' } else { 'mobile' }
$defaultApk = Join-Path $projectRoot "web\android\app\build\outputs\apk\$flavorDir\debug\app-$flavorDir-debug.apk"
$packageName = if ($Flavor -eq 'tv') { 'uk.vikyflix.tv' } else { 'uk.vikyflix.app' }

function Invoke-Adb {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & $adb @Args
}

function Get-DeviceState {
    $lines = & $adb devices 2>$null | Select-Object -Skip 1 | Where-Object { $_ -match '\S' }
    if (-not $lines) { return 'no-device' }
    if ($lines -match 'emulator-\d+\s+device') { return 'emulator' }
    if ($lines -match '\s+device$') { return 'device' }
    return 'unavailable'
}

function Wait-AdbBoot {
    param([int]$TimeoutSeconds = 240)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $state = Get-DeviceState
            if ($state -eq 'emulator' -or $state -eq 'device') {
                $boot = (& $adb shell getprop sys.boot_completed 2>&1 | Out-String)
                if ($boot -match '1') { return $true }
            }
        } catch { /* device still coming up */ }
        Start-Sleep -Seconds 3
    }
    return $false
}

function Start-Emulator {
    $state = Get-DeviceState
    if ($state -eq 'emulator') { Write-Output "Emulator already running ($state)."; return }
    $avds = & $emulator -list-avds 2>$null
    if ($avds -notcontains $Avd) { throw "AVD '$Avd' not found. Available: $($avds -join ', ')" }
    $windowArg = if ($ShowWindow) { '-no-snapshot' } else { '-no-window' }
    $emuArgs = @('-avd', $Avd, $windowArg, '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect') + $accelArgs
    if (-not $ShowWindow) { $emuArgs += '-no-snapshot' }
    Write-Output "Starting emulator '$Avd' (headless: $(-not $ShowWindow), accel: $(if ($accelArgs) { 'off (software — slow)' } else { 'hardware' }))..."
    Start-Process -FilePath $emulator -ArgumentList $emuArgs | Out-Null
    if (-not (Wait-AdbBoot -TimeoutSeconds $bootTimeout)) { throw "Emulator did not finish booting within ${bootTimeout}s." }
    Write-Output 'Emulator booted.'
}

function Install-Apk {
    $path = if ($Apk) { $Apk } else { $defaultApk }
    if (-not (Test-Path $path)) {
        throw "APK not found: $path`nBuild it first: cd web; npm run build; npx cap sync android; cd android; .\gradlew.bat :app:assemble${($Flavor.Substring(0,1)).ToUpper()}$($Flavor.Substring(1))Debug"
    }
    Write-Output "Installing $path ..."
    & $adb install -r $path
    if ($LASTEXITCODE -ne 0) { throw "adb install failed (exit $LASTEXITCODE)." }
    Write-Output "Installed $packageName."
}

function Launch-App {
    Write-Output "Launching $packageName ..."
    & $adb shell monkey -p $packageName -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
    Write-Output 'App launched.'
}

function Write-Logcat {
    Start-Sleep -Seconds 3
    Write-Output "--- logcat snapshot (last $LogcatSeconds s worth, filtered) ---"
    & $adb logcat -d -t 300 2>$null |
        Select-String -Pattern 'Capacitor|HLS|Stremio|FATAL|AndroidRuntime|Exception|vitel|chromium' |
        Select-Object -Last 40
}

switch ($Action) {
    'status' {
        Write-Output "SDK: $sdk"
        Write-Output "Devices:"
        & $adb devices
        Write-Output ("Default APK: " + $(if (Test-Path $defaultApk) { $defaultApk } else { '(not built)' }))
    }
    'start' { Start-Emulator }
    'install' { Install-Apk }
    'launch' { Launch-App }
    'logcat' { Write-Logcat }
    'stop' {
        & $adb emu kill 2>$null | Out-Null
        Start-Sleep -Seconds 2
        Write-Output 'Emulator stopped.'
    }
    'test' {
        Start-Emulator
        Install-Apk
        Launch-App
        Write-Logcat
        Write-Output 'APK test loop complete. Add -ShowWindow to watch it live.'
    }
}
