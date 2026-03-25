# Removes the old nested copy under "תיקיה חדשה\ai--main\..." after migration to repo root.
# Run this AFTER: close any editor tabs / terminals pointing inside that old folder, or restart Cursor.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/remove-legacy-nested-folder.ps1

$ErrorActionPreference = 'Stop'
Set-Location $env:USERPROFILE

$root = $PSScriptRoot | Split-Path -Parent
$candidates = Get-ChildItem -LiteralPath $root -Directory -Force |
  Where-Object { Test-Path (Join-Path $_.FullName 'ai--main') }

if (-not $candidates) {
  Write-Host 'No legacy nested folder found (already removed).'
  exit 0
}

foreach ($d in $candidates) {
  Write-Host "Removing: $($d.FullName)"
  Remove-Item -LiteralPath $d.FullName -Recurse -Force
}

Write-Host 'Done.'
