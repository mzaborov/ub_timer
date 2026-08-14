# Деплой портала на Masterhost: ciocdo-org-skills.zaborov.ru/www
# Запуск из корня репо: .\scripts\deploy_portal.ps1

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

if (-not (Test-Path "secrets.env")) {
    Write-Host "Ошибка: нет secrets.env" -ForegroundColor Red
    exit 1
}
Get-Content "secrets.env" | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$' -and $_ -notmatch '^\s*#') {
        Set-Item -Path "Env:$($matches[1])" -Value $matches[2].Trim()
    }
}

$hostFtp = $env:FTP_HOST
$userFtp = $env:FTP_USER
$passFtp = $env:FTP_PASSWORD
$remoteDir = $env:FTP_PORTAL_REMOTE_DIR
if (-not $remoteDir) { $remoteDir = "ciocdo-org-skills.zaborov.ru/www" }

if (-not $hostFtp -or -not $userFtp -or -not $passFtp) {
    Write-Host "Ошибка: FTP_HOST / FTP_USER / FTP_PASSWORD в secrets.env" -ForegroundColor Red
    exit 1
}

$localRoot = Join-Path $repoRoot "portal"
if (-not (Test-Path $localRoot)) {
    Write-Host "Нет папки portal/" -ForegroundColor Red
    exit 1
}

$curlUser = "${userFtp}:${passFtp}"
# Локальные черновики: в репо оставляем, на прод не выкладываем.
$excludeFiles = @(
    "ring-preview.php",
    "js/ring-preview.js"
)
$files = Get-ChildItem -Path $localRoot -Recurse -File
Write-Host "=== Портал → $remoteDir ($($files.Count) файл(ов)) ===" -ForegroundColor Cyan
foreach ($f in $files) {
    $rel = $f.FullName.Substring($localRoot.Length + 1).Replace('\', '/')
    if ($excludeFiles -contains $rel) {
        Write-Host "  skip $rel (только локально)" -ForegroundColor DarkGray
        continue
    }
    $url = "ftp://$hostFtp/$remoteDir/$rel"
    Write-Host "  $rel" -ForegroundColor Gray
    & curl.exe -s -S --ftp-create-dirs -T $f.FullName -u $curlUser $url
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Ошибка: $rel" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

# Общий расчёт рейтинга и тултип лежат в корне репо (inc/), не в portal/.
$sharedInc = @(
    "inc/rating_calc.php",
    "inc/rating_tooltip.php"
)
foreach ($rel in $sharedInc) {
    $local = Join-Path $repoRoot $rel
    if (Test-Path $local) {
        $url = "ftp://$hostFtp/$remoteDir/$rel"
        Write-Host "  $rel (общий)" -ForegroundColor Gray
        & curl.exe -s -S --ftp-create-dirs -T $local -u $curlUser $url
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Ошибка: $rel" -ForegroundColor Red
            exit $LASTEXITCODE
        }
    }
}

# Черновик ring-preview не должен оставаться на проде (локальный файл не трогаем).
$removeFromProd = @(
    "ring-preview.php",
    "js/ring-preview.js"
)
foreach ($rel in $removeFromProd) {
    $dirPart = Split-Path $rel -Parent
    $name = Split-Path $rel -Leaf
    if (-not $dirPart -or $dirPart -eq ".") {
        $cwd = $remoteDir
    } else {
        $cwd = "$remoteDir/$($dirPart.Replace('\', '/'))"
    }
    Write-Host "  удаляю с прода $rel" -ForegroundColor Yellow
    # *DELE — до листинга и не валим деплой, если файла уже нет.
    & curl.exe -s -S -u $curlUser --quote "CWD $cwd" --quote "*DELE $name" "ftp://$hostFtp/"
}

Write-Host "Готово." -ForegroundColor Green
