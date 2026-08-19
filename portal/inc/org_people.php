<?php
declare(strict_types=1);

function org_people_payload(mysqli $db): array
{
    $people = [];
    $r = $db->query(
        'SELECT id, full_name, email, telegram, is_active, notes
         FROM people ORDER BY full_name, id'
    );
    while ($row = $r->fetch_assoc()) {
        $pid = (int)$row['id'];
        $people[$pid] = [
            'id' => $pid,
            'name' => (string)$row['full_name'],
            'email' => (string)($row['email'] ?? ''),
            'telegram' => (string)($row['telegram'] ?? ''),
            'active' => (int)$row['is_active'] === 1,
            'notes' => (string)($row['notes'] ?? ''),
            'games' => 0,
            'judged' => 0,
            'seconded' => 0,
            'memberships' => [],
        ];
    }
    $r = $db->query(
        'SELECT player1_id, player2_id, duel_type, second1_id, second2_id FROM duels'
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
        'SELECT person_id, COUNT(*) AS n FROM duel_judges
         WHERE person_id IS NOT NULL GROUP BY person_id'
    );
    while ($row = $r->fetch_assoc()) {
        $pid = (int)$row['person_id'];
        if (isset($people[$pid])) {
            $people[$pid]['judged'] = (int)$row['n'];
        }
    }
    $circles = [];
    $r = $db->query('SELECT id, title FROM circles ORDER BY id');
    while ($row = $r->fetch_assoc()) {
        $cid = (int)$row['id'];
        $circles[$cid] = [
            'id' => $cid,
            'title' => (string)$row['title'],
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

/** Член телеграм-чата: круг «я-ИТ-ы», вовлечённость «участник чата телеграмм». */
function org_person_in_chat(array $p): bool
{
    foreach ($p['memberships'] as $m) {
        if ((string)($m['circle'] ?? '') === COMMUNITY_CIRCLE
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
         FROM duels d JOIN events e ON e.id = d.event_id'
    );
    while ($row = $r->fetch_assoc()) {
        $duelRows[] = $row;
    }
    return rating_skip_guests($circleRows, $duelRows);
}

/**
 * Воронка: участники рейтинга (балл > 0) плюс верхние ступени —
 * я-ИТ-ы / чат / стрим при 0 игр и 0 суда. Гостей skip не берём.
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
        || org_person_in_circle($p, COMMUNITY_CIRCLE)
        || org_person_in_circle($p, STREAM_CIRCLE);
}

function org_people_funnel_stages(): array
{
    return [
        [
            'key' => 'uninvolved',
            'title' => 'Непричастные ЧС',
            'hint' => 'В круге я-ИТ-ы, но не в телеграм-чате. Без игр и суда.',
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
    return ['error' => 'Неизвестное действие'];
}

function org_mem_add(mysqli $db): array
{
    $cid = (int)($_POST['circle_id'] ?? 0);
    $pid = (int)($_POST['person_id'] ?? 0);
    $inv = org_mem_norm((string)($_POST['involvement'] ?? ''));
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
        return [];
    }
    $st = $db->prepare(
        'INSERT INTO circle_memberships (circle_id, person_id, involvement) VALUES (?, ?, ?)'
    );
    $st->bind_param('iis', $cid, $pid, $inv);
    $st->execute();
    $st->close();
    return [];
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
    return [];
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

function portal_echo_org_people(mysqli $db): void
{
    $data = org_people_payload($db);
    echo '<nav class="org-people-tabs" aria-label="Виды раздела Люди">';
    echo '<button type="button" class="org-people-tab is-on" data-people-tab="list">Работа со списком</button>';
    echo '<button type="button" class="org-people-tab" data-people-tab="funnel">Воронка и цели</button>';
    echo '</nav>';
    echo '<p class="muted org-people-hint" id="org-people-hint">Клик по узлу фильтрует список. Ctrl+клик — несколько узлов. Карандаш — переименовать, крестик — убрать участие.</p>';
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
