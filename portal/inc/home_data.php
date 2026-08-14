<?php
declare(strict_types=1);

function portal_people_list(mysqli $db): array
{
    $out = [];
    $r = $db->query('SELECT id, full_name FROM people WHERE is_active = 1 ORDER BY full_name');
    while ($row = $r->fetch_assoc()) {
        $out[] = ['id' => (int)$row['id'], 'name' => $row['full_name']];
    }
    return $out;
}

/** Ярлыки шаблонного «Онлайн 10» Google на 2024–2028; живой online_10 (2023) не входит. */
function portal_template_online10_slugs(): array
{
    return ['online_10_20', 'online_10_21', 'online_10_22', 'online_10_23', 'online_10_24'];
}

function portal_not_template_slug_sql(): string
{
    $quoted = [];
    foreach (portal_template_online10_slugs() as $slug) {
        $quoted[] = "'" . str_replace("'", "''", $slug) . "'";
    }
    return '(slug IS NULL OR slug NOT IN (' . implode(',', $quoted) . '))';
}

function portal_dated_events(mysqli $db): array
{
    $notTpl = portal_not_template_slug_sql();
    $r = $db->query(
        "SELECT id, slug, title, event_type, starts_on, ends_on, status
         FROM events
         WHERE starts_on IS NOT NULL
           AND starts_on <> '0000-00-00'
           AND $notTpl
         ORDER BY starts_on, id"
    );
    $out = [];
    while ($row = $r->fetch_assoc()) {
        $out[] = [
            'id' => (int)$row['id'],
            'slug' => $row['slug'],
            'title' => $row['title'],
            'type' => $row['event_type'],
            'start' => $row['starts_on'],
            'end' => $row['ends_on'],
            'status' => $row['status'],
        ];
    }
    return $out;
}

function portal_next_events(mysqli $db, int $limit = 3): array
{
    $today = date('Y-m-d');
    $limit = max(1, $limit);
    $notTpl = portal_not_template_slug_sql();
    $st = $db->prepare(
        "SELECT id, slug, title, event_type, starts_on, ends_on, status
         FROM events
         WHERE status IN ('Запланировано', 'Подготовка')
           AND status <> 'Отменено'
           AND starts_on IS NOT NULL
           AND starts_on <> '0000-00-00'
           AND starts_on >= ?
           AND $notTpl
         ORDER BY starts_on, id
         LIMIT $limit"
    );
    $st->bind_param('s', $today);
    $st->execute();
    $res = $st->get_result();
    $out = [];
    while ($row = $res->fetch_assoc()) {
        $out[] = $row;
    }
    $st->close();
    return $out;
}

function portal_event_by_id(mysqli $db, int $id): ?array
{
    if ($id <= 0) {
        return null;
    }
    $st = $db->prepare(
        'SELECT id, slug, title, event_type, starts_on, ends_on, status
         FROM events WHERE id = ?'
    );
    $st->bind_param('i', $id);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    return $row ?: null;
}

/** Ссылка на нашу форму заявки (онлайн / купала / новогоднее). */
function portal_register_url(?array $event): string
{
    if (!$event) {
        return '';
    }
    $type = (string)($event['event_type'] ?? '');
    if (!in_array($type, ['онлайн', 'купала', 'новогоднее'], true)) {
        return '';
    }
    return 'register.php?event=' . (int)$event['id'];
}

function portal_event_dates(array $ev): string
{
    $start = portal_fmt_date($ev['starts_on'] ?? null);
    $end = portal_fmt_date($ev['ends_on'] ?? null);
    if ($start !== '' && $end !== '' && $start !== $end) {
        return $start . '–' . $end;
    }
    return $start !== '' ? $start : $end;
}

function portal_title_has_dates(string $title, array $ev): bool
{
    $iso = (string)($ev['starts_on'] ?? '');
    if ($iso === '') {
        return false;
    }
    $t = strtotime($iso);
    if ($t === false) {
        return false;
    }
    foreach ([date('d.m.Y', $t), date('d.m.y', $t)] as $fmt) {
        if (strpos($title, $fmt) !== false) {
            return true;
        }
    }
    return false;
}

function portal_title_has_type(string $title, string $type): bool
{
    $type = trim($type);
    if ($type === '') {
        return true;
    }
    if (preg_match('/' . preg_quote($type, '/') . '/ui', $title)) {
        return true;
    }
    if ($type === 'новогоднее' && preg_match('/(?<!\p{L})нг(?!\p{L})/ui', $title)) {
        return true;
    }
    return false;
}

/** Диапазон без года: 05.12–06.12; один день — ДД.ММ.ГГГГ. */
function portal_event_dates_compact(array $ev): string
{
    $startIso = (string)($ev['starts_on'] ?? '');
    $endIso = (string)($ev['ends_on'] ?? '');
    $st = $startIso !== '' ? strtotime($startIso) : false;
    $en = $endIso !== '' ? strtotime($endIso) : false;
    if ($st && $en && date('Y-m-d', $st) !== date('Y-m-d', $en)) {
        if (date('Y', $st) === date('Y', $en)) {
            return date('d.m', $st) . '–' . date('d.m', $en);
        }
        return date('d.m.Y', $st) . '–' . date('d.m.Y', $en);
    }
    if ($st) {
        return date('d.m.Y', $st);
    }
    if ($en) {
        return date('d.m.Y', $en);
    }
    return '';
}

/** Серая строка «Ближайшее»: только то, чего нет в названии. */
function portal_next_meta(array $ev): string
{
    $title = (string)($ev['title'] ?? '');
    $parts = [];
    if (!portal_title_has_dates($title, $ev)) {
        $dates = portal_event_dates_compact($ev);
        if ($dates !== '') {
            $parts[] = $dates;
        }
    }
    $type = trim((string)($ev['event_type'] ?? ''));
    if ($type !== '' && !portal_title_has_type($title, $type)) {
        $parts[] = $type;
    }
    return implode(' · ', $parts);
}

function portal_name_or_empty(?string $name): string
{
    $name = trim((string)$name);
    return $name !== '' ? $name : '';
}

/** Подпись ситуации как в сетке Google: код, иначе номер, иначе 00/00Э. */
function portal_sit_label(?string $code, $num, string $prep, string $type): string
{
    $code = trim((string)$code);
    if ($code !== '') {
        return $code;
    }
    if ($num !== null && $num !== '') {
        return (string)$num;
    }
    if ($prep === 'случайный') {
        return $type === 'экспресс' ? '00Э' : '00';
    }
    return '—';
}

function portal_short_fio(string $name): string
{
    $name = trim($name);
    if ($name === '') {
        return '';
    }
    $parts = preg_split('/\s+/u', $name);
    return $parts[0] !== false && $parts[0] !== null ? $parts[0] : $name;
}

function portal_sit_is_random_label(string $label): bool
{
    return $label === '00' || $label === '00Э' || $label === '—';
}

function portal_sit_bank_url(?string $code, string $label): string
{
    if (portal_sit_is_random_label($label)) {
        return '';
    }
    $code = trim((string)$code);
    if ($code === '' || preg_match('/^00([ЭE]|[-–]|$)/u', $code)) {
        return '';
    }
    return 'https://timer.zaborov.ru/situations-bank.html?from=portal&code=' . rawurlencode($code);
}

function portal_video_url(?string $url): string
{
    $url = trim((string)$url);
    if ($url === '' || !preg_match('#^https?://#i', $url)) {
        return '';
    }
    return $url;
}

function portal_video_link_html(?string $url, string $extraClass = '', string $label = 'видео'): string
{
    $url = portal_video_url($url);
    if ($url === '') {
        return '';
    }
    $cls = 'video-link vid-pill';
    if ($extraClass !== '') {
        $cls .= ' ' . $extraClass;
    }
    $text = $label !== '' ? $label : 'видео';
    return '<a class="' . $cls . '" href="' . h($url) . '" target="_blank" rel="noopener">'
        . '<svg class="ico" aria-hidden="true"><use href="#i-video"></use></svg> ' . h($text) . '</a>';
}

/** URL дня целиком, если он не совпадает ни с одним клипом поединка. */
function portal_event_day_video_url(array $ev): string
{
    $url = portal_video_url($ev['video'] ?? null);
    if ($url === '') {
        return '';
    }
    foreach ($ev['duels'] ?? [] as $d) {
        if (portal_video_url($d['video'] ?? null) === $url) {
            return '';
        }
    }
    return $url;
}

/**
 * Первое валидное видео дня (дуэль null) и первое видео каждого поединка.
 *
 * @param list<int> $eventIds
 * @return array{events: array<int, string>, duels: array<int, string>}
 */
function portal_videos_for_events(mysqli $db, array $eventIds): array
{
    $eventIds = array_values(array_unique(array_filter(array_map('intval', $eventIds))));
    $eventUrls = [];
    $duelUrls = [];
    if (!$eventIds) {
        return ['events' => $eventUrls, 'duels' => $duelUrls];
    }
    $in = implode(',', $eventIds);
    try {
        $r = $db->query(
            "SELECT event_id, duel_id, url, video_type
             FROM videos
             WHERE event_id IN ($in)
             ORDER BY id"
        );
    } catch (Throwable $e) {
        return ['events' => $eventUrls, 'duels' => $duelUrls];
    }
    while ($row = $r->fetch_assoc()) {
        $url = portal_video_url($row['url'] ?? null);
        if ($url === '') {
            continue;
        }
        $did = isset($row['duel_id']) && $row['duel_id'] !== null && $row['duel_id'] !== ''
            ? (int)$row['duel_id'] : 0;
        $type = (string)($row['video_type'] ?? '');
        if ($did > 0) {
            if (!isset($duelUrls[$did])) {
                $duelUrls[$did] = $url;
            }
        } elseif ($type !== 'Поединок') {
            $eid = (int)$row['event_id'];
            if (!isset($eventUrls[$eid])) {
                $eventUrls[$eid] = $url;
            }
        }
    }
    return ['events' => $eventUrls, 'duels' => $duelUrls];
}

function portal_sit_td(array $d, bool $withVideo = false): string
{
    $label = (string)$d['sit'];
    $url = (string)($d['sit_url'] ?? '');
    $html = '<td class="sit"><span class="with-vid">';
    if ($url !== '') {
        $html .= '<a href="' . h($url) . '" target="_blank" rel="noopener">' . h($label) . '</a>';
    } else {
        $html .= h($label);
    }
    if ($withVideo) {
        $html .= portal_video_link_html($d['video'] ?? null);
    }
    $html .= '</span></td>';
    return $html;
}

function portal_you_mark(): string
{
    return '<span class="you" title="это вы">вы</span>';
}

function portal_side_td(
    string $player,
    string $second,
    int $winner,
    int $side,
    int $meId = 0,
    int $playerId = 0,
    int $secondId = 0,
    bool $paired = false
): string {
    $cls = 'side';
    if ($winner === $side) {
        $cls .= ' win';
    } elseif ($winner === 0) {
        $cls .= ' draw';
    }
    if ($meId > 0 && ($meId === $playerId || $meId === $secondId)) {
        $cls .= ' is-me';
    }
    $html = '<td class="' . $cls . '">';
    $html .= h($player !== '' ? $player : '—');
    if ($meId > 0 && $meId === $playerId) {
        $html .= portal_you_mark();
    }
    if ($second !== '') {
        $span = $paired ? 'pair' : 'second';
        $html .= '<span class="' . $span . '">' . h($second);
        if ($meId > 0 && $meId === $secondId) {
            $html .= portal_you_mark();
        }
        $html .= '</span>';
    }
    $html .= '</td>';
    return $html;
}

function portal_meeting_heading(array $ev, bool $plan = false): string
{
    $title = trim((string)($ev['title'] ?? ''));
    $start = portal_fmt_date($ev['starts_on'] ?? $ev['start'] ?? null);
    $end = portal_fmt_date($ev['ends_on'] ?? $ev['end'] ?? null);
    $date = '';
    if ($start && $end && $start !== $end) {
        $date = $start . '–' . $end;
    } else {
        $date = $start !== '' ? $start : $end;
    }
    if ($date !== '' && $title !== '') {
        $title = trim(preg_replace('/\s+' . preg_quote($date, '/') . '\s*$/u', '', $title));
    }
    $head = $plan ? 'План' : 'Результаты';
    if ($title !== '') {
        $head .= ': ' . $title;
    }
    if ($date !== '') {
        $head .= ' · ' . $date;
    }
    return $head;
}

function portal_last_heading(array $last): string
{
    return portal_meeting_heading($last, false);
}

function portal_score_td(array $d): string
{
    $w = (int)$d['winner'];
    $html = '<td class="result' . ($w === 0 ? ' draw' : '') . '">';
    $html .= '<span class="score">' . (int)$d['v1'] . ':' . (int)$d['v2'] . '</span>';
    if ($w === 0) {
        $html .= '<span class="outcome">ничья</span>';
    } else {
        $name = portal_short_fio($w === 1 ? (string)$d['p1'] : (string)$d['p2']);
        $paired = (($d['type'] ?? '') === 'парный');
        if ($paired) {
            $other = portal_short_fio($w === 1 ? (string)($d['s1'] ?? '') : (string)($d['s2'] ?? ''));
            if ($name !== '' && $other !== '') {
                $name = $name . ', ' . $other;
            } elseif ($other !== '') {
                $name = $other;
            }
        }
        if ($name !== '') {
            $html .= '<span class="outcome win">' . h($name) . '</span>';
        }
    }
    $html .= '</td>';
    return $html;
}

/** Порядок коллегий как в каноне; пустые не показываем. */
function portal_college_short(string $college): string
{
    switch ($college) {
        case 'нанимающиесяНаРаботу':
            return 'Нанимающиеся';
        case 'отправляющиеНаПереговоры':
            return 'Отправляющие';
        case 'доверяющиеСобственность':
            return 'Доверяющие';
        case 'неизвестна':
            return 'Неизвестна';
        default:
            return $college !== '' ? $college : 'Неизвестна';
    }
}

/**
 * Судьи по коллегиям: короткие ФИО, без голоса.
 * Экспресс (канон express-only-sending): один список, без трёх подписей коллегий.
 *
 * @param list<array{id: int, name: string, college: string}> $judges
 * @return list<array{label: string, people: list<array{id: int, name: string}>}>
 */
function portal_judge_groups(array $judges, $duelType = '')
{
    if ($duelType === 'экспресс') {
        $people = [];
        foreach ($judges as $j) {
            $id = (int)($j['id'] ?? 0);
            $name = portal_short_fio((string)($j['name'] ?? ''));
            if ($id <= 0 || $name === '') {
                continue;
            }
            $people[] = ['id' => $id, 'name' => $name];
        }
        return $people ? [['label' => '', 'people' => $people]] : [];
    }
    $order = [
        'нанимающиесяНаРаботу',
        'отправляющиеНаПереговоры',
        'доверяющиеСобственность',
        'неизвестна',
    ];
    $buckets = [];
    foreach ($order as $c) {
        $buckets[$c] = [];
    }
    $extra = [];
    foreach ($judges as $j) {
        $id = (int)($j['id'] ?? 0);
        $name = portal_short_fio((string)($j['name'] ?? ''));
        if ($id <= 0 || $name === '') {
            continue;
        }
        $c = trim((string)($j['college'] ?? ''));
        if ($c === '') {
            $c = 'неизвестна';
        }
        $row = ['id' => $id, 'name' => $name];
        if (isset($buckets[$c])) {
            $buckets[$c][] = $row;
        } else {
            $extra[$c][] = $row;
        }
    }
    $out = [];
    foreach ($buckets as $c => $people) {
        if ($people) {
            $out[] = ['label' => portal_college_short($c), 'people' => $people];
        }
    }
    foreach ($extra as $c => $people) {
        if ($people) {
            $out[] = ['label' => portal_college_short($c), 'people' => $people];
        }
    }
    return $out;
}

function portal_judge_names_html(array $people, int $meId = 0): string
{
    $parts = [];
    foreach ($people as $p) {
        $s = h((string)($p['name'] ?? ''));
        if ($meId > 0 && $meId === (int)($p['id'] ?? 0)) {
            $s .= portal_you_mark();
        }
        $parts[] = $s;
    }
    return implode(', ', $parts);
}

function portal_judges_td(array $d, int $meId = 0): string
{
    $groups = $d['judge_groups'] ?? [];
    $meHere = false;
    foreach ($groups as $g) {
        foreach ($g['people'] ?? [] as $p) {
            if ($meId > 0 && $meId === (int)($p['id'] ?? 0)) {
                $meHere = true;
                break 2;
            }
        }
    }
    $cls = 'judges';
    if ($meHere) {
        $cls .= ' is-me';
    }
    $html = '<td class="' . $cls . '">';
    $flat = (($d['type'] ?? '') === 'экспресс') || (count($groups) === 1);
    if (!$groups) {
        $html .= '—';
    } elseif ($flat) {
        $all = [];
        foreach ($groups as $g) {
            foreach ($g['people'] ?? [] as $p) {
                $all[] = $p;
            }
        }
        $html .= portal_judge_names_html($all, $meId);
    } else {
        foreach ($groups as $g) {
            $html .= '<div class="jcol"><strong class="jlab">' . h((string)($g['label'] ?? '')) . '</strong> ';
            $html .= portal_judge_names_html($g['people'] ?? [], $meId);
            $html .= '</div>';
        }
    }
    $html .= '</td>';
    return $html;
}

function portal_fmt_date(?string $iso): string
{
    if ($iso === null || $iso === '') {
        return '';
    }
    $t = strtotime($iso);
    return $t ? date('d.m.Y', $t) : $iso;
}

/**
 * Поединки по списку мероприятий: состав, ситуации, голоса.
 *
 * @param list<int> $eventIds
 * @return array<int, list<array<string, mixed>>>
 */
function portal_duels_by_event(mysqli $db, array $eventIds): array
{
    $eventIds = array_values(array_unique(array_filter(array_map('intval', $eventIds))));
    if (!$eventIds) {
        return [];
    }
    $in = implode(',', $eventIds);
    $r = $db->query(
        "SELECT d.id, d.event_id, d.sort_order, d.duel_date, d.duel_type, d.prep_mode,
                d.player1_id, d.second1_id, d.player2_id, d.second2_id,
                s.code AS sit_code, s.num AS sit_num,
                p1.full_name AS p1_name, s1.full_name AS s1_name,
                p2.full_name AS p2_name, s2.full_name AS s2_name
         FROM duels d
         LEFT JOIN situations s ON s.id = d.situation_id
         LEFT JOIN people p1 ON p1.id = d.player1_id
         LEFT JOIN people s1 ON s1.id = d.second1_id
         LEFT JOIN people p2 ON p2.id = d.player2_id
         LEFT JOIN people s2 ON s2.id = d.second2_id
         WHERE d.event_id IN ($in)
         ORDER BY d.event_id, d.sort_order, d.id"
    );
    $byDid = [];
    $eventOf = [];
    while ($row = $r->fetch_assoc()) {
        $did = (int)$row['id'];
        $type = (string)$row['duel_type'];
        $express = $type === 'экспресс';
        $sit = portal_sit_label($row['sit_code'] ?? null, $row['sit_num'] ?? null, (string)$row['prep_mode'], $type);
        $dd = (string)($row['duel_date'] ?? '');
        if ($dd === '0000-00-00') {
            $dd = '';
        }
        $byDid[$did] = [
            'id' => $did,
            'order' => (int)$row['sort_order'],
            'date' => $dd !== '' ? $dd : null,
            'type' => $type,
            'sit' => $sit,
            'sit_url' => portal_sit_bank_url($row['sit_code'] ?? null, $sit),
            'p1' => portal_name_or_empty($row['p1_name'] ?? null),
            's1' => $express ? '' : portal_name_or_empty($row['s1_name'] ?? null),
            'p1_id' => (int)($row['player1_id'] ?? 0),
            's1_id' => $express ? 0 : (int)($row['second1_id'] ?? 0),
            'p2' => portal_name_or_empty($row['p2_name'] ?? null),
            's2' => $express ? '' : portal_name_or_empty($row['s2_name'] ?? null),
            'p2_id' => (int)($row['player2_id'] ?? 0),
            's2_id' => $express ? 0 : (int)($row['second2_id'] ?? 0),
            'v1' => 0,
            'v2' => 0,
            'winner' => 0,
            'judges' => [],
            'judge_groups' => [],
        ];
        $eventOf[$did] = (int)$row['event_id'];
    }

    if ($byDid) {
        $inDuels = implode(',', array_map('intval', array_keys($byDid)));
        $vr = $db->query(
            "SELECT dj.duel_id, dj.person_id, dj.college, dj.vote, p.full_name
             FROM duel_judges dj
             LEFT JOIN people p ON p.id = dj.person_id
             WHERE dj.duel_id IN ($inDuels)
             ORDER BY dj.id"
        );
        while ($row = $vr->fetch_assoc()) {
            $did = (int)$row['duel_id'];
            if (!isset($byDid[$did])) {
                continue;
            }
            $v = trim((string)$row['vote']);
            if ($v === '1') {
                $byDid[$did]['v1']++;
            } elseif ($v === '2') {
                $byDid[$did]['v2']++;
            }
            $pid = (int)($row['person_id'] ?? 0);
            $name = portal_name_or_empty($row['full_name'] ?? null);
            if ($pid > 0 && $name !== '') {
                $byDid[$did]['judges'][] = [
                    'id' => $pid,
                    'name' => $name,
                    'college' => (string)($row['college'] ?? ''),
                ];
            }
        }
        foreach ($byDid as &$d) {
            if ($d['v1'] > $d['v2']) {
                $d['winner'] = 1;
            } elseif ($d['v2'] > $d['v1']) {
                $d['winner'] = 2;
            } else {
                $d['winner'] = 0;
            }
            $d['judge_groups'] = portal_judge_groups($d['judges'] ?? [], $d['type'] ?? '');
            unset($d['judges']);
        }
        unset($d);
    }

    $out = [];
    foreach ($byDid as $did => $d) {
        $out[$eventOf[$did]][] = $d;
    }
    return $out;
}

/** Датированные мероприятия с поединками — календарь и таблица на главной. */
function portal_events_for_calendar(mysqli $db): array
{
    $events = portal_dated_events($db);
    $ids = array_column($events, 'id');
    $byEv = portal_duels_by_event($db, $ids);
    $vids = portal_videos_for_events($db, $ids);
    foreach ($events as &$ev) {
        $eid = (int)$ev['id'];
        $duels = $byEv[$eid] ?? [];
        foreach ($duels as &$d) {
            $did = (int)$d['id'];
            if (!empty($vids['duels'][$did])) {
                $d['video'] = $vids['duels'][$did];
            }
        }
        unset($d);
        $ev['duels'] = $duels;
        if (!empty($vids['events'][$eid])) {
            $ev['video'] = $vids['events'][$eid];
        }
    }
    unset($ev);
    return $events;
}

/** Последний прошедший онлайн (тип онлайн, Проведено, дата ≤ сегодня). */
function portal_default_meeting(array $events): ?array
{
    $today = date('Y-m-d');
    $best = null;
    $bestDate = '';
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'онлайн') {
            continue;
        }
        if (($ev['status'] ?? '') !== 'Проведено') {
            continue;
        }
        $d = substr((string)($ev['start'] ?? ''), 0, 10);
        if ($d === '') {
            $d = substr((string)($ev['end'] ?? ''), 0, 10);
        }
        if ($d === '' || $d > $today) {
            continue;
        }
        if ($best === null || $d > $bestDate || ($d === $bestDate && (int)$ev['id'] > (int)$best['id'])) {
            $best = $ev;
            $bestDate = $d;
        }
    }
    return $best;
}

function portal_last_meeting(mysqli $db): ?array
{
    return portal_default_meeting(portal_events_for_calendar($db));
}

/**
 * Статистика залогиненного: игры (игрок1/2), секундант/2-й игрок,
 * судейство, победы/поражения по голосам 1/2 (ничья не считается),
 * уникальные соперники с числом встреч,
 * число турниров (event_type=турнир, УБ Лидер) как игрок/секундант/судья.
 *
 * @return array{
 *   played: int, seconded: int, judged: int, tournaments: int,
 *   won: int, lost: int,
 *   rivals: list<array{id: int, name: string, n: int}>
 * }|null
 */
function portal_person_stats(mysqli $db, int $personId): ?array
{
    if ($personId <= 0) {
        return null;
    }

    $played = 0;
    $seconded = 0;
    $won = 0;
    $lost = 0;
    $rivalIds = [];
    $asPlayer = [];

    $st = $db->prepare(
        'SELECT id, player1_id, second1_id, player2_id, second2_id
         FROM duels
         WHERE player1_id = ? OR player2_id = ? OR second1_id = ? OR second2_id = ?'
    );
    $st->bind_param('iiii', $personId, $personId, $personId, $personId);
    $st->execute();
    $res = $st->get_result();
    while ($d = $res->fetch_assoc()) {
        $did = (int)$d['id'];
        $p1 = (int)$d['player1_id'];
        $p2 = (int)$d['player2_id'];
        $s1 = (int)$d['second1_id'];
        $s2 = (int)$d['second2_id'];
        if ($p1 === $personId || $p2 === $personId) {
            $played++;
            $side = $p1 === $personId ? 1 : 2;
            $asPlayer[$did] = $side;
            $opp = $side === 1 ? $p2 : $p1;
            if ($opp > 0) {
                if (!isset($rivalIds[$opp])) {
                    $rivalIds[$opp] = 0;
                }
                $rivalIds[$opp]++;
            }
        }
        if ($s1 === $personId || $s2 === $personId) {
            $seconded++;
        }
    }
    $st->close();

    if ($asPlayer) {
        $in = implode(',', array_map('intval', array_keys($asPlayer)));
        $votes = [];
        $r = $db->query("SELECT duel_id, vote FROM duel_judges WHERE duel_id IN ($in)");
        while ($row = $r->fetch_assoc()) {
            $did = (int)$row['duel_id'];
            if (!isset($votes[$did])) {
                $votes[$did] = ['1' => 0, '2' => 0];
            }
            $v = trim((string)$row['vote']);
            if ($v === '1' || $v === '2') {
                $votes[$did][$v]++;
            }
        }
        foreach ($asPlayer as $did => $side) {
            $vv = $votes[$did] ?? ['1' => 0, '2' => 0];
            if ($vv['1'] === $vv['2']) {
                continue;
            }
            $winner = $vv['1'] > $vv['2'] ? 1 : 2;
            if ($winner === $side) {
                $won++;
            } else {
                $lost++;
            }
        }
    }

    $st = $db->prepare('SELECT COUNT(*) AS n FROM duel_judges WHERE person_id = ?');
    $st->bind_param('i', $personId);
    $st->execute();
    $judged = (int)$st->get_result()->fetch_assoc()['n'];
    $st->close();

    $tournaments = 0;
    $st = $db->prepare(
        "SELECT COUNT(DISTINCT e.id) AS n
         FROM events e
         WHERE e.event_type = 'турнир'
           AND (
             EXISTS (
               SELECT 1 FROM duels d
               WHERE d.event_id = e.id
                 AND (d.player1_id = ? OR d.player2_id = ?
                      OR d.second1_id = ? OR d.second2_id = ?)
             )
             OR EXISTS (
               SELECT 1 FROM duels d
               INNER JOIN duel_judges dj ON dj.duel_id = d.id
               WHERE d.event_id = e.id AND dj.person_id = ?
             )
           )"
    );
    $st->bind_param('iiiii', $personId, $personId, $personId, $personId, $personId);
    $st->execute();
    $tournaments = (int)$st->get_result()->fetch_assoc()['n'];
    $st->close();

    $rivals = [];
    if ($rivalIds) {
        $in = implode(',', array_map('intval', array_keys($rivalIds)));
        $names = [];
        $r = $db->query("SELECT id, full_name FROM people WHERE id IN ($in)");
        while ($row = $r->fetch_assoc()) {
            $names[(int)$row['id']] = $row['full_name'];
        }
        foreach ($rivalIds as $oid => $n) {
            $rivals[] = [
                'id' => (int)$oid,
                'name' => $names[$oid] ?? ('#' . $oid),
                'n' => (int)$n,
            ];
        }
        usort($rivals, static function ($a, $b) {
            if ($a['n'] === $b['n']) {
                return strcasecmp($a['name'], $b['name']);
            }
            return ($a['n'] < $b['n']) ? 1 : -1;
        });
    }

    return [
        'played' => $played,
        'seconded' => $seconded,
        'judged' => $judged,
        'tournaments' => $tournaments,
        'won' => $won,
        'lost' => $lost,
        'rivals' => $rivals,
    ];
}
