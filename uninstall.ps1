[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\CodexQuotaWeather"),
  [switch]$KeepSettings
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$Value) {
  return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Value))
}

$installRoot = Resolve-FullPath $InstallDir
$localPrograms = Resolve-FullPath (Join-Path $env:LOCALAPPDATA "Programs")
if (
  -not $installRoot.StartsWith($localPrograms, [StringComparison]::OrdinalIgnoreCase) -or
  $installRoot -eq $localPrograms
) {
  throw "Refusing to remove an unsafe installation target: $installRoot"
}

$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
@("Codex Quota Weather.lnk", "Quota-Weather.lnk") | ForEach-Object {
  Remove-Item -LiteralPath (Join-Path $startupDir $_) -Force -ErrorAction SilentlyContinue
}

$needle = $installRoot.ToLowerInvariant()
Get-CimInstance Win32_Process -Filter "Name = 'electron.exe' OR Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) } |
  ForEach-Object {
    Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null
  }

if (-not $KeepSettings) {
  Remove-Item -LiteralPath (Join-Path $env:APPDATA "CodexQuotaWeather") `
    -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path -LiteralPath $installRoot) {
  $cleanupSource = Join-Path $PSScriptRoot "scripts\remove-install.ps1"
  $cleanupCopy = Join-Path ([IO.Path]::GetTempPath()) (
    "codex-quota-weather-cleanup-" + [Guid]::NewGuid().ToString("N") + ".ps1"
  )
  Copy-Item -LiteralPath $cleanupSource -Destination $cleanupCopy -Force
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "`"$cleanupCopy`"",
    "-Target",
    "`"$installRoot`""
  ) -WindowStyle Hidden
}

Write-Host "Codex Quota Weather has been uninstalled." -ForegroundColor Green
