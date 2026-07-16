param(
  [Parameter(Mandatory = $true)]
  [string]$Target
)

$ErrorActionPreference = "SilentlyContinue"
Start-Sleep -Seconds 2

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
  Remove-Item -LiteralPath $fullTarget -Recurse -Force
}

Remove-Item -LiteralPath $PSCommandPath -Force
