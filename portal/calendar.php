<?php
declare(strict_types=1);

require __DIR__ . '/inc/bootstrap.php';
require __DIR__ . '/inc/home_data.php';

$event = portal_event_by_id($db, (int)($_GET['event'] ?? 0));
if (!$event || portal_event_is_template($event) || portal_event_start_iso($event) === '') {
    header('HTTP/1.1 404 Not Found');
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Мероприятие не найдено.';
    exit;
}

$ics = portal_build_ics($event);
$filename = portal_ics_filename($event);

header('Content-Type: text/calendar; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Cache-Control: no-store');
echo $ics;
