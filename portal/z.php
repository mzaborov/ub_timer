<?php
declare(strict_types=1);

require __DIR__ . '/inc/bootstrap.php';

$eventId = (int)($_GET['e'] ?? 0);
$url = '';
if ($eventId > 0) {
    try {
        $st = $db->prepare('SELECT zoom_url FROM events WHERE id = ?');
        $st->bind_param('i', $eventId);
        $st->execute();
        $row = $st->get_result()->fetch_assoc();
        $st->close();
        $url = trim((string)($row['zoom_url'] ?? ''));
    } catch (Throwable $e) {
        $url = '';
    }
}

if ($url !== '' && preg_match('#^https?://#i', $url)) {
    header('Location: ' . $url, true, 302);
    exit;
}

header('HTTP/1.1 404 Not Found');
header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Ссылка недоступна</title>
    <link rel="icon" href="assets/favicon.png">
    <link rel="stylesheet" href="css/portal.css?v=73">
</head>
<body class="page-register">
<main class="reg-wrap">
    <section class="card">
        <h1>Ссылка недоступна</h1>
        <p class="muted">Для этой встречи нет комнаты подключения.</p>
        <p class="reg-back"><a href="./">← на главную</a></p>
    </section>
</main>
</body>
</html>
