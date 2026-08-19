<?php
declare(strict_types=1);

/**
 * История игр банка ситуаций (duels + situations.code + videos).
 * Общая для публичного GET api/situations.php и орг-раздела.
 */

const SIT_SKIP_EVENT_SLUGS = [
    'online_10_20',
    'online_10_21',
    'online_10_22',
    'online_10_23',
    'online_10_24',
];

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

function sit_item_url(mixed $item): string
{
    if (is_array($item)) {
        return trim((string)($item['url'] ?? ''));
    }
    return trim((string)$item);
}

function sit_pick_url(array $urls): string
{
    foreach ($urls as $item) {
        $url = sit_item_url($item);
        if (sit_is_http_url($url)) {
            return $url;
        }
    }
    return '';
}

/** Подпись таблетки: xlsx/таблица — «материал», иначе «разбор». */
function sit_review_label(string $url, ?string $title = null): string
{
    $t = trim((string)$title);
    $low = function_exists('mb_strtolower') ? mb_strtolower($t, 'UTF-8') : strtolower($t);
    if ($low === 'материал' || $low === 'разбор') {
        return $low;
    }
    if (preg_match('/\.(xlsx|xls|ods|csv)(\?|#|$)/i', $url)
        || str_contains($url, 'spreadsheets')
        || str_contains($url, 'docs.google.com/spreadsheets')) {
        return 'материал';
    }
    return 'разбор';
}

/**
 * @param list<array{url: string, label: string}> $items
 * @return list<array{url: string, label: string}>
 */
function sit_reviews_public(array $items): array
{
    $out = [];
    $seen = [];
    foreach ($items as $it) {
        $url = sit_item_url($it);
        if (!sit_is_http_url($url) || isset($seen[$url])) {
            continue;
        }
        $seen[$url] = true;
        $label = is_array($it) ? trim((string)($it['label'] ?? '')) : '';
        if ($label === '') {
            $label = sit_review_label($url, is_array($it) ? ($it['title'] ?? null) : null);
        }
        $row = [
            'url' => $url,
            'label' => $label,
            'duelId' => is_array($it) ? (int)($it['duelId'] ?? $it['duel_id'] ?? 0) : 0,
        ];
        if (is_array($it)) {
            if (!empty($it['date'])) {
                $row['date'] = (string)$it['date'];
            }
            if (!empty($it['iso'])) {
                $row['iso'] = (string)$it['iso'];
            }
            if (!empty($it['event'])) {
                $row['event'] = (string)$it['event'];
            }
            if (!empty($it['eventId'])) {
                $row['eventId'] = (int)$it['eventId'];
            }
        }
        $out[] = $row;
    }
    return $out;
}

/**
 * Первый общий разбор (без поединка) — для обратной совместимости reviewUrl.
 */
function sit_review_url_general(array $items): string
{
    foreach ($items as $it) {
        if ((int)($it['duelId'] ?? 0) !== 0) {
            continue;
        }
        $url = sit_item_url($it);
        if (sit_is_http_url($url)) {
            return $url;
        }
    }
    return '';
}

/**
 * Карты видео: клипы поединков, день целиком, разборы по ситуации и по поединку.
 *
 * @return array{
 *   duelBout: array<int, list<string>>,
 *   duelAny: array<int, list<string>>,
 *   eventDay: array<int, list<string>>,
 *   reviewBySit: array<int, list<array{url: string, label: string, duel_id: int}>>,
 *   reviewByDuel: array<int, list<array{url: string, label: string}>>
 * }
 */
function sit_video_maps(mysqli $db): array
{
    $duelBout = [];
    $duelAny = [];
    $eventDay = [];
    $reviewBySit = [];
    $reviewByDuel = [];
    $vidRes = $db->query(
        'SELECT v.event_id, v.duel_id, v.situation_id, v.url, v.title, v.video_type, v.video_date,
                e.title AS event_title, e.starts_on
         FROM videos v
         LEFT JOIN events e ON e.id = v.event_id
         ORDER BY v.id'
    );
    while ($v = $vidRes->fetch_assoc()) {
        $url = trim((string)($v['url'] ?? ''));
        if (!sit_is_http_url($url)) {
            continue;
        }
        $did = isset($v['duel_id']) && $v['duel_id'] !== null && $v['duel_id'] !== ''
            ? (int)$v['duel_id'] : 0;
        $type = (string)($v['video_type'] ?? '');
        if ($type === 'Разбор') {
            $sid = isset($v['situation_id']) && $v['situation_id'] !== null && $v['situation_id'] !== ''
                ? (int)$v['situation_id'] : 0;
            $label = sit_review_label($url, $v['title'] ?? null);
            $iso = trim((string)($v['video_date'] ?? ''));
            if ($iso === '' || str_starts_with($iso, '0000')) {
                $iso = trim((string)($v['starts_on'] ?? ''));
            }
            $dateDisp = sit_fmt_date($iso);
            $eid = isset($v['event_id']) && $v['event_id'] !== null && $v['event_id'] !== ''
                ? (int)$v['event_id'] : 0;
            $item = [
                'url' => $url,
                'label' => $label,
                'duel_id' => $did,
                'duelId' => $did,
                'iso' => $iso,
                'date' => $dateDisp,
                'eventId' => $eid,
                'event' => $eid > 0 ? sit_event_title((string)($v['event_title'] ?? ''), $dateDisp) : '',
            ];
            if ($sid > 0) {
                $reviewBySit[$sid][] = $item;
            }
            if ($did > 0) {
                $reviewByDuel[$did][] = ['url' => $url, 'label' => $label];
            }
            continue;
        }
        if ($did > 0) {
            $duelAny[$did][] = $url;
            if ($type === 'Поединок') {
                $duelBout[$did][] = $url;
            }
        } elseif ($type === 'ДеньЦеликом') {
            $eventDay[(int)$v['event_id']][] = $url;
        }
    }
    return [
        'duelBout' => $duelBout,
        'duelAny' => $duelAny,
        'eventDay' => $eventDay,
        'reviewBySit' => $reviewBySit,
        'reviewByDuel' => $reviewByDuel,
    ];
}

/**
 * История игр по коду ситуации (как публичный банк).
 *
 * @param array|null $videos результат sit_video_maps(); null — загрузить внутри
 * @return array<string, list<array<string, mixed>>>
 */
function sit_plays_by_code(mysqli $db, ?array $videos = null): array
{
    if ($videos === null) {
        $videos = sit_video_maps($db);
    }
    $duelBout = $videos['duelBout'] ?? [];
    $duelAny = $videos['duelAny'] ?? [];
    $eventDay = $videos['eventDay'] ?? [];
    $reviewByDuel = $videos['reviewByDuel'] ?? [];

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
            'eventId' => (int)$d['event_id'],
            'event' => sit_event_title((string)$d['event_title'], $dateDisp),
            'p1' => sit_side_label($d['p1_name'] ?? null, $d['s1_name'] ?? null, $paired) ?: '—',
            'p2' => sit_side_label($d['p2_name'] ?? null, $d['s2_name'] ?? null, $paired) ?: '—',
            'score' => $score,
            'winner' => $winner,
        ];
        if ($video !== '') {
            $play['video'] = $video;
        }
        $rev = sit_reviews_public($reviewByDuel[$did] ?? []);
        if ($rev) {
            $play['review'] = $rev[0]['url'];
            $play['reviewLabel'] = $rev[0]['label'];
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
        $playsByCode[$code] = array_values($list);
    }

    return $playsByCode;
}
