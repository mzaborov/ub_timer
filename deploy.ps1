# Деплой на Masterhost: сравнение с сервером и загрузка только изменённых файлов.
# Запуск: .\deploy.ps1              — сравнение и загрузка изменённых
#         .\deploy.ps1 -TestConnection — только проверить связь
#         .\deploy.ps1 -CompareOnly   — сравнить репу и прод, вывести отчёт (ничего не заливать)
# Требует: secrets.env с FTP_HOST, FTP_USER, FTP_PASSWORD, FTP_REMOTE_DIR

param(
    [switch]$TestConnection,
    [switch]$CompareOnly
)

$ErrorActionPreference = "Stop"

# Загрузка переменных из secrets.env
if (-not (Test-Path "secrets.env")) {
    Write-Host "Ошибка: файл secrets.env не найден. Создайте его по образцу и укажите FTP-доступы." -ForegroundColor Red
    exit 1
}
Get-Content "secrets.env" | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$' -and $_ -notmatch '^\s*#') {
        $name = $matches[1]
        $val = $matches[2].Trim()
        Set-Item -Path "Env:$name" -Value $val
    }
}

$hostFtp = $env:FTP_HOST
$userFtp = $env:FTP_USER
$passFtp = $env:FTP_PASSWORD
$remoteDir = $env:FTP_REMOTE_DIR

if (-not $hostFtp -or -not $userFtp -or -not $passFtp) {
    Write-Host "Ошибка: в secrets.env задайте FTP_HOST, FTP_USER, FTP_PASSWORD." -ForegroundColor Red
    exit 1
}
if (-not $remoteDir) { $remoteDir = "timer.zaborov.ru/www" }

$rootUri = "ftp://$hostFtp"
$remoteBase = $remoteDir.TrimEnd('/')

# Элементы в корне, которые не выкладываем (остальное, включая assets/, css/, js/, fontawesome/, — заливаем)
$excludeRoot = @('.git', 'secrets.env', 'deploy.ps1', 'commit_session.ps1', '.gitignore', '.cursor', 'node_modules', 'History.log', '.vscode', 'git_hint.txt')

function Get-FtpListingRecursive {
    param([string]$baseUri, [PSCredential]$cred, [string]$path, [string]$prefix, [switch]$Silent)
    $result = @{}
    if (-not $Silent) { Write-Host "  список: $path" -ForegroundColor DarkGray }
    $request = [Net.FtpWebRequest]::Create("$baseUri/$path")
    $request.Credentials = $cred
    $request.Method = [Net.WebRequestMethods+Ftp]::ListDirectoryDetails
    $request.UseBinary = $true
    $request.UsePassive = $true
    $request.Timeout = 20000
    $request.ReadWriteTimeout = 20000
    try {
        $response = $request.GetResponse()
        $reader = New-Object IO.StreamReader($response.GetResponseStream())
        $lines = ($reader.ReadToEnd() -split "`r?`n") | Where-Object { $_.Trim() -ne "" }
        $reader.Close()
        $response.Close()
    } catch {
        Write-Warning "Не удалось получить список: $path — $_"
        return $result
    }
    foreach ($line in $lines) {
        $s = $line.Trim()
        if ($s -eq "") { continue }
        # Unix: -rw-r--r-- 1 user group size month day time name
        $parts = $s -split '\s+', 9
        if ($parts.Length -lt 9) { continue }
        $name = $parts[8]
        if ($name -eq '.' -or $name -eq '..') { continue }  # не заходить в . и ..
        $sizeStr = $parts[4]
        $isDir = $parts[0].StartsWith('d')
        if ($isDir) {
            $subPath = if ($path -eq "") { $name } else { "$path/$name" }
            $subPrefix = if ($prefix -eq "") { "$name/" } else { "$prefix$name/" }
            $sub = Get-FtpListingRecursive -baseUri $baseUri -cred $cred -path $subPath -prefix $subPrefix -Silent:$Silent
            foreach ($k in $sub.Keys) { $result[$k] = $sub[$k] }
        } else {
            $size = 0
            [long]::TryParse($sizeStr, [ref]$size) | Out-Null
            $key = if ($prefix -eq "") { $name } else { "$prefix$name" }
            $result[$key] = $size
        }
    }
    return $result
}

Write-Host "=== Получение списка файлов на сервере ($remoteBase) ===" -ForegroundColor Cyan
$cred = New-Object PSCredential($userFtp, (ConvertTo-SecureString $passFtp -AsPlainText -Force))
# Сначала один уровень (timer.zaborov.ru), затем заходим в www — так первый запрос не зависает
$remoteBaseParent = $remoteBase -replace '/www$', ''
$remoteFilesRaw = Get-FtpListingRecursive -baseUri $rootUri -cred $cred -path $remoteBaseParent -prefix ""
# Ключи пришли с префиксом "www/" — убираем для сравнения с локальными путями
$remoteFiles = @{}
$remoteFilesRaw.GetEnumerator() | ForEach-Object {
    $k = $_.Key -replace '^www/', '' -replace '\\', '/'
    if ($k -ne '') { $remoteFiles[$k] = $_.Value }
}
# Если сразу запрашивали timer.zaborov.ru/www, ключи уже без www/ — поправим
if ($remoteFiles.Count -eq 0 -and $remoteFilesRaw.Count -gt 0) {
    $remoteFiles = $remoteFilesRaw
} elseif ($remoteFiles.Count -eq 0) {
    $remoteFiles = Get-FtpListingRecursive -baseUri $rootUri -cred $cred -path $remoteBase -prefix ""
}

Write-Host "На сервере файлов: $($remoteFiles.Count)" -ForegroundColor Gray

if ($TestConnection) {
    if ($remoteFiles.Count -eq 0) {
        Write-Host "`nСвязи нет: не удалось прочитать список с сервера. Проверьте FTP_HOST и доступ в панели Masterhost." -ForegroundColor Red
        exit 1
    }
    Write-Host "`n=== Режим проверки: вывод списка с сервера (загрузка не выполняется) ===" -ForegroundColor Cyan
    $remoteFiles.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host "  $($_.Key)  ($($_.Value) байт)" }
    Write-Host "`nСвязь с FTP есть. Для деплоя запустите без -TestConnection." -ForegroundColor Green
    exit 0
}

# Нормализуем ключи под один стиль (слэш)
$remoteNormalized = @{}
foreach ($k in $remoteFiles.Keys) {
    $normal = $k -replace '\\', '/'
    $remoteNormalized[$normal] = $remoteFiles[$k]
}

Write-Host "`n=== Сравнение с локальными файлами ===" -ForegroundColor Cyan
$root = Get-Location
$toUpload = @()
Get-ChildItem -Path $root -Recurse -File | ForEach-Object {
    $full = $_.FullName
    $rel = $full.Substring($root.Path.Length + 1).Replace('\', '/')
    $relParts = $rel -split '/'
    if ($relParts[0] -in $excludeRoot) { return }
    if ($relParts -contains '.git' -or $relParts -contains 'node_modules' -or $relParts -contains '.cursor') { return }
    if ($rel -in @('secrets.env', 'deploy.ps1', 'commit_session.ps1', '.gitignore', 'History.log', 'git_hint.txt')) { return }
    $size = $_.Length
    $remoteSize = $remoteNormalized[$rel]
    if ($null -eq $remoteSize -or $remoteSize -ne $size) {
        $toUpload += [PSCustomObject]@{ LocalPath = $full; RelativePath = $rel; Size = $size }
    }
}

# Локальные пути (относительные) для сравнения
$localPaths = @{}
Get-ChildItem -Path $root -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($root.Path.Length + 1).Replace('\', '/')
    $relParts = $rel -split '/'
    if ($relParts[0] -in $excludeRoot) { return }
    if ($relParts -contains '.git' -or $relParts -contains 'node_modules' -or $relParts -contains '.cursor') { return }
    if ($rel -in @('secrets.env', 'deploy.ps1', 'commit_session.ps1', '.gitignore', 'History.log', 'git_hint.txt')) { return }
    $localPaths[$rel] = $_.Length
}

if ($CompareOnly) {
    $onlyServer = @($remoteNormalized.Keys | Where-Object { -not $localPaths.ContainsKey($_) } | Sort-Object)
    $onlyLocal  = @($toUpload | ForEach-Object { $_.RelativePath } | Sort-Object)
    $same       = @($localPaths.Keys | Where-Object { $remoteNormalized[$_] -eq $localPaths[$_] } | Sort-Object)
    Write-Host "`n=== Репозиторий vs прод ($remoteBase) ===" -ForegroundColor Cyan
    Write-Host "На проде: $($remoteNormalized.Count) файл(ов)  |  В репе: $($localPaths.Count) файл(ов)" -ForegroundColor Gray
    Write-Host "`nТолько на проде (нет в репе): $($onlyServer.Count)" -ForegroundColor Yellow
    if ($onlyServer.Count -gt 0) { $onlyServer | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }; if ($onlyServer.Count -gt 30) { Write-Host "  ... и ещё $($onlyServer.Count - 30)" } }
    Write-Host "`nТолько в репе / изменены (будут залиты при деплое): $($onlyLocal.Count)" -ForegroundColor Yellow
    if ($onlyLocal.Count -gt 0) { $onlyLocal | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }; if ($onlyLocal.Count -gt 30) { Write-Host "  ... и ещё $($onlyLocal.Count - 30)" } }
    Write-Host "`nСовпадают (размер тот же): $($same.Count)" -ForegroundColor Green
    Write-Host "`nДля загрузки изменённых выполните: .\deploy.ps1" -ForegroundColor Gray
    exit 0
}

Write-Host "К загрузке: $($toUpload.Count) файл(ов)" -ForegroundColor $(if ($toUpload.Count -eq 0) { 'Green' } else { 'Yellow' })
if ($toUpload.Count -eq 0) {
    Write-Host "`nДеплой не требуется — всё совпадает." -ForegroundColor Green
    exit 0
}

# Загрузка через curl (создаём каталоги при необходимости)
$ftpUrl = "ftp://$hostFtp/$remoteBase/"
$curlUser = "${userFtp}:${passFtp}"
foreach ($f in $toUpload) {
    $remotePath = "$remoteBase/$($f.RelativePath)"
    $url = "ftp://$hostFtp/$remotePath"
    Write-Host "  $($f.RelativePath)" -ForegroundColor Gray
    & curl.exe -s -S --ftp-create-dirs -T $f.LocalPath -u $curlUser $url
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Ошибка загрузки: $($f.RelativePath)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host "`n=== Готово: загружено $($toUpload.Count) файл(ов) ===" -ForegroundColor Green
