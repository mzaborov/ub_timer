<?php
declare(strict_types=1);

require_once __DIR__ . '/home_data.php';

function org_people_payload(mysqli $db): array
{
    $people = [];
    $r = $db->query(
        'SELECT id, full_name, email, telegram, telegram_id, is_active, notes
         FROM people ORDER BY full_name, id'
    );
    while ($row = $r->fetch_assoc()) {
        $pid = (int)$row['id'];
        $people[$pid] = [
            'id' => $pid,
            'name' => (string)$row['full_name'],
            'email' => (string)($row['email'] ?? ''),
            'telegram' => (string)($row['telegram'] ?? ''),
            'telegram_id' => (int)($row['telegram_id'] ?? 0),
            'active' => (int)$row['is_active'] === 1,
            'notes' => (string)($row['notes'] ?? ''),
            'games' => 0,
            'judged' => 0,
            'seconded' => 0,
            'memberships' => [],
        ];
    }
    $playedCond = portal_duel_played_sql('d', 'e');
    $r = $db->query(
        "SELECT d.player1_id, d.player2_id, d.duel_type, d.second1_id, d.second2_id
         FROM duels d JOIN events e ON e.id = d.event_id
         WHERE COALESCE(e.title, '') NOT LIKE 'ТЕСТ БД%'
           AND $playedCond"
    );
    while ($row = $r->fetch_assoc()) {
        foreach (['player1_id', 'player2_id'] as $k) {
            $pid = (int)($row[$k] ?? 0);
            if ($pid && isset($people[$pid])) {
                $people[$pid]['games']++;
            }
        }
        if (($row['duel_type'] ?? '') === 'парный') {
            foreach (['second1_id', 'second2_id'] as $k) {
                $pid = (int)($row[$k] ?? 0);
                if ($pid && isset($people[$pid])) {
                    $people[$pid]['games']++;
                }
            }
        }
        if (($row['duel_type'] ?? '') === 'классика') {
            foreach (['second1_id', 'second2_id'] as $k) {
                $pid = (int)($row[$k] ?? 0);
                if ($pid && isset($people[$pid])) {
                    $people[$pid]['seconded']++;
                }
            }
        }
    }
    $r = $db->query(
        "SELECT dj.person_id, COUNT(*) AS n
         FROM duel_judges dj
         JOIN duels d ON d.id = dj.duel_id
         JOIN events e ON e.id = d.event_id
         WHERE dj.person_id IS NOT NULL
           AND COALESCE(e.title, '') NOT LIKE 'ТЕСТ БД%'
           AND $playedCond
         GROUP BY dj.person_id"
    );
    while ($row = $r->fetch_assoc()) {
        $pid = (int)$row['person_id'];
        if (isset($people[$pid])) {
            $people[$pid]['judged'] = (int)$row['n'];
        }
    }
    $circles = [];
    $r = $db->query('SELECT id, title, parent_id, kind FROM circles ORDER BY id');
    while ($row = $r->fetch_assoc()) {
        $cid = (int)$row['id'];
        $circles[$cid] = [
            'id' => $cid,
            'title' => (string)$row['title'],
            'parentId' => $row['parent_id'] === null ? null : (int)$row['parent_id'],
            'kind' => (string)$row['kind'],
            'involvements' => [],
            'members' => 0,
        ];
    }
    $circlePeople = [];
    $r = $db->query(
        'SELECT circle_id, person_id, involvement FROM circle_memberships ORDER BY id'
    );
    while ($row = $r->fetch_assoc()) {
        $cid = (int)$row['circle_id'];
        $pid = (int)$row['person_id'];
        $inv = (string)$row['involvement'];
        if (!isset($people[$pid], $circles[$cid])) {
            continue;
        }
        $people[$pid]['memberships'][] = [
            'circleId' => $cid,
            'circle' => $circles[$cid]['title'],
            'involvement' => $inv,
        ];
        if (!isset($circles[$cid]['involvements'][$inv])) {
            $circles[$cid]['involvements'][$inv] = 0;
        }
        $circles[$cid]['involvements'][$inv]++;
        $circlePeople[$cid][$pid] = true;
    }
    foreach ($circles as $cid => &$c) {
        $c['members'] = isset($circlePeople[$cid]) ? count($circlePeople[$cid]) : 0;
        $invs = $c['involvements'];
        uksort($invs, static function ($a, $b) {
            $rank = ['Организатор' => 0, 'Куратор' => 1];
            $ra = $rank[$a] ?? 50;
            $rb = $rank[$b] ?? 50;
            return $ra <=> $rb ?: strcmp($a, $b);
        });
        $c['involvements'] = $invs;
    }
    unset($c);
    if (!function_exists('org_funnel_stage')) {
        require_once __DIR__ . '/org_events.php';
    }
    $inRating = org_people_in_rating($db);
    $skip = org_people_skip_ids($db);
    $funnelPeople = [];
    foreach ($people as &$p) {
        if (!org_people_in_funnel($p, $inRating, $skip)) {
            continue;
        }
        $f = org_people_funnel($p);
        $p['funnelNow'] = $f['now'];
        $p['funnelNext'] = $f['next'];
        $funnelPeople[] = $p;
    }
    unset($p);
    $funnel = org_people_funnel_board($funnelPeople);
    foreach ($people as &$p) {
        unset($p['seconded']);
    }
    unset($p);
    return [
        'people' => array_values($people),
        'circles' => array_values($circles),
        'funnel' => $funnel,
    ];
}

function org_person_in_circle(array $p, string $title): bool
{
    foreach ($p['memberships'] as $m) {
        if ((string)($m['circle'] ?? '') === $title) {
            return true;
        }
    }
    return false;
}

/** Член телеграм-чата: круг стрима, вовлечённость «участник чата телеграмм». */
function org_person_in_chat(array $p): bool
{
    foreach ($p['memberships'] as $m) {
        if ((string)($m['circle'] ?? '') === STREAM_CIRCLE
            && (string)($m['involvement'] ?? '') === 'участник чата телеграмм') {
            return true;
        }
    }
    return false;
}

/** Кто виден в таблице рейтинга: не гость (rating_skip_guests) и итоговый балл > 0. */
function org_people_in_rating(mysqli $db): array
{
    if (!function_exists('portal_rating_rows')) {
        require __DIR__ . '/rating.php';
    }
    $ids = [];
    foreach (portal_rating_rows($db) as $row) {
        $pid = (int)($row['pid'] ?? 0);
        if ($pid > 0) {
            $ids[$pid] = true;
        }
    }
    return $ids;
}

/** Гости ФУБ без стрима и оппоненты турнира вне стрима — та же функция, что в рейтинге. */
function org_people_skip_ids(mysqli $db): array
{
    if (!function_exists('rating_skip_guests')) {
        require __DIR__ . '/rating.php';
    }
    $circleRows = [];
    $r = $db->query(
        'SELECT cm.person_id, c.title, cm.involvement FROM circle_memberships cm
         JOIN circles c ON c.id = cm.circle_id'
    );
    while ($row = $r->fetch_assoc()) {
        $circleRows[] = $row;
    }
    $duelRows = [];
    $r = $db->query(
        'SELECT d.player1_id, d.second1_id, d.player2_id, d.second2_id, e.event_type
         FROM duels d JOIN events e ON e.id = d.event_id
         WHERE LTRIM(COALESCE(e.title, \'\')) NOT LIKE \'ТЕСТ БД%\''
    );
    while ($row = $r->fetch_assoc()) {
        $duelRows[] = $row;
    }
    return rating_skip_guests($circleRows, $duelRows);
}

/**
 * Воронка: участники рейтинга (балл > 0) плюс верхние ступени —
 * я-ИТ_ы A / чат / стрим при 0 игр и 0 суда. Гостей skip не берём.
 */
function org_people_in_funnel(array $p, array $inRating, array $skip): bool
{
    $pid = (int)$p['id'];
    if (isset($skip[$pid])) {
        return false;
    }
    if (isset($inRating[$pid])) {
        return true;
    }
    if ((int)($p['games'] ?? 0) > 0 || (int)($p['judged'] ?? 0) > 0) {
        return false;
    }
    return org_person_in_chat($p)
        || org_person_in_circle($p, COMMUNITY_A_CIRCLE)
        || org_person_in_circle($p, STREAM_CIRCLE);
}

function org_people_funnel_stages(): array
{
    return [
        [
            'key' => 'uninvolved',
            'title' => 'Непричастные ЧС',
            'hint' => 'В круге я-ИТ_ы A, но не в телеграм-чате. Без игр и суда.',
        ],
        [
            'key' => 'interested',
            'title' => 'Интересовались, не судили',
            'hint' => 'В телеграм-чате или в круге стрима. Ещё не судили и не играли.',
        ],
        [
            'key' => 'judged0',
            'title' => 'Посудили, но не играли',
            'hint' => 'Хотя бы раз судили, игр пока нет.',
        ],
        [
            'key' => 'g1',
            'title' => 'Сыграли 1',
            'hint' => 'Ровно одна игра.',
        ],
        [
            'key' => 'g2',
            'title' => 'Сыграли 2',
            'hint' => 'Ровно две игры.',
        ],
        [
            'key' => 'g3',
            'title' => 'Сыграли 3',
            'hint' => 'Три или четыре игры.',
        ],
        [
            'key' => 'many',
            'title' => 'Сыграли много',
            'hint' => 'Пять и больше игр, без секундантства.',
        ],
        [
            'key' => 'manysec',
            'title' => 'Сыграли много и секундировали',
            'hint' => 'Пять и больше игр и хотя бы раз секундировали.',
        ],
    ];
}

function org_people_funnel_key(array $p): string
{
    $g = (int)($p['games'] ?? 0);
    $j = (int)($p['judged'] ?? 0);
    $sec = (int)($p['seconded'] ?? 0);
    if ($g >= 5 && $sec > 0) {
        return 'manysec';
    }
    if ($g >= 5) {
        return 'many';
    }
    if ($g >= 3) {
        return 'g3';
    }
    if ($g === 2) {
        return 'g2';
    }
    if ($g === 1) {
        return 'g1';
    }
    if ($j > 0) {
        return 'judged0';
    }
    if (org_person_in_chat($p)) {
        return 'interested';
    }
    if (org_person_in_circle($p, COMMUNITY_CIRCLE)) {
        return 'uninvolved';
    }
    if (org_person_in_circle($p, STREAM_CIRCLE)) {
        return 'interested';
    }
    return '';
}

function org_people_funnel_title(string $key): string
{
    foreach (org_people_funnel_stages() as $s) {
        if ($s['key'] === $key) {
            return $s['title'];
        }
    }
    return $key;
}

function org_people_funnel_board(array $people): array
{
    $stages = [];
    $byKey = [];
    foreach (org_people_funnel_stages() as $i => $s) {
        $s['ids'] = [];
        $stages[] = $s;
        $byKey[$s['key']] = $i;
    }
    $events = [];
    $play1 = [];
    $play3 = [];
    foreach ($people as $p) {
        $pid = (int)$p['id'];
        $g = (int)($p['games'] ?? 0);
        $j = (int)($p['judged'] ?? 0);
        $sec = (int)($p['seconded'] ?? 0);
        if ($j > 0 || $g > 0 || $sec > 0) {
            $events[] = $pid;
        }
        if ($g >= 1) {
            $play1[] = $pid;
        }
        if ($g >= 3) {
            $play3[] = $pid;
        }
        $key = org_people_funnel_key($p);
        if (isset($byKey[$key])) {
            $stages[$byKey[$key]]['ids'][] = $pid;
        }
    }
    return [
        'note' => 'Рейтинг (балл > 0) плюс люди из я-ИТ-ы и чата без суда и игр. Гостей ФУБ не считаем.',
        'stages' => $stages,
        'goals' => [
            [
                'key' => 'events',
                'title' => 'ЧС участвовало в мероприятиях',
                'hint' => 'Судили, играли или секундировали хотя бы раз.',
                'ids' => $events,
            ],
            [
                'key' => 'play1',
                'title' => 'ЧС сыграло хотя бы 1 игру',
                'hint' => 'Сыграли хотя бы одну игру.',
                'ids' => $play1,
            ],
            [
                'key' => 'play3',
                'title' => 'ЧС сыграли 3+ игр',
                'hint' => 'Сыграли три игры или больше.',
                'ids' => $play3,
            ],
        ],
    ];
}

function org_people_funnel(array $p): array
{
    $key = org_people_funnel_key($p);
    $next = [
        'uninvolved' => 'добавить в стрим',
        'interested' => 'посудить на встрече',
        'judged0' => 'сыграть первую игру',
        'g1' => 'сыграть вторую игру',
        'g2' => 'сыграть третью игру',
        'g3' => 'сыграть до 5 игр',
        'many' => 'быть секундантом',
        'manysec' => org_funnel_goal_text(),
    ][$key] ?? '';
    return ['now' => org_people_funnel_title($key), 'next' => $next];
}

function org_mem_norm(string $s): string
{
    $s = trim($s);
    if ($s === '') {
        return '';
    }
    return function_exists('mb_substr') ? mb_substr($s, 0, 191) : substr($s, 0, 191);
}

function org_row_exists(mysqli $db, string $sql, string $types, array $args): bool
{
    $st = $db->prepare($sql);
    $st->bind_param($types, ...$args);
    $st->execute();
    $ok = (bool)$st->get_result()->fetch_row();
    $st->close();
    return $ok;
}

function org_mem_exists(mysqli $db, int $cid, int $pid, string $inv): bool
{
    return org_row_exists(
        $db,
        'SELECT id FROM circle_memberships
         WHERE circle_id = ? AND person_id = ? AND involvement = ? LIMIT 1',
        'iis',
        [$cid, $pid, $inv]
    );
}

function org_people_handle_post(mysqli $db): array
{
    if (!portal_csrf_ok((string)($_POST['csrf'] ?? ''))) {
        return ['error' => 'Сессия устарела, обновите страницу'];
    }
    $action = (string)($_POST['action'] ?? '');
    if ($action === 'org_mem_add') {
        return org_mem_add($db);
    }
    if ($action === 'org_mem_remove') {
        return org_mem_remove($db);
    }
    if ($action === 'org_circle_rename') {
        return org_circle_rename($db);
    }
    if ($action === 'org_inv_rename') {
        return org_inv_rename($db);
    }
    if ($action === 'org_inv_delete') {
        return org_inv_delete($db);
    }
    if ($action === 'org_person_add') {
        return org_person_add($db);
    }
    if ($action === 'org_person_delete') {
        return org_person_delete($db);
    }
    if ($action === 'org_person_stats') {
        $pid = (int)($_POST['person_id'] ?? 0);
        if ($pid < 1) {
            return ['error' => 'Не выбран человек'];
        }
        require_once __DIR__ . '/home_data.php';
        return [
            'stats' => portal_person_stats($db, $pid),
            'no_payload' => true,
        ];
    }
    return ['error' => 'Неизвестное действие'];
}

/** Игры/судейства в протоколах — блокируют удаление карточки. */
function org_person_has_protocol_data(mysqli $db, int $pid): bool
{
    if ($pid < 1) {
        return true;
    }
    if (org_row_exists(
        $db,
        'SELECT id FROM duels
         WHERE player1_id = ? OR player2_id = ? OR second1_id = ? OR second2_id = ?
         LIMIT 1',
        'iiii',
        [$pid, $pid, $pid, $pid]
    )) {
        return true;
    }
    return org_row_exists(
        $db,
        'SELECT id FROM duel_judges WHERE person_id = ? LIMIT 1',
        'i',
        [$pid]
    );
}

function org_person_delete(mysqli $db): array
{
    $pid = (int)($_POST['person_id'] ?? 0);
    if ($pid < 1) {
        return ['error' => 'Нужен человек'];
    }
    $st = $db->prepare('SELECT id, full_name FROM people WHERE id = ? LIMIT 1');
    $st->bind_param('i', $pid);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    if (!$row) {
        return ['error' => 'Человек не найден'];
    }
    if (org_person_has_protocol_data($db, $pid)) {
        return ['error' => 'Нельзя удалить: есть данные в протоколах (игры или судейства)'];
    }
    $name = (string)$row['full_name'];
    $db->begin_transaction();
    try {
        $st = $db->prepare('DELETE FROM circle_memberships WHERE person_id = ?');
        $st->bind_param('i', $pid);
        $st->execute();
        $st->close();
        $st = $db->prepare('DELETE FROM meeting_registrations WHERE person_id = ?');
        $st->bind_param('i', $pid);
        $st->execute();
        $st->close();
        $st = $db->prepare('DELETE FROM event_organizers WHERE person_id = ?');
        $st->bind_param('i', $pid);
        $st->execute();
        $st->close();
        $st = $db->prepare('DELETE FROM event_observers WHERE person_id = ?');
        $st->bind_param('i', $pid);
        $st->execute();
        $st->close();
        $st = $db->prepare('UPDATE events SET referee_person_id = NULL WHERE referee_person_id = ?');
        $st->bind_param('i', $pid);
        $st->execute();
        $st->close();
        $st = $db->prepare('UPDATE duel_change_log SET author_id = NULL WHERE author_id = ?');
        $st->bind_param('i', $pid);
        $st->execute();
        $st->close();
        $st = $db->prepare('DELETE FROM people WHERE id = ?');
        $st->bind_param('i', $pid);
        $st->execute();
        $st->close();
        $db->commit();
    } catch (Throwable $e) {
        $db->rollback();
        return ['error' => 'Не удалось удалить'];
    }
    require_once __DIR__ . '/portal_log.php';
    portal_log_write($db, 'delete', 'person', $pid, ['full_name' => $name]);
    return [];
}

function org_mem_add(mysqli $db): array
{
    $cidRaw = (string)($_POST['circle_id'] ?? '');
    $invSel = '';
    if (strpos($cidRaw, '|') !== false) {
        [$cidRaw, $invSel] = explode('|', $cidRaw, 2);
    }
    $cid = (int)$cidRaw;
    $pid = (int)($_POST['person_id'] ?? 0);
    $invRaw = org_mem_norm((string)($_POST['involvement'] ?? ''));
    if ($invSel === '__custom__') {
        $inv = $invRaw;
    } elseif ($invSel !== '') {
        $inv = org_mem_norm($invSel);
    } else {
        $inv = $invRaw;
    }
    if ($cid < 1 || $pid < 1 || $inv === '') {
        return ['error' => 'Нужны человек, круг и участие'];
    }
    if (!org_row_exists($db, 'SELECT id FROM circles WHERE id = ?', 'i', [$cid])) {
        return ['error' => 'Круг не найден'];
    }
    if (!org_row_exists($db, 'SELECT id FROM people WHERE id = ?', 'i', [$pid])) {
        return ['error' => 'Человек не найден'];
    }
    if (org_mem_exists($db, $cid, $pid, $inv)) {
        return org_person_mem_redirect($pid);
    }
    $st = $db->prepare(
        'INSERT INTO circle_memberships (circle_id, person_id, involvement) VALUES (?, ?, ?)'
    );
    $st->bind_param('iis', $cid, $pid, $inv);
    $st->execute();
    $st->close();
    return org_person_mem_redirect($pid);
}

function org_person_mem_redirect(int $pid): array
{
    if (empty($_POST['return_person'])) {
        return [];
    }
    return ['redirect' => portal_org_url('people') . '&person=' . $pid];
}

function org_mem_remove(mysqli $db): array
{
    $cid = (int)($_POST['circle_id'] ?? 0);
    $pid = (int)($_POST['person_id'] ?? 0);
    $inv = org_mem_norm((string)($_POST['involvement'] ?? ''));
    if ($cid < 1 || $pid < 1 || $inv === '') {
        return ['error' => 'Нужны человек, круг и участие'];
    }
    $st = $db->prepare(
        'DELETE FROM circle_memberships
         WHERE circle_id = ? AND person_id = ? AND involvement = ?'
    );
    $st->bind_param('iis', $cid, $pid, $inv);
    $st->execute();
    $st->close();
    return org_person_mem_redirect($pid);
}

function org_circle_rename(mysqli $db): array
{
    $cid = (int)($_POST['circle_id'] ?? 0);
    $title = org_mem_norm((string)($_POST['title'] ?? ''));
    if ($cid < 1 || $title === '') {
        return ['error' => 'Нужно название круга'];
    }
    if (!org_row_exists($db, 'SELECT id FROM circles WHERE id = ?', 'i', [$cid])) {
        return ['error' => 'Круг не найден'];
    }
    $st = $db->prepare('UPDATE circles SET title = ? WHERE id = ?');
    $st->bind_param('si', $title, $cid);
    $st->execute();
    $st->close();
    return [];
}

function org_inv_delete(mysqli $db): array
{
    $cid = (int)($_POST['circle_id'] ?? 0);
    $inv = org_mem_norm((string)($_POST['involvement'] ?? ''));
    if ($cid < 1 || $inv === '') {
        return ['error' => 'Нужны круг и участие'];
    }
    if (!org_row_exists($db, 'SELECT id FROM circles WHERE id = ?', 'i', [$cid])) {
        return ['error' => 'Круг не найден'];
    }
    $st = $db->prepare(
        'DELETE FROM circle_memberships WHERE circle_id = ? AND involvement = ?'
    );
    $st->bind_param('is', $cid, $inv);
    $st->execute();
    $st->close();
    return [];
}

function org_person_add(mysqli $db): array
{
    $name = org_mem_norm((string)($_POST['full_name'] ?? ''));
    $email = org_mem_norm((string)($_POST['email'] ?? ''));
    $telegram = org_mem_norm((string)($_POST['telegram'] ?? ''));
    $telegram = function_exists('mb_substr') ? mb_substr($telegram, 0, 64) : substr($telegram, 0, 64);
    if ($name === '') {
        return ['error' => 'Нужно ФИО'];
    }
    if (org_row_exists($db, 'SELECT id FROM people WHERE full_name = ?', 's', [$name])) {
        return ['error' => 'уже есть'];
    }
    $emailVal = $email !== '' ? $email : '';
    $tgVal = $telegram !== '' ? $telegram : '';
    $active = 1;
    $st = $db->prepare(
        'INSERT INTO people (full_name, email, telegram, is_active) VALUES (?, ?, ?, ?)'
    );
    $st->bind_param('sssi', $name, $emailVal, $tgVal, $active);
    $st->execute();
    $id = (int)$db->insert_id;
    $st->close();
    return ['person_id' => $id];
}

function org_inv_rename(mysqli $db): array
{
    $cid = (int)($_POST['circle_id'] ?? 0);
    $old = org_mem_norm((string)($_POST['old'] ?? ''));
    $new = org_mem_norm((string)($_POST['title'] ?? ''));
    if ($cid < 1 || $old === '' || $new === '') {
        return ['error' => 'Нужны круг и название участия'];
    }
    if ($old === $new) {
        return [];
    }
    if (!org_row_exists($db, 'SELECT id FROM circles WHERE id = ?', 'i', [$cid])) {
        return ['error' => 'Круг не найден'];
    }
    $st = $db->prepare(
        'SELECT id, person_id FROM circle_memberships
         WHERE circle_id = ? AND involvement = ?'
    );
    $st->bind_param('is', $cid, $old);
    $st->execute();
    $rows = $st->get_result()->fetch_all(MYSQLI_ASSOC);
    $st->close();
    if (!$rows) {
        return ['error' => 'Такого участия нет'];
    }
    foreach ($rows as $row) {
        $pid = (int)$row['person_id'];
        $id = (int)$row['id'];
        // Сравнение involvement в MySQL обычно CI: «п» = «П».
        // Нельзя считать «уже есть новое имя» по текущей же строке — иначе rename
        // только регистра удаляет членство, и узел пропадает из дерева.
        $other = org_row_exists(
            $db,
            'SELECT id FROM circle_memberships
             WHERE circle_id = ? AND person_id = ? AND involvement = ? AND id <> ? LIMIT 1',
            'iisi',
            [$cid, $pid, $new, $id]
        );
        if ($other) {
            $del = $db->prepare('DELETE FROM circle_memberships WHERE id = ?');
            $del->bind_param('i', $id);
            $del->execute();
            $del->close();
        } else {
            $up = $db->prepare('UPDATE circle_memberships SET involvement = ? WHERE id = ?');
            $up->bind_param('si', $new, $id);
            $up->execute();
            $up->close();
        }
    }
    return [];
}

function org_person_circle_tree(array $byParent, int $rootId, int $depth = 0): array
{
    if ($depth > 12) {
        return [];
    }
    $out = [];
    foreach ($byParent[$rootId] ?? [] as $c) {
        $out[] = ['circle' => $c, 'depth' => $depth];
        $out = array_merge($out, org_person_circle_tree($byParent, (int)$c['id'], $depth + 1));
    }
    return $out;
}

function org_person_circle_path(array $circleById, int $cid): string
{
    $parts = [];
    $guard = 0;
    while ($cid > 0 && isset($circleById[$cid]) && $guard++ < 20) {
        $c = $circleById[$cid];
        array_unshift($parts, (string)$c['title']);
        $cid = $c['parentId'] === null ? 0 : (int)$c['parentId'];
    }
    return implode(' → ', $parts);
}

function org_person_page_data(mysqli $db, int $pid): ?array
{
    $st = $db->prepare(
        'SELECT id, full_name, email, telegram, telegram_id, is_active, notes
         FROM people WHERE id = ? LIMIT 1'
    );
    $st->bind_param('i', $pid);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    if (!$row) {
        return null;
    }
    $payload = org_people_payload($db);
    $person = null;
    foreach ($payload['people'] as $p) {
        if ((int)$p['id'] === $pid) {
            $person = $p;
            break;
        }
    }
    if ($person === null) {
        $person = [
            'id' => $pid,
            'name' => (string)$row['full_name'],
            'email' => (string)($row['email'] ?? ''),
            'telegram' => (string)($row['telegram'] ?? ''),
            'telegram_id' => (int)($row['telegram_id'] ?? 0),
            'active' => (int)$row['is_active'] === 1,
            'notes' => (string)($row['notes'] ?? ''),
            'games' => 0,
            'judged' => 0,
            'memberships' => [],
        ];
    }
    return [
        'person' => $person,
        'circles' => $payload['circles'],
        'stats' => portal_person_stats($db, $pid),
    ];
}

function org_person_funnel_text(string $title): string
{
    $map = [
        'Непричастные ЧС' => 'Непричастен к ЧС',
        'Интересовались, не судили' => 'Интересовался, не судил',
        'Посудили, но не играли' => 'Судил, но не играл',
        'Сыграли много и секундировали' => 'Сыграл много и секундировал',
        'Сыграли много' => 'Сыграл много',
        'Сыграли 1' => 'Сыграл 1',
        'Сыграли 2' => 'Сыграл 2',
        'Сыграли 3' => 'Сыграл 3',
    ];
    return $map[$title] ?? $title;
}

function org_person_kpi(string $label, int $value, string $tip): string
{
    $html = '<div class="org-kpi"><span>' . h($label)
        . ' <span class="tip-ico has-tip" role="button" tabindex="0" data-tip="' . h($tip) . '" aria-label="подробнее">i</span>'
        . '</span><b>' . $value . '</b></div>';
    return $html;
}

function org_person_page(mysqli $db, int $pid): void
{
    $data = org_person_page_data($db, $pid);
    $back = portal_org_url('people');
    if (!$data) {
        echo '<section class="card org-person-page"><p class="muted">Человек не найден.</p>';
        echo '<p><a href="' . h($back) . '">← К списку людей</a></p></section>';
        return;
    }
    $p = $data['person'];
    $stats = $data['stats'];
    $circles = $data['circles'];
    $memberships = $p['memberships'] ?? [];
    $tgRaw = trim((string)($p['telegram'] ?? ''));
    $tg = ltrim($tgRaw, '@');
    $tgId = (int)($p['telegram_id'] ?? 0);

    echo '<div class="org-person-page">';
    echo '<p class="org-person-back"><a href="' . h($back) . '">← К списку людей</a></p>';
    echo '<header class="org-person-page-head">';
    echo '<h1>' . h((string)$p['name']) . '</h1>';
    if (empty($p['active'])) {
        echo '<span class="org-person-off">не активен</span>';
    }
    if (($p['funnelNow'] ?? '') !== '') {
        echo '<span class="org-chip org-funnel-pill">Сейчас: '
            . h(org_person_funnel_text((string)$p['funnelNow'])) . '</span>';
    }
    echo '</header>';

    echo '<div class="org-person-page-grid">';

    echo '<section class="card org-person-about">';
    echo '<h2>О человеке</h2>';
    echo '<dl class="org-person-dl">';
    if ((string)($p['email'] ?? '') !== '') {
        echo '<dt>Email</dt><dd><a href="mailto:' . h((string)$p['email']) . '">' . h((string)$p['email']) . '</a></dd>';
    }
    if ($tg !== '' || $tgId > 0) {
        echo '<dt>Telegram</dt><dd>';
        echo '<details class="org-secret"><summary>Показать Telegram</summary><div class="org-secret-body">';
        if ($tg !== '') {
            echo '<a href="https://t.me/' . h($tg) . '" target="_blank" rel="noopener">@' . h($tg) . '</a>';
        }
        if ($tgId > 0) {
            echo ($tg !== '' ? ' · ' : '') . 'ID: <a href="tg://user?id=' . $tgId . '">' . $tgId . '</a>';
        }
        echo '</div></details>';
        echo '</dd>';
    }
    if ((string)($p['notes'] ?? '') !== '') {
        echo '<dt>Заметки</dt><dd>' . nl2br(h((string)$p['notes'])) . '</dd>';
    }
    echo '<dt>Игр / судейств</dt><dd>' . (int)$p['games'] . ' / ' . (int)$p['judged'] . '</dd>';
    echo '</dl>';
    if (($p['funnelNext'] ?? '') !== '') {
        echo '<p class="org-funnel-next">Куда развивать дальше: ' . h((string)$p['funnelNext']) . '</p>';
    }
    echo '</section>';

    echo '<section class="card org-person-statcard">';
    echo '<h2>Статистика</h2>';
    if (!$stats) {
        echo '<p class="muted">Нет данных.</p>';
    } else {
        echo '<div class="org-person-statgrid">';
        echo '<div class="org-kpis">';
        echo org_person_kpi('Играл', (int)$stats['played'], 'played');
        echo org_person_kpi('Секундировал', (int)$stats['seconded'], 'seconded');
        echo org_person_kpi('Судил', (int)$stats['judged'], 'judged');
        echo org_person_kpi('Участие в турнирах', (int)$stats['tournaments'], 'tournaments');
        echo org_person_kpi('Выиграл', (int)$stats['won'], 'won');
        echo org_person_kpi('Проиграл', (int)$stats['lost'], 'lost');
        echo '</div>';
        echo '<div class="org-rivals-col">';
        echo '<h3>С кем играл</h3>';
        if (empty($stats['rivals'])) {
            echo '<p class="muted">Пока нет сыгранных поединков.</p>';
        } else {
            echo '<p class="org-rivals">';
            $parts = [];
            foreach ($stats['rivals'] as $rv) {
                $tone = (string)($rv['tone'] ?? 'even');
                if ($tone !== 'win' && $tone !== 'lose') {
                    $tone = 'even';
                }
                $s = '<span class="rival rival--' . $tone . '">'
                    . '<a href="' . h(portal_org_url('people') . '&person=' . (int)$rv['id'])
                    . '" target="_blank" rel="noopener">' . h((string)$rv['name']) . '</a>';
                if ((int)$rv['n'] > 0) {
                    $s .= ' <span class="n">(' . (int)$rv['n'] . ')</span>';
                }
                $s .= ' <span class="tip-ico has-tip" role="button" tabindex="0" data-tip="rival" data-rid="'
                    . (int)$rv['id'] . '" aria-label="подробнее">i</span>';
                $s .= '</span>';
                $parts[] = $s;
            }
            echo implode(', ', $parts);
            echo '</p>';
        }
        echo '</div></div>';
        echo '<script type="application/json" id="org-person-tips-json">'
            . json_encode($stats['tips'], JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP)
            . '</script>';
    }
    echo '</section>';

    echo '<section class="card org-person-circles">';
    echo '<h2>Круги</h2>';
    if (!$circles) {
        echo '<p class="muted">Кругов пока нет.</p>';
    }
    $byParent = [];
    $circleById = [];
    foreach ($circles as $c) {
        $circleById[(int)$c['id']] = $c;
        $parent = $c['parentId'] === null ? 0 : (int)$c['parentId'];
        $byParent[$parent][] = $c;
    }
    $roots = $byParent[0] ?? [];
    $csrfField = static function (): string {
        ob_start();
        portal_csrf_field();
        return (string)ob_get_clean();
    };
    $renderChips = static function (array $memberships, array $allowed, array $circleById, int $pid) use ($csrfField): string {
        $out = '';
        foreach ($memberships as $m) {
            $mcid = (int)($m['circleId'] ?? 0);
            if (!isset($allowed[$mcid])) {
                continue;
            }
            $path = org_person_circle_path($circleById, $mcid);
            $nodeTitle = (string)($circleById[$mcid]['title'] ?? $path);
            $out .= '<form method="post" class="org-chip-form">' . $csrfField()
                . '<input type="hidden" name="action" value="org_mem_remove">'
                . '<input type="hidden" name="person_id" value="' . $pid . '">'
                . '<input type="hidden" name="circle_id" value="' . $mcid . '">'
                . '<input type="hidden" name="involvement" value="' . h((string)$m['involvement']) . '">'
                . '<input type="hidden" name="return_person" value="1">'
                . '<span class="org-chip" title="' . h($path) . '">' . h($nodeTitle)
                . ' · ' . h((string)$m['involvement'])
                . '<button type="submit" class="org-chip-x" title="Убрать">×</button></span>'
                . '</form>';
        }
        return $out;
    };
    $renderSelect = static function (array $base, array $children, string $aria): string {
        $out = '<select name="circle_id" aria-label="' . h($aria) . '" required>';
        $out .= '<option value="" selected disabled>— выберите группу и участие —</option>';
        $invs = array_keys($base['involvements'] ?? []);
        if ($invs) {
            $out .= '<optgroup label="' . h((string)$base['title']) . '">';
            foreach ($invs as $inv) {
                $out .= '<option value="' . (int)$base['id'] . '|' . h((string)$inv) . '">'
                    . h((string)$inv) . '</option>';
            }
            $out .= '<option value="' . (int)$base['id'] . '|__custom__">+ своё участие…</option>';
            $out .= '</optgroup>';
        }
        $open = false;
        foreach ($children as $node) {
            $c = $node['circle'];
            $depth = (int)$node['depth'];
            if ($depth === 0) {
                if ($open) {
                    $out .= '</optgroup>';
                }
                $out .= '<optgroup label="' . h((string)$c['title']) . '">';
                $open = true;
                $cInvs = array_keys($c['involvements'] ?? []);
                if (!$cInvs) {
                    $out .= '<option value="' . (int)$c['id'] . '|__custom__">+ своё участие…</option>';
                } else {
                    foreach ($cInvs as $inv) {
                        $out .= '<option value="' . (int)$c['id'] . '|' . h((string)$inv) . '">'
                            . h((string)$inv) . '</option>';
                    }
                    $out .= '<option value="' . (int)$c['id'] . '|__custom__">+ своё участие…</option>';
                }
                continue;
            }
            foreach (array_keys($c['involvements'] ?? []) as $inv) {
                $out .= '<option value="' . (int)$c['id'] . '|' . h((string)$inv) . '">'
                    . h(str_repeat('— ', $depth) . (string)$c['title']) . ' · ' . h((string)$inv) . '</option>';
            }
        }
        if ($open) {
            $out .= '</optgroup>';
        }
        $out .= '</select>';
        return $out;
    };
    $renderForm = static function (array $base, array $children, int $pid, string $aria) use ($renderSelect, $csrfField): string {
        return '<form method="post" class="org-circle-assign">' . $csrfField()
            . '<input type="hidden" name="action" value="org_mem_add">'
            . '<input type="hidden" name="person_id" value="' . $pid . '">'
            . '<input type="hidden" name="return_person" value="1">'
            . $renderSelect($base, $children, $aria)
            . '<input type="text" class="org-circle-custom" name="involvement" placeholder="участие" autocomplete="off" hidden>'
            . '<button type="submit" class="btn-ghost">Назначить</button>'
            . '</form>';
    };
    foreach ($roots as $root) {
        $rid = (int)$root['id'];
        echo '<div class="org-circle-row">';
        echo '<div class="org-circle-row-head"><strong>' . h((string)$root['title']) . '</strong>';
        echo '<span class="muted">' . (int)($root['members'] ?? 0) . '</span></div>';
        echo '<div class="org-circle-body">';
        $rootChips = $renderChips($memberships, [$rid => true], $circleById, $pid);
        if ($rootChips !== '') {
            echo '<div class="org-person-chips">' . $rootChips . '</div>';
        }
        $viewpoints = $byParent[$rid] ?? [];
        if (!$viewpoints) {
            echo $renderForm($root, [], $pid, 'Уровень участия');
        } else {
            foreach ($viewpoints as $vp) {
                $vid = (int)$vp['id'];
                $vpTree = org_person_circle_tree($byParent, $vid);
                $vpIds = [$vid => true];
                foreach ($vpTree as $node) {
                    $vpIds[(int)$node['circle']['id']] = true;
                }
                echo '<div class="org-circle-view">';
                echo '<div class="org-circle-view-head"><strong>' . h((string)$vp['title']) . '</strong>';
                if ((int)($vp['members'] ?? 0) > 0) {
                    echo ' <span class="muted">' . (int)$vp['members'] . '</span>';
                }
                echo '</div>';
                $vpChips = $renderChips($memberships, $vpIds, $circleById, $pid);
                if ($vpChips !== '') {
                    echo '<div class="org-person-chips">' . $vpChips . '</div>';
                }
                echo $renderForm($vp, $vpTree, $pid, (string)$vp['title'] . ' — уровень участия');
                echo '</div>';
            }
        }
        echo '</div></div>';
    }
    echo '</section>';

    echo '</div></div>';
}

function portal_echo_org_people(mysqli $db): void
{
    $personId = (int)($_GET['person'] ?? 0);
    if ($personId > 0) {
        org_person_page($db, $personId);
        return;
    }
    $data = org_people_payload($db);
    echo '<nav class="org-people-tabs" aria-label="Виды раздела Люди">';
    echo '<button type="button" class="org-people-tab is-on" data-people-tab="list">Работа со списком</button>';
    echo '<button type="button" class="org-people-tab" data-people-tab="funnel">Воронка и цели</button>';
    echo '</nav>';
    echo '<p class="muted org-people-hint" id="org-people-hint">Клик по узлу фильтрует список. Ctrl+клик — несколько узлов. Клик по человеку откроет карточку в новой вкладке.</p>';
    echo '<p class="org-people-err" id="org-people-err" hidden></p>';
    echo '<div class="org-people" id="org-people-list-pane">';
    echo '<aside class="org-people-tree card" id="org-people-tree"></aside>';
    echo '<section class="org-people-list card">';
    echo '<div class="org-people-toolbar">';
    echo '<div class="org-people-list-head">';
    echo '<strong id="org-people-count"></strong>';
    echo '<input type="search" id="org-people-q" class="org-people-q" placeholder="поиск по ФИО" autocomplete="off">';
    echo '<button type="button" class="org-people-new-btn" id="org-people-new-btn">+ человек</button>';
    echo '</div>';
    echo '<div class="org-people-funnel-filter" id="org-people-funnel-filter" hidden></div>';
    echo '<div class="org-people-new" id="org-people-new" hidden></div>';
    echo '<div class="org-people-add" id="org-people-add" hidden></div>';
    echo '</div>';
    echo '<ul class="org-people-ul" id="org-people-ul"></ul>';
    echo '</section>';
    echo '</div>';
    echo '<div class="org-funnel-pane" id="org-people-funnel-pane" hidden>';
    echo '<p class="muted org-funnel-note" id="org-funnel-note"></p>';
    echo '<div class="org-funnel-goals" id="org-funnel-goals"></div>';
    echo '<div class="org-funnel-layout">';
    echo '<div class="org-funnel-chart card" id="org-funnel-chart"></div>';
    echo '<section class="org-funnel-names card" id="org-funnel-names">';
    echo '<strong class="org-funnel-names-h" id="org-funnel-names-h">Клик по ступени или цифре</strong>';
    echo '<ul class="org-funnel-ul" id="org-funnel-ul"></ul>';
    echo '</section>';
    echo '</div>';
    echo '</div>';
    echo '<section class="org-people-card card" id="org-people-card">';
    echo '<p class="muted">Выберите человека в списке.</p>';
    echo '</section>';
    echo '<input type="hidden" id="org-people-csrf" value="' . h(portal_csrf_token()) . '">';
    echo '<script type="application/json" id="org-people-json">'
        . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP)
        . '</script>';
}
