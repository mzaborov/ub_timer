# Деплой на Masterhost: сравнение с сервером и загрузка только изменённых файлов.
# Запуск из корня репо: .\scripts\deploy.ps1
#         .\scripts\deploy.ps1 -TestConnection   — только проверить связь
#         .\scripts\deploy.ps1 -CompareOnly     — сравнить репу и прод
# Требует: secrets.env в корне репо (FTP_HOST, FTP_USER, FTP_PASSWORD, FTP_REMOTE_DIR)
# Опционально: DEPLOY_EXCLUDE_ROOTS, DEPLOY_EXCLUDE_FILES — см. secrets.env.example

param(
    [switch]$TestConnection,
    [switch]$CompareOnly
)

$ErrorActionPreference = "Stop"

# Работа всегда из корня репозитория (secrets.env и пути к файлам)
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

# Загрузка переменных из secrets.env
if (-not (Test-Path "secrets.env")) {
    Write-Host "Ошибка: файл secrets.env не найден в корне репо. Создайте его по образцу." -ForegroundColor Red
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

# Исключения из выкладки: из env или значения по умолчанию
$defaultExcludeRoots = '.git', 'secrets.env', 'scripts', '.gitignore', '.cursor', 'node_modules', 'History.log', '.vscode', 'git_hint.txt', 'Таблицы для онлайнов', 'docs', '_tmp_rating_sheets', 'portal'
$defaultExcludeFiles = 'secrets.env', 'secrets.env.example', '.gitignore', 'History.log', 'git_hint.txt', 'Макет часов.vsdx', 'Онлайн я-ИТ-ы №24.xlsx'
# Файлы с расширением .xlsx не выкладываем (данные/примеры расписаний; на сервере пользователи загружают свои)
$excludeRoot = if ($env:DEPLOY_EXCLUDE_ROOTS) { $env:DEPLOY_EXCLUDE_ROOTS -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' } } else { $defaultExcludeRoots }
$excludeFiles = if ($env:DEPLOY_EXCLUDE_FILES) { $env:DEPLOY_EXCLUDE_FILES -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' } } else { $defaultExcludeFiles }

$rootUri = "ftp://$hostFtp"
$remoteBase = $remoteDir.TrimEnd('/')

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

# Сгенерировать assets/Sound/intro/list.json по списку *.mp3 в папке intro (для жребия)
$introDir = Join-Path $root "assets/Sound/intro"
$listJsonPath = Join-Path $introDir "list.json"
if (Test-Path $introDir) {
    $mp3List = @(Get-ChildItem -Path $introDir -Filter "*.mp3" -File | Sort-Object Name | ForEach-Object { $_.Name })
    $jsonContent = ($mp3List | ConvertTo-Json -Compress)
    $jsonContent | Set-Content $listJsonPath -NoNewline -Encoding UTF8
    Write-Host "  list.json обновлён ($($mp3List.Count) треков)" -ForegroundColor Gray
}

$toUpload = @()
Get-ChildItem -Path $root -Recurse -File | ForEach-Object {
    $full = $_.FullName
    $rel = $full.Substring($root.Path.Length + 1).Replace('\', '/')
    $relParts = $rel -split '/'
    if ($relParts[0] -in $excludeRoot) { return }
    if ($relParts[0] -like '_tmp*') { return }
    if ($relParts -contains '.git' -or $relParts -contains 'node_modules' -or $relParts -contains '.cursor') { return }
    if ($rel -in $excludeFiles) { return }
    if ($rel -match '\.xlsx$') { return }
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
    if ($relParts[0] -like '_tmp*') { return }
    if ($relParts -contains '.git' -or $relParts -contains 'node_modules' -or $relParts -contains '.cursor') { return }
    if ($rel -in $excludeFiles) { return }
    if ($rel -match '\.xlsx$') { return }
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
    Write-Host "`nДля загрузки выполните: .\scripts\deploy.ps1" -ForegroundColor Gray
    exit 0
}

Write-Host "К загрузке: $($toUpload.Count) файл(ов)" -ForegroundColor $(if ($toUpload.Count -eq 0) { 'Green' } else { 'Yellow' })
if ($toUpload.Count -eq 0) {
    Write-Host "`nДеплой не требуется — всё совпадает." -ForegroundColor Green
    exit 0
}

# Перед загрузкой увеличиваем счётчик версии и подставляем во все файлы с кодом
$versionFile = Join-Path $root "version.txt"
$currentVer = 0
if (Test-Path $versionFile) {
    $currentVer = [int](Get-Content $versionFile -Raw).Trim()
}
$newVer = $currentVer + 1
Set-Content $versionFile -Value ([string]$newVer) -NoNewline -Encoding UTF8
Write-Host "Версия выкладки: $newVer" -ForegroundColor Cyan

$versionedFiles = @("index.html", "js/init.js", "css/timer.css", "situations-bank.html")
foreach ($rel in $versionedFiles) {
    $fp = Join-Path $root $rel
    if (-not (Test-Path $fp)) { continue }
    $content = Get-Content $fp -Raw -Encoding UTF8
    $changed = $false
    if ($content -match 'deploy-version:\s*\d+') {
        $content = $content -replace '(deploy-version:\s*)\d+', "`${1}$newVer"
        $changed = $true
    }
    if ($rel -eq "index.html" -or $rel -eq "situations-bank.html") {
        $content = $content -replace '\?v=\d+', "?v=$newVer"
        $changed = $true
    }
    if ($rel -eq "index.html") {
        $content = $content -replace '\?v=\d+', "?v=$newVer"
        $content = $content -replace '(Версия: )\d+', "`${1}$newVer"
        $content = $content -replace '(v )\d+(\s*</div>)', "`${1}$newVer`$2"
        if (Test-Path $listJsonPath) {
            $introJson = Get-Content $listJsonPath -Raw -Encoding UTF8
            if ($introJson) {
                $repl = "`${1}" + $introJson.Trim() + "`$2"
                $content = $content -replace '(?s)(<script type="application/json" id="intro-tracks-json">).*?(</script>)', $repl
                $changed = $true
            }
        }
        $changed = $true
    }
    if ($changed) {
        $content | Set-Content $fp -NoNewline -Encoding UTF8
        Write-Host "  $rel -> $newVer" -ForegroundColor Gray
        $inUpload = $toUpload | Where-Object { $_.RelativePath -eq $rel }
        if (-not $inUpload) {
            $toUpload += [PSCustomObject]@{ LocalPath = $fp; RelativePath = $rel; Size = (Get-Item $fp).Length }
        }
    }
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
