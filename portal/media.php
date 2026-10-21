<?php
declare(strict_types=1);

/**
 * Прокси к Google Drive: отдаёт видео из `videos` браузеру с поддержкой Range.
 * ?id=<videos.id>  или  ?f=<drive file id>; ?dl=1 — как файл на скачивание.
 * На хостинге ничего не хранится: байты идут из Drive в ответ.
 */

set_time_limit(0);

$cfg = __DIR__ . '/../db.inc.php';
if (!is_file($cfg)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Нет конфигурации БД.';
    exit;
}
require $cfg;

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function media_fail(int $code, string $text): void
{
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo $text;
    exit;
}

function media_drive_id(string $url): string
{
    if (preg_match('#/file/d/([A-Za-z0-9_-]{10,})#', $url, $m)) {
        return $m[1];
    }
    if (preg_match('#[?&]id=([A-Za-z0-9_-]{10,})#', $url, $m)) {
        return $m[1];
    }
    return '';
}

function media_clean_name(string $name): string
{
    $name = trim(preg_replace('/[\x00-\x1f\x7f]+/u', ' ', $name) ?? '');
    $name = str_replace(['"', '\\', '/', ':', '*', '?', '<', '>', '|'], '_', $name);
    return $name !== '' ? $name : 'video.mp4';
}

try {
    $db = mysqli_connect($mysql_host, $mysql_user, $mysql_password, $mysql_database);
} catch (Throwable $e) {
    media_fail(500, 'Нет соединения с БД.');
}

$row = null;
$vid = (int)($_GET['id'] ?? 0);
$fid = trim((string)($_GET['f'] ?? ''));

if ($vid > 0) {
    $st = $db->prepare('SELECT id, url, title FROM videos WHERE id = ? LIMIT 1');
    $st->bind_param('i', $vid);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
} elseif ($fid !== '' && preg_match('/^[A-Za-z0-9_-]{10,}$/', $fid)) {
    $like = '%' . $fid . '%';
    $st = $db->prepare('SELECT id, url, title FROM videos WHERE url LIKE ? LIMIT 1');
    $st->bind_param('s', $like);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
}

if (!$row) {
    media_fail(404, 'Видео не найдено.');
}

$fileId = media_drive_id((string)($row['url'] ?? ''));
if ($fileId === '') {
    media_fail(404, 'У этого видео нет файла на Drive.');
}

$title = media_clean_name((string)($row['title'] ?? 'video.mp4'));
$isDownload = isset($_GET['dl']) && (string)$_GET['dl'] !== '0';
$upstream = 'https://drive.usercontent.google.com/download?id=' . rawurlencode($fileId) . '&export=download&confirm=t';

/** HEAD: узнаём полный размер и тип. */
$total = null;
$ctype = 'application/octet-stream';
$ch = curl_init($upstream);
curl_setopt_array($ch, [
    CURLOPT_NOBODY => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$total, &$ctype): int {
        if (stripos($line, 'HTTP/') === 0) {
            $total = null;
            $ctype = 'application/octet-stream';
        } elseif (stripos($line, 'content-length:') === 0) {
            $total = (int)trim(substr($line, 15));
        } elseif (stripos($line, 'content-type:') === 0) {
            $ctype = trim(substr($line, 13));
        }
        return strlen($line);
    },
]);
curl_exec($ch);
$headCode = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($headCode >= 400 || $total === null || $total <= 0) {
    media_fail(502, 'Drive не отдал файл.');
}
if (stripos($ctype, 'text/html') !== false) {
    media_fail(502, 'Drive вернул страницу вместо файла.');
}

/** Разбираем Range клиента (bytes=start-end), поддержан одиночный диапазон. */
$start = 0;
$end = $total - 1;
$status = 200;
$rangeHeader = (string)($_SERVER['HTTP_RANGE'] ?? '');
if ($rangeHeader !== '' && preg_match('/bytes=(\d*)-(\d*)/', $rangeHeader, $m)) {
    if ($m[1] === '' && $m[2] !== '') {
        $len = (int)$m[2];
        $start = max(0, $total - $len);
    } else {
        $start = (int)$m[1];
        if ($m[2] !== '') {
            $end = min((int)$m[2], $total - 1);
        }
    }
    if ($start > $end || $start >= $total) {
        http_response_code(416);
        header('Content-Range: bytes */' . $total);
        exit;
    }
    $status = 206;
}

$need = $end - $start + 1;

http_response_code($status);
header('Content-Type: ' . $ctype);
header('Accept-Ranges: bytes');
header('Content-Length: ' . $need);
if ($status === 206) {
    header('Content-Range: bytes ' . $start . '-' . $end . '/' . $total);
}
header('Cache-Control: private, max-age=0, no-store');
header('X-Content-Type-Options: nosniff');
if ($isDownload) {
    header('Content-Disposition: attachment; filename="' . $title . '"');
} else {
    header('Content-Disposition: inline; filename="' . $title . '"');
}

while (ob_get_level() > 0) {
    ob_end_flush();
}

$sent = 0;
$ch = curl_init($upstream);
curl_setopt_array($ch, [
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_TIMEOUT => 0,
    CURLOPT_BUFFERSIZE => 65536,
    CURLOPT_HTTPHEADER => ['Accept-Encoding: identity'],
    CURLOPT_RANGE => $start . '-' . $end,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$sent, $need): int {
        $left = $need - $sent;
        if ($left <= 0) {
            return 0;
        }
        if (strlen($chunk) > $left) {
            $chunk = substr($chunk, 0, $left);
        }
        echo $chunk;
        $sent += strlen($chunk);
        flush();
        return strlen($chunk);
    },
]);
curl_exec($ch);
curl_close($ch);
exit;
