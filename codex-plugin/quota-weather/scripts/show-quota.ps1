$ErrorActionPreference = "Stop"

$installRoot = if ($env:CODEX_QUOTA_WEATHER_INSTALL_DIR) {
  [IO.Path]::GetFullPath($env:CODEX_QUOTA_WEATHER_INSTALL_DIR)
} else {
  Join-Path $env:LOCALAPPDATA "Programs\CodexQuotaWeather"
}
$launcher = Join-Path $installRoot "launcher\start-hidden.vbs"
$config = Join-Path $env:APPDATA "CodexQuotaWeather\config.json"

if (-not (Test-Path -LiteralPath $launcher)) {
  throw "Codex Quota Weather is not installed correctly. Rerun install.cmd. Missing: $launcher"
}

$port = 8787
if (Test-Path -LiteralPath $config) {
  try {
    $configured = [int](Get-Content -LiteralPath $config -Raw | ConvertFrom-Json).port
    if ($configured -gt 0 -and $configured -le 65535) { $port = $configured }
  } catch { }
}
$baseUrl = "http://127.0.0.1:$port"

function Test-LocalPanel {
  try {
    return [bool](Invoke-RestMethod -UseBasicParsing -Uri "$baseUrl/health" -TimeoutSec 2).ok
  } catch {
    return $false
  }
}

if (Test-LocalPanel) {
  Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$baseUrl/panel/toggle" -TimeoutSec 5 |
    ConvertTo-Json -Compress
  exit 0
}

$wscript = Join-Path $env:WINDIR "System32\wscript.exe"
Start-Process -FilePath $wscript -ArgumentList ('"' + $launcher + '"') -WorkingDirectory $installRoot -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 500
} until ((Test-LocalPanel) -or (Get-Date) -ge $deadline)

if (-not (Test-LocalPanel)) {
  throw "Codex Quota Weather did not start within 30 seconds. Launcher log: $installRoot\logs\launcher.log"
}

Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$baseUrl/panel/show" -TimeoutSec 5 |
  ConvertTo-Json -Compress
