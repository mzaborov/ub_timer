<?php
declare(strict_types=1);

/** Страница просмотра видео: плеер через media.php + кнопка «Скачать». */

$cfg = __DIR__ . '/../db.inc.php';
if (!is_file($cfg)) {
    http_response_code(500);
    echo 'Нет конфигурации БД.';
    exit;
}
require $cfg;

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

function player_h(?string $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

try {
    $db = mysqli_connect($mysql_host, $mysql_user, $mysql_password, $mysql_database);
} catch (Throwable $e) {
    http_response_code(500);
    echo 'Нет соединения с БД.';
    exit;
}

$row = null;
$vid = (int)($_GET['id'] ?? 0);
$fid = trim((string)($_GET['f'] ?? ''));

if ($vid > 0) {
    $st = $db->prepare('SELECT id, title, url FROM videos WHERE id = ? LIMIT 1');
    $st->bind_param('i', $vid);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
} elseif ($fid !== '' && preg_match('/^[A-Za-z0-9_-]{10,}$/', $fid)) {
    $like = '%' . $fid . '%';
    $st = $db->prepare('SELECT id, title, url FROM videos WHERE url LIKE ? LIMIT 1');
    $st->bind_param('s', $like);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
}

if (!$row) {
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>Видео не найдено</title>'
        . '<p style="font:16px system-ui;padding:2rem">Видео не найдено.</p>';
    exit;
}

$videoId = (int)$row['id'];
$title = trim((string)($row['title'] ?? '')) ?: 'Видео';
$ext = strtolower(pathinfo($title, PATHINFO_EXTENSION));
if ($ext === '') {
    $url = (string)($row['url'] ?? '');
    $driveId = '';
    if (preg_match('#/file/d/([A-Za-z0-9_-]{10,})#', $url, $m)) {
        $driveId = $m[1];
    } elseif (preg_match('#[?&]id=([A-Za-z0-9_-]{10,})#', $url, $m)) {
        $driveId = $m[1];
    }
    if ($driveId !== '') {
        $ch = curl_init('https://drive.usercontent.google.com/download?id=' . rawurlencode($driveId) . '&export=download&confirm=t');
        curl_setopt_array($ch, [
            CURLOPT_NOBODY => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36',
            CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$ext): int {
                if (stripos($line, 'content-type:') === 0) {
                    $type = strtolower(trim(substr($line, 13)));
                    if (strpos($type, 'matroska') !== false) {
                        $ext = 'mkv';
                    } elseif (strpos($type, 'mp4') !== false) {
                        $ext = 'mp4';
                    } elseif (strpos($type, 'webm') !== false) {
                        $ext = 'webm';
                    }
                }
                return strlen($line);
            },
        ]);
        curl_exec($ch);
        curl_close($ch);
    }
}
$isMkv = $ext === 'mkv';
$playable = !$isMkv;

$media = 'media.php?id=' . $videoId;
$download = $media . '&dl=1';
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?php echo player_h($title); ?></title>
<style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background: #101418;
        color: #eef2f5;
        font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.65rem 1rem;
        background: #171d23;
        border-bottom: 1px solid #263038;
    }
    h1 { margin: 0; font-size: 0.95rem; font-weight: 700; flex: 1; min-width: 0;
         white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .btn {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.45rem 0.85rem;
        border: 0;
        border-radius: 0.5rem;
        background: #f07d28;
        color: #fff;
        font: inherit;
        font-weight: 700;
        text-decoration: none;
        cursor: pointer;
        white-space: nowrap;
    }
    .btn:hover { background: #d96a17; }
    main {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.75rem;
        min-height: 0;
    }
    video {
        max-width: 100%;
        max-height: calc(100vh - 8rem);
        background: #000;
        border-radius: 0.5rem;
    }
    .note { max-width: 32rem; text-align: center; color: #b9c5cf; }
    .note p { margin: 0 0 1rem; }
</style>
</head>
<body>
<header>
    <h1><?php echo player_h($title); ?></h1>
    <a class="btn" href="<?php echo player_h($download); ?>" download>Скачать</a>
</header>
<main>
<?php if ($playable) { ?>
    <video controls playsinline preload="metadata" src="<?php echo player_h($media); ?>"></video>
<?php } else { ?>
    <div class="note">
        <p>Браузер не воспроизводит этот формат (<?php echo player_h($ext !== '' ? $ext : 'файл'); ?>).</p>
        <p>Скачайте файл и откройте в VLC или другом плеере.</p>
    </div>
<?php } ?>
</main>
</body>
</html>
