<?php
declare(strict_types=1);

/**
 * Read-only API для нативного приложения нарезки видео.
 *
 * Авторизация: Authorization: Bearer <token> (или X-Api-Token).
 * Токен — $videocut_api_token из db.inc.php; если он не задан, используется
 * $portal_org_password (совместимость с текущим деплоем).
 *
 * GET ?action=events
 * GET ?action=event&id=<event_id>
 * GET ?action=health
 *
 * Видео не проксируется здесь: в ответе есть mediaUrl на portal/media.php,
 * который умеет Range и кэшируется нативным приложением.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$cfg = dirname(__DIR__) . '/../db.inc.php';
if (!is_file($cfg)) {
    api_fail(500, 'Нет конфигурации БД');
}
require $cfg;

$expected = '';
if (isset($videocut_api_token) && is_string($videocut_api_token)) {
    $expected = trim($videocut_api_token);
}
if ($expected === '' && isset($portal_org_password) && is_string($portal_org_password)) {
    $expected = trim($portal_org_password);
}

$given = api_bearer_token();
if ($expected === '' || $given === '' || !hash_equals($expected, $given)) {
    header('WWW-Authenticate: Bearer realm="ub-timer-videocut"');
    api_fail(401, 'Неверный или отсутствующий токен');
}

$action = strtolower(trim((string)($_GET['action'] ?? 'events')));

if ($action === 'health') {
    api_ok([
        'service' => 'ub-timer-videocut',
        'time' => gmdate('c'),
    ]);
}

if (!function_exists('mysqli_connect')) {
    api_fail(503, 'На сервере нет расширения mysqli');
}
if (function_exists('mysqli_report')) {
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
}
try {
    $db = mysqli_connect($mysql_host, $mysql_user, $mysql_password, $mysql_database);
    $db->set_charset('utf8mb4');
} catch (Throwable $e) {
    api_fail(503, 'БД недоступна');
}

require_once dirname(__DIR__) . '/inc/org_videocut.php';

try {
    if ($action === 'events') {
        api_ok([
            'events' => org_vc_events($db),
        ]);
    }

    if ($action === 'event') {
        $eventId = (int)($_GET['id'] ?? $_GET['event'] ?? 0);
        $event = org_vc_load_event($db, $eventId);
        if (!$event) {
            api_fail(404, 'Мероприятие не найдено');
        }
        $duels = org_vc_duels($db, $eventId);
        $protocol = org_vc_protocol_times($db, $eventId);
        $videos = org_vc_videos($db, $eventId);
        $payload = org_vc_payload($event, $duels, $protocol, $videos);
        $payload['media'] = api_media_links($payload['dayVideo'] ?? null, $eventId);
        if (is_array($payload['dayVideo'] ?? null)) {
            unset($payload['dayVideo']['url']);
        }
        api_ok($payload);
    }

    api_fail(400, 'Неизвестное действие');
} catch (Throwable $e) {
    api_fail(500, 'Ошибка выборки данных');
}

function api_bearer_token(): string
{
    $auth = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if ($auth === '') {
        $headers = [];
        if (function_exists('getallheaders')) {
            $headers = getallheaders();
        } elseif (function_exists('apache_request_headers')) {
            $headers = apache_request_headers();
        }
        foreach ($headers as $name => $value) {
            if (strcasecmp((string)$name, 'Authorization') === 0) {
                $auth = (string)$value;
                break;
            }
        }
    }
    if (preg_match('/^\s*Bearer\s+(.+?)\s*$/i', $auth, $m)) {
        return $m[1];
    }
    $alt = trim((string)($_SERVER['HTTP_X_API_TOKEN'] ?? ''));
    return $alt;
}

function api_media_links(?array $dayVideo, int $eventId): array
{
    if (!$dayVideo || empty($dayVideo['id'])) {
        return ['available' => false, 'eventId' => $eventId];
    }
    $forwarded_proto = strtolower(trim(explode(',', (string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]));
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || $forwarded_proto === 'https';
    $scheme = $https ? 'https' : 'http';
    $host = (string)($_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? '');
    $base = rtrim(str_replace('\\', '/', dirname(dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/portal/api/videocut.php')))), '/');

    return [
        'available' => true,
        'eventId' => $eventId,
        'videoId' => (int)$dayVideo['id'],
        'title' => (string)($dayVideo['title'] ?? ''),
        'mediaUrl' => $scheme . '://' . $host . $base . '/media.php?id=' . (int)$dayVideo['id'],
        'downloadUrl' => $scheme . '://' . $host . $base . '/media.php?dl=1&id=' . (int)$dayVideo['id'],
    ];
}

function api_ok(array $data): never
{
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function api_fail(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
