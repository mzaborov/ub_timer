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

const SIT_SKIP_EVENT_SLUGS = [
    'online_10_20',
    'online_10_21',
    'online_10_22',
    'online_10_23',
    'online_10_24',
];

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

function sit_is_http_url(string $url): bool
{
    return (bool)preg_match('#^https?://#i', $url);
}

function sit_fmt_date(?string $iso): string
{
    $iso = trim((string)$iso);
    if ($iso === '' || str_starts_with($iso, '0000')) {
        return '';
    }
    $parts = explode('-', $iso);
    if (count($parts) === 3 && strlen($parts[0]) === 4) {
        return $parts[2] . '.' . $parts[1] . '.' . $parts[0];
    }
    return $iso;
}

function sit_event_title(string $title, string $dateDisp): string
{
    $name = trim($title);
    if ($dateDisp !== '' && str_ends_with($name, $dateDisp)) {
        return trim(substr($name, 0, -strlen($dateDisp)));
    }
    return trim((string)preg_replace('/\s+\d{2}\.\d{2}\.\d{2,4}\s*$/u', '', $name));
}

function sit_surname(?string $fio): string
{
    $name = trim((string)$fio);
    if ($name === '') {
        return '';
    }
    $parts = preg_split('/\s+/u', $name);
    return ($parts !== false && isset($parts[0])) ? $parts[0] : $name;
}

function sit_side_label(?string $player, ?string $second, bool $paired): string
{
    $p = sit_surname($player);
    if ($paired) {
        $s = sit_surname($second);
        if ($p !== '' && $s !== '') {
            return $p . ', ' . $s;
        }
        return $p !== '' ? $p : $s;
    }
    return $p;
}

function sit_pick_url(array $urls): string
{
    foreach ($urls as $url) {
        $url = trim((string)$url);
        if (sit_is_http_url($url)) {
            return $url;
        }
    }
    return '';
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
        ];
    }

    $skip = [];
    foreach (SIT_SKIP_EVENT_SLUGS as $slug) {
        $skip[] = "'" . $db->real_escape_string($slug) . "'";
    }
    $skipSql = implode(',', $skip);

    $duelSql = "SELECT d.id, d.event_id, d.duel_date, d.duel_type, d.situation_id,
                       s.code AS sit_code,
                       e.title AS event_title, e.starts_on, e.slug,
                       p1.full_name AS p1_name, s1.full_name AS s1_name,
                       p2.full_name AS p2_name, s2.full_name AS s2_name
                FROM duels d
                INNER JOIN situations s ON s.id = d.situation_id
                INNER JOIN events e ON e.id = d.event_id
                LEFT JOIN people p1 ON p1.id = d.player1_id
                LEFT JOIN people s1 ON s1.id = d.second1_id
                LEFT JOIN people p2 ON p2.id = d.player2_id
                LEFT JOIN people s2 ON s2.id = d.second2_id
                WHERE d.situation_id IS NOT NULL
                  AND (e.slug IS NULL OR e.slug NOT IN ($skipSql))";
    $duelRes = $db->query($duelSql);

    $duels = [];
    $duelIds = [];
    while ($d = $duelRes->fetch_assoc()) {
        $did = (int)$d['id'];
        $duels[$did] = $d;
        $duelIds[] = $did;
    }

    $votes = [];
    if ($duelIds) {
        $in = implode(',', array_map('intval', $duelIds));
        $vRes = $db->query(
            "SELECT duel_id, vote FROM duel_judges
             WHERE duel_id IN ($in) AND vote IN ('1','2')"
        );
        while ($v = $vRes->fetch_assoc()) {
            $did = (int)$v['duel_id'];
            $votes[$did][] = (string)$v['vote'];
        }
    }

    $duelBout = [];
    $duelAny = [];
    $eventDay = [];
    $vidRes = $db->query('SELECT event_id, duel_id, url, video_type FROM videos ORDER BY id');
    while ($v = $vidRes->fetch_assoc()) {
        $url = trim((string)($v['url'] ?? ''));
        if (!sit_is_http_url($url)) {
            continue;
        }
        $did = isset($v['duel_id']) && $v['duel_id'] !== null && $v['duel_id'] !== ''
            ? (int)$v['duel_id'] : 0;
        $type = (string)($v['video_type'] ?? '');
        if ($did > 0) {
            $duelAny[$did][] = $url;
            if ($type === 'Поединок') {
                $duelBout[$did][] = $url;
            }
        } elseif ($type === 'ДеньЦеликом') {
            $eventDay[(int)$v['event_id']][] = $url;
        }
    }

    $playsByCode = [];
    foreach ($duels as $did => $d) {
        $code = trim((string)$d['sit_code']);
        if ($code === '') {
            continue;
        }
        $iso = trim((string)($d['duel_date'] ?? ''));
        if ($iso === '' || str_starts_with($iso, '0000')) {
            $iso = trim((string)($d['starts_on'] ?? ''));
        }
        $dateDisp = sit_fmt_date($iso);
        $paired = ((string)$d['duel_type']) === 'парный';
        $vv = $votes[$did] ?? [];
        $v1 = 0;
        $v2 = 0;
        foreach ($vv as $vote) {
            if ($vote === '1') {
                $v1++;
            } elseif ($vote === '2') {
                $v2++;
            }
        }
        $winner = $v1 > $v2 ? 1 : ($v2 > $v1 ? 2 : 0);
        $score = ($v1 + $v2) > 0 ? ($v1 . ':' . $v2) : '';
        $video = sit_pick_url($duelBout[$did] ?? [])
            ?: sit_pick_url($duelAny[$did] ?? [])
            ?: sit_pick_url($eventDay[(int)$d['event_id']] ?? []);
        $play = [
            'date' => $dateDisp,
            'iso' => $iso,
            'event' => sit_event_title((string)$d['event_title'], $dateDisp),
            'p1' => sit_side_label($d['p1_name'] ?? null, $d['s1_name'] ?? null, $paired) ?: '—',
            'p2' => sit_side_label($d['p2_name'] ?? null, $d['s2_name'] ?? null, $paired) ?: '—',
            'score' => $score,
            'winner' => $winner,
        ];
        if ($video !== '') {
            $play['video'] = $video;
        }
        $playsByCode[$code][] = $play;
    }

    foreach ($playsByCode as $code => $list) {
        usort($list, static function (array $a, array $b): int {
            $c = strcmp((string)($b['iso'] ?? ''), (string)($a['iso'] ?? ''));
            if ($c !== 0) {
                return $c;
            }
            return strcmp((string)($b['event'] ?? ''), (string)($a['event'] ?? ''));
        });
        foreach ($list as &$item) {
            unset($item['iso']);
        }
        unset($item);
        $playsByCode[$code] = array_values($list);
    }

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
