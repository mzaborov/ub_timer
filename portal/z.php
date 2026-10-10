<?php
declare(strict_types=1);

require __DIR__ . '/inc/bootstrap.php';
require __DIR__ . '/inc/home_data.php';

$eventId = (int)($_GET['e'] ?? 0);
$url = '';
$event = $eventId > 0 ? portal_event_by_id($db, $eventId) : null;
if ($event && portal_zoom_join_open($event)) {
    $url = trim((string)($event['zoom_url'] ?? ''));
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
    <title>Ссылка неактивна</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="icon" href="assets/favicon.png">
    <link rel="stylesheet" href="css/portal.css?v=73">
</head>
<body class="page-register">
<main class="reg-wrap">
    <section class="card">
        <h1>Ссылка неактивна</h1>
        <p class="muted">Подключение открыто за час до начала встречи и час после её окончания.</p>
        <p class="reg-back"><a href="./">← на главную</a></p>
    </section>
</main>
</body>
</html>
