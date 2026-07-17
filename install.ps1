[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\CodexQuotaWeather"),
  [string]$SourceDir = "",
  [switch]$NoStartup,
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol =
  [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$RepoOwner = "fantarunning"
$RepoName = "codex-quota-weather"
$ArchiveUrl = "https://github.com/$RepoOwner/$RepoName/archive/refs/heads/main.zip"
$NodeChannel = "latest-v24.x"

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-FullPath([string]$Value) {
  return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Value))
}

function Write-JsonFile([string]$Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($Path, $json + "`n", (New-Object Text.UTF8Encoding($false)))
}

function Stop-InstalledApp([string]$RootDir) {
  $needle = (Resolve-FullPath $RootDir).ToLowerInvariant()
  Get-CimInstance Win32_Process -Filter "Name = 'electron.exe' OR Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) } |
    ForEach-Object {
      Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null
    }
}

function Wait-ForLocalPanel([int]$Port, [int]$TimeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $health = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
      if ($health.ok) { return $health }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Get-SourceDirectory {
  if ($SourceDir) {
    $resolved = Resolve-FullPath $SourceDir
    if (-not (Test-Path -LiteralPath (Join-Path $resolved "package.json"))) {
      throw "SourceDir does not contain package.json: $resolved"
    }
    return @{ Path = $resolved; Temp = $null }
  }

  if ($PSScriptRoot -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot "package.json"))) {
    return @{ Path = (Resolve-FullPath $PSScriptRoot); Temp = $null }
  }

  Write-Step "Downloading the latest source from GitHub"
  $temp = Join-Path ([IO.Path]::GetTempPath()) ("codex-quota-weather-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $temp -Force | Out-Null
  $zip = Join-Path $temp "source.zip"
  Invoke-WebRequest -UseBasicParsing -Uri $ArchiveUrl -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force
  $folder = Get-ChildItem -LiteralPath $temp -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "package.json") } |
    Select-Object -First 1
  if (-not $folder) { throw "The downloaded archive did not contain package.json." }
  return @{ Path = $folder.FullName; Temp = $temp }
}

function Install-PortableNode([string]$RuntimeDir) {
  $nodeExe = Join-Path $RuntimeDir "node\node.exe"
  if (Test-Path -LiteralPath $nodeExe) { return (Split-Path -Parent $nodeExe) }

  Write-Step "Downloading a private Node.js 24 runtime (no administrator access required)"
  $architecture = if (
    $env:PROCESSOR_ARCHITEW6432 -eq "ARM64" -or
    $env:PROCESSOR_ARCHITECTURE -eq "ARM64"
  ) { "arm64" } else { "x64" }
  $manifestUrl = "https://nodejs.org/dist/$NodeChannel/SHASUMS256.txt"
  $manifest = (Invoke-WebRequest -UseBasicParsing -Uri $manifestUrl).Content
  $pattern = "(?m)^([a-f0-9]{64})\s+(node-v([0-9.]+)-win-$architecture\.zip)$"
  $match = [regex]::Match($manifest, $pattern)
  if (-not $match.Success) { throw "Could not resolve the current Node.js 24 Windows $architecture archive." }

  $expectedHash = $match.Groups[1].Value.ToUpperInvariant()
  $fileName = $match.Groups[2].Value
  $tempZip = Join-Path ([IO.Path]::GetTempPath()) $fileName
  Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$NodeChannel/$fileName" -OutFile $tempZip
  $actualHash = (Get-FileHash -LiteralPath $tempZip -Algorithm SHA256).Hash
  if ($actualHash -ne $expectedHash) {
    Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue
    throw "Node.js archive checksum verification failed."
  }

  New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
  $extractDir = Join-Path $RuntimeDir ("extract-" + [Guid]::NewGuid().ToString("N"))
  Expand-Archive -LiteralPath $tempZip -DestinationPath $extractDir -Force
  $expanded = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1
  if (-not $expanded) { throw "Node.js archive extraction failed." }
  $finalNodeDir = Join-Path $RuntimeDir "node"
  Move-Item -LiteralPath $expanded.FullName -Destination $finalNodeDir
  Remove-Item -LiteralPath $extractDir -Recurse -Force
  Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue
  return $finalNodeDir
}

function Copy-AppSource([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force |
    Where-Object { $_.Name -notin @(".git", "node_modules", "config.json", ".tmp", "release") } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force }
}

$installRoot = Resolve-FullPath $InstallDir
$localPrograms = Resolve-FullPath (Join-Path $env:LOCALAPPDATA "Programs")
if ($installRoot -eq [IO.Path]::GetPathRoot($installRoot) -or $installRoot.Length -lt ($localPrograms.Length + 3)) {
  throw "Unsafe installation target: $installRoot"
}

$runtimeDir = Join-Path $installRoot "runtime"
$versionsDir = Join-Path $installRoot "versions"
$launcherDir = Join-Path $installRoot "launcher"
$stateDir = Join-Path $installRoot "state"
$stateFile = Join-Path $stateDir "update-state.json"
$legacyAppDir = Join-Path $installRoot "app"
$source = Get-SourceDirectory
$tempVersionDir = $null

try {
  $sourcePath = Resolve-FullPath $source.Path
  $sourcePackage = Get-Content -LiteralPath (Join-Path $sourcePath "package.json") -Raw | ConvertFrom-Json
  $version = [string]$sourcePackage.version
  if ($version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') { throw "Invalid package version: $version" }
  $versionDir = Join-Path $versionsDir $version

  Write-Step "Installing Codex Quota Weather v$version to $installRoot"
  New-Item -ItemType Directory -Path $installRoot, $versionsDir, $launcherDir, $stateDir -Force | Out-Null
  Stop-InstalledApp $installRoot

  $oldCurrent = $null
  if (Test-Path -LiteralPath $stateFile) {
    try { $oldCurrent = [string](Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json).currentVersion } catch { }
  }

  # One-time migration from releases that overwrote a single app directory.
  if (Test-Path -LiteralPath $legacyAppDir) {
    $legacyPackagePath = Join-Path $legacyAppDir "package.json"
    $legacyVersion = "0.0.0-legacy"
    if (Test-Path -LiteralPath $legacyPackagePath) {
      try { $legacyVersion = [string](Get-Content -LiteralPath $legacyPackagePath -Raw | ConvertFrom-Json).version } catch { }
    }
    if ($legacyVersion -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') { $legacyVersion = "0.0.0-legacy" }
    $legacyTarget = Join-Path $versionsDir $legacyVersion
    if (-not (Test-Path -LiteralPath $legacyTarget)) {
      Write-Step "Preserving the previously installed v$legacyVersion for rollback"
      Move-Item -LiteralPath $legacyAppDir -Destination $legacyTarget
    } else {
      Remove-Item -LiteralPath $legacyAppDir -Recurse -Force
    }
    if (-not $oldCurrent) { $oldCurrent = $legacyVersion }
  }

  $nodeDir = Install-PortableNode $runtimeDir
  $nodeExe = Join-Path $nodeDir "node.exe"
  $npmCmd = Join-Path $nodeDir "npm.cmd"
  if (-not (Test-Path -LiteralPath $npmCmd)) { throw "npm.cmd is missing from the private Node.js runtime." }

  $sameDirectory = $sourcePath.TrimEnd("\") -ieq (Resolve-FullPath $versionDir).TrimEnd("\")
  if (-not $sameDirectory) {
    $tempVersionDir = Join-Path $versionsDir (".$version-" + [Guid]::NewGuid().ToString("N"))
    Copy-AppSource $sourcePath $tempVersionDir
    Write-Step "Installing Electron and verifying v$version"
    Push-Location $tempVersionDir
    try {
      $env:npm_config_registry = "https://registry.npmjs.org"
      $env:ELECTRON_GET_USE_PROXY = "1"
      & $npmCmd ci --include=dev --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
      & $nodeExe "scripts\smoke-test.js"
      if ($LASTEXITCODE -ne 0) { throw "The installed application failed its smoke test." }
    } finally { Pop-Location }
    if (Test-Path -LiteralPath $versionDir) { Remove-Item -LiteralPath $versionDir -Recurse -Force }
    Move-Item -LiteralPath $tempVersionDir -Destination $versionDir
    $tempVersionDir = $null
  } else {
    & $nodeExe (Join-Path $versionDir "scripts\smoke-test.js")
    if ($LASTEXITCODE -ne 0) { throw "The installed application failed its smoke test." }
  }

  Write-Step "Installing the stable launcher and version state"
  Get-ChildItem -LiteralPath (Join-Path $versionDir "launcher") -Force |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $launcherDir -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $versionDir "uninstall.ps1") -Destination (Join-Path $installRoot "uninstall.ps1") -Force
  Copy-Item -LiteralPath (Join-Path $versionDir "scripts\manage-codex-plugin.js") -Destination (Join-Path $installRoot "manage-codex-plugin.js") -Force
  New-Item -ItemType Directory -Path (Join-Path $installRoot "scripts") -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $versionDir "scripts\remove-install.ps1") -Destination (Join-Path $installRoot "scripts\remove-install.ps1") -Force

  $userConfigDir = Join-Path $env:APPDATA "CodexQuotaWeather"
  $userConfig = Join-Path $userConfigDir "config.json"
  $legacyConfig = Join-Path $sourcePath "config.json"
  if (-not (Test-Path -LiteralPath $userConfig) -and (Test-Path -LiteralPath $legacyConfig)) {
    Write-Step "Migrating settings from the legacy installation"
    New-Item -ItemType Directory -Path $userConfigDir -Force | Out-Null
    Copy-Item -LiteralPath $legacyConfig -Destination $userConfig -Force
  }

  $installed = @()
  Get-ChildItem -LiteralPath $versionsDir -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "package.json") } |
    ForEach-Object { $installed += [ordered]@{ version = $_.Name; installedAt = (Get-Date).ToUniversalTime().ToString("o") } }
  $previous = if ($oldCurrent -and $oldCurrent -ne $version) { $oldCurrent } else { $null }
  $state = [ordered]@{
    schemaVersion = 1
    currentVersion = $version
    previousVersion = $previous
    pendingVersion = $null
    healthyVersion = $version
    installedVersions = $installed
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  Write-JsonFile $stateFile $state

  Write-Step "Installing and enabling the Codex /quota plugin"
  & $nodeExe (Join-Path $installRoot "manage-codex-plugin.js") install (Join-Path $versionDir "codex-plugin\quota-weather")
  if ($LASTEXITCODE -ne 0) { throw "The Codex /quota plugin installation failed." }

  $startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
  $shortcutPath = Join-Path $startupDir "Codex Quota Weather.lnk"
  Remove-Item -LiteralPath (Join-Path $startupDir "Quota-Weather.lnk") -Force -ErrorAction SilentlyContinue
  if (-not $NoStartup) {
    Write-Step "Enabling startup with Windows"
    New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = (Join-Path $env:WINDIR "System32\wscript.exe")
    $shortcut.Arguments = '"' + (Join-Path $launcherDir "start-hidden.vbs") + '"'
    $shortcut.WorkingDirectory = $installRoot
    $shortcut.IconLocation = (Join-Path $versionDir "node_modules\electron\dist\electron.exe") + ",0"
    $shortcut.Description = "Codex Quota Weather"
    $shortcut.Save()
  } else {
    Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
  }

  if (-not $NoLaunch) {
    Write-Step "Starting Codex Quota Weather through the stable launcher"
    $wscript = Join-Path $env:WINDIR "System32\wscript.exe"
    $launcherVbs = Join-Path $launcherDir "start-hidden.vbs"
    Start-Process -FilePath $wscript `
      -ArgumentList ('"' + $launcherVbs + '"') `
      -WorkingDirectory $installRoot -WindowStyle Hidden

    $healthPort = 8787
    if (Test-Path -LiteralPath $userConfig) {
      try {
        $configuredPort = [int](Get-Content -LiteralPath $userConfig -Raw | ConvertFrom-Json).port
        if ($configuredPort -gt 0 -and $configuredPort -le 65535) { $healthPort = $configuredPort }
      } catch { }
    }
    Write-Step "Waiting for the local panel to become ready"
    $health = Wait-ForLocalPanel -Port $healthPort
    if (-not $health) {
      $launcherLog = Join-Path $installRoot "logs\launcher.log"
      throw "The panel did not start within 30 seconds. Launcher log: $launcherLog"
    }

    # A second launch reaches Electron's single-instance handler and explicitly
    # shows the already healthy panel, independent of process-name detection.
    Start-Process -FilePath $wscript `
      -ArgumentList ('"' + $launcherVbs + '"') `
      -WorkingDirectory $installRoot -WindowStyle Hidden
  }

  Write-Host ""
  Write-Host "Codex Quota Weather v$version is installed and verified." -ForegroundColor Green
  Write-Host "Install path: $installRoot"
  Write-Host "Active version: $versionDir"
  Write-Host "User settings: $userConfig"
  Write-Host "Codex command: /quota (restart Codex once after first install)"
} finally {
  if ($tempVersionDir -and (Test-Path -LiteralPath $tempVersionDir)) {
    Remove-Item -LiteralPath $tempVersionDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($source.Temp -and (Test-Path -LiteralPath $source.Temp)) {
    Remove-Item -LiteralPath $source.Temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
