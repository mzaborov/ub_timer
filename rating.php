<?php
/**
 * Старый URL рейтинга. Гостю и боту — 410 Gone, без ФИО и баллов, без БД.
 * points.php в HTML не светим. Залогиненному (cookie ub_me) — 302 на points.php.
 */
error_reporting(E_ALL);
ini_set('display_errors', '0');
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');

$meId = 0;
if (!empty($_COOKIE['ub_me'])) {
    $meId = (int)$_COOKIE['ub_me'];
}
if ($meId > 0) {
    header('Location: points.php', true, 302);
    exit;
}

header('HTTP/1.1 410 Gone');
?>
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Страница перенесена</title>
    <style>
        body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;background:#fff;color:#333}
        main{padding:1.25rem .75rem;max-width:36rem}
    </style>
</head>
<body>
<main>
    <p>Страница перенесена.</p>
</main>
</body>
</html>
