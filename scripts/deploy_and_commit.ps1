# Единый скрипт: выкладка на прод + коммит и push (Git совпадает с продом).
# Запуск из корня репо: .\scripts\deploy_and_commit.ps1
#
# Порядок: 1) scripts\deploy.ps1 (обновляет версию в index.html, заливает по FTP)
#          2) при наличии изменений — коммит и push

$ErrorActionPreference = "Stop"

# Коммит и git — из корня репо
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

Write-Host "=== 1. Выкладка на прод ===" -ForegroundColor Cyan
& "$PSScriptRoot\deploy.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Деплой завершился с ошибкой. Коммит не выполняется." -ForegroundColor Red
    exit $LASTEXITCODE
}

$version = Get-Date -Format "yyyyMMdd"
Write-Host "`n=== 2. Проверка изменений в репозитории ===" -ForegroundColor Cyan
git status --short
$porcelain = git status --porcelain
if ([string]::IsNullOrWhiteSpace($porcelain)) {
    Write-Host "`nНет изменений для коммита (версия уже актуальна или ничего не менялось)." -ForegroundColor Gray
    exit 0
}

Write-Host "`n=== 3. Коммит и push ===" -ForegroundColor Cyan
git add -A
git commit -m "Выкладка на прод: версия $version"
git push

Write-Host "`n=== Готово: прод и Git синхронизированы ===" -ForegroundColor Green
