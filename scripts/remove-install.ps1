param(
  [Parameter(Mandatory = $true)]
  [string]$Target
)

$ErrorActionPreference = "SilentlyContinue"
Start-Sleep -Milliseconds 600

$fullTarget = [IO.Path]::GetFullPath(
  [Environment]::ExpandEnvironmentVariables($Target)
)
$allowedRoot = [IO.Path]::GetFullPath(
  (Join-Path $env:LOCALAPPDATA "Programs")
)

if (
  $fullTarget.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -and
  $fullTarget -ne $allowedRoot
) {
  for ($attempt = 0; $attempt -lt 30 -and (Test-Path -LiteralPath $fullTarget); $attempt += 1) {
    Remove-Item -LiteralPath $fullTarget -Recurse -Force
    if (Test-Path -LiteralPath $fullTarget) { Start-Sleep -Milliseconds 500 }
  }
}

if (-not (Test-Path -LiteralPath $fullTarget)) {
  Remove-Item -LiteralPath $PSCommandPath -Force
}
