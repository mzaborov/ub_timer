# Деплой Google Apps Script (Python + Apps Script API)
# Требуется: pip install -r scripts/requirements-gas.txt, secrets.env, OAuth один раз

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

chcp 65001 >$null 2>&1
$env:PYTHONIOENCODING = "utf-8"

$pyArgs = @("scripts/deploy_gas.py")
if ($args -contains "--dry-run") {
    $pyArgs += "--dry-run"
}

python @pyArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
