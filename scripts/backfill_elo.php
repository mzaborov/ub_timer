<?php
declare(strict_types=1);

/**
 * Разовый бэкфилл Elo по истории поединков.
 * Запуск на сервере (PHP CLI):
 *   php scripts/backfill_elo.php
 * Требует db.inc.php в корне репозитория (как у портала).
 */

$cfg = dirname(__DIR__) . '/db.inc.php';
if (!is_file($cfg)) {
    fwrite(STDERR, "Нет db.inc.php в корне репозитория.\n");
    exit(1);
}
require $cfg;
require dirname(__DIR__) . '/portal/inc/elo.php';

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$db = mysqli_connect($mysql_host, $mysql_user, $mysql_password, $mysql_database);
$db->set_charset('utf8mb4');

$n = portal_elo_recompute($db);
echo "Elo пересчитан: {$n} участников.\n";
