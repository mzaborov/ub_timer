<?php
declare(strict_types=1);

require_once __DIR__ . '/elo.php';
require_once __DIR__ . '/org_pairs.php';
require_once __DIR__ . '/home_data.php';

function org_default_zoom(): string
{
    global $portal_default_zoom;
    return is_string($portal_default_zoom) ? trim($portal_default_zoom) : '';
}

function org_event_types(): array
{
    return ['онлайн', 'купала', 'новогоднее', 'региональный', 'турнир', 'обучение'];
}

function org_event_statuses(): array
{
    return ['Запланировано', 'Подготовка', 'Проведено', 'Отменено'];
}

function org_duel_types(): array
{
    return ['классика', 'экспресс', 'парный'];
}

function org_norm_duel_type_pref(?string $raw): ?string
{
    $raw = mb_strtolower(trim((string)$raw));
    foreach (org_duel_types() as $t) {
        if ($raw === mb_strtolower($t)) {
            return $t;
        }
    }
    return null;
}

function org_duel_type_pref_options(string $selected): string
{
    $options = [
        '' => 'любой',
        'классика' => 'классика',
        'экспресс' => 'экспресс',
        'парный' => 'парный',
    ];
    $html = '';
    foreach ($options as $value => $label) {
        $s = $selected === $value ? ' selected' : '';
        $html .= '<option value="' . h($value) . '"' . $s . '>' . h($label) . '</option>';
    }
    return $html;
}

function org_event_is_planned(array $ev): bool
{
    return portal_event_is_open_status((string)($ev['status'] ?? ''));
}

function org_event_can_manage_regs(array $ev): bool
{
    return org_event_is_planned($ev)
        || (($ev['event_type'] ?? '') === 'обучение' && ($ev['status'] ?? '') !== 'Отменено');
}

function org_event_url(int $id = 0, string $year = '', bool $new = false, string $date = ''): string
{
    $q = ['p' => 'org', 's' => 'events'];
    if ($new) {
        $q['new'] = '1';
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $q['date'] = $date;
        }
    } elseif ($id > 0) {
        $q['id'] = (string)$id;
    }
    if (preg_match('/^(\d{4})/', $year, $m)) {
        $q['y'] = $m[1];
    }
    return './?' . http_build_query($q);
}

function org_events_dated(mysqli $db): array
{
    $notTpl = portal_not_template_slug_sql();
    $r = $db->query(
        "SELECT e.id, e.slug, e.title, e.event_type, e.starts_on, e.ends_on,
                e.starts_at, e.ends_at, e.status, e.zoom_url, e.referee_person_id,
                p.full_name AS referee_name
         FROM events e
         LEFT JOIN people p ON p.id = e.referee_person_id
         WHERE e.starts_on IS NOT NULL
           AND e.starts_on <> '0000-00-00'
           AND $notTpl
         ORDER BY e.starts_on, e.id"
    );
    $out = [];
    while ($row = $r->fetch_assoc()) {
        $out[] = portal_hydrate_event_times($row);
    }
    return $out;
}

function org_event_load(mysqli $db, int $id): ?array
{
    if ($id <= 0) {
        return null;
    }
    $st = $db->prepare(
        'SELECT e.id, e.slug, e.title, e.event_type, e.starts_on, e.ends_on,
                e.starts_at, e.ends_at, e.status, e.zoom_url, e.referee_person_id,
                p.full_name AS referee_name
         FROM events e
         LEFT JOIN people p ON p.id = e.referee_person_id
         WHERE e.id = ?'
    );
    $st->bind_param('i', $id);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    if (!$row || portal_event_is_template($row)) {
        return null;
    }
    return portal_hydrate_event_times($row);
}

function org_people_map(mysqli $db): array
{
    $out = [];
    $r = $db->query('SELECT id, full_name FROM people WHERE is_active = 1 ORDER BY full_name');
    while ($row = $r->fetch_assoc()) {
        $out[(int)$row['id']] = (string)$row['full_name'];
    }
    return $out;
}

function org_next_online_num(mysqli $db): int
{
    $max = 0;
    $r = $db->query("SELECT slug, title FROM events WHERE event_type = 'онлайн'");
    while ($row = $r->fetch_assoc()) {
        foreach ([(string)$row['slug'], (string)$row['title']] as $s) {
            if (preg_match('/online[_ ](\d+)/i', $s, $m) || preg_match('/онлайн\s*№?\s*(\d+)/ui', $s, $m)) {
                $n = (int)$m[1];
                if ($n > $max && $n < 200) {
                    $max = $n;
                }
            }
        }
    }
    return $max + 1;
}

/** @return list<array<string, mixed>> */
function org_event_duels(mysqli $db, int $eventId): array
{
    $by = portal_duels_by_event($db, [$eventId]);
    $duels = $by[$eventId] ?? [];
    $vids = portal_videos_for_events($db, [$eventId]);
    $st = $db->prepare(
        'SELECT dj.duel_id, dj.person_id, dj.college, dj.vote, p.full_name
         FROM duel_judges dj
         LEFT JOIN people p ON p.id = dj.person_id
         WHERE dj.duel_id IN (SELECT id FROM duels WHERE event_id = ?)
         ORDER BY dj.id'
    );
    $st->bind_param('i', $eventId);
    $st->execute();
    $res = $st->get_result();
    $judges = [];
    while ($row = $res->fetch_assoc()) {
        $did = (int)$row['duel_id'];
        $judges[$did][] = [
            'id' => (int)($row['person_id'] ?? 0),
            'name' => portal_name_or_empty($row['full_name'] ?? null),
            'college' => (string)($row['college'] ?? ''),
            'vote' => trim((string)($row['vote'] ?? '')),
        ];
    }
    $st->close();
    $reviews = org_event_reviews_by_duel($db, $eventId);
    foreach ($duels as &$d) {
        $did = (int)$d['id'];
        $d['judge_rows'] = $judges[$did] ?? [];
        $d['video'] = $vids['duels'][$did] ?? '';
        if (!empty($reviews[$did])) {
            $d['review'] = $reviews[$did]['url'];
            $d['review_label'] = $reviews[$did]['label'];
            $d['review_id'] = $reviews[$did]['id'];
            $d['review_title'] = $reviews[$did]['title'];
            $d['review_iso'] = $reviews[$did]['iso'];
            $d['review_situation_id'] = $reviews[$did]['situation_id'];
        }
    }
    unset($d);
    return $duels;
}

/** @return array<int, array{id: int, url: string, label: string, title: string, iso: string, situation_id: int}> */
function org_event_reviews_by_duel(mysqli $db, int $eventId): array
{
    $out = [];
    if ($eventId <= 0) {
        return $out;
    }
    $st = $db->prepare(
        "SELECT v.id, v.duel_id, v.situation_id, v.url, v.title, v.video_date
         FROM videos v
         INNER JOIN duels d ON d.id = v.duel_id
         WHERE d.event_id = ? AND v.video_type = 'Разбор'
         ORDER BY v.id"
    );
    $st->bind_param('i', $eventId);
    $st->execute();
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $did = (int)($row['duel_id'] ?? 0);
        if ($did <= 0 || isset($out[$did])) {
            continue;
        }
        $url = portal_video_url($row['url'] ?? null);
        if ($url === '') {
            continue;
        }
        $iso = trim((string)($row['video_date'] ?? ''));
        if ($iso === '' || str_starts_with($iso, '0000')) {
            $iso = '';
        }
        $title = trim((string)($row['title'] ?? ''));
        $label = function_exists('sit_review_label')
            ? sit_review_label($url, $title !== '' ? $title : null)
            : (($title === 'материал' || $title === 'разбор') ? $title : 'разбор');
        $out[$did] = [
            'id' => (int)$row['id'],
            'url' => $url,
            'label' => $label,
            'title' => $title,
            'iso' => $iso,
            'situation_id' => (int)($row['situation_id'] ?? 0),
        ];
    }
    $st->close();
    return $out;
}

function org_event_regs(mysqli $db, int $eventId): array
{
    $st = $db->prepare(
        'SELECT id, person_id, full_name, telegram, wants_play, wants_judge, wants_second, duel_type_pref, comment,
                org_no_play, org_banned_types, org_confirmed, org_attended, org_attended_comment
         FROM meeting_registrations
         WHERE event_id = ?
         ORDER BY full_name, id'
    );
    $st->bind_param('i', $eventId);
    $st->execute();
    $res = $st->get_result();
    $out = [];
    while ($row = $res->fetch_assoc()) {
        $out[] = [
            'reg_id' => (int)$row['id'],
            'id' => (int)($row['person_id'] ?? 0),
            'name' => (string)$row['full_name'],
            'telegram' => (string)($row['telegram'] ?? ''),
            'play' => (int)$row['wants_play'] === 1,
            'judge' => (int)$row['wants_judge'] === 1,
            'second' => (int)$row['wants_second'] === 1,
            'duel_type_pref' => (string)($row['duel_type_pref'] ?? ''),
            'comment' => (string)($row['comment'] ?? ''),
            'org_no_play' => (int)($row['org_no_play'] ?? 0) === 1,
            'org_banned_types' => (string)($row['org_banned_types'] ?? ''),
            'confirmed' => (int)($row['org_confirmed'] ?? 0) === 1,
            'attended' => $row['org_attended'] === null ? null : ((int)$row['org_attended'] === 1),
            'att_comment' => (string)($row['org_attended_comment'] ?? ''),
        ];
    }
    $st->close();
    return $out;
}

/** @return list<array{id: int, label: string, type: string}> */
function org_situations_list(mysqli $db): array
{
    $out = [];
    $r = $db->query(
        'SELECT id, code, num, duel_type FROM situations
         WHERE is_published = 1
         ORDER BY num IS NULL, num, code'
    );
    if (!$r) {
        return [];
    }
    while ($row = $r->fetch_assoc()) {
        $code = trim((string)$row['code']);
        $label = $code !== '' ? $code : (string)($row['num'] ?? '');
        if ($label === '') {
            continue;
        }
        $out[] = [
            'id' => (int)$row['id'],
            'label' => $label,
            'type' => (string)$row['duel_type'],
            'url' => portal_sit_bank_url($code, $label),
        ];
    }
    return $out;
}

function org_funnel_goal_text(): string
{
    return 'цель стрима достигнута';
}

/** pid => games / judged / seconded / name */
function org_people_career(mysqli $db, int $excludeEventId = 0): array
{
    $ex = $excludeEventId > 0 ? (int)$excludeEventId : 0;
    $out = [];
    $r = $db->query('SELECT id, full_name FROM people');
    while ($row = $r->fetch_assoc()) {
        $out[(int)$row['id']] = [
            'name' => (string)$row['full_name'],
            'games' => 0,
            'judged' => 0,
            'seconded' => 0,
            'last_judged' => '',
            'last_played' => '',
            'last_seconded' => '',
        ];
    }
    $playedCond = portal_duel_played_sql('d', 'e');
    $r = $db->query(
        'SELECT d.duel_type, d.player1_id, d.player2_id, d.second1_id, d.second2_id
         FROM duels d JOIN events e ON e.id = d.event_id
         WHERE LTRIM(COALESCE(e.title, \'\')) NOT LIKE \'ТЕСТ БД%\'
           AND ' . $playedCond
        . ($ex > 0 ? ' AND d.event_id <> ' . $ex : '')
    );
    while ($row = $r->fetch_assoc()) {
        $paired = ($row['duel_type'] ?? '') === 'парный';
        $classic = ($row['duel_type'] ?? '') === 'классика';
        foreach (['player1_id', 'player2_id'] as $k) {
            $pid = (int)($row[$k] ?? 0);
            if ($pid && isset($out[$pid])) {
                $out[$pid]['games']++;
            }
        }
        if ($paired) {
            foreach (['second1_id', 'second2_id'] as $k) {
                $pid = (int)($row[$k] ?? 0);
                if ($pid && isset($out[$pid])) {
                    $out[$pid]['games']++;
                }
            }
        }
        if ($classic) {
            foreach (['second1_id', 'second2_id'] as $k) {
                $pid = (int)($row[$k] ?? 0);
                if ($pid && isset($out[$pid])) {
                    $out[$pid]['seconded']++;
                }
            }
        }
    }
    $r = $db->query(
        'SELECT dj.person_id,
                COUNT(*) AS judged,
                MAX(CASE
                    WHEN d.duel_date IS NOT NULL AND d.duel_date <> \'0000-00-00\' THEN d.duel_date
                    ELSE e.starts_on
                END) AS last_judged
         FROM duel_judges dj
         JOIN duels d ON d.id = dj.duel_id
         JOIN events e ON e.id = d.event_id
         WHERE dj.person_id IS NOT NULL
           AND LTRIM(COALESCE(e.title, \'\')) NOT LIKE \'ТЕСТ БД%\'
           AND ' . $playedCond
        . ($ex > 0 ? ' AND d.event_id <> ' . $ex : '') . '
         GROUP BY dj.person_id'
    );
    while ($row = $r->fetch_assoc()) {
        $pid = (int)$row['person_id'];
        if (!isset($out[$pid])) {
            continue;
        }
        $out[$pid]['judged'] = (int)$row['judged'];
        $d = (string)($row['last_judged'] ?? '');
        if ($d !== '' && $d !== '0000-00-00') {
            $out[$pid]['last_judged'] = $d;
        }
    }
    $r = $db->query(
        'SELECT pid,
                MAX(play_on) AS last_played
         FROM (
            SELECT d.player1_id AS pid,
                   CASE
                       WHEN d.duel_date IS NOT NULL AND d.duel_date <> \'0000-00-00\' THEN d.duel_date
                       ELSE e.starts_on
                   END AS play_on
            FROM duels d
            JOIN events e ON e.id = d.event_id
            WHERE d.player1_id IS NOT NULL
              AND LTRIM(COALESCE(e.title, \'\')) NOT LIKE \'ТЕСТ БД%\'
              AND ' . $playedCond . ($ex > 0 ? ' AND d.event_id <> ' . $ex : '') . '
            UNION ALL
            SELECT d.player2_id AS pid,
                   CASE
                       WHEN d.duel_date IS NOT NULL AND d.duel_date <> \'0000-00-00\' THEN d.duel_date
                       ELSE e.starts_on
                   END AS play_on
            FROM duels d
            JOIN events e ON e.id = d.event_id
            WHERE d.player2_id IS NOT NULL
              AND LTRIM(COALESCE(e.title, \'\')) NOT LIKE \'ТЕСТ БД%\'
              AND ' . $playedCond . ($ex > 0 ? ' AND d.event_id <> ' . $ex : '') . '
         ) t
         WHERE pid IS NOT NULL
         GROUP BY pid'
    );
    while ($row = $r->fetch_assoc()) {
        $pid = (int)$row['pid'];
        if (!isset($out[$pid])) {
            continue;
        }
        $d = (string)($row['last_played'] ?? '');
        if ($d !== '' && $d !== '0000-00-00') {
            $out[$pid]['last_played'] = $d;
        }
    }
    $r = $db->query(
        'SELECT pid,
                MAX(sec_on) AS last_seconded
         FROM (
            SELECT d.second1_id AS pid,
                   CASE
                       WHEN d.duel_date IS NOT NULL AND d.duel_date <> \'0000-00-00\' THEN d.duel_date
                       ELSE e.starts_on
                   END AS sec_on
            FROM duels d
            JOIN events e ON e.id = d.event_id
            WHERE d.second1_id IS NOT NULL
              AND LTRIM(COALESCE(e.title, \'\')) NOT LIKE \'ТЕСТ БД%\'
              AND ' . $playedCond . ($ex > 0 ? ' AND d.event_id <> ' . $ex : '') . '
            UNION ALL
            SELECT d.second2_id AS pid,
                   CASE
                       WHEN d.duel_date IS NOT NULL AND d.duel_date <> \'0000-00-00\' THEN d.duel_date
                       ELSE e.starts_on
                   END AS sec_on
            FROM duels d
            JOIN events e ON e.id = d.event_id
            WHERE d.second2_id IS NOT NULL
              AND LTRIM(COALESCE(e.title, \'\')) NOT LIKE \'ТЕСТ БД%\'
              AND ' . $playedCond . ($ex > 0 ? ' AND d.event_id <> ' . $ex : '') . '
         ) t
         WHERE pid IS NOT NULL
         GROUP BY pid'
    );
    while ($row = $r->fetch_assoc()) {
        $pid = (int)$row['pid'];
        if (!isset($out[$pid])) {
            continue;
        }
        $d = (string)($row['last_seconded'] ?? '');
        if ($d !== '' && $d !== '0000-00-00') {
            $out[$pid]['last_seconded'] = $d;
        }
    }
    return $out;
}

/** Более поздняя из двух дат YYYY-MM-DD; пустые и 0000-00-00 игнорируются. */
function org_later_date(string $a, string $b): string
{
    $a = ($a !== '' && $a !== '0000-00-00') ? $a : '';
    $b = ($b !== '' && $b !== '0000-00-00') ? $b : '';
    if ($a === '') {
        return $b;
    }
    if ($b === '') {
        return $a;
    }
    return $a >= $b ? $a : $b;
}

/** Позже из судейства, игры и секундантства. */
function org_last_activity(array $c): string
{
    return org_later_date(
        org_later_date((string)($c['last_judged'] ?? ''), (string)($c['last_played'] ?? '')),
        (string)($c['last_seconded'] ?? '')
    );
}

function org_funnel_stage(array $c): string
{
    $g = (int)$c['games'];
    if ($g >= 3 && (int)$c['seconded'] > 0) {
        return 'наставник';
    }
    if ($g >= 3) {
        return 'профи';
    }
    if ($g === 2) {
        return 'сыграл 2';
    }
    if ($g === 1) {
        return 'сыграл 1';
    }
    if ((int)$c['judged'] > 0) {
        return 'посудил';
    }
    return 'без игр';
}

/**
 * Движение участников мероприятия по воронке стрима: сколько на этом событии
 * впервые посудят / впервые сыграют / достигнут цели стрима (3 игры) / станут наставниками.
 * Считаем по всем участникам сетки: игроки, секунданты (парный) и судьи.
 */
function org_event_metrics(mysqli $db, array $duels, array $career, array $regs = []): array
{
    $players = [];
    $seconds = [];
    $judges = [];
    $judgeNames = [];
    foreach ($duels as $d) {
        foreach (['p1_id', 'p2_id'] as $k) {
            $pid = (int)($d[$k] ?? 0);
            if ($pid > 0) {
                $players[$pid] = true;
            }
        }
        if (($d['type'] ?? '') === 'парный') {
            foreach (['s1_id', 's2_id'] as $k) {
                $pid = (int)($d[$k] ?? 0);
                if ($pid > 0) {
                    $seconds[$pid] = true;
                }
            }
        }
        foreach (($d['judge_rows'] ?? []) as $j) {
            $pid = (int)($j['id'] ?? 0);
            if ($pid > 0) {
                $judges[$pid] = true;
                if (!isset($judgeNames[$pid])) {
                    $judgeNames[$pid] = trim((string)($j['name'] ?? ''));
                }
            }
        }
    }

    $onGrid = count($players + $seconds + $judges);

    // Кандидаты в судьи: назначенные на сетке + заявившиеся на событие (заявки).
    $regNames = [];
    foreach ($regs as $r) {
        $pid = (int)($r['id'] ?? 0);
        if ($pid <= 0) {
            continue;
        }
        if (!empty($r['judge'])) {
            $judges[$pid] = true;
            $regNames[$pid] = trim((string)($r['name'] ?? ''));
        }
    }

    $nameOf = static function (int $pid) use ($career, $judgeNames, $regNames): string {
        $n = trim((string)($career[$pid]['name'] ?? ''));
        if ($n === '') {
            $n = (string)($judgeNames[$pid] ?? '');
        }
        if ($n === '') {
            $n = (string)($regNames[$pid] ?? '');
        }
        return $n;
    };

    $playFirst = [];
    $playSecond = [];
    $reachGoal = [];
    foreach (array_keys($players) as $pid) {
        $g = (int)($career[$pid]['games'] ?? 0);
        if ($g === 0) {
            $playFirst[$pid] = $nameOf($pid);
        }
        if ($g === 1) {
            $playSecond[$pid] = $nameOf($pid);
        }
        if ($g === 2) {
            $reachGoal[$pid] = $nameOf($pid);
        }
    }

    $judgeFirst = [];
    foreach (array_keys($judges) as $pid) {
        if ((int)($career[$pid]['judged'] ?? 0) === 0) {
            $judgeFirst[$pid] = $nameOf($pid);
        }
    }

    $becomeMentor = [];
    $staff = $players + $seconds;
    foreach (array_keys($staff) as $pid) {
        $c = $career[$pid] ?? ['games' => 0, 'judged' => 0, 'seconded' => 0];
        $g = (int)($c['games'] ?? 0);
        $sec = (int)($c['seconded'] ?? 0);
        $before = $g >= 3 && $sec > 0;
        $gAfter = $g + (isset($players[$pid]) ? 1 : 0);
        $secAfter = $sec + (isset($seconds[$pid]) ? 1 : 0);
        $after = $gAfter >= 3 && $secAfter > 0;
        if (!$before && $after) {
            $becomeMentor[$pid] = $nameOf($pid);
        }
    }

    return [
        'on_grid' => $onGrid,
        'judge_first' => count($judgeFirst),
        'play_first' => count($playFirst),
        'play_second' => count($playSecond),
        'reach_goal' => count($reachGoal),
        'become_mentor' => count($becomeMentor),
        'judge_first_names' => array_values(array_filter($judgeFirst)),
        'play_first_names' => array_values(array_filter($playFirst)),
        'play_second_names' => array_values(array_filter($playSecond)),
        'reach_goal_names' => array_values(array_filter($reachGoal)),
        'become_mentor_names' => array_values(array_filter($becomeMentor)),
    ];
}

/** id людей с данной степенью вовлечения в круге стрима. $prefix — «Куратор» и «Кураторы от я-ИТ-ы». */
function org_stream_involvement_ids(mysqli $db, string $involvement, bool $prefix = false): array
{
    $sql = 'SELECT cm.person_id FROM circle_memberships cm
            JOIN circles c ON c.id = cm.circle_id
            WHERE c.title = ? AND '
        . ($prefix ? 'cm.involvement LIKE CONCAT(?, \'%\')' : 'cm.involvement = ?');
    $st = $db->prepare($sql);
    $title = STREAM_CIRCLE;
    $st->bind_param('ss', $title, $involvement);
    $st->execute();
    $ids = [];
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $ids[(int)$row['person_id']] = true;
    }
    $st->close();
    return $ids;
}

/** id людей в круге с заданным title (независимо от involvement). */
function org_circle_member_ids(mysqli $db, string $title): array
{
    $sql = 'SELECT cm.person_id FROM circle_memberships cm
            JOIN circles c ON c.id = cm.circle_id
            WHERE c.title = ?';
    $st = $db->prepare($sql);
    $st->bind_param('s', $title);
    $st->execute();
    $ids = [];
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $ids[(int)$row['person_id']] = true;
    }
    $st->close();
    return $ids;
}

/**
 * id => ФИО для поля referee_person_id.
 * Обычные мероприятия — круг стрима с вовлечённостью «Арбитр».
 * Обучение — любой организатор круга стрима (вовлечённость «Организатор»).
 * $keepId — уже выбранный, даже если членство сняли.
 */
function org_referees_map(mysqli $db, int $keepId = 0, string $eventType = ''): array
{
    $involvement = $eventType === 'обучение' ? 'Организатор' : 'Арбитр';
    $ids = org_stream_involvement_ids($db, $involvement);
    if ($keepId > 0) {
        $ids[$keepId] = true;
    }
    if (!$ids) {
        return [];
    }
    $in = implode(',', array_map('intval', array_keys($ids)));
    $out = [];
    $r = $db->query("SELECT id, full_name FROM people WHERE id IN ($in) ORDER BY full_name");
    if ($r) {
        while ($row = $r->fetch_assoc()) {
            $out[(int)$row['id']] = (string)$row['full_name'];
        }
    }
    return $out;
}

function org_norm_referee_id(mysqli $db, int $ref, int $keepId = 0, string $eventType = ''): int
{
    if ($ref <= 0) {
        return 0;
    }
    $ok = org_referees_map($db, $keepId, $eventType);
    return isset($ok[$ref]) ? $ref : 0;
}

/** Ключи РольОрганизатора на карточке. Остальные записи event_organizers не трогаем. */
function org_event_staff_role_keys(): array
{
    return [
        'планированиеМероприятия',
        'работаСНовичками',
        'показывалЧасы',
        'велЗапись',
        'настраивалКомнатыZoom',
        'экспертныйКомментарий',
        'обработкаВидео',
        'подведениеИтогов',
    ];
}

function org_event_referee_label(string $eventType = ''): string
{
    return $eventType === 'обучение' ? 'Ведущий' : 'Арбитр';
}

/**
 * Ячейки таблицы слева направо, затем вниз.
 * Арбитр/Ведущий — events.referee_person_id, не значение enum.
 *
 * @return list<array{kind: string, key?: string, label?: string, need?: bool}>
 */
function org_event_staff_cells(string $eventType = ''): array
{
    $refLabel = org_event_referee_label($eventType);
    return [
        ['kind' => 'role', 'key' => 'планированиеМероприятия', 'label' => 'Планирование мероприятия', 'need' => true],
        ['kind' => 'role', 'key' => 'работаСНовичками', 'label' => 'Работа с новичками', 'need' => false],
        ['kind' => 'referee', 'key' => 'referee', 'label' => $refLabel, 'need' => $eventType !== 'обучение'],
        ['kind' => 'role', 'key' => 'показывалЧасы', 'label' => 'Демонстрация часов', 'need' => false],
        ['kind' => 'role', 'key' => 'велЗапись', 'label' => 'Запись', 'need' => false],
        ['kind' => 'role', 'key' => 'настраивалКомнатыZoom', 'label' => 'Zoom', 'need' => false],
        ['kind' => 'role', 'key' => 'экспертныйКомментарий', 'label' => 'Экспертный комментарий', 'need' => false],
        ['kind' => 'role', 'key' => 'обработкаВидео', 'label' => 'Обработка видео', 'need' => false],
        ['kind' => 'role', 'key' => 'подведениеИтогов', 'label' => 'Подготовка итогов и закрытие', 'need' => false],
        ['kind' => 'empty'],
    ];
}

/** id => ФИО с участием «Организатор» в круге стрима. $keepIds — уже назначенные на встречу. */
function org_event_orgs_map(mysqli $db, array $keepIds = []): array
{
    $ids = org_stream_involvement_ids($db, 'Организатор');
    foreach ($keepIds as $id) {
        $id = (int)$id;
        if ($id > 0) {
            $ids[$id] = true;
        }
    }
    if (!$ids) {
        return [];
    }
    $in = implode(',', array_map('intval', array_keys($ids)));
    $out = [];
    $r = $db->query("SELECT id, full_name FROM people WHERE id IN ($in) ORDER BY full_name");
    if ($r) {
        while ($row = $r->fetch_assoc()) {
            $out[(int)$row['id']] = (string)$row['full_name'];
        }
    }
    return $out;
}

/** @return array<string, int> роль => один person_id (при нескольких записях — первая по id) */
function org_event_role_person_map(mysqli $db, int $eventId): array
{
    if ($eventId <= 0) {
        return [];
    }
    $st = $db->prepare(
        'SELECT role, person_id FROM event_organizers WHERE event_id = ? ORDER BY id'
    );
    $st->bind_param('i', $eventId);
    $st->execute();
    $out = [];
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $role = (string)($row['role'] ?? '');
        $pid = (int)($row['person_id'] ?? 0);
        if ($role !== '' && $pid > 0 && !isset($out[$role])) {
            $out[$role] = $pid;
        }
    }
    $st->close();
    return $out;
}

/** @return array<string, int> */
function org_norm_staff_roles(mysqli $db, mixed $raw, array $keepByRole = []): array
{
    if (!is_array($raw)) {
        $raw = [];
    }
    $keepIds = [];
    foreach ($keepByRole as $pid) {
        $pid = (int)$pid;
        if ($pid > 0) {
            $keepIds[] = $pid;
        }
    }
    $ok = org_event_orgs_map($db, $keepIds);
    $out = [];
    foreach (org_event_staff_role_keys() as $role) {
        $pid = (int)($raw[$role] ?? 0);
        $out[$role] = ($pid > 0 && isset($ok[$pid])) ? $pid : 0;
    }
    return $out;
}

/** Пишет только роли таблицы. Чужие титровые записи (не из org_event_staff_role_keys) не трогает. */
function org_event_staff_roles_sync(mysqli $db, int $eventId, array $roleToPerson): void
{
    if ($eventId <= 0) {
        return;
    }
    $keys = org_event_staff_role_keys();
    $want = [];
    foreach ($keys as $role) {
        $pid = (int)($roleToPerson[$role] ?? 0);
        $want[$role] = $pid > 0 ? $pid : 0;
    }
    $have = [];
    $st = $db->prepare(
        'SELECT id, role, person_id FROM event_organizers WHERE event_id = ? ORDER BY id'
    );
    $st->bind_param('i', $eventId);
    $st->execute();
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $role = (string)($row['role'] ?? '');
        if (!in_array($role, $keys, true)) {
            continue;
        }
        $have[$role][] = [
            'id' => (int)$row['id'],
            'person_id' => (int)$row['person_id'],
        ];
    }
    $st->close();
    $del = $db->prepare('DELETE FROM event_organizers WHERE id = ? AND event_id = ?');
    $ins = $db->prepare('INSERT INTO event_organizers (event_id, person_id, role) VALUES (?, ?, ?)');
    foreach ($keys as $role) {
        $wantPid = $want[$role];
        $kept = false;
        foreach ($have[$role] ?? [] as $row) {
            if ($wantPid > 0 && (int)$row['person_id'] === $wantPid && !$kept) {
                $kept = true;
                continue;
            }
            $rid = (int)$row['id'];
            $del->bind_param('ii', $rid, $eventId);
            $del->execute();
        }
        if ($wantPid > 0 && !$kept) {
            $ins->bind_param('iis', $eventId, $wantPid, $role);
            $ins->execute();
        }
    }
    $del->close();
    $ins->close();
}

function org_need_fill_class(bool $empty): string
{
    return $empty ? ' class="org-need-fill"' : '';
}

/** Гости ФУБ: членство в круге «ФУБ» и нет членства в круге стрима. Кто в обоих кругах — не гости. */
function org_fub_guest_ids(mysqli $db): array
{
    $sql = 'SELECT cm.person_id FROM circle_memberships cm
            JOIN circles c ON c.id = cm.circle_id
            WHERE c.title = ?
              AND cm.person_id NOT IN (
                  SELECT cm2.person_id FROM circle_memberships cm2
                  JOIN circles c2 ON c2.id = cm2.circle_id
                  WHERE c2.title = ?
              )';
    $st = $db->prepare($sql);
    $fub = FUB_CIRCLE;
    $stream = STREAM_CIRCLE;
    $st->bind_param('ss', $fub, $stream);
    $st->execute();
    $ids = [];
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $ids[(int)$row['person_id']] = true;
    }
    $st->close();
    return $ids;
}

/** Члены круга «Партнеры» (любая степень, в т.ч. «1С партнер»). */
function org_partner_ids(mysqli $db): array
{
    $sql = 'SELECT cm.person_id FROM circle_memberships cm
            JOIN circles c ON c.id = cm.circle_id
            WHERE c.title = ?';
    $st = $db->prepare($sql);
    $title = PARTNERS_CIRCLE;
    $st->bind_param('s', $title);
    $st->execute();
    $ids = [];
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $ids[(int)$row['person_id']] = true;
    }
    $st->close();
    return $ids;
}

/** Орг-роли круга сообщества «я-ИТ-ы»: правление и прочие, не «участник чата телеграмм». */
function org_community_org_ids(mysqli $db): array
{
    $sql = 'SELECT cm.person_id FROM circle_memberships cm
            JOIN circles c ON c.id = cm.circle_id
            WHERE c.title = ?
              AND cm.involvement <> ?';
    $st = $db->prepare($sql);
    $title = COMMUNITY_CIRCLE;
    $skip = 'участник чата телеграмм';
    $st->bind_param('ss', $title, $skip);
    $st->execute();
    $ids = [];
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $ids[(int)$row['person_id']] = true;
    }
    $st->close();
    return $ids;
}

function org_attract(mysqli $db, array $career, array $duels, array $regs, int $limit = 12): array
{
    $skipOrg = org_stream_involvement_ids($db, 'Организатор');
    $aOnly = org_circle_member_ids($db, COMMUNITY_A_CIRCLE);
    $busy = [];
    foreach ($duels as $d) {
        foreach (['p1_id', 'p2_id', 's1_id', 's2_id'] as $k) {
            $pid = (int)($d[$k] ?? 0);
            if ($pid > 0) {
                $busy[$pid] = true;
            }
        }
    }
    foreach ($regs as $r) {
        $pid = (int)($r['id'] ?? 0);
        if ($pid > 0) {
            $busy[$pid] = true;
        }
    }
    $scored = [];
    foreach ($career as $pid => $c) {
        if (isset($busy[$pid]) || isset($skipOrg[(int)$pid]) || !isset($aOnly[$pid])) {
            continue;
        }
        $g = (int)$c['games'];
        $j = (int)$c['judged'];
        if ($g >= 3) {
            continue;
        }
        $score = 0;
        $why = '';
        if ($g === 0 && $j > 0) {
            $score = 30;
            $why = 'посудил, ещё не играл';
        } elseif ($g === 2) {
            $score = 25;
            $why = '2 игры — до тройки одна';
        } elseif ($g === 1) {
            $score = 20;
            $why = '1 игра';
        } elseif ($g === 0 && $j === 0) {
            continue;
        }
        $last = (string)($c['last_judged'] ?? '');
        if ($why !== '' && $last !== '') {
            $why .= ' · ' . org_fmt_ru_date($last);
        }
        $scored[] = [
            'id' => $pid,
            'name' => $c['name'],
            'why' => $why,
            'games' => $g,
            'score' => $score,
            'last_judged' => $last,
        ];
    }
    usort($scored, static function ($a, $b) {
        $da = (string)($a['last_judged'] ?? '');
        $dbd = (string)($b['last_judged'] ?? '');
        if ($da !== $dbd) {
            return $dbd <=> $da;
        }
        return $b['score'] <=> $a['score'] ?: strcmp($a['name'], $b['name']);
    });
    return array_slice($scored, 0, $limit);
}

/** Недавно (судейство / игра / секундантство за 90 дней) → орги без игр → давно.
 *  Внутри недавно и давно: 1-я → 2-я → 3-я игра. Секундантство только для яруса, на экран не идёт.
 *  Стримовых оргов, гостей ФУБ без стрима и партнёров не рекомендуем. */
function org_play_recs(mysqli $db, array $career, array $duels, array $regs): array
{
    $skipStreamOrg = org_stream_involvement_ids($db, 'Организатор');
    $communityOrgs = org_community_org_ids($db);
    $skipPartners = org_partner_ids($db);
    $skipFubGuests = org_fub_guest_ids($db);
    $curators = org_stream_involvement_ids($db, 'Куратор', true);
    $aOnly = org_circle_member_ids($db, COMMUNITY_A_CIRCLE);
    $busy = [];
    foreach ($duels as $d) {
        foreach (['p1_id', 'p2_id', 's1_id', 's2_id'] as $k) {
            $pid = (int)($d[$k] ?? 0);
            if ($pid > 0) {
                $busy[$pid] = true;
            }
        }
    }
    $applied = [];
    foreach ($regs as $r) {
        $pid = (int)($r['id'] ?? 0);
        if ($pid > 0) {
            $applied[$pid] = true;
        }
    }
    $today = portal_today_iso();
    $cutoff = $today !== ''
        ? date('Y-m-d', strtotime($today . ' -90 days'))
        : date('Y-m-d', strtotime('-90 days'));
    $fresh = [];
    $older = [];
    $orgs = [];
    foreach ($career as $pid => $c) {
        $pid = (int)$pid;
        if (isset($busy[$pid]) || isset($skipPartners[$pid]) || isset($skipFubGuests[$pid]) || isset($skipStreamOrg[$pid]) || !isset($aOnly[$pid])) {
            continue;
        }
        $g = (int)$c['games'];
        $j = (int)$c['judged'];
        $isCurator = isset($curators[$pid]);
        $isCommunityOrg = isset($communityOrgs[$pid]);
        $last = org_last_activity($c);
        if ($isCommunityOrg && $g === 0) {
            $orgs[] = [
                'id' => $pid,
                'name' => (string)$c['name'],
                'need' => 1,
                'last_at' => $last,
                'applied' => isset($applied[$pid]),
                'curator' => $isCurator,
            ];
            continue;
        }
        if ($g === 0 && ($j > 0 || $isCurator)) {
            $need = 1;
        } elseif ($g === 1) {
            $need = 2;
        } elseif ($g === 2) {
            $need = 3;
        } else {
            continue;
        }
        $row = [
            'id' => $pid,
            'name' => (string)$c['name'],
            'need' => $need,
            'last_at' => $last,
            'applied' => isset($applied[$pid]),
            'curator' => $isCurator,
        ];
        if ($last !== '' && $last >= $cutoff) {
            $fresh[] = $row;
        } else {
            $older[] = $row;
        }
    }
    $byNeedThenFresh = static function ($a, $b) {
        if ($a['need'] !== $b['need']) {
            return $a['need'] <=> $b['need'];
        }
        $da = (string)($a['last_at'] ?? '');
        $dbd = (string)($b['last_at'] ?? '');
        if ($da !== $dbd) {
            return $dbd <=> $da;
        }
        return strcmp((string)$a['name'], (string)$b['name']);
    };
    $byNeedCuratorThenFresh = static function ($a, $b) use ($byNeedThenFresh) {
        if ($a['need'] !== $b['need']) {
            return $a['need'] <=> $b['need'];
        }
        if ((int)$a['need'] === 1) {
            $ca = !empty($a['curator']);
            $cb = !empty($b['curator']);
            if ($ca !== $cb) {
                return $cb <=> $ca;
            }
        }
        return $byNeedThenFresh($a, $b);
    };
    usort($fresh, $byNeedCuratorThenFresh);
    usort($older, $byNeedCuratorThenFresh);
    usort($orgs, $byNeedThenFresh);
    return ['fresh' => $fresh, 'orgs' => $orgs, 'older' => $older];
}

function org_fmt_ru_date(string $iso): string
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $iso, $m)) {
        return $iso;
    }
    return $m[3] . '.' . $m[2] . '.' . $m[1];
}

/** @return array{text: string, kind: string} */
function org_star_rec(array $c, array $reg): array
{
    $stage = org_funnel_stage($c);
    if ($stage === 'наставник') {
        return ['text' => org_funnel_goal_text(), 'kind' => 'done'];
    }
    if ($stage === 'профи') {
        return ['text' => 'Стать наставником', 'kind' => 'next'];
    }
    $g = (int)($c['games'] ?? 0);
    $j = (int)($c['judged'] ?? 0);
    if ($g === 0 && $j > 0) {
        return ['text' => 'судил(а), игр нет — предложить игроком', 'kind' => 'next'];
    }
    if ($g === 0 && !empty($reg['play'])) {
        return ['text' => 'ещё не играл(а) — предложить первую игру', 'kind' => 'next'];
    }
    if ($g === 1) {
        return ['text' => '1 игра — сыграть вторую', 'kind' => 'next'];
    }
    if ($g === 2) {
        return ['text' => '2 игры — сыграть третью', 'kind' => 'next'];
    }
    if ($g === 0 && !empty($reg['judge'])) {
        return ['text' => 'хочет судить, игр нет — сначала судейство, потом игроком', 'kind' => 'next'];
    }
    return ['text' => '', 'kind' => ''];
}

function org_reg_heat(array $c): int
{
    $g = (int)($c['games'] ?? 0);
    $j = (int)($c['judged'] ?? 0);
    if ($g === 0 && $j > 0) {
        return 40;
    }
    if ($g === 2) {
        return 30;
    }
    if ($g === 1) {
        return 20;
    }
    if ($g === 0) {
        return 10;
    }
    return 0;
}

function org_norm_date(?string $raw): ?string
{
    $raw = trim((string)$raw);
    if ($raw === '') {
        return null;
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) && $raw !== '0000-00-00') {
        return $raw;
    }
    return null;
}

function org_norm_time(?string $raw): ?string
{
    $t = portal_norm_clock($raw);
    return $t !== '' ? $t . ':00' : null;
}

function org_events_handle_post(mysqli $db): array
{
    if (!portal_csrf_ok((string)($_POST['csrf'] ?? ''))) {
        return ['error' => 'Сессия устарела, обновите страницу'];
    }
    $action = (string)($_POST['action'] ?? '');
    if ($action === 'org_event_create') {
        return org_event_create($db);
    }
    if ($action === 'org_event_save') {
        return org_event_save($db);
    }
    if ($action === 'org_event_restore') {
        return org_event_restore($db);
    }
    if ($action === 'org_event_test_create') {
        return org_event_test_create($db);
    }
    if ($action === 'org_event_test_delete') {
        return org_event_test_delete($db);
    }
    if ($action === 'org_slot_add') {
        return org_slot_add($db);
    }
    if ($action === 'org_slot_delete') {
        return org_slot_delete($db);
    }
    if ($action === 'org_slots_save') {
        return org_slots_save($db);
    }
    if ($action === 'org_sit_labels_save') {
        return org_sit_labels_save($db);
    }
    if ($action === 'org_reg_add') {
        return org_reg_add($db);
    }
    if ($action === 'org_outreach_add') {
        return org_outreach_add_from_event($db);
    }
    if ($action === 'org_outreach_remove') {
        return org_outreach_remove_from_event($db);
    }
    if ($action === 'org_reg_remove') {
        return org_reg_remove($db);
    }
    if ($action === 'org_reg_update') {
        return org_reg_update($db);
    }
    if ($action === 'org_reg_confirm') {
        return org_reg_confirm($db);
    }
    if ($action === 'org_reg_attendance') {
        return org_reg_attendance($db);
    }
    if ($action === 'org_gen_pairs') {
        return org_gen_pairs($db);
    }
    if ($action === 'org_slots_clear') {
        return org_slots_clear($db);
    }
    if ($action === 'org_review_save' || $action === 'org_review_delete') {
        require_once __DIR__ . '/org_situations.php';
        return $action === 'org_review_save' ? org_review_save($db) : org_review_delete($db);
    }
    return ['error' => 'Неизвестное действие'];
}

function org_event_create(mysqli $db): array
{
    $title = trim((string)($_POST['title'] ?? ''));
    $type = (string)($_POST['event_type'] ?? 'онлайн');
    if (!in_array($type, org_event_types(), true)) {
        return ['error' => 'Неверный тип'];
    }
    if ($title === '') {
        if ($type === 'обучение') {
            $title = 'Обучение';
        } else {
            $n = org_next_online_num($db);
            $title = $type === 'онлайн' ? ('Онлайн ' . $n) : 'Мероприятие';
        }
    }
    $slug = trim((string)($_POST['slug'] ?? ''));
    if ($slug === '' && $type === 'онлайн' && preg_match('/(\d+)/', $title, $m)) {
        $slug = 'online_' . (int)$m[1];
    }
    if ($slug !== '' && org_slug_taken($db, $slug, 0)) {
        return ['error' => 'Ярлык уже занят'];
    }
    $status = (string)($_POST['status'] ?? 'Запланировано');
    if (!in_array($status, org_event_statuses(), true)) {
        $status = 'Запланировано';
    }
    $start = org_norm_date($_POST['starts_on'] ?? null);
    $end = org_norm_date($_POST['ends_on'] ?? null) ?? $start;
    $stAt = org_norm_time($_POST['starts_at'] ?? null);
    $enAt = org_norm_time($_POST['ends_at'] ?? null);
    if ($type === 'онлайн' && $start) {
        $stAt = $stAt ?? '11:00:00';
        $enAt = $enAt ?? '13:30:00';
    }
    $zoom = trim((string)($_POST['zoom_url'] ?? '')) ?: null;
    $ref = org_norm_referee_id($db, (int)($_POST['referee_person_id'] ?? 0), 0, $type);
    $slugVal = $slug !== '' ? $slug : null;
    $refBind = $ref > 0 ? $ref : 0;
    $st = $db->prepare(
        'INSERT INTO events (slug, title, event_type, starts_on, ends_on, starts_at, ends_at, status, zoom_url, referee_person_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, 0))'
    );
    $st->bind_param(
        'sssssssssi',
        $slugVal,
        $title,
        $type,
        $start,
        $end,
        $stAt,
        $enAt,
        $status,
        $zoom,
        $refBind
    );
    $st->execute();
    $id = (int)$db->insert_id;
    $st->close();
    if ($type === 'онлайн') {
        org_insert_empty_slots($db, $id, $start, 5);
    }
    org_event_staff_roles_sync($db, $id, org_norm_staff_roles($db, $_POST['org_role'] ?? []));
    $_SESSION['org_flash'] = 'Мероприятие создано';
    return ['redirect' => org_event_url($id)];
}

function org_insert_empty_slots(mysqli $db, int $eventId, ?string $date, int $count, int $fromOrder = 1): void
{
    $type = 'классика';
    $prep = 'обычный';
    $mins = 5;
    $st = $db->prepare(
        'INSERT INTO duels (event_id, sort_order, duel_date, duel_type, prep_mode, round_minutes)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    for ($i = 0; $i < $count; $i++) {
        $order = $fromOrder + $i;
        $st->bind_param('iisssi', $eventId, $order, $date, $type, $prep, $mins);
        $st->execute();
    }
    $st->close();
}

function org_slug_taken(mysqli $db, string $slug, int $exceptId): bool
{
    $st = $db->prepare('SELECT id FROM events WHERE slug = ? AND id <> ? LIMIT 1');
    $st->bind_param('si', $slug, $exceptId);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    return (bool)$row;
}

function org_event_save(mysqli $db): array
{
    $id = (int)($_POST['event_id'] ?? 0);
    $ev = org_event_load($db, $id);
    if (!$ev) {
        return ['error' => 'Мероприятие не найдено'];
    }
    if (!org_event_is_planned($ev)) {
        return ['error' => 'Прошедшее мероприятие не редактируется'];
    }
    $title = trim((string)($_POST['title'] ?? ''));
    if ($title === '') {
        return ['error' => 'Нужно название'];
    }
    $type = (string)($_POST['event_type'] ?? '');
    if (!in_array($type, org_event_types(), true)) {
        return ['error' => 'Неверный тип'];
    }
    $status = (string)($_POST['status'] ?? '');
    if (!in_array($status, org_event_statuses(), true)) {
        return ['error' => 'Неверный статус'];
    }
    $slug = trim((string)($_POST['slug'] ?? ''));
    if ($slug !== '' && org_slug_taken($db, $slug, $id)) {
        return ['error' => 'Ярлык уже занят'];
    }
    $start = org_norm_date($_POST['starts_on'] ?? null);
    $end = org_norm_date($_POST['ends_on'] ?? null) ?? $start;
    $stAt = org_norm_time($_POST['starts_at'] ?? null);
    $enAt = org_norm_time($_POST['ends_at'] ?? null);
    $zoom = trim((string)($_POST['zoom_url'] ?? '')) ?: null;
    $ref = org_norm_referee_id($db, (int)($_POST['referee_person_id'] ?? 0), (int)($ev['referee_person_id'] ?? 0), $type);
    $refBind = $ref > 0 ? $ref : 0;
    $slugVal = $slug !== '' ? $slug : null;
    $st = $db->prepare(
        'UPDATE events SET slug=?, title=?, event_type=?, starts_on=?, ends_on=?,
                starts_at=?, ends_at=?, status=?, zoom_url=?, referee_person_id=NULLIF(?, 0)
         WHERE id=?'
    );
    $st->bind_param(
        'sssssssssii',
        $slugVal,
        $title,
        $type,
        $start,
        $end,
        $stAt,
        $enAt,
        $status,
        $zoom,
        $refBind,
        $id
    );
    $st->execute();
    $st->close();
    $keepRoles = org_event_role_person_map($db, $id);
    org_event_staff_roles_sync(
        $db,
        $id,
        org_norm_staff_roles($db, $_POST['org_role'] ?? [], $keepRoles)
    );
    $_SESSION['org_flash'] = 'Сохранено';
    return ['redirect' => org_event_url($id)];
}

function org_event_restore(mysqli $db): array
{
    $id = (int)($_POST['event_id'] ?? 0);
    $ev = org_event_load($db, $id);
    if (!$ev) {
        return ['error' => 'Мероприятие не найдено'];
    }
    if (($ev['status'] ?? '') !== 'Отменено') {
        return ['error' => 'Мероприятие не отменено'];
    }
    $st = $db->prepare("UPDATE events SET status = 'Запланировано' WHERE id = ?");
    $st->bind_param('i', $id);
    $st->execute();
    $st->close();
    $_SESSION['org_flash'] = 'Мероприятие восстановлено';
    return ['redirect' => org_event_url($id)];
}

function org_event_test_create(mysqli $db): array
{
    $sourceId = (int)($_POST['event_id'] ?? 0);
    $src = org_event_load($db, $sourceId);
    if (!$src) {
        return ['error' => 'Мероприятие не найдено'];
    }
    if (portal_event_is_test($src)) {
        return ['error' => 'Это уже тестовое мероприятие'];
    }
    $today = date('Y-m-d');
    $title = mb_substr('ТЕСТ БД ' . $today . ' — ' . (string)$src['title'], 0, 255);
    $type = (string)$src['event_type'];
    $startAt = $src['starts_at'] ?? null;
    $endAt = $src['ends_at'] ?? null;
    $zoom = $src['zoom_url'] ?? null;
    $ref = (int)($src['referee_person_id'] ?? 0);
    $refBind = $ref > 0 ? $ref : 0;
    $db->begin_transaction();
    try {
        $st = $db->prepare(
            'INSERT INTO events (slug, title, event_type, starts_on, ends_on, starts_at, ends_at, status, zoom_url, referee_person_id)
             VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, 0))'
        );
        $status = 'Подготовка';
        $st->bind_param('ssssssssi', $title, $type, $today, $today, $startAt, $endAt, $status, $zoom, $refBind);
        $st->execute();
        $newId = (int)$db->insert_id;
        $st->close();

        $srcDuels = $db->query('SELECT * FROM duels WHERE event_id = ' . $sourceId . ' ORDER BY sort_order, id');
        $insDuel = $db->prepare(
            'INSERT INTO duels (event_id, sort_order, duel_date, duel_type, prep_mode, round_minutes,
                                situation_id, player1_id, second1_id, player2_id, second2_id, referee_qty, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $map = [];
        while ($d = $srcDuels->fetch_assoc()) {
            $order = (int)$d['sort_order'];
            $duelType = $d['duel_type'];
            $prep = $d['prep_mode'];
            $mins = $d['round_minutes'];
            $sit = $d['situation_id'];
            $p1 = $d['player1_id'];
            $s1 = $d['second1_id'];
            $p2 = $d['player2_id'];
            $s2 = $d['second2_id'];
            $qty = $d['referee_qty'];
            $notes = $d['notes'];
            $insDuel->bind_param(
                'iisssssssssss',
                $newId, $order, $today, $duelType, $prep, $mins, $sit, $p1, $s1, $p2, $s2, $qty, $notes
            );
            $insDuel->execute();
            $map[(int)$d['id']] = (int)$db->insert_id;
        }
        $insDuel->close();

        $srcJudge = $db->prepare('SELECT person_id, college FROM duel_judges WHERE duel_id = ?');
        $insJudge = $db->prepare('INSERT INTO duel_judges (duel_id, person_id, college, vote, agreed) VALUES (?, ?, ?, NULL, 0)');
        foreach ($map as $oldDuel => $newDuel) {
            $srcJudge->bind_param('i', $oldDuel);
            $srcJudge->execute();
            $judges = $srcJudge->get_result();
            while ($j = $judges->fetch_assoc()) {
                $pid = $j['person_id'];
                $college = $j['college'];
                $insJudge->bind_param('iss', $newDuel, $pid, $college);
                $insJudge->execute();
            }
        }
        $srcJudge->close();
        $insJudge->close();

        $stmt = $db->prepare('INSERT INTO event_organizers (event_id, person_id, role) SELECT ?, person_id, role FROM event_organizers WHERE event_id = ?');
        $stmt->bind_param('ii', $newId, $sourceId);
        $stmt->execute();
        $stmt->close();
        $stmt = $db->prepare('INSERT INTO event_observers (event_id, person_id) SELECT ?, person_id FROM event_observers WHERE event_id = ?');
        $stmt->bind_param('ii', $newId, $sourceId);
        $stmt->execute();
        $stmt->close();

        $db->commit();
    } catch (Throwable $e) {
        $db->rollback();
        return ['error' => 'Не удалось создать тест: ' . $e->getMessage()];
    }
    $_SESSION['org_flash'] = 'Тестовое мероприятие создано';
    return ['redirect' => org_event_url($newId)];
}

function org_event_test_delete(mysqli $db): array
{
    $id = (int)($_POST['event_id'] ?? 0);
    $ev = org_event_load($db, $id);
    if (!$ev) {
        return ['error' => 'Мероприятие не найдено'];
    }
    if (!portal_event_is_test($ev)) {
        return ['error' => 'Удалять можно только тестовые мероприятия'];
    }
    $db->begin_transaction();
    try {
        $db->query('DELETE FROM videos WHERE event_id = ' . $id . ' OR duel_id IN (SELECT id FROM duels WHERE event_id = ' . $id . ')');
        $db->query('DELETE pe FROM protocol_events pe JOIN duels d ON d.id = pe.duel_id WHERE d.event_id = ' . $id);
        $db->query('DELETE cl FROM duel_change_log cl JOIN duels d ON d.id = cl.duel_id WHERE d.event_id = ' . $id);
        $db->query('DELETE dj FROM duel_judges dj JOIN duels d ON d.id = dj.duel_id WHERE d.event_id = ' . $id);
        $db->query('DELETE FROM duels WHERE event_id = ' . $id);
        $db->query('DELETE FROM event_organizers WHERE event_id = ' . $id);
        $db->query('DELETE FROM event_observers WHERE event_id = ' . $id);
        $db->query('DELETE FROM meeting_registrations WHERE event_id = ' . $id);
        $db->query('UPDATE outreach_campaigns SET event_id = NULL WHERE event_id = ' . $id);
        $db->query('DELETE FROM events WHERE id = ' . $id);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollback();
        return ['error' => 'Не удалось удалить тест: ' . $e->getMessage()];
    }
    $_SESSION['org_flash'] = 'Тестовое мероприятие удалено';
    return ['redirect' => org_event_url()];
}

function org_slot_add(mysqli $db): array
{
    $id = (int)($_POST['event_id'] ?? 0);
    $ev = org_event_load($db, $id);
    if (!$ev || !org_event_is_planned($ev)) {
        return ['error' => 'Нельзя добавить слот'];
    }
    $r = $db->query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM duels WHERE event_id = ' . $id);
    $order = (int)($r->fetch_assoc()['m'] ?? 0) + 1;
    $date = org_norm_date($ev['starts_on'] ?? null);
    org_insert_empty_slots($db, $id, $date, 1, $order);
    $_SESSION['org_flash'] = 'Слот добавлен';
    return ['redirect' => org_event_url($id) . '#slots'];
}

function org_slot_delete(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $did = (int)($_POST['duel_id'] ?? 0);
    $ev = org_event_load($db, $eid);
    if (!$ev || !org_event_is_planned($ev) || $did <= 0) {
        return ['error' => 'Нельзя удалить слот'];
    }
    $st = $db->prepare('SELECT id FROM duels WHERE id = ? AND event_id = ?');
    $st->bind_param('ii', $did, $eid);
    $st->execute();
    $ok = (bool)$st->get_result()->fetch_assoc();
    $st->close();
    if (!$ok) {
        return ['error' => 'Слот не найден'];
    }
    $chk = $db->prepare('SELECT COUNT(*) AS n FROM duel_judges WHERE duel_id = ?');
    $chk->bind_param('i', $did);
    $chk->execute();
    $n = (int)($chk->get_result()->fetch_assoc()['n'] ?? 0);
    $chk->close();
    if ($n > 0) {
        return ['error' => 'У слота уже есть судьи — не удаляю'];
    }
    $del = $db->prepare('DELETE FROM duels WHERE id = ? AND event_id = ?');
    $del->bind_param('ii', $did, $eid);
    $del->execute();
    $del->close();
    $_SESSION['org_flash'] = 'Слот удалён';
    return ['redirect' => org_event_url($eid) . '#slots'];
}

function org_slots_save(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $ev = org_event_load($db, $eid);
    if (!$ev || !org_event_is_planned($ev)) {
        return ['error' => 'Нельзя править сетку'];
    }
    $ids = $_POST['duel_id'] ?? [];
    $dates = $_POST['duel_date'] ?? [];
    $types = $_POST['duel_type'] ?? [];
    $sits = $_POST['situation_id'] ?? [];
    $labels = $_POST['sit_label'] ?? [];
    $p1s = $_POST['p1'] ?? [];
    $s1s = $_POST['s1'] ?? [];
    $p2s = $_POST['p2'] ?? [];
    $s2s = $_POST['s2'] ?? [];
    $locks = $_POST['lock'] ?? [];
    if (!is_array($ids)) {
        return ['error' => 'Пустая сетка'];
    }
    $validSit = [];
    foreach (org_situations_list($db) as $sit) {
        $validSit[(int)$sit['id']] = true;
    }
    $st = $db->prepare(
        'UPDATE duels SET duel_date=?, duel_type=?, prep_mode=?, round_minutes=?,
                situation_id=NULLIF(?, 0), notes=NULLIF(?, \'\'),
                player1_id=NULLIF(?, 0), second1_id=NULLIF(?, 0),
                player2_id=NULLIF(?, 0), second2_id=NULLIF(?, 0), gen_locked=?
         WHERE id=? AND event_id=?'
    );
    $seconds = [];
    foreach ($ids as $i => $rawId) {
        $did = (int)$rawId;
        if ($did <= 0) {
            continue;
        }
        $type = (string)($types[$i] ?? 'классика');
        if (!in_array($type, org_duel_types(), true)) {
            $type = 'классика';
        }
        $date = org_norm_date($dates[$i] ?? null);
        $mins = $type === 'экспресс' ? 1 : 5;
        $prep = 'обычный';
        $sid = (int)($sits[$i] ?? 0);
        if ($sid > 0 && !isset($validSit[$sid])) {
            $sid = 0;
        }
        $notes = $sid > 0 ? '' : trim((string)($labels[$i] ?? ''));
        $p1 = (int)($p1s[$i] ?? 0);
        $p2 = (int)($p2s[$i] ?? 0);
        $s1 = $type === 'экспресс' ? 0 : (int)($s1s[$i] ?? 0);
        $s2 = $type === 'экспресс' ? 0 : (int)($s2s[$i] ?? 0);
        if ($s1 > 0) {
            $seconds[$s1] = true;
        }
        if ($s2 > 0) {
            $seconds[$s2] = true;
        }
        $lock = !empty($locks[$i]) ? 1 : 0;
        $st->bind_param('sssiisiiiiiii', $date, $type, $prep, $mins, $sid, $notes, $p1, $s1, $p2, $s2, $lock, $did, $eid);
        $st->execute();
    }
    $st->close();

    // Секундантов, выбранных не из заявок, добавляем в заявки мероприятия.
    if ($seconds) {
        $regPids = [];
        foreach (org_event_regs($db, $eid) as $rr) {
            $rp = (int)($rr['id'] ?? 0);
            if ($rp > 0) {
                $regPids[$rp] = true;
            }
        }
        foreach (array_keys($seconds) as $spid) {
            if (!isset($regPids[$spid])) {
                org_ensure_registration_for_second($db, $eid, (int)$spid);
                $regPids[$spid] = true;
            }
        }
    }

    $_SESSION['org_flash'] = 'Сетка сохранена';
    return ['redirect' => org_event_url($eid) . '#slots'];
}

function org_slots_clear(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $ev = org_event_load($db, $eid);
    if (!$ev || !org_event_is_planned($ev)) {
        return ['error' => 'Нельзя очистить сетку'];
    }
    $locked = 0;
    $lr = $db->prepare('SELECT COUNT(*) c FROM duels WHERE event_id=? AND gen_locked=1');
    if ($lr) {
        $lr->bind_param('i', $eid);
        $lr->execute();
        $locked = (int)(($lr->get_result()->fetch_assoc()['c'] ?? 0));
        $lr->close();
    }
    $st = $db->prepare(
        'UPDATE duels
         SET player1_id=NULL, player2_id=NULL, second1_id=NULL, second2_id=NULL
         WHERE event_id=? AND gen_locked=0'
    );
    $st->bind_param('i', $eid);
    $st->execute();
    $n = $st->affected_rows;
    $st->close();

    $_SESSION['org_flash'] = 'Сетка очищена: ' . $n . ' слот(ов)'
        . ($locked > 0 ? '. Зафиксировано (не тронуто): ' . $locked : '');
    return ['redirect' => org_event_url($eid) . '#slots'];
}

function org_sit_labels_save(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $ev = org_event_load($db, $eid);
    if (!$ev) {
        return ['error' => 'Нет мероприятия'];
    }
    $ids = $_POST['duel_id'] ?? [];
    $sits = $_POST['situation_id'] ?? [];
    $labels = $_POST['sit_label'] ?? [];
    if (!is_array($ids)) {
        return ['error' => 'Пусто'];
    }
    $validSit = [];
    foreach (org_situations_list($db) as $sit) {
        $validSit[(int)$sit['id']] = true;
    }
    $st = $db->prepare(
        'UPDATE duels SET situation_id=NULLIF(?, 0), notes=NULLIF(?, \'\')
         WHERE id=? AND event_id=?'
    );
    foreach ($ids as $i => $rawId) {
        $did = (int)$rawId;
        if ($did <= 0) {
            continue;
        }
        $sid = (int)($sits[$i] ?? 0);
        if ($sid > 0 && !isset($validSit[$sid])) {
            $sid = 0;
        }
        $notes = $sid > 0 ? '' : trim((string)($labels[$i] ?? ''));
        $st->bind_param('isii', $sid, $notes, $did, $eid);
        $st->execute();
    }
    $st->close();
    $_SESSION['org_flash'] = 'Подписи ситуаций сохранены';
    return ['redirect' => org_event_url($eid)];
}

function org_outreach_add_from_event(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $pid = (int)($_POST['person_id'] ?? 0);
    $ev = org_event_load($db, $eid);
    if (!$ev || !org_event_is_planned($ev) || $pid <= 0) {
        return ['error' => 'Нельзя добавить в опрос'];
    }
    $now = date('Y-m-d H:i:s');
    $cid = 0;
    $st = $db->prepare('SELECT id FROM outreach_campaigns WHERE event_id = ? ORDER BY id DESC LIMIT 1');
    $st->bind_param('i', $eid);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    if ($row) {
        $cid = (int)$row['id'];
    } else {
        $title = 'Опрос: ' . (string)$ev['title'];
        $st = $db->prepare('INSERT INTO outreach_campaigns (event_id, title, status, created_at, updated_at) VALUES (?, ?, \'active\', ?, ?)');
        $st->bind_param('isss', $eid, $title, $now, $now);
        $st->execute();
        $cid = (int)$db->insert_id;
        $st->close();
    }
    $st = $db->prepare('INSERT INTO outreach_items (campaign_id, person_id, status, updated_at) VALUES (?, ?, \'new\', ?) ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)');
    $st->bind_param('iis', $cid, $pid, $now);
    $st->execute();
    $st->close();
    $_SESSION['org_flash'] = 'Добавлено в опрос';
    return ['redirect' => org_event_url($eid)];
}

function org_outreach_remove_from_event(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $pid = (int)($_POST['person_id'] ?? 0);
    if ($eid > 0 && $pid > 0) {
        $st = $db->prepare('DELETE oi FROM outreach_items oi JOIN outreach_campaigns c ON c.id = oi.campaign_id WHERE c.event_id = ? AND oi.person_id = ?');
        $st->bind_param('ii', $eid, $pid);
        $st->execute();
        $st->close();
        $_SESSION['org_flash'] = 'Убрано из опроса';
    }
    return ['redirect' => org_event_url($eid)];
}

/** @return array<int, true> person_id, кто уже в опросе этого мероприятия */
function org_outreach_in_campaign_ids(mysqli $db, int $eventId): array
{
    static $cache = [];
    if ($eventId <= 0) {
        return [];
    }
    if (array_key_exists($eventId, $cache)) {
        return $cache[$eventId];
    }
    $set = [];
    $st = $db->prepare('SELECT oi.person_id FROM outreach_items oi JOIN outreach_campaigns c ON c.id = oi.campaign_id WHERE c.event_id = ?');
    $st->bind_param('i', $eventId);
    $st->execute();
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $set[(int)$row['person_id']] = true;
    }
    $st->close();
    $cache[$eventId] = $set;
    return $set;
}

function org_reg_add(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $pid = (int)($_POST['person_id'] ?? 0);
    $ev = org_event_load($db, $eid);
    if (!$ev || !org_event_can_manage_regs($ev) || $pid <= 0) {
        return ['error' => 'Нельзя добавить заявку'];
    }
    $st = $db->prepare(
        'SELECT id, full_name, email, telegram FROM people WHERE id = ? AND is_active = 1'
    );
    $st->bind_param('i', $pid);
    $st->execute();
    $person = $st->get_result()->fetch_assoc();
    $st->close();
    if (!$person) {
        return ['error' => 'Человек не найден'];
    }
    $chk = $db->prepare(
        'SELECT id FROM meeting_registrations WHERE event_id = ? AND person_id = ? LIMIT 1'
    );
    $chk->bind_param('ii', $eid, $pid);
    $chk->execute();
    $exists = (bool)$chk->get_result()->fetch_assoc();
    $chk->close();
    if ($exists) {
        $_SESSION['org_flash'] = 'Уже в заявках';
        return ['redirect' => org_event_url($eid) . '#regs'];
    }
    $name = (string)$person['full_name'];
    $email = trim((string)($person['email'] ?? ''));
    $telegram = trim((string)($person['telegram'] ?? ''));
    $play = 1;
    $judge = 0;
    $second = 0;
    $duelTypePref = org_norm_duel_type_pref((string)($_POST['duel_type_pref'] ?? ''));
    $comment = trim((string)($_POST['comment'] ?? ''));
    $source = 'manual';
    $ins = $db->prepare(
        'INSERT INTO meeting_registrations
         (event_id, person_id, full_name, email, telegram,
          wants_play, wants_judge, wants_second, duel_type_pref, comment, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $ins->bind_param(
        'iisssiiisss',
        $eid,
        $pid,
        $name,
        $email,
        $telegram,
        $play,
        $judge,
        $second,
        $duelTypePref,
        $comment,
        $source
    );
    $ins->execute();
    $ins->close();
    $_SESSION['org_flash'] = 'Добавлен в заявки';
    return ['redirect' => org_event_url($eid) . '#regs'];
}

function org_reg_remove(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $rid = (int)($_POST['reg_id'] ?? 0);
    $ev = org_event_load($db, $eid);
    if (!$ev || !org_event_can_manage_regs($ev) || $rid <= 0) {
        return ['error' => 'Нельзя убрать заявку'];
    }
    $del = $db->prepare('DELETE FROM meeting_registrations WHERE id = ? AND event_id = ?');
    $del->bind_param('ii', $rid, $eid);
    $del->execute();
    $ok = $del->affected_rows > 0;
    $del->close();
    if (!$ok) {
        return ['error' => 'Заявка не найдена'];
    }
    $_SESSION['org_flash'] = 'Убран из заявок';
    return ['redirect' => org_event_url($eid) . '#regs'];
}

function org_reg_attendance(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $ev = org_event_load($db, $eid);
    if (!$ev || !org_event_can_manage_regs($ev)) {
        return ['error' => 'Нельзя сохранить посещаемость'];
    }
    $att = $_POST['attended'] ?? [];
    $cmts = $_POST['att_comment'] ?? [];
    if (!is_array($att) || !is_array($cmts)) {
        return ['error' => 'Некорректные данные'];
    }
    $st = $db->prepare(
        'UPDATE meeting_registrations
         SET org_attended=?, org_attended_comment=NULLIF(?, \'\')
         WHERE id=? AND event_id=?'
    );
    foreach ($att as $ridRaw => $valRaw) {
        $rid = (int)$ridRaw;
        if ($rid <= 0) {
            continue;
        }
        $val = $valRaw === '' || $valRaw === null ? null : ((int)$valRaw === 1 ? 1 : 0);
        $comment = trim((string)($cmts[$ridRaw] ?? ''));
        $st->bind_param('isii', $val, $comment, $rid, $eid);
        $st->execute();
    }
    $st->close();
    $_SESSION['org_flash'] = 'Посещаемость сохранена';
    return ['redirect' => org_event_url($eid) . '#regs'];
}

function org_reg_update(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $rid = (int)($_POST['reg_id'] ?? 0);
    $ev = org_event_load($db, $eid);
    if (!$ev || !org_event_is_planned($ev) || $rid <= 0) {
        return ['error' => 'Нельзя обновить заявку'];
    }
    $play = !empty($_POST['wants_play']) ? 1 : 0;
    $judge = !empty($_POST['wants_judge']) ? 1 : 0;
    $second = !empty($_POST['wants_second']) ? 1 : 0;
    $duelTypePref = org_norm_duel_type_pref((string)($_POST['duel_type_pref'] ?? ''));
    $comment = trim((string)($_POST['comment'] ?? ''));
    $orgNoPlay = !empty($_POST['org_no_play']) ? 1 : 0;
    $bannedRaw = $_POST['org_banned_types'] ?? [];
    $banned = [];
    if (is_array($bannedRaw)) {
        foreach ($bannedRaw as $t) {
            $t = (string)$t;
            if (in_array($t, org_duel_types(), true)) {
                $banned[$t] = true;
            }
        }
    }
    $bannedStr = $banned ? implode(',', array_keys($banned)) : null;
    $st = $db->prepare(
        'UPDATE meeting_registrations
         SET wants_play=?, wants_judge=?, wants_second=?, duel_type_pref=?, comment=?,
             org_no_play=?, org_banned_types=?
         WHERE id = ? AND event_id = ?'
    );
    $st->bind_param('iiissisii', $play, $judge, $second, $duelTypePref, $comment, $orgNoPlay, $bannedStr, $rid, $eid);
    $st->execute();
    $ok = $st->affected_rows >= 0;
    $st->close();
    if (!$ok) {
        return ['error' => 'Заявка не найдена'];
    }
    $_SESSION['org_flash'] = 'Заявка обновлена';
    return ['redirect' => org_event_url($eid) . '#regs'];
}

/** Отметить/снять у человека в заявке мероприятия «подтвердил участие». */
function org_reg_confirm(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $pid = (int)($_POST['person_id'] ?? 0);
    $ev = org_event_load($db, $eid);
    if (!$ev || !org_event_is_planned($ev) || $pid <= 0) {
        return ['error' => 'Нельзя отметить подтверждение'];
    }
    $val = !empty($_POST['confirmed']) ? 1 : 0;
    $st = $db->prepare(
        'UPDATE meeting_registrations SET org_confirmed=? WHERE event_id=? AND person_id=?'
    );
    $st->bind_param('iii', $val, $eid, $pid);
    $st->execute();
    $n = $st->affected_rows;
    $st->close();
    if ($n < 0) {
        return ['error' => 'Заявка не найдена'];
    }
    $name = '';
    $ns = $db->prepare('SELECT full_name FROM people WHERE id = ?');
    if ($ns) {
        $ns->bind_param('i', $pid);
        $ns->execute();
        $name = (string)(($ns->get_result()->fetch_assoc()['full_name'] ?? ''));
        $ns->close();
    }
    $_SESSION['org_flash'] = ($val ? 'Подтвердил участие: ' : 'Снята отметка подтверждения: ')
        . ($name !== '' ? $name : ('#' . $pid));
    return ['redirect' => org_event_url($eid) . '#slots'];
}

/** Добавить заявку мероприятия человеку (напр. выбранному секунданту не из заявок). */
function org_ensure_registration_for_second(mysqli $db, int $eventId, int $personId): void
{
    if ($eventId <= 0 || $personId <= 0) {
        return;
    }
    $st = $db->prepare('SELECT full_name FROM people WHERE id = ?');
    $st->bind_param('i', $personId);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    if (!$row) {
        return;
    }
    $name = (string)$row['full_name'];
    $second = 1;
    $src = 'org_second';
    $st = $db->prepare(
        'INSERT INTO meeting_registrations (event_id, person_id, full_name, wants_play, wants_judge, wants_second, source)
         VALUES (?, ?, ?, 0, 0, ?, ?)'
    );
    $st->bind_param('iisis', $eventId, $personId, $name, $second, $src);
    $st->execute();
    $st->close();
}

function org_pick_event(array $events, int $id): ?array
{
    foreach ($events as $ev) {
        if ((int)$ev['id'] === $id) {
            return $ev;
        }
    }
    return null;
}

function org_default_event(array $events): ?array
{
    $today = portal_today_iso();
    $bestPlan = null;
    $bestPast = null;
    foreach ($events as $ev) {
        $d = portal_event_date_start($ev);
        if (org_event_is_planned($ev) && $d !== '' && $d >= $today) {
            if ($bestPlan === null || $d < portal_event_date_start($bestPlan)) {
                $bestPlan = $ev;
            }
        }
        if (($ev['status'] ?? '') === 'Проведено' && $d !== '' && $d <= $today) {
            if ($bestPast === null || $d > portal_event_date_start($bestPast)) {
                $bestPast = $ev;
            }
        }
    }
    return $bestPlan ?? $bestPast ?? ($events ? $events[count($events) - 1] : null);
}

function org_echo_person_select(
    string $name,
    int $selected,
    array $people,
    string $empty = '—',
    bool $needFill = false,
    string $extraAttrs = ''
): void {
    echo '<select name="' . h($name) . '"' . org_need_fill_class($needFill && $selected <= 0)
        . ($extraAttrs !== '' ? (' ' . $extraAttrs) : '') . '>';
    echo '<option value="0">' . h($empty) . '</option>';
    foreach ($people as $pid => $fio) {
        echo '<option value="' . (int)$pid . '"' . ($pid === $selected ? ' selected' : '') . '>'
            . h($fio) . '</option>';
    }
    echo '</select>';
}

/** @param array<string, int> $roleMap @param array<int, string> $orgPool @param array<int, string> $refPool */
function org_echo_staff_table(
    array $roleMap,
    int $refId,
    array $orgPool,
    array $refPool,
    bool $edit,
    string $refName = '',
    string $eventType = '',
    string $refereeExtraAttrs = ''
): void {
    echo '<div class="org-staff-wrap">';
    echo '<table class="org-staff">';
    echo '<thead><tr><th>Роль</th><th>Кто</th><th>Роль</th><th>Кто</th></tr></thead><tbody>';
    $cells = org_event_staff_cells($eventType);
    $n = count($cells);
    for ($i = 0; $i < $n; $i += 2) {
        echo '<tr>';
        org_echo_staff_cell($cells[$i], $roleMap, $refId, $orgPool, $refPool, $edit, $refName, $eventType, $refereeExtraAttrs);
        org_echo_staff_cell(
            $cells[$i + 1] ?? ['kind' => 'empty'],
            $roleMap,
            $refId,
            $orgPool,
            $refPool,
            $edit,
            $refName,
            $eventType,
            $refereeExtraAttrs
        );
        echo '</tr>';
    }
    echo '</tbody></table></div>';
}

/** @param array{kind: string, key?: string, label?: string, need?: bool} $cell */
function org_echo_staff_cell(
    array $cell,
    array $roleMap,
    int $refId,
    array $orgPool,
    array $refPool,
    bool $edit,
    string $refName,
    string $eventType = '',
    string $refereeExtraAttrs = ''
): void {
    if (($cell['kind'] ?? '') === 'empty') {
        echo '<td class="org-staff-role"></td><td class="org-staff-who"></td>';
        return;
    }
    $need = !empty($cell['need']);
    echo '<td class="org-staff-role">' . h((string)($cell['label'] ?? '')) . '</td>';
    echo '<td class="org-staff-who">';
    if (($cell['kind'] ?? '') === 'referee') {
        if ($edit) {
            org_echo_person_select('referee_person_id', $refId, $refPool, 'нет', $need, $refereeExtraAttrs);
        } else {
            $name = $refName !== '' ? $refName : (string)($refPool[$refId] ?? '');
            echo $name !== '' ? h($name) : '—';
        }
    } else {
        $pid = (int)($roleMap[(string)($cell['key'] ?? '')] ?? 0);
        if ($edit) {
            org_echo_person_select(
                'org_role[' . (string)($cell['key'] ?? '') . ']',
                $pid,
                $orgPool,
                '—',
                $need
            );
        } else {
            $name = $pid > 0 ? (string)($orgPool[$pid] ?? '') : '';
            echo $name !== '' ? h($name) : '—';
        }
    }
    echo '</td>';
}

function org_echo_combo(string $name, int $selected, string $label, string $kind, string $textName = '', string $link = ''): void
{
    echo '<div class="org-combo" data-combo="' . h($kind) . '">';
    echo '<input type="hidden" name="' . h($name) . '" value="' . (int)$selected . '">';
    $tn = $textName !== '' ? ' name="' . h($textName) . '"' : '';
    if (($kind === 'person' || $kind === 'sit') && $selected > 0) {
        if ($kind === 'person') {
            $viewUrl = portal_org_url('people') . '&person=' . $selected;
            $viewTitle = 'Открыть карточку (двойной клик — изменить)';
        } else {
            $viewUrl = $link;
            $viewTitle = $viewUrl !== ''
                ? 'Открыть ситуацию в банке (двойной клик — изменить)'
                : 'Двойной клик — изменить';
        }
        if ($viewUrl !== '') {
            echo '<a class="org-combo-view" href="' . h($viewUrl)
                . '" target="_blank" rel="noopener" title="' . h($viewTitle) . '">'
                . h($label) . '</a>';
        } else {
            echo '<span class="org-combo-view" title="' . h($viewTitle) . '">'
                . h($label) . '</span>';
        }
        echo '<input type="text" class="org-cell-in org-combo-input"' . $tn . ' value="' . h($label)
            . '" placeholder="—" autocomplete="off" hidden>';
        echo '<button type="button" class="org-combo-arrow" aria-label="Выбрать" title="Выбрать">▾</button>';
    } else {
        echo '<input type="text" class="org-cell-in"' . $tn . ' value="' . h($label) . '" placeholder="—" autocomplete="off">';
    }
    echo '</div>';
}

function org_sit_cell_label(array $d): string
{
    $lab = trim((string)($d['sit'] ?? ''));
    if ($lab === '' || $lab === '—' || portal_sit_is_random_label($lab)) {
        return '';
    }
    return $lab;
}

function org_echo_to_reg_btn(int $eventId, int $pid): void
{
    if ($eventId <= 0 || $pid <= 0) {
        return;
    }
    echo ' <button type="submit" form="reg-add-' . $pid . '" class="btn-ghost org-to-reg">в заявку</button>';
}

function org_echo_to_list_btn(int $eventId, int $pid): void
{
    if ($eventId <= 0 || $pid <= 0) {
        return;
    }
    echo '<form method="post" class="org-inline-form">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_outreach_add">';
    echo '<input type="hidden" name="event_id" value="' . $eventId . '">';
    echo '<input type="hidden" name="person_id" value="' . $pid . '">';
    echo '<button type="submit" class="btn-ghost org-to-reg">+ в опрос</button>';
    echo '</form>';
}

function org_echo_to_list_remove_btn(int $eventId, int $pid): void
{
    if ($eventId <= 0 || $pid <= 0) {
        return;
    }
    echo '<form method="post" class="org-inline-form">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_outreach_remove">';
    echo '<input type="hidden" name="event_id" value="' . $eventId . '">';
    echo '<input type="hidden" name="person_id" value="' . $pid . '">';
    echo '<button type="submit" class="btn-ghost org-to-reg">убрать</button>';
    echo '</form>';
}

function org_echo_reg_add_form(int $eventId, int $pid): void
{
    if ($eventId <= 0 || $pid <= 0) {
        return;
    }
    echo '<form method="post" id="reg-add-' . $pid . '" class="org-hidden">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_reg_add">';
    echo '<input type="hidden" name="event_id" value="' . $eventId . '">';
    echo '<input type="hidden" name="person_id" value="' . $pid . '">';
    echo '</form>';
}

function portal_echo_org_events(mysqli $db, string $flash, string $error): void
{
    $events = org_events_dated($db);
    $isNew = isset($_GET['new']);
    $id = (int)($_GET['id'] ?? 0);
    $preDate = org_norm_date($_GET['date'] ?? null);
    $selected = $isNew ? null : ($id > 0 ? org_pick_event($events, $id) : org_default_event($events));
    if ($selected && $id <= 0) {
        $id = (int)$selected['id'];
    }
    if ($selected) {
        $full = org_event_load($db, (int)$selected['id']);
        if ($full) {
            $selected = $full;
        }
    }
    $anchor = $selected ? portal_event_date_start($selected) : ($preDate ?? portal_today_iso());
    $year = (int)($_GET['y'] ?? 0);
    if ($year < 2020 || $year > 2040) {
        $year = $anchor !== '' ? (int)substr($anchor, 0, 4) : (int)date('Y');
    }
    $people = org_people_map($db);
    $duels = $selected ? org_event_duels($db, (int)$selected['id']) : [];
    $regs = ($selected && org_event_can_manage_regs($selected)) ? org_event_regs($db, (int)$selected['id']) : [];
    $career = ($selected && org_event_is_planned($selected)) ? org_people_career($db, (int)$selected['id']) : [];
    $metrics = $career ? org_event_metrics($db, $duels, $career, $regs) : null;
    $onlinePlan = $selected && ($selected['event_type'] ?? '') === 'онлайн';
    $attract = ($career && !$onlinePlan) ? org_attract($db, $career, $duels, $regs) : [];

    if ($flash !== '' || $error !== '') {
        echo '<div class="org-toasts" aria-live="polite">';
        if ($flash !== '') {
            echo '<div class="org-toast is-ok" role="status">' . h($flash) . '</div>';
        }
        if ($error !== '') {
            echo '<div class="org-toast is-err" role="alert">' . h($error) . '</div>';
        }
        echo '</div>';
    }
    echo '<div class="org-main">';
    $isTraining = $selected && ($selected['event_type'] ?? '') === 'обучение';
    $showRecs = $selected && org_event_is_planned($selected) && !$isTraining;
    echo '<div class="org-ev' . ($showRecs ? ' org-ev-split' : '') . '">';
    echo '<div class="org-ev-main">';
    echo '<div class="org-ev-col org-ev-col-cal">';
    echo '<div class="org-ev-cal">';
    org_echo_year($year, $events, $selected, $isNew ? $preDate : portal_event_date_start($selected ?? []));
    echo '</div>';
    if ($showRecs) {
        org_echo_slots_card($selected, $duels, $regs, $people, $db, $metrics);
    }
    echo '</div>';
    echo '<div class="org-ev-col org-ev-col-side">';
    echo '<div class="org-ev-attrs">';
    if ($isNew) {
        org_echo_attrs_form(null, $people, $db, $preDate);
    } elseif ($selected) {
        if (org_event_is_planned($selected)) {
            org_echo_attrs_form($selected, $people, $db, null);
        } else {
            org_echo_attrs_read($db, $selected);
        }
    } else {
        echo '<p class="muted">Выберите день в календаре или создайте мероприятие.</p>';
    }
    echo '</div>';
    if ($showRecs) {
        org_echo_plan_side($selected, $regs, $career, $duels);
    } elseif ($isTraining && $selected && ($selected['status'] ?? '') !== 'Отменено') {
        org_echo_event_participants($selected, $regs, $people);
    }
    echo '</div>';
    if ($selected && !org_event_is_planned($selected)) {
        echo '<div class="org-ev-bottom">';
        org_echo_google_grid($selected, $duels);
        org_echo_sit_labels_form($selected, $duels, $people, $db);
        echo '</div>';
    }
    echo '</div>';
    if ($showRecs) {
        echo '<aside class="org-ev-recs">';
        org_echo_event_recs($selected, $duels, $regs, $attract, $career, $db);
        echo '</aside>';
    }
    echo '</div></div>';
}

function org_echo_year(int $year, array $events, ?array $selected, ?string $selDay): void
{
    $selId = $selected ? (int)$selected['id'] : 0;
    $yearS = (string)$year;
    $months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    $byDay = [];
    foreach ($events as $ev) {
        $from = portal_event_date_start($ev);
        $to = portal_event_date_end($ev);
        if ($from === '') {
            continue;
        }
        $cur = $from;
        while ($cur <= $to) {
            $byDay[$cur][] = $ev;
            $cur = date('Y-m-d', strtotime($cur . ' +1 day'));
        }
    }
    echo '<div class="org-cal">';
    echo '<div class="org-cal-nav">';
    echo '<a href="' . h(org_event_url($selId, (string)($year - 1))) . '">←</a>';
    echo '<strong>' . $year . '</strong>';
    echo '<a href="' . h(org_event_url($selId, (string)($year + 1))) . '">→</a>';
    echo '</div>';
    echo '<div class="org-year">';
    for ($mo = 1; $mo <= 12; $mo++) {
        org_echo_year_month($year, $mo, $months[$mo - 1], $byDay, $selId, $selDay, $yearS);
    }
    echo '</div></div>';
}

function org_echo_year_month(
    int $y,
    int $mo,
    string $label,
    array $byDay,
    int $selId,
    ?string $selDay,
    string $yearS
): void {
    $first = new DateTime(sprintf('%04d-%02d-01', $y, $mo));
    $startDow = ((int)$first->format('N')) - 1;
    $dim = (int)$first->format('t');
    echo '<div class="org-month">';
    echo '<h2>' . h($label) . '</h2>';
    echo '<table><tbody>';
    $day = 1 - $startDow;
    for ($row = 0; $row < 6; $row++) {
        echo '<tr>';
        $empty = true;
        for ($col = 0; $col < 7; $col++) {
            if ($day < 1 || $day > $dim) {
                echo '<td></td>';
            } else {
                $empty = false;
                $iso = sprintf('%04d-%02d-%02d', $y, $mo, $day);
                $evs = $byDay[$iso] ?? [];
                $cls = [];
                if ($col >= 5) {
                    $cls[] = 'wknd';
                }
                if ($evs) {
                    $cls[] = 'has';
                    $types = array_map(static fn($e) => (string)($e['event_type'] ?? ''), $evs);
                    if (in_array('онлайн', $types, true)) {
                        $cls[] = 'online';
                    }
                    if (in_array('турнир', $types, true)) {
                        $cls[] = 'tournament';
                    }
                    if (in_array('обучение', $types, true)) {
                        $cls[] = 'training';
                    }
                    if (array_intersect($types, ['купала', 'новогоднее'])) {
                        $cls[] = 'special';
                    }
                    if (array_filter($evs, static fn($e) => org_event_is_planned($e))) {
                        $cls[] = 'plan';
                    }
                    if (array_filter($evs, static fn($e) => ($e['status'] ?? '') === 'Проведено')) {
                        $cls[] = 'done';
                    }
                    if (array_filter($evs, static fn($e) => ($e['status'] ?? '') === 'Отменено')) {
                        $cls[] = 'cancelled';
                    }
                    if (array_filter($evs, static fn($e) => portal_event_is_test($e))) {
                        $cls[] = 'test';
                    }
                    if (count($evs) === 1 && (int)$evs[0]['id'] === $selId) {
                        $cls[] = 'on';
                    }
                }
                if ($selDay === $iso) {
                    $cls[] = 'on';
                }
                $href = $evs
                    ? org_event_url((int)$evs[0]['id'], $yearS)
                    : org_event_url(0, $yearS, true, $iso);
                $title = $evs ? implode(', ', array_map(static fn($e) => $e['title'], $evs)) : 'создать';
                echo '<td class="' . h(implode(' ', $cls)) . '">';
                echo '<a href="' . h($href) . '" title="' . h($title) . '">' . $day . '</a>';
                echo '</td>';
            }
            $day++;
        }
        echo '</tr>';
        if ($empty && $row > 3) {
            break;
        }
        if ($day > $dim && $row >= 3) {
            break;
        }
    }
    echo '</tbody></table></div>';
}

function org_echo_attrs_read(mysqli $db, array $ev): void
{
    $zoom = portal_zoom_short_url($ev);
    echo '<section class="card org-attrs">';
    echo '<h2>' . h((string)$ev['title'])
        . (portal_event_is_test($ev) ? ' <span class="badge-test">тест</span>' : '') . '</h2>';
    echo '<dl class="org-dl">';
    org_dl('Тип', (string)$ev['event_type']);
    org_dl('Статус', (string)$ev['status']);
    $dates = portal_event_date_start($ev);
    $end = portal_event_date_end($ev);
    if ($end !== '' && $end !== $dates) {
        $dates .= ' — ' . $end;
    }
    $times = portal_event_time_range($ev);
    org_dl('Когда', trim($dates . ' ' . $times));
    org_dl('Ярлык', (string)($ev['slug'] ?? ''));
    if ($zoom !== '') {
        echo '<div><dt>Zoom</dt><dd><a href="' . h($zoom) . '" target="_blank" rel="noopener">' . h($zoom) . '</a></dd></div>';
    }
    $regUrl = portal_register_url($ev);
    if ($regUrl !== '') {
        $regAbs = rtrim(portal_public_base(), '/') . '/' . ltrim($regUrl, '/');
        echo '<div><dt>Регистрация</dt><dd class="org-reg-link">'
            . '<a href="' . h($regAbs) . '" target="_blank" rel="noopener">' . h($regAbs) . '</a>'
            . '<button type="button" class="org-copy-btn" data-copy="' . h($regAbs) . '">Скопировать</button>'
            . '</dd></div>';
    }
    echo '</dl>';
    $ref = (int)($ev['referee_person_id'] ?? 0);
    $evType = (string)($ev['event_type'] ?? '');
    $roleMap = org_event_role_person_map($db, (int)($ev['id'] ?? 0));
    $orgPool = org_event_orgs_map($db, array_values($roleMap));
    $refPool = org_referees_map($db, $ref, $evType);
    org_echo_staff_table($roleMap, $ref, $orgPool, $refPool, false, (string)($ev['referee_name'] ?? ''), $evType);
    if (($ev['status'] ?? '') === 'Отменено') {
        echo '<form method="post" class="org-attrs-actions" onsubmit="return confirm(\'Восстановить мероприятие?\');">';
        portal_csrf_field();
        echo '<input type="hidden" name="action" value="org_event_restore">';
        echo '<input type="hidden" name="event_id" value="' . (int)$ev['id'] . '">';
        echo '<button type="submit">Восстановить мероприятие</button>';
        echo '</form>';
    }
    org_echo_test_actions($ev);
    echo '</section>';
}

function org_dl(string $k, string $v): void
{
    if ($v === '') {
        return;
    }
    echo '<div><dt>' . h($k) . '</dt><dd>' . h($v) . '</dd></div>';
}

function org_echo_test_actions(?array $ev, bool $isNew = false): void
{
    if ($isNew || !$ev) {
        return;
    }
    $id = (int)$ev['id'];
    if (portal_event_is_test($ev)) {
        echo '<form method="post" class="org-test-actions" onsubmit="return confirm(\'Удалить тестовое мероприятие?\');">';
        portal_csrf_field();
        echo '<input type="hidden" name="action" value="org_event_test_delete">';
        echo '<input type="hidden" name="event_id" value="' . $id . '">';
        echo '<button type="submit" class="org-test-delete">Удалить тест</button>';
        echo '</form>';
        return;
    }
    echo '<form method="post" class="org-test-actions" onsubmit="return confirm(\'Создать тестовое мероприятие на сегодня?\');">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_event_test_create">';
    echo '<input type="hidden" name="event_id" value="' . $id . '">';
    echo '<button type="submit" class="org-test-create">Создать тест на сегодня</button>';
    echo '</form>';
}

function org_echo_attrs_form(?array $ev, array $people, mysqli $db, ?string $preDate): void
{
    $isNew = $ev === null;
    $n = $isNew ? org_next_online_num($db) : 0;
    $title = $isNew ? ('Онлайн ' . $n) : (string)$ev['title'];
    $type = $isNew ? 'онлайн' : (string)$ev['event_type'];
    $status = $isNew ? 'Запланировано' : (string)$ev['status'];
    $slug = $isNew ? ('online_' . $n) : (string)($ev['slug'] ?? '');
    $start = $isNew ? ($preDate ?? '') : portal_event_date_start($ev);
    $end = $isNew ? ($preDate ?? '') : portal_event_date_end($ev);
    $stAt = $isNew ? '11:00' : portal_event_clock($ev ?? [], 'start');
    $enAt = $isNew ? '13:30' : portal_event_clock($ev ?? [], 'end');
    $zoom = $isNew ? org_default_zoom() : (string)($ev['zoom_url'] ?? '');
    if ($zoom === '' && ($isNew || ($ev['event_type'] ?? '') === 'онлайн')) {
        $zoom = org_default_zoom();
    }
    $ref = $isNew ? 0 : (int)($ev['referee_person_id'] ?? 0);
    $referees = org_referees_map($db, 0, '') + org_referees_map($db, 0, 'обучение');
    $arbiterIds = array_keys(org_referees_map($db, 0, ''));
    $trainerIds = array_keys(org_referees_map($db, 0, 'обучение'));
    $refereeAttrs = 'data-arbiters="' . h(json_encode($arbiterIds, JSON_UNESCAPED_UNICODE)) . '"'
        . ' data-trainers="' . h(json_encode($trainerIds, JSON_UNESCAPED_UNICODE)) . '"'
        . ' data-train-label="Ведущий" data-default-label="Арбитр"';
    $roleMap = $isNew ? [] : org_event_role_person_map($db, (int)$ev['id']);
    $orgPool = org_event_orgs_map($db, array_values($roleMap));
    echo '<section class="card org-attrs">';
    echo '<h2>' . ($isNew ? 'Новое мероприятие' : h($title))
        . (!$isNew && portal_event_is_test($ev) ? ' <span class="badge-test">тест</span>' : '') . '</h2>';
    echo '<form method="post" class="org-attrs-form">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="' . ($isNew ? 'org_event_create' : 'org_event_save') . '">';
    if (!$isNew) {
        echo '<input type="hidden" name="event_id" value="' . (int)$ev['id'] . '">';
    }
    echo '<label>Название <input name="title" required value="' . h($title) . '"'
        . org_need_fill_class($title === '') . '></label>';
    echo '<label>Тип <select name="event_type">';
    foreach (org_event_types() as $t) {
        echo '<option' . ($t === $type ? ' selected' : '') . '>' . h($t) . '</option>';
    }
    echo '</select></label>';
    echo '<label>Статус <select name="status">';
    foreach (org_event_statuses() as $s) {
        echo '<option' . ($s === $status ? ' selected' : '') . '>' . h($s) . '</option>';
    }
    echo '</select></label>';
    echo '<label>Дата <input type="date" name="starts_on" value="' . h($start) . '"'
        . org_need_fill_class($start === '') . '></label>';
    echo '<label>Окончание <input type="date" name="ends_on" value="' . h($end) . '"></label>';
    echo '<label>Начало <input type="time" name="starts_at" value="' . h($stAt) . '"></label>';
    echo '<label>Конец <input type="time" name="ends_at" value="' . h($enAt) . '"></label>';
    echo '<label>Ярлык <input name="slug" value="' . h($slug) . '"></label>';
    echo '<label>Zoom <input name="zoom_url" value="' . h($zoom) . '" placeholder="полный URL"'
        . org_need_fill_class($zoom === '') . '></label>';
    if (!$isNew && $ev) {
        $regUrl = portal_register_url($ev);
        if ($regUrl !== '') {
            $regAbs = rtrim(portal_public_base(), '/') . '/' . ltrim($regUrl, '/');
            echo '<div class="org-reg-link-row"><span class="org-reg-link-label">Регистрация</span>'
                . '<a href="' . h($regAbs) . '" target="_blank" rel="noopener">' . h($regAbs) . '</a>'
                . '<button type="button" class="org-copy-btn" data-copy="' . h($regAbs) . '">Скопировать</button>'
                . '</div>';
        }
    }
    org_echo_staff_table($roleMap, $ref, $orgPool, $referees, true, '', $type, $refereeAttrs);
    echo '<p class="org-attrs-actions"><button type="submit">' . ($isNew ? 'Создать' : 'Сохранить') . '</button></p>';
    echo '</form>';
    org_echo_test_actions($ev, $isNew);
    echo '</section>';
}

function org_echo_google_grid(array $ev, array $duels): void
{
    echo '<section class="card org-gg-wrap">';
    echo '<h2>Сетка (как в Google)</h2>';
    if (!$duels) {
        echo '<p class="muted">Поединков нет.</p></section>';
        return;
    }
    $year = substr(portal_event_date_start($ev), 0, 4);
    $rows = [
        ['year', 'Год'],
        ['meet', 'Встреча'],
        ['started', 'Начинал'],
        ['win', 'Победитель'],
        ['s1', 'Счет Команды 1'],
        ['s2', 'Счет Команды 2'],
        ['num', ''],
        ['sit', 'Ситуация'],
        ['p1', 'Участник'],
        ['s1n', 'Секундант'],
        ['p2', 'Участник'],
        ['s2n', 'Секундант'],
    ];
    for ($i = 1; $i <= 9; $i++) {
        $rows[] = ['jn' . $i, 'Судья ' . $i];
    }
    for ($i = 1; $i <= 9; $i++) {
        $rows[] = ['jv' . $i, 'Судья ' . $i . ' Голос'];
    }
    $rows[] = ['vid', 'Видео поединка'];
    $rows[] = ['rev', 'Разбор'];
    echo '<div class="org-gg-scroll"><table class="org-gg">';
    foreach ($rows as $row) {
        [$key, $lab] = $row;
        echo '<tr class="gg-' . h($key) . '">';
        echo '<th>' . h($lab) . '</th>';
        foreach ($duels as $idx => $d) {
            echo '<td>' . org_gg_cell($key, $d, $ev, $year, $idx + 1) . '</td>';
        }
        echo '</tr>';
    }
    echo '</table></div>';
    org_echo_review_editor();
    echo '</section>';
}

function org_echo_review_editor(): void
{
    echo '<div id="org-rv-editor" class="org-rv-editor" hidden>';
    echo '<form class="org-rv-card" id="org-rv-form" autocomplete="off">';
    echo '<h2 class="org-rv-title" id="org-rv-title">Добавить разбор</h2>';
    echo '<p class="org-rv-err" id="org-rv-err" hidden></p>';
    echo '<input type="hidden" id="org-rv-id" value="">';
    echo '<input type="hidden" id="org-rv-sit" value="">';
    echo '<input type="hidden" id="org-rv-duel" value="0">';
    echo '<input type="hidden" id="org-rv-event" value="0">';
    echo '<label class="org-rv-lab">Ссылка<input id="org-rv-url" type="url" required maxlength="1024" placeholder="https://"></label>';
    echo '<label class="org-rv-lab">Подпись<select id="org-rv-label">';
    echo '<option value="auto">авто (по ссылке)</option>';
    echo '<option value="разбор">разбор</option>';
    echo '<option value="материал">материал</option>';
    echo '</select><span class="org-rv-hint" id="org-rv-hint"></span></label>';
    echo '<label class="org-rv-lab">Дата<input id="org-rv-date" type="date"></label>';
    echo '<div class="org-rv-form-actions">';
    echo '<button type="submit">Сохранить</button>';
    echo '<button type="button" id="org-rv-cancel">Отмена</button>';
    echo '</div></form></div>';
    echo '<input type="hidden" id="org-events-csrf" value="' . h(portal_csrf_token()) . '">';
}

function org_echo_sit_labels_form(array $ev, array $duels, array $people, mysqli $db): void
{
    if (($ev['event_type'] ?? '') !== 'турнир' || !$duels) {
        return;
    }
    $eid = (int)$ev['id'];
    $sits = org_situations_list($db);
    $peopleJs = [];
    foreach ($people as $pid => $fio) {
        $peopleJs[] = ['id' => (int)$pid, 'name' => (string)$fio, 'applied' => false];
    }
    echo '<script type="application/json" id="org-events-json">'
        . json_encode(
            ['people' => $peopleJs, 'situations' => $sits],
            JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP
        )
        . '</script>';
    echo '<section class="card org-sit-ext" id="sit-ext">';
    echo '<h2>Ситуации не из банка</h2>';
    echo '<p class="muted">Название сюжета турнира без карточки в нашем банке. Можно выбрать из банка или вписать своё.</p>';
    echo '<form method="post">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_sit_labels_save">';
    echo '<input type="hidden" name="event_id" value="' . $eid . '">';
    echo '<div class="org-slots-scroll"><table class="org-slots org-sit-ext-table">';
    echo '<thead><tr><th>#</th><th>Состав</th><th>Ситуация</th></tr></thead><tbody>';
    foreach ($duels as $i => $d) {
        $did = (int)$d['id'];
        $who = trim(implode(' — ', array_filter([(string)($d['p1'] ?? ''), (string)($d['p2'] ?? '')])));
        echo '<tr><td class="org-slot-n">' . ($i + 1)
            . '<input type="hidden" name="duel_id[]" value="' . $did . '"></td>';
        echo '<td>' . h($who !== '' ? $who : '—') . '</td><td>';
        org_echo_combo(
            'situation_id[]',
            (int)($d['situation_id'] ?? 0),
            org_sit_cell_label($d),
            'sit',
            'sit_label[]',
            (string)($d['sit_url'] ?? '')
        );
        echo '</td></tr>';
    }
    echo '</tbody></table></div>';
    echo '<p class="org-attrs-actions"><button type="submit">Сохранить подписи</button></p>';
    echo '</form></section>';
}

function org_gg_cell(string $key, array $d, array $ev, string $year, int $n): string
{
    $judges = $d['judge_rows'] ?? [];
    if ($key === 'year') {
        return h($year !== '' ? $year . ' год' : '');
    }
    if ($key === 'meet') {
        return h((string)$ev['title']);
    }
    if ($key === 'started') {
        return '';
    }
    if ($key === 'win') {
        $w = (int)($d['winner'] ?? 0);
        return $w === 0 ? 'ничья' : ('Команда ' . $w);
    }
    if ($key === 's1') {
        return (string)(int)($d['v1'] ?? 0);
    }
    if ($key === 's2') {
        return (string)(int)($d['v2'] ?? 0);
    }
    if ($key === 'num') {
        return 'Поединок ' . $n;
    }
    if ($key === 'sit') {
        $lab = (string)($d['sit'] ?? '');
        $url = (string)($d['sit_url'] ?? '');
        return $url !== ''
            ? '<a href="' . h($url) . '" target="_blank" rel="noopener">' . h($lab) . '</a>'
            : h($lab);
    }
    if ($key === 'p1') {
        return h((string)($d['p1'] ?? ''));
    }
    if ($key === 's1n') {
        return h((string)($d['s1'] ?? ''));
    }
    if ($key === 'p2') {
        return h((string)($d['p2'] ?? ''));
    }
    if ($key === 's2n') {
        return h((string)($d['s2'] ?? ''));
    }
    if (preg_match('/^jn(\d+)$/', $key, $m)) {
        $j = $judges[(int)$m[1] - 1] ?? null;
        return $j ? h((string)$j['name']) : '';
    }
    if (preg_match('/^jv(\d+)$/', $key, $m)) {
        $j = $judges[(int)$m[1] - 1] ?? null;
        return $j ? h((string)$j['vote']) : '';
    }
    if ($key === 'vid') {
        $u = (string)($d['video'] ?? '');
        return $u !== '' ? '<a href="' . h($u) . '" target="_blank" rel="noopener">Видео</a>' : '';
    }
    if ($key === 'rev') {
        return org_gg_review_cell($d, $ev);
    }
    return '';
}

function org_gg_review_cell(array $d, array $ev): string
{
    $did = (int)($d['id'] ?? 0);
    $eid = (int)($ev['id'] ?? 0);
    $sitId = (int)($d['situation_id'] ?? 0);
    if ($sitId <= 0) {
        $sitId = (int)($d['review_situation_id'] ?? 0);
    }
    $iso = trim((string)($d['review_iso'] ?? ''));
    if ($iso === '' || str_starts_with($iso, '0000')) {
        $iso = trim((string)($d['date'] ?? ''));
    }
    if ($iso === '' || str_starts_with($iso, '0000')) {
        $iso = trim((string)($ev['starts_on'] ?? ''));
    }
    if (str_starts_with($iso, '0000')) {
        $iso = '';
    }
    $attrs = ' data-duel-id="' . $did . '" data-event-id="' . $eid . '" data-sit-id="' . $sitId . '"';
    if ($iso !== '') {
        $attrs .= ' data-iso="' . h(substr($iso, 0, 10)) . '"';
    }
    $rev = (string)($d['review'] ?? '');
    $revId = (int)($d['review_id'] ?? 0);
    if ($rev !== '' && $revId > 0) {
        $lab = trim((string)($d['review_label'] ?? 'разбор')) ?: 'разбор';
        $title = trim((string)($d['review_title'] ?? ''));
        $attrs .= ' data-review-id="' . $revId . '" data-url="' . h($rev) . '"';
        if ($title !== '') {
            $attrs .= ' data-title="' . h($title) . '"';
        }
        $html = '<a href="' . h($rev) . '" target="_blank" rel="noopener">'
            . h($lab) . '</a>';
        $html .= '<span class="org-rv-acts">';
        $html .= '<button type="button" class="org-rv-act" data-review-edit="1"' . $attrs . '>править</button>';
        $html .= '<button type="button" class="org-rv-act org-rv-act--del" data-review-delete="1"'
            . $attrs . '>удалить</button>';
        $html .= '</span>';
        return $html;
    }
    return '<button type="button" class="org-rv-act org-rv-act--add" data-review-add="1"'
        . $attrs . '>+ Добавить</button>';
}

function org_echo_slots_card(
    array $ev,
    array $duels,
    array $regs,
    array $people,
    ?mysqli $db = null,
    ?array $metrics = null
): void {
    $eid = (int)$ev['id'];
    $applied = [];
    foreach ($regs as $r) {
        $pid = (int)($r['id'] ?? 0);
        if ($pid > 0) {
            $applied[$pid] = true;
        }
    }
    $sits = $db ? org_situations_list($db) : [];
    $pairHist = $db ? org_pairs_pair_history($db, $eid) : [];
    // «Подтвердил участие»: карта по person_id + сводка по игрокам сетки.
    $confirmed = [];
    foreach ($regs as $r) {
        $cpid = (int)($r['id'] ?? 0);
        if ($cpid > 0 && !empty($r['confirmed'])) {
            $confirmed[$cpid] = true;
        }
    }
    $gridPids = [];
    foreach ($duels as $d) {
        foreach ([(int)($d['p1_id'] ?? 0), (int)($d['p2_id'] ?? 0)] as $gpid) {
            if ($gpid > 0) {
                $gridPids[$gpid] = true;
            }
        }
    }
    $gridTotal = count($gridPids);
    $gridOk = 0;
    foreach (array_keys($gridPids) as $gpid) {
        if (isset($confirmed[$gpid])) {
            $gridOk++;
        }
    }
    $hasRepeat = false;
    foreach ($duels as $d) {
        $rp1 = (int)($d['p1_id'] ?? 0);
        $rp2 = (int)($d['p2_id'] ?? 0);
        if ($rp1 > 0 && $rp2 > 0 && $rp1 !== $rp2
            && isset($pairHist[min($rp1, $rp2) . '|' . max($rp1, $rp2)])
        ) {
            $hasRepeat = true;
            break;
        }
    }
    $confirmBox = static function (int $pid) use ($confirmed): string {
        if ($pid <= 0) {
            return '';
        }
        return '<label class="org-confirm" title="Отметить, что человек подтвердил участие"><input type="checkbox" class="org-confirm-box" data-pid="'
            . $pid . '"' . (isset($confirmed[$pid]) ? ' checked' : '') . '>подтв.</label>';
    };
    $peopleJs = [];
    foreach ($people as $pid => $fio) {
        $peopleJs[] = [
            'id' => (int)$pid,
            'name' => (string)$fio,
            'applied' => isset($applied[(int)$pid]),
        ];
    }
    echo '<script type="application/json" id="org-events-json">'
        . json_encode(
            ['people' => $peopleJs, 'situations' => $sits],
            JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP
        )
        . '</script>';

    echo '<section class="card org-slots-card" id="slots">';
    echo '<h2>Слоты'
        . ($gridTotal > 0
            ? ' <span class="org-slots-confirm-sum" title="Сколько игроков из сетки подтвердили участие">подтвердили '
                . $gridOk . ' из ' . $gridTotal . '</span>'
            : '')
        . '</h2>';
    if ($hasRepeat) {
        echo '<p class="org-slots-legend"><span class="org-slots-legend-dot"></span>'
            . 'Оранжевая строка — эта пара уже играла раньше</p>';
    }
    if ($metrics) {
        $namesTip = static function (array $names): string {
            return $names !== [] ? implode(', ', $names) : 'никого';
        };
        echo '<div class="org-funnel">';
        echo '<div class="org-funnel-head">Воронка стрима '
            . '<span class="org-funnel-hint" title="Кого это мероприятие двигает по воронке. Считаем по всем участникам сетки: игроки, секунданты (парный) и судьи.">'
            . '— кого двигает этот онлайн</span></div>';
        echo '<ul class="org-funnel-list">';
        echo '<li title="1-й раз посудят: ' . h($namesTip($metrics['judge_first_names'])) . '">1-й раз посудит <b>'
            . (int)$metrics['judge_first'] . '</b></li>';
        echo '<li title="1-й раз сыграют: ' . h($namesTip($metrics['play_first_names'])) . '">1-й раз сыграет <b>'
            . (int)$metrics['play_first'] . '</b></li>';
        echo '<li title="Сыграют второй раз: ' . h($namesTip($metrics['play_second_names'])) . '">сыграет второй раз <b>'
            . (int)$metrics['play_second'] . '</b></li>';
        echo '<li title="Достигнут целей стрима: ' . h($namesTip($metrics['reach_goal_names'])) . '">достигнет целей стрима <b>'
            . (int)$metrics['reach_goal'] . '</b></li>';
        echo '<li title="Станет наставником: ' . h($namesTip($metrics['become_mentor_names'])) . '">станет наставником <b>'
            . (int)$metrics['become_mentor'] . '</b></li>';
        echo '</ul>';
        echo '</div>';
    }
    echo '<form method="post" id="org-slots-form">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_slots_save">';
    echo '<input type="hidden" name="event_id" value="' . $eid . '">';
    echo '<div class="org-slots-scroll"><table class="org-slots">';
    echo '<thead><tr><th>#</th><th>Дата</th><th>Тип</th><th>Ситуация</th>'
        . '<th>Игрок 1</th><th>Секундант 1</th><th>Игрок 2</th><th>Секундант 2</th>'
        . '<th title="Зафиксировать слот: при генерации пар он не меняется">Фикс.</th><th></th></tr></thead><tbody>';
    foreach ($duels as $i => $d) {
        $did = (int)$d['id'];
        $rp1 = (int)($d['p1_id'] ?? 0);
        $rp2 = (int)($d['p2_id'] ?? 0);
        $pairRec = null;
        if ($rp1 > 0 && $rp2 > 0 && $rp1 !== $rp2) {
            $pairRec = $pairHist[min($rp1, $rp2) . '|' . max($rp1, $rp2)] ?? null;
        }
        $repeatTip = '';
        if ($pairRec) {
            $n = (int)$pairRec['count'];
            $mod10 = $n % 10;
            $mod100 = $n % 100;
            $word = ($mod10 === 1 && $mod100 !== 11)
                ? 'раз'
                : (($mod10 >= 2 && $mod10 <= 4 && ($mod100 < 12 || $mod100 > 14)) ? 'раза' : 'раз');
            $repeatTip = 'Эта пара уже играла: ' . $n . ' ' . $word
                . ($pairRec['last'] !== '' ? ', последний раз ' . $pairRec['last'] : '');
        }
        $isLocked = !empty($d['gen_locked']);
        $rowClass = [];
        if ($pairRec) {
            $rowClass[] = 'org-slot-repeat';
        }
        if ($isLocked) {
            $rowClass[] = 'org-slot-locked';
        }
        $rowAttrs = $rowClass ? ' class="' . implode(' ', $rowClass) . '"' : '';
        if ($repeatTip !== '') {
            $rowAttrs .= ' title="' . h($repeatTip) . '"';
        }
        echo '<tr' . $rowAttrs . '>';
        echo '<td class="org-slot-n">' . ($i + 1) . '<input type="hidden" name="duel_id[]" value="' . $did . '"></td>';
        echo '<td><input type="date" class="org-cell-in" name="duel_date[]" value="'
            . h((string)($d['date'] ?? $ev['starts_on'] ?? '')) . '"></td>';
        echo '<td><select class="org-cell-in" name="duel_type[]">';
        foreach (org_duel_types() as $t) {
            echo '<option' . (($d['type'] ?? '') === $t ? ' selected' : '') . '>' . h($t) . '</option>';
        }
        echo '</select></td>';
        echo '<td>';
        org_echo_combo('situation_id[]', (int)($d['situation_id'] ?? 0), org_sit_cell_label($d), 'sit', 'sit_label[]', (string)($d['sit_url'] ?? ''));
        echo '</td><td class="org-slot-p1">';
        org_echo_combo('p1[]', (int)($d['p1_id'] ?? 0), (string)($d['p1'] ?? ''), 'person');
        echo $confirmBox((int)($d['p1_id'] ?? 0));
        echo '</td><td>';
        org_echo_combo('s1[]', (int)($d['s1_id'] ?? 0), (string)($d['s1'] ?? ''), 'person');
        echo '</td><td>';
        org_echo_combo('p2[]', (int)($d['p2_id'] ?? 0), (string)($d['p2'] ?? ''), 'person');
        echo $confirmBox((int)($d['p2_id'] ?? 0));
        echo '</td><td>';
        org_echo_combo('s2[]', (int)($d['s2_id'] ?? 0), (string)($d['s2'] ?? ''), 'person');
        echo '</td><td class="org-slot-lock">';
        echo '<label title="Зафиксировать пару: генерация не изменит этот слот">'
            . '<input type="checkbox" name="lock[' . $i . ']" value="1"'
            . ($isLocked ? ' checked' : '') . '></label>';
        echo '</td><td class="org-slot-x">';
        echo '<button type="submit" form="slot-del-' . $did . '" class="btn-ghost">×</button>';
        echo '</td></tr>';
    }
    echo '</tbody></table></div></form>';
    echo '<div class="org-slots-actions">';
    if ($duels) {
        echo '<button type="submit" form="org-slots-form">Сохранить сетку</button>';
    }
    echo '<form method="post" class="org-inline" id="org-slot-add">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_slot_add">';
    echo '<input type="hidden" name="event_id" value="' . $eid . '">';
    echo '<button type="submit">Добавить слот</button></form>';
    echo '<form method="post" class="org-inline" id="org-gen-pairs-form">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_gen_pairs">';
    echo '<input type="hidden" name="event_id" value="' . $eid . '">';
    echo '<button type="submit" id="org-gen-pairs" title="Собрать игроков в пары из заявок (классика/экспресс)">'
        . 'Сгенерировать пары из заявок</button>';
    echo '</form>';
    echo '<form method="post" class="org-inline" id="org-slots-clear-form">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_slots_clear">';
    echo '<input type="hidden" name="event_id" value="' . $eid . '">';
    echo '<button type="submit" title="Снять игроков и секундантов со всех незафиксированных слотов (типы, судьи и зафиксированные пары остаются)">'
        . 'Очистить сетку</button>';
    echo '</form>';
    echo '</div>';
    echo '<form method="post" id="org-reg-confirm-form" class="org-hidden">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_reg_confirm">';
    echo '<input type="hidden" name="event_id" value="' . $eid . '">';
    echo '<input type="hidden" name="person_id" value="">';
    echo '<input type="hidden" name="confirmed" value="">';
    echo '</form>';
    foreach ($duels as $d) {
        $did = (int)$d['id'];
        echo '<form method="post" id="slot-del-' . $did . '" class="org-hidden">';
        portal_csrf_field();
        echo '<input type="hidden" name="action" value="org_slot_delete">';
        echo '<input type="hidden" name="event_id" value="' . $eid . '">';
        echo '<input type="hidden" name="duel_id" value="' . $did . '">';
        echo '</form>';
    }
    echo '</section>';
}

function org_echo_plan_side(array $ev, array $regs, array $career = [], array $duels = []): void
{
    $eid = (int)$ev['id'];
    $inGrid = [];
    $gridRoles = [];
    foreach ($duels as $d) {
        foreach ([
            'p1_id' => 'игра',
            'p2_id' => 'игра',
            's1_id' => 'секунд',
            's2_id' => 'секунд',
        ] as $key => $role) {
            $gpid = (int)($d[$key] ?? 0);
            if ($gpid > 0) {
                $inGrid[$gpid] = true;
                $gridRoles[$gpid][$role] = true;
            }
        }
    }
    echo '<aside class="org-plan-side" id="regs">';
    echo '<section class="card org-regs-card">';
    $regTotal = count($regs);
    $nClassic = 0;
    $nExpress = 0;
    $nAny = 0;
    $nJudge = 0;
    $nSecond = 0;
    foreach ($regs as $r) {
        if (!empty($r['play'])) {
            $pref = trim((string)($r['duel_type_pref'] ?? ''));
            if ($pref === 'классика') {
                $nClassic++;
            } elseif ($pref === 'экспресс') {
                $nExpress++;
            } else {
                $nAny++;
            }
        }
        if (!empty($r['judge'])) {
            $nJudge++;
        }
        if (!empty($r['second'])) {
            $nSecond++;
        }
    }
    echo '<h2>Заявки <span class="org-regs-total">всего ' . $regTotal . '</span></h2>';
    if ($regs) {
        echo '<div class="org-reg-tiles">';
        echo '<div class="org-reg-tile" title="Хотят играть классику"><b>' . $nClassic
            . '</b><span>клас.</span></div>';
        echo '<div class="org-reg-tile" title="Хотят играть экспресс"><b>' . $nExpress
            . '</b><span>экспр.</span></div>';
        echo '<div class="org-reg-tile" title="Хотят играть, тип не указан"><b>' . $nAny
            . '</b><span>не указано</span></div>';
        echo '<div class="org-reg-tile" title="Хотят судить"><b>' . $nJudge . '</b><span>судить</span></div>';
        echo '<div class="org-reg-tile" title="Хотят секундировать"><b>' . $nSecond
            . '</b><span>секунд.</span></div>';
        echo '</div>';
    }
    if (!$regs) {
        echo '<p class="muted">Пока никого. Это не слоты сетки — сюда собираем желающих.</p>';
    } else {
        usort($regs, static function ($a, $b) use ($career) {
            $ca = $career[(int)($a['id'] ?? 0)] ?? [];
            $cb = $career[(int)($b['id'] ?? 0)] ?? [];
            $ha = org_reg_heat($ca);
            $hb = org_reg_heat($cb);
            if ($ha !== $hb) {
                return $hb <=> $ha;
            }
            $da = (string)($ca['last_judged'] ?? '');
            $dbd = (string)($cb['last_judged'] ?? '');
            return $dbd <=> $da ?: strcmp((string)$a['name'], (string)$b['name']);
        });
        echo '<div class="org-regs-scroll">';
        echo '<table class="org-regs-table">';
        echo '<thead><tr><th>Имя</th><th>Роли</th><th>Тип</th><th>Комм.</th><th></th></tr></thead>';
        echo '<tbody>';
        foreach ($regs as $r) {
            $roles = [];
            if ($r['play']) {
                $roles[] = 'игра';
            }
            if ($r['judge']) {
                $roles[] = 'судья';
            }
            if ($r['second']) {
                $roles[] = 'секунд';
            }
            $typePref = trim((string)($r['duel_type_pref'] ?? ''));
            $c = $career[(int)($r['id'] ?? 0)] ?? [];
            $rec = $c ? org_star_rec($c, $r) : ['text' => '', 'kind' => ''];
            $rid = (int)($r['reg_id'] ?? 0);
            $hasEdit = $rid > 0;
            $comment = trim((string)$r['comment']);
            $regPidRow = (int)($r['id'] ?? 0);
            $rowIsInGrid = $regPidRow > 0 && isset($inGrid[$regPidRow]);
            $gridTip = '';
            if ($rowIsInGrid) {
                $gridTip = ' title="Включён в сетку слотов: '
                    . h(implode(', ', array_keys($gridRoles[$regPidRow] ?? []))) . '"';
            }

            echo '<tr class="org-reg-view' . ($rowIsInGrid ? ' org-reg-in-grid' : '') . '" data-reg-row="' . $rid . '"' . $gridTip . '>';
            echo '<td class="org-reg-name">';
            $regPid = (int)($r['id'] ?? 0);
            $regName = h($r['name']);
            if ($regPid > 0) {
                echo '<strong><a class="org-person-link" href="'
                    . h(portal_org_url('people') . '&person=' . $regPid)
                    . '" target="_blank" rel="noopener" title="Открыть карточку человека">' . $regName . '</a></strong>';
            } else {
                echo '<strong>' . $regName . '</strong>';
            }
            if ($rowIsInGrid) {
                echo ' <span class="org-reg-flag org-reg-flag-grid" title="Попал в сетку слотов">в сетке</span>';
            }
            if (!empty($r['org_no_play'])) {
                echo ' <span class="org-reg-flag" title="Пометка орга: не играть">не играть</span>';
            }
            if (!empty($r['confirmed'])) {
                echo ' <span class="org-reg-flag org-reg-flag-ok" title="Подтвердил участие">подтв.</span>';
            }
            $bannedView = org_pairs_parse_banned((string)($r['org_banned_types'] ?? ''));
            if ($bannedView) {
                echo ' <span class="org-reg-flag" title="Пометка орга: запрещённые типы">⊘ ' . h(implode(', ', array_keys($bannedView))) . '</span>';
            }
            if (($rec['text'] ?? '') !== '') {
                $kind = (string)($rec['kind'] ?? 'next');
                echo '<span class="org-rec org-rec-' . h($kind) . '">' . h((string)$rec['text']) . '</span>';
            }
            echo '</td>';
            echo '<td class="org-reg-roles">' . h($roles ? implode(', ', $roles) : '—') . '</td>';
            echo '<td class="org-reg-type">' . h($typePref !== '' ? $typePref : '—') . '</td>';
            echo '<td class="org-reg-comment"' . ($comment !== '' ? ' title="' . h($comment) . '"' : '') . '>' . h($comment !== '' ? mb_strimwidth($comment, 0, 28, '…') : '—') . '</td>';
            echo '<td class="org-reg-actions">';
            if ($hasEdit) {
                echo '<button type="button" class="btn-ghost org-reg-edit-btn" title="Править заявку">править</button>';
                echo '<button type="submit" form="reg-del-' . $rid . '" class="btn-ghost org-reg-x" title="Убрать из заявки">×</button>';
            }
            echo '</td>';
            echo '</tr>';

            if ($hasEdit) {
                echo '<tr class="org-reg-edit" hidden data-reg-edit="' . $rid . '">';
                echo '<td colspan="5">';
                echo '<form method="post" class="org-reg-edit-form" id="reg-edit-' . $rid . '">';
                portal_csrf_field();
                echo '<input type="hidden" name="action" value="org_reg_update">';
                echo '<input type="hidden" name="event_id" value="' . $eid . '">';
                echo '<input type="hidden" name="reg_id" value="' . $rid . '">';
                echo '<div class="org-reg-edit-line">';
                echo '<label class="org-reg-edit-role"><input type="checkbox" name="wants_play" value="1"' . ($r['play'] ? ' checked' : '') . '> играть</label>';
                echo '<label class="org-reg-edit-role"><input type="checkbox" name="wants_judge" value="1"' . ($r['judge'] ? ' checked' : '') . '> судить</label>';
                echo '<label class="org-reg-edit-role"><input type="checkbox" name="wants_second" value="1"' . ($r['second'] ? ' checked' : '') . '> секунд</label>';
                echo '<label class="org-reg-edit-type">тип <select name="duel_type_pref">' . org_duel_type_pref_options($typePref) . '</select></label>';
                echo '<label class="org-reg-edit-comment">комм. <textarea name="comment" rows="1" maxlength="2000">' . h($comment) . '</textarea></label>';
                echo '</div>';
                echo '<div class="org-reg-edit-line org-reg-edit-org">';
                echo '<span class="org-reg-edit-org-label" title="Пометки орга видны только организатору">пометки орга:</span>';
                echo '<label class="org-reg-edit-role"><input type="checkbox" name="org_no_play" value="1"' . (!empty($r['org_no_play']) ? ' checked' : '') . '> не играть</label>';
                $banned = org_pairs_parse_banned((string)($r['org_banned_types'] ?? ''));
                foreach (org_duel_types() as $bt) {
                    echo '<label class="org-reg-edit-role"><input type="checkbox" name="org_banned_types[]" value="' . h($bt) . '"'
                        . (isset($banned[$bt]) ? ' checked' : '') . '> не ' . h($bt) . '</label>';
                }
                echo '</div>';
                echo '<div class="org-reg-edit-actions">';
                echo '<button type="submit" class="btn-ghost">Сохранить</button>';
                echo '<button type="button" class="btn-ghost org-reg-edit-cancel">Отмена</button>';
                echo '</div>';
                echo '</form>';
                echo '</td>';
                echo '</tr>';
            }
        }
        echo '</tbody></table></div>';
    }
    echo '<form method="post" class="org-reg-add" id="org-reg-add-form">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_reg_add">';
    echo '<input type="hidden" name="event_id" value="' . $eid . '">';
    echo '<div class="org-combo" data-combo="reg-add">';
    echo '<input type="hidden" name="person_id" value="0">';
    echo '<input type="text" class="org-cell-in" placeholder="добавить человека…" autocomplete="off">';
    echo '</div></form>';
    echo '</section>';
    echo '</aside>';
    foreach ($regs as $r) {
        $rid = (int)($r['reg_id'] ?? 0);
        if ($rid <= 0) {
            continue;
        }
        echo '<form method="post" id="reg-del-' . $rid . '" class="org-hidden">';
        portal_csrf_field();
        echo '<input type="hidden" name="action" value="org_reg_remove">';
        echo '<input type="hidden" name="event_id" value="' . $eid . '">';
        echo '<input type="hidden" name="reg_id" value="' . $rid . '">';
        echo '</form>';
    }
}

/**
 * Участники мероприятия типа «обучение». На обучении роли (играть/судить/
 * секунд) и типы поединков не применяются — показываем только записавшихся,
 * с возможностью добавить или убрать человека вручную.
 */
function org_echo_event_participants(array $ev, array $regs, array $people = []): void
{
    $eid = (int)$ev['id'];
    $came = 0;
    $applied = [];
    foreach ($regs as $r) {
        if (($r['attended'] ?? null) === true) {
            $came++;
        }
        $pid = (int)($r['id'] ?? 0);
        if ($pid > 0) {
            $applied[$pid] = true;
        }
    }
    $peopleJs = [];
    foreach ($people as $pid => $fio) {
        $peopleJs[] = [
            'id' => (int)$pid,
            'name' => (string)$fio,
            'applied' => isset($applied[(int)$pid]),
        ];
    }
    echo '<script type="application/json" id="org-events-json">'
        . json_encode(
            ['people' => $peopleJs, 'situations' => []],
            JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP
        )
        . '</script>';
    echo '<section class="card org-regs-card" id="regs">';
    echo '<h2>Участники <span class="org-regs-total">всего ' . count($regs)
        . ($came > 0 ? ' · пришли ' . $came : '') . '</span></h2>';
    if (!$regs) {
        echo '<p class="muted">Пока никто не записался.</p>';
    } else {
        echo '<form method="post" id="org-reg-attendance-form">';
        portal_csrf_field();
        echo '<input type="hidden" name="action" value="org_reg_attendance">';
        echo '<input type="hidden" name="event_id" value="' . $eid . '">';
        echo '<div class="org-regs-scroll">';
        echo '<table class="org-regs-table org-regs-att-table">';
        echo '<thead><tr><th>Имя</th><th>Пришёл</th><th>Комментарий</th><th></th></tr></thead>';
        echo '<tbody>';
        foreach ($regs as $r) {
            $rid = (int)($r['reg_id'] ?? 0);
            $comment = trim((string)($r['comment'] ?? ''));
            $att = $r['attended'] ?? null;
            $orgComment = (string)($r['att_comment'] ?? '');
            echo '<tr>';
            echo '<td class="org-reg-name"><strong>' . h($r['name']) . '</strong>';
            if ($comment !== '') {
                echo '<span class="org-reg-name-note" title="' . h($comment) . '">'
                    . h(mb_strimwidth($comment, 0, 40, '…')) . '</span>';
            }
            echo '</td>';
            echo '<td class="org-reg-att"><select class="org-cell-in" name="attended[' . $rid . ']">';
            echo '<option value=""' . ($att === null ? ' selected' : '') . '>—</option>';
            echo '<option value="1"' . ($att === true ? ' selected' : '') . '>пришёл</option>';
            echo '<option value="0"' . ($att === false ? ' selected' : '') . '>не пришёл</option>';
            echo '</select></td>';
            echo '<td class="org-reg-att-comment"><input type="text" class="org-cell-in" name="att_comment['
                . $rid . ']" value="' . h($orgComment) . '" placeholder="комментарий"></td>';
            echo '<td class="org-reg-actions">';
            if ($rid > 0) {
                echo '<button type="submit" form="reg-del-' . $rid
                    . '" class="btn-ghost org-reg-x" title="Убрать из списка">×</button>';
            }
            echo '</td>';
            echo '</tr>';
        }
        echo '</tbody></table></div>';
        echo '<div class="org-reg-att-actions"><button type="submit">Сохранить посещаемость</button></div>';
        echo '</form>';
    }
    echo '<form method="post" class="org-reg-add" id="org-reg-add-form">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="org_reg_add">';
    echo '<input type="hidden" name="event_id" value="' . $eid . '">';
    echo '<div class="org-combo" data-combo="reg-add">';
    echo '<input type="hidden" name="person_id" value="0">';
    echo '<input type="text" class="org-cell-in" placeholder="добавить человека…" autocomplete="off">';
    echo '</div></form>';
    echo '</section>';
    foreach ($regs as $r) {
        $rid = (int)($r['reg_id'] ?? 0);
        if ($rid <= 0) {
            continue;
        }
        echo '<form method="post" id="reg-del-' . $rid . '" class="org-hidden">';
        portal_csrf_field();
        echo '<input type="hidden" name="action" value="org_reg_remove">';
        echo '<input type="hidden" name="event_id" value="' . $eid . '">';
        echo '<input type="hidden" name="reg_id" value="' . $rid . '">';
        echo '</form>';
    }
}

function org_echo_event_recs(
    array $ev,
    array $duels,
    array $regs,
    array $attract,
    array $career,
    ?mysqli $db
): void {
    $eid = (int)$ev['id'];
    $applied = [];
    foreach ($regs as $r) {
        $pid = (int)($r['id'] ?? 0);
        if ($pid > 0) {
            $applied[$pid] = true;
        }
    }
    $online = ($ev['event_type'] ?? '') === 'онлайн';
    $addPids = [];
    if ($online) {
        if ($db) {
            $addPids = org_echo_play_recs($db, $career, $duels, $regs, $eid);
        }
    } else {
        echo '<section class="card org-play-recs">';
        echo '<h2>Кого привлечь</h2>';
        if (!$attract) {
            echo '<p class="muted">Нет кандидатов без цели стрима вне сетки и заявок.</p>';
        } else {
            echo '<ul class="org-regs">';
            foreach ($attract as $a) {
                $pid = (int)($a['id'] ?? 0);
                echo '<li><strong>' . h($a['name']) . '</strong> <span class="muted">' . h($a['why']) . '</span>';
                if ($pid > 0 && !isset($applied[$pid])) {
                    org_echo_to_reg_btn($eid, $pid);
                    $addPids[$pid] = true;
                }
                echo '</li>';
            }
            echo '</ul>';
        }
        echo '</section>';
    }
    foreach (array_keys($addPids) as $pid) {
        org_echo_reg_add_form($eid, (int)$pid);
    }
}

/** @return array<int, true> pid для скрытых форм «в заявку» */
function org_echo_play_recs(mysqli $db, array $career, array $duels, array $regs, int $eventId): array
{
    $recs = $career ? org_play_recs($db, $career, $duels, $regs) : ['fresh' => [], 'orgs' => [], 'older' => []];
    $hint = '«Недавно судили, играли» — активность за 90 дней: судейство, игра или секундантство (секундантство только чтобы попасть в группу, на экране не пишем). Внутри: сыграть 1-ю, 2-ю, 3-ю игру. Затем «Организаторы ни разу не игравшие» — круг я-ИТ-ы, правление и прочие роли, не участники телеги, 0 игр; не стримовые организаторы. Затем «Судили, играли давно» — те же люди вне 90 дней, те же подгруппы. Уже в сетке, стримовых организаторов, гостей ФУБ без стрима и партнёров не показываем.';
    echo '<section class="card org-play-recs">';
    echo '<h2 class="org-play-recs-h">Кого привлечь';
    echo '<span class="org-recs-help">';
    echo '<span class="tip-ico" tabindex="0" role="button" aria-label="как составляем список">i</span>';
    echo '<span class="org-recs-tip">' . h($hint) . '</span>';
    echo '</span></h2>';
    $addPids = [];
    if (!$recs['fresh'] && !$recs['orgs'] && !$recs['older']) {
        echo '<p class="muted">Нет кандидатов без цели стрима вне сетки.</p></section>';
        return [];
    }
    if ($recs['fresh']) {
        echo '<div class="org-recs-tier org-recs-fresh">';
        echo '<h3>Недавно судили, играли</h3>';
        $addPids += org_echo_play_recs_by_need($db, $recs['fresh'], $eventId);
        echo '</div>';
    }
    if ($recs['orgs']) {
        echo '<div class="org-recs-tier org-recs-orgs">';
        echo '<h3>Организаторы ни разу не игравшие</h3>';
        $addPids += org_echo_play_recs_list($db, $recs['orgs'], $eventId);
        echo '</div>';
    }
    if ($recs['older']) {
        echo '<div class="org-recs-tier org-recs-older">';
        echo '<h3>Судили, играли давно</h3>';
        $addPids += org_echo_play_recs_by_need($db, $recs['older'], $eventId);
        echo '</div>';
    }
    echo '</section>';
    return $addPids;
}

/** @return array<int, true> */
function org_echo_play_recs_by_need(mysqli $db, array $rows, int $eventId): array
{
    $labels = [
        1 => 'сыграть 1-ю игру',
        2 => 'сыграть 2-ю игру',
        3 => 'сыграть 3-ю игру',
    ];
    $addPids = [];
    foreach ($labels as $need => $label) {
        $chunk = [];
        foreach ($rows as $row) {
            if ((int)($row['need'] ?? 0) === $need) {
                $chunk[] = $row;
            }
        }
        if (!$chunk) {
            continue;
        }
        echo '<div class="org-recs-sub org-recs-need-' . $need . '">';
        echo '<h4>' . h($label) . '</h4>';
        $addPids += org_echo_play_recs_list($db, $chunk, $eventId);
        echo '</div>';
    }
    return $addPids;
}

/** @return array<int, true> */
function org_echo_play_recs_list(mysqli $db, array $rows, int $eventId): array
{
    $inList = org_outreach_in_campaign_ids($db, $eventId);
    $addPids = [];
    echo '<ul class="org-regs org-play-list">';
    foreach ($rows as $a) {
        $pid = (int)($a['id'] ?? 0);
        echo '<li><strong>' . h((string)$a['name']) . '</strong>';
        if (!empty($a['applied'])) {
            echo '<span class="org-applied">заявка</span>';
        } elseif ($pid > 0 && isset($inList[$pid])) {
            echo '<span class="org-in-list">в списке</span>';
            org_echo_to_list_remove_btn($eventId, $pid);
        } elseif ($pid > 0) {
            org_echo_to_list_btn($eventId, $pid);
        }
        echo '</li>';
    }
    echo '</ul>';
    return $addPids;
}
