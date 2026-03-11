# Коммит изменений сессии (сообщение — обязательно).
# Запуск из корня репо: .\scripts\commit_session.ps1 "Описание изменений"
#         .\scripts\commit_session.ps1 -Message "Описание"

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Message
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

Write-Host "=== Проверка изменений ===" -ForegroundColor Cyan
git status --short

Write-Host "`n=== Добавление всех изменений ===" -ForegroundColor Cyan
git add -A

Write-Host "`n=== Коммит ===" -ForegroundColor Cyan
git commit -m $Message

Write-Host "`n=== Push в GitHub ===" -ForegroundColor Cyan
git push

Write-Host "`n=== Готово ===" -ForegroundColor Green
