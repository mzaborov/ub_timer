<?php
declare(strict_types=1);

/**
 * Публичный JSON банка ситуаций из MySQL (PHP 8.3, портал).
 * CORS: страница банка на timer.zaborov.ru.
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Accept');
header('Vary: Origin');
header('X-Robots-Tag: noindex, nofollow');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=120');

$cfg = dirname(__DIR__) . '/../db.inc.php';
if (!is_file($cfg)) {
    http_response_code(500);
    echo json_encode(['error' => 'Нет конфига БД'], JSON_UNESCAPED_UNICODE);
    exit;
}

require $cfg;

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

require_once __DIR__ . '/../inc/sit_plays.php';

function sit_api_fail(string $msg): void
{
    http_response_code(500);
    echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function sit_name_from_code(string $code): string
{
    if (preg_match('/^\d+[a-zA-Zа-яА-ЯёЁ]*\s*[-–—]\s*(.+)$/u', $code, $m)) {
        return trim($m[1]);
    }
    return $code;
}

try {
    $db = mysqli_connect($mysql_host, $mysql_user, $mysql_password, $mysql_database);
    $db->set_charset('utf8mb4');
} catch (Throwable $e) {
    sit_api_fail('БД недоступна');
}

try {
    $res = $db->query(
        'SELECT id, code, num, duel_type, description, roles_json
         FROM situations
         WHERE is_published = 1
         ORDER BY num IS NULL, num, code'
    );
    $rows = [];
    while ($row = $res->fetch_assoc()) {
        $code = trim((string)$row['code']);
        if ($code === '') {
            continue;
        }
        $rolesJson = null;
        $rawRoles = trim((string)($row['roles_json'] ?? ''));
        if ($rawRoles !== '') {
            $decoded = json_decode($rawRoles, true);
            if (is_array($decoded)) {
                $rolesJson = $decoded;
            }
        }
        $desc = (string)($row['description'] ?? '');
        $rows[] = [
            'id' => (int)$row['id'],
            'num' => $row['num'] !== null && $row['num'] !== '' ? (int)$row['num'] : 0,
            'code' => $code,
            'name' => sit_name_from_code($code),
            'type' => (string)$row['duel_type'],
            'descriptionHtml' => $desc,
            'rolesJson' => $rolesJson,
            'reviews' => [],
        ];
    }

    $videos = sit_video_maps($db);
    $reviewBySit = $videos['reviewBySit'];
    foreach ($rows as &$sitRow) {
        $items = sit_reviews_public($reviewBySit[(int)$sitRow['id']] ?? []);
        if ($items) {
            $sitRow['reviews'] = $items;
            $general = sit_review_url_general($items);
            if ($general !== '') {
                $sitRow['reviewUrl'] = $general;
            }
        }
    }
    unset($sitRow);

    $playsByCode = sit_plays_by_code($db, $videos);

    $payload = [
        'source' => 'mysql',
        'count' => count($rows),
        'rows' => $rows,
        'playsByCode' => $playsByCode,
    ];
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    sit_api_fail('Ошибка выборки');
}
