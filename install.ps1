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

function Stop-InstalledApp([string]$AppDir) {
  $needle = (Resolve-FullPath $AppDir).ToLowerInvariant()
  Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle)
    } |
    ForEach-Object {
      Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null
    }
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
  if (-not $folder) {
    throw "The downloaded archive did not contain package.json."
  }
  return @{ Path = $folder.FullName; Temp = $temp }
}

function Install-PortableNode([string]$RuntimeDir) {
  $nodeExe = Join-Path $RuntimeDir "node\node.exe"
  if (Test-Path -LiteralPath $nodeExe) {
    return (Split-Path -Parent $nodeExe)
  }

  Write-Step "Downloading a private Node.js 24 runtime (no administrator access required)"
  $architecture = if (
    $env:PROCESSOR_ARCHITEW6432 -eq "ARM64" -or
    $env:PROCESSOR_ARCHITECTURE -eq "ARM64"
  ) { "arm64" } else { "x64" }

  $manifestUrl = "https://nodejs.org/dist/$NodeChannel/SHASUMS256.txt"
  $manifest = (Invoke-WebRequest -UseBasicParsing -Uri $manifestUrl).Content
  $pattern = "(?m)^([a-f0-9]{64})\s+(node-v([0-9.]+)-win-$architecture\.zip)$"
  $match = [regex]::Match($manifest, $pattern)
  if (-not $match.Success) {
    throw "Could not resolve the current Node.js 24 Windows $architecture archive."
  }

  $expectedHash = $match.Groups[1].Value.ToUpperInvariant()
  $fileName = $match.Groups[2].Value
  $downloadUrl = "https://nodejs.org/dist/$NodeChannel/$fileName"
  $tempZip = Join-Path ([IO.Path]::GetTempPath()) $fileName
  Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $tempZip

  $actualHash = (Get-FileHash -LiteralPath $tempZip -Algorithm SHA256).Hash
  if ($actualHash -ne $expectedHash) {
    Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue
    throw "Node.js archive checksum verification failed."
  }

  New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
  $extractDir = Join-Path $RuntimeDir ("extract-" + [Guid]::NewGuid().ToString("N"))
  Expand-Archive -LiteralPath $tempZip -DestinationPath $extractDir -Force
  $expanded = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1
  if (-not $expanded) {
    throw "Node.js archive extraction failed."
  }

  $finalNodeDir = Join-Path $RuntimeDir "node"
  Move-Item -LiteralPath $expanded.FullName -Destination $finalNodeDir
  Remove-Item -LiteralPath $extractDir -Recurse -Force
  Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue
  return $finalNodeDir
}

$installRoot = Resolve-FullPath $InstallDir
$localPrograms = Resolve-FullPath (Join-Path $env:LOCALAPPDATA "Programs")
if (
  $installRoot -eq [IO.Path]::GetPathRoot($installRoot) -or
  $installRoot.Length -lt ($localPrograms.Length + 3)
) {
  throw "Unsafe installation target: $installRoot"
}

$appDir = Join-Path $installRoot "app"
$runtimeDir = Join-Path $installRoot "runtime"
$source = Get-SourceDirectory

try {
  Write-Step "Installing Codex Quota Weather to $installRoot"
  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  Stop-InstalledApp $appDir

  $sourcePath = Resolve-FullPath $source.Path
  $sameDirectory = $sourcePath.TrimEnd("\") -ieq (Resolve-FullPath $appDir).TrimEnd("\")
  if (-not $sameDirectory) {
    if (Test-Path -LiteralPath $appDir) {
      Remove-Item -LiteralPath $appDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $appDir -Force | Out-Null
    Get-ChildItem -LiteralPath $sourcePath -Force |
      Where-Object { $_.Name -notin @(".git", "node_modules", "config.json", ".tmp") } |
      ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $appDir -Recurse -Force
      }
  }

  $nodeDir = Install-PortableNode $runtimeDir
  $npmCmd = Join-Path $nodeDir "npm.cmd"
  if (-not (Test-Path -LiteralPath $npmCmd)) {
    throw "npm.cmd is missing from the private Node.js runtime."
  }

  Write-Step "Installing the Electron runtime and verifying dependencies"
  Push-Location $appDir
  try {
    $env:npm_config_registry = "https://registry.npmjs.org"
    $env:ELECTRON_GET_USE_PROXY = "1"
    & $npmCmd ci --include=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      throw "npm ci failed with exit code $LASTEXITCODE."
    }
    & (Join-Path $nodeDir "node.exe") "scripts\smoke-test.js"
    if ($LASTEXITCODE -ne 0) {
      throw "The installed application failed its smoke test."
    }
  } finally {
    Pop-Location
  }

  $userConfigDir = Join-Path $env:APPDATA "CodexQuotaWeather"
  $userConfig = Join-Path $userConfigDir "config.json"
  $legacyConfig = Join-Path $sourcePath "config.json"
  if (-not (Test-Path -LiteralPath $userConfig) -and (Test-Path -LiteralPath $legacyConfig)) {
    Write-Step "Migrating settings from the legacy installation"
    New-Item -ItemType Directory -Path $userConfigDir -Force | Out-Null
    Copy-Item -LiteralPath $legacyConfig -Destination $userConfig -Force
  }

  $startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
  $shortcutPath = Join-Path $startupDir "Codex Quota Weather.lnk"
  $legacyShortcut = Join-Path $startupDir "Quota-Weather.lnk"
  Remove-Item -LiteralPath $legacyShortcut -Force -ErrorAction SilentlyContinue

  if (-not $NoStartup) {
    Write-Step "Enabling startup with Windows"
    New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = (Join-Path $env:WINDIR "System32\wscript.exe")
    $shortcut.Arguments = '"' + (Join-Path $appDir "start-hidden.vbs") + '"'
    $shortcut.WorkingDirectory = $appDir
    $shortcut.IconLocation = (Join-Path $appDir "node_modules\electron\dist\electron.exe") + ",0"
    $shortcut.Description = "Codex Quota Weather"
    $shortcut.Save()
  } else {
    Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
  }

  if (-not $NoLaunch) {
    Write-Step "Starting Codex Quota Weather"
    Start-Process -FilePath (Join-Path $env:WINDIR "System32\wscript.exe") `
      -ArgumentList ('"' + (Join-Path $appDir "start-hidden.vbs") + '"') `
      -WorkingDirectory $appDir -WindowStyle Hidden
  }

  Write-Host ""
  Write-Host "Codex Quota Weather is installed and verified." -ForegroundColor Green
  Write-Host "Install path: $appDir"
  Write-Host "User settings: $(Join-Path $env:APPDATA 'CodexQuotaWeather\config.json')"
} finally {
  if ($source.Temp -and (Test-Path -LiteralPath $source.Temp)) {
    Remove-Item -LiteralPath $source.Temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
