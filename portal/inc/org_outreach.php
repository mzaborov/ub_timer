<?php
declare(strict_types=1);

/**
 * Раздел организатора «Опрос» (?p=org&s=outreach).
 * Кампании опроса (обычно к онлайну, можно свободную), набор участников
 * (ручной + рекомендации как «Кого привлечь»), статус общения по человеку.
 */

function org_outreach_statuses(): array
{
    return [
        'new' => 'не начато',
        'written' => 'написал',
        'no_answer' => 'нет ответа',
        'not_interested' => 'не интересны поединки вообще',
        'later' => 'интересны, но не сейчас',
        'ready' => 'готов поучаствовать в онлайне',
    ];
}

function org_outreach_status_ok(string $s): bool
{
    return array_key_exists($s, org_outreach_statuses());
}

/** @return array<int, true> person_id, у кого есть любой Telegram (username или id) */
function org_outreach_contact_ids(mysqli $db): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $cache = [];
    $r = $db->query("SELECT id FROM people WHERE (telegram IS NOT NULL AND telegram <> '') OR (telegram_id IS NOT NULL AND telegram_id <> 0)");
    while ($row = $r->fetch_assoc()) {
        $cache[(int)$row['id']] = true;
    }
    return $cache;
}

function org_outreach_url(int $campaignId = 0, array $extra = []): string
{
    $q = ['p' => 'org', 's' => 'outreach'];
    if ($campaignId > 0) {
        $q['c'] = $campaignId;
    }
    foreach ($extra as $k => $v) {
        if ($v !== '' && $v !== null) {
            $q[$k] = $v;
        }
    }
    return './?' . http_build_query($q);
}

function org_outreach_handle_post(mysqli $db): array
{
    if (!portal_csrf_ok((string)($_POST['csrf'] ?? ''))) {
        return ['error' => 'Сессия истекла, обновите страницу.'];
    }
    $action = (string)($_POST['action'] ?? '');
    $cid = (int)($_POST['campaign_id'] ?? 0);
    $now = date('Y-m-d H:i:s');
    $pq = (string)($_GET['q'] ?? '');
    $ptg = (string)($_GET['tg'] ?? '');
    if (!in_array($ptg, ['yes', 'no'], true)) {
        $ptg = '';
    }
    $back = org_outreach_url($cid, ['q' => $pq, 'tg' => $ptg]);

    if ($action === 'create_campaign') {
        $title = trim((string)($_POST['title'] ?? ''));
        if ($title === '') {
            $title = 'Опрос ' . date('d.m.Y H:i');
        }
        $eventId = (int)($_POST['event_id'] ?? 0);
        if ($eventId > 0) {
            $st = $db->prepare('INSERT INTO outreach_campaigns (event_id, title, status, created_at, updated_at) VALUES (?, ?, \'active\', ?, ?)');
            $st->bind_param('isss', $eventId, $title, $now, $now);
        } else {
            $st = $db->prepare('INSERT INTO outreach_campaigns (event_id, title, status, created_at, updated_at) VALUES (NULL, ?, \'active\', ?, ?)');
            $st->bind_param('sss', $title, $now, $now);
        }
        if (!$st || !$st->execute()) {
            return ['error' => 'Не удалось создать опрос.'];
        }
        $newId = (int)$db->insert_id;
        $st->close();
        return ['redirect' => org_outreach_url($newId)];
    }

    if ($action === 'delete_campaign') {
        if ($cid > 0) {
            $db->query('DELETE FROM outreach_items WHERE campaign_id = ' . $cid);
            $db->query('DELETE FROM outreach_campaigns WHERE id = ' . $cid);
        }
        return ['redirect' => org_outreach_url()];
    }

    if ($action === 'rename_campaign') {
        $title = trim((string)($_POST['title'] ?? ''));
        if ($cid > 0 && $title !== '') {
            $st = $db->prepare('UPDATE outreach_campaigns SET title = ?, updated_at = ? WHERE id = ?');
            $st->bind_param('ssi', $title, $now, $cid);
            $st->execute();
            $st->close();
        }
        return ['redirect' => $back];
    }

    if ($action === 'set_event') {
        $eventId = (int)($_POST['event_id'] ?? 0);
        if ($cid > 0) {
            if ($eventId > 0) {
                $st = $db->prepare('UPDATE outreach_campaigns SET event_id = ?, updated_at = ? WHERE id = ?');
                $st->bind_param('isi', $eventId, $now, $cid);
            } else {
                $st = $db->prepare('UPDATE outreach_campaigns SET event_id = NULL, updated_at = ? WHERE id = ?');
                $st->bind_param('si', $now, $cid);
            }
            $st->execute();
            $st->close();
        }
        return ['redirect' => $back];
    }

    if ($action === 'set_status') {
        $status = (string)($_POST['campaign_status'] ?? 'active');
        if (!in_array($status, ['active', 'done'], true)) {
            $status = 'active';
        }
        if ($cid > 0) {
            $st = $db->prepare('UPDATE outreach_campaigns SET status = ?, updated_at = ? WHERE id = ?');
            $st->bind_param('ssi', $status, $now, $cid);
            $st->execute();
            $st->close();
        }
        return ['redirect' => $back];
    }

    if ($action === 'add_item') {
        $pid = (int)($_POST['person_id'] ?? 0);
        if ($cid > 0 && $pid > 0) {
            $st = $db->prepare('INSERT INTO outreach_items (campaign_id, person_id, status, updated_at) VALUES (?, ?, \'new\', ?) ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)');
            $st->bind_param('iis', $cid, $pid, $now);
            $st->execute();
            $st->close();
        }
        return ['redirect' => $back];
    }

    if ($action === 'save_items') {
        $removeId = (int)($_POST['remove_id'] ?? 0);
        if ($removeId > 0 && $cid > 0) {
            $del = $db->prepare('DELETE FROM outreach_items WHERE id = ? AND campaign_id = ?');
            $del->bind_param('ii', $removeId, $cid);
            $del->execute();
            $del->close();
            return ['redirect' => $back];
        }
        if ($cid > 0) {
            $statuses = (array)($_POST['status'] ?? []);
            $hints = (array)($_POST['hint'] ?? []);
            $comments = (array)($_POST['comment'] ?? []);
            $remove = (array)($_POST['remove'] ?? []);
            $upd = $db->prepare('UPDATE outreach_items SET status = ?, ready_hint = ?, comment = ?, updated_at = ? WHERE id = ? AND campaign_id = ?');
            foreach ($statuses as $itemId => $status) {
                $itemId = (int)$itemId;
                if (isset($remove[$itemId])) {
                    continue;
                }
                $status = (string)$status;
                if (!org_outreach_status_ok($status)) {
                    $status = 'new';
                }
                $hint = trim((string)($hints[$itemId] ?? ''));
                $commentVal = trim((string)($comments[$itemId] ?? ''));
                $upd->bind_param('ssssii', $status, $hint, $commentVal, $now, $itemId, $cid);
                $upd->execute();
            }
            $upd->close();
            $del = $db->prepare('DELETE FROM outreach_items WHERE id = ? AND campaign_id = ?');
            foreach (array_keys($remove) as $itemId) {
                $itemId = (int)$itemId;
                $del->bind_param('ii', $itemId, $cid);
                $del->execute();
            }
            $del->close();
            $st = $db->prepare('UPDATE outreach_campaigns SET updated_at = ? WHERE id = ?');
            $st->bind_param('si', $now, $cid);
            $st->execute();
            $st->close();
        }
        return ['redirect' => $back];
    }

    return ['error' => 'Неизвестное действие.'];
}

/** Кампании (с названием мероприятия). */
function org_outreach_campaigns(mysqli $db): array
{
    $out = [];
    $r = $db->query(
        'SELECT c.id, c.event_id, c.title, c.status, c.updated_at, e.title AS ev_title, e.starts_on
         FROM outreach_campaigns c
         LEFT JOIN events e ON e.id = c.event_id
         ORDER BY c.updated_at DESC, c.id DESC'
    );
    while ($row = $r->fetch_assoc()) {
        $out[] = [
            'id' => (int)$row['id'],
            'event_id' => (int)($row['event_id'] ?? 0),
            'title' => (string)$row['title'],
            'status' => (string)$row['status'],
            'updated_at' => (string)$row['updated_at'],
            'ev_title' => (string)($row['ev_title'] ?? ''),
            'starts_on' => (string)($row['starts_on'] ?? ''),
        ];
    }
    return $out;
}

/** Рекомендации «кому писать» (как «Кого привлечь»). */
function org_outreach_recs(mysqli $db, int $eventId): array
{
    $career = org_people_career($db);
    $regs = $eventId > 0 ? org_event_regs($db, $eventId) : [];
    $recs = org_play_recs($db, $career, [], $regs);
    $out = [];
    $tierLabels = [
        'fresh' => 'Недавно судили, играли',
        'orgs' => 'Организаторы без игр',
        'older' => 'Играли давно',
    ];
    $needLabels = [1 => 'первая игра', 2 => 'вторая игра', 3 => 'третья игра'];
    foreach ($tierLabels as $tier => $label) {
        foreach (($recs[$tier] ?? []) as $row) {
            $need = (int)($row['need'] ?? 0);
            $why = $label;
            if (isset($needLabels[$need])) {
                $why .= ' · ' . $needLabels[$need];
            }
            $out[] = [
                'id' => (int)$row['id'],
                'name' => (string)$row['name'],
                'why' => $why,
                'tier' => $tier,
            ];
        }
    }
    return $out;
}

function org_outreach_tg_html(array $p): string
{
    $tg = trim((string)($p['telegram'] ?? ''), '@');
    $tid = (int)($p['telegram_id'] ?? 0);
    $out = '';
    if ($tg !== '') {
        $out .= '<a class="oc-tg" href="https://t.me/' . h($tg) . '" target="_blank" rel="noopener" title="Написать в Telegram: @' . h($tg) . '">'
            . portal_icon('telegram') . '</a>';
    }
    if ($tid > 0) {
        $out .= '<a class="oc-tg oc-tg--id" href="tg://user?id=' . $tid . '" title="Открыть чат по Telegram ID ' . $tid . ' (может не сработать)">'
            . portal_icon('id') . '</a>';
    }
    return $out;
}

/** @return array<int, array{telegram: string, telegram_id: int}> */
function org_outreach_contacts(mysqli $db): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $cache = [];
    $r = $db->query('SELECT id, telegram, telegram_id FROM people');
    while ($row = $r->fetch_assoc()) {
        $cache[(int)$row['id']] = [
            'telegram' => (string)($row['telegram'] ?? ''),
            'telegram_id' => (int)($row['telegram_id'] ?? 0),
        ];
    }
    return $cache;
}

function portal_echo_org_outreach(mysqli $db, string $error = ''): void
{
    $campaigns = org_outreach_campaigns($db);
    $cid = (int)($_GET['c'] ?? 0);
    if ($cid <= 0 && $campaigns) {
        $cid = (int)$campaigns[0]['id'];
    }
    $sel = null;
    foreach ($campaigns as $c) {
        if ((int)$c['id'] === $cid) {
            $sel = $c;
        }
    }
    $statuses = org_outreach_statuses();
    $q = trim((string)($_GET['q'] ?? ''));
    $allEvents = array_values(array_filter(
        org_events_dated($db),
        static function (array $ev): bool {
            return org_event_is_planned($ev);
        }
    ));

    echo '<div class="org-main org-outreach">';
    echo '<h1 class="org-title">' . portal_icon('send') . ' Опрос</h1>';
    if ($error !== '') {
        echo '<div class="org-toasts"><div class="org-toast is-err" role="alert">' . h($error) . '</div></div>';
    }

    echo '<section class="card oc-bar">';
    echo '<form method="post" class="oc-create">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="create_campaign">';
    echo '<input type="text" name="title" placeholder="Название опроса" class="oc-input">';
    echo '<select name="event_id" class="oc-input"><option value="0">— без привязки —</option>';
    foreach ($allEvents as $ev) {
        $label = (string)$ev['title'];
        if (!empty($ev['starts_on'])) {
            $label .= ' · ' . (string)$ev['starts_on'];
        }
        echo '<option value="' . (int)$ev['id'] . '">' . h($label) . '</option>';
    }
    echo '</select>';
    echo '<button type="submit" class="btn-primary">Создать опрос</button>';
    echo '</form>';
    if ($campaigns) {
        echo '<div class="oc-nav">';
        foreach ($campaigns as $c) {
            $on = (int)$c['id'] === $cid ? ' is-on' : '';
            echo '<a class="oc-nav-item' . $on . '" href="' . h(org_outreach_url((int)$c['id'])) . '">'
                . h($c['title']) . '</a>';
        }
        echo '</div>';
    }
    echo '</section>';

    if (!$sel) {
        echo '<section class="card"><p class="muted">Опросов пока нет — создайте первый.</p></section>';
        echo '</div>';
        return;
    }

    $eventId = (int)$sel['event_id'];

    // items
    $items = [];
    $st = $db->prepare(
        'SELECT oi.id, oi.person_id, oi.status, oi.ready_hint, oi.comment,
                p.full_name, p.telegram, p.telegram_id
         FROM outreach_items oi
         JOIN people p ON p.id = oi.person_id
         WHERE oi.campaign_id = ?
         ORDER BY p.full_name, oi.id'
    );
    $st->bind_param('i', $cid);
    $st->execute();
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $items[] = $row;
    }
    $st->close();

    // registered set for auto-badge
    $registered = [];
    if ($eventId > 0) {
        foreach (org_event_regs($db, $eventId) as $r) {
            $pid = (int)($r['id'] ?? 0);
            if ($pid > 0) {
                $registered[$pid] = true;
            }
        }
    }

    $inCampaign = [];
    foreach ($items as $it) {
        $inCampaign[(int)$it['person_id']] = true;
    }

    // counts
    $counts = array_fill_keys(array_keys($statuses), 0);
    foreach ($items as $it) {
        $s = (string)$it['status'];
        if (!isset($counts[$s])) {
            $s = 'new';
        }
        $counts[$s]++;
    }

    // header
    echo '<section class="card oc-head">';
    echo '<form method="post" class="oc-head-form">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="rename_campaign">';
    echo '<input type="hidden" name="campaign_id" value="' . $cid . '">';
    echo '<input type="text" name="title" value="' . h($sel['title']) . '" class="oc-title-input">';
    echo '<button type="submit" class="btn-ghost">Переименовать</button>';
    echo '</form>';
    echo '<form method="post" class="oc-head-form">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="set_event">';
    echo '<input type="hidden" name="campaign_id" value="' . $cid . '">';
    echo '<select name="event_id" class="oc-input">';
    echo '<option value="0"' . ($eventId === 0 ? ' selected' : '') . '>— без привязки —</option>';
    foreach ($allEvents as $ev) {
        $label = (string)$ev['title'];
        if (!empty($ev['starts_on'])) {
            $label .= ' · ' . (string)$ev['starts_on'];
        }
        echo '<option value="' . (int)$ev['id'] . '"' . ((int)$ev['id'] === $eventId ? ' selected' : '') . '>' . h($label) . '</option>';
    }
    echo '</select>';
    echo '<button type="submit" class="btn-ghost">Привязать к онлайну</button>';
    echo '</form>';
    echo '<form method="post" class="oc-head-form">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="set_status">';
    echo '<input type="hidden" name="campaign_id" value="' . $cid . '">';
    echo '<select name="campaign_status" class="oc-input">';
    echo '<option value="active"' . ($sel['status'] === 'active' ? ' selected' : '') . '>активен</option>';
    echo '<option value="done"' . ($sel['status'] === 'done' ? ' selected' : '') . '>завершён</option>';
    echo '</select>';
    echo '<button type="submit" class="btn-ghost">Статус</button>';
    echo '</form>';
    echo '<form method="post" class="oc-head-form" onsubmit="return confirm(\'Удалить опрос и все отметки?\');">';
    portal_csrf_field();
    echo '<input type="hidden" name="action" value="delete_campaign">';
    echo '<input type="hidden" name="campaign_id" value="' . $cid . '">';
    echo '<button type="submit" class="btn-ghost oc-danger">Удалить опрос</button>';
    echo '</form>';
    echo '</section>';

    // counts summary
    echo '<section class="card oc-counts">';
    echo '<span class="oc-count"><b>' . count($items) . '</b> в списке</span>';
    foreach ($statuses as $code => $label) {
        echo '<span class="oc-count oc-count--' . $code . '"><b>' . (int)$counts[$code] . '</b> ' . h($label) . '</span>';
    }
    echo '</section>';

    // фильтр «есть/нет Telegram» (для рекомендаций и поиска)
    $tg = (string)($_GET['tg'] ?? '');
    if (!in_array($tg, ['yes', 'no'], true)) {
        $tg = '';
    }
    $mkTgUrl = static function (string $val) use ($cid, $q): string {
        return org_outreach_url($cid, ['q' => $q, 'tg' => $val]);
    };

    // items table — сверху: кто уже в списке
    echo '<section class="card oc-items-card">';
    echo '<h2>В списке опроса</h2>';
    if (!$items) {
        echo '<p class="muted">Список пуст — добавьте людей из рекомендаций ниже.</p>';
    } else {
        echo '<form method="post">';
        portal_csrf_field();
        echo '<input type="hidden" name="action" value="save_items">';
        echo '<input type="hidden" name="campaign_id" value="' . $cid . '">';
        echo '<table class="oc-table"><thead><tr>';
        echo '<th>ФИО</th><th>статус</th><th>когда готов</th><th>комментарий</th><th>рег.</th><th></th>';
        echo '</tr></thead><tbody>';
        foreach ($items as $it) {
            $itemId = (int)$it['id'];
            $pid = (int)$it['person_id'];
            echo '<tr>';
            echo '<td class="oc-td-name"><span class="oc-name-text">' . h((string)$it['full_name']) . '</span>' . org_outreach_tg_html($it) . '</td>';
            echo '<td><select name="status[' . $itemId . ']" class="oc-input">';
            foreach ($statuses as $code => $label) {
                echo '<option value="' . $code . '"' . ((string)$it['status'] === $code ? ' selected' : '') . '>' . h($label) . '</option>';
            }
            echo '</select></td>';
            $hintRaw = trim((string)($it['ready_hint'] ?? ''));
            $hintVal = preg_match('/^\d{4}-\d{2}-\d{2}$/', $hintRaw) ? $hintRaw : '';
            echo '<td><input type="date" name="hint[' . $itemId . ']" value="' . h($hintVal) . '" class="oc-input oc-date" title="когда готов"></td>';
            echo '<td><input type="text" name="comment[' . $itemId . ']" value="' . h((string)($it['comment'] ?? '')) . '" class="oc-input"></td>';
            echo '<td class="oc-td-reg">' . (isset($registered[$pid]) ? '<span class="oc-reg-badge" title="есть регистрация на онлайн">✓</span>' : '') . '</td>';
            echo '<td class="oc-td-del"><button type="submit" name="remove_id" value="' . $itemId . '" class="btn-ghost oc-move" title="убрать из списка (вернётся в рекомендации)">↓ убрать</button></td>';
            echo '</tr>';
        }
        echo '</tbody></table>';
        echo '<button type="submit" class="btn-primary oc-save">Сохранить изменения</button>';
        echo '</form>';
    }
    echo '</section>';

    // Кандидаты — кого добавить: рекомендации (по умолчанию) или поиск по ФИО
    echo '<section class="card oc-cands">';
    echo '<h2>Кандидаты — кого добавить</h2>';
    echo '<form method="get" class="oc-search">';
    echo '<input type="hidden" name="p" value="org">';
    echo '<input type="hidden" name="s" value="outreach">';
    echo '<input type="hidden" name="c" value="' . $cid . '">';
    echo '<input type="hidden" name="tg" value="' . h($tg) . '">';
    echo '<input type="text" name="q" value="' . h($q) . '" placeholder="Поиск по ФИО" class="oc-input">';
    echo '<button type="submit" class="btn-ghost">Найти</button>';
    if ($q !== '') {
        echo '<a class="btn-ghost" href="' . h(org_outreach_url($cid, ['tg' => $tg])) . '">Сбросить</a>';
    }
    echo '</form>';
    echo '<div class="oc-filter">';
    echo '<span class="oc-filter-label">Telegram:</span>';
    echo '<a class="oc-flt' . ($tg === '' ? ' is-on' : '') . '" href="' . h($mkTgUrl('')) . '">все</a>';
    echo '<a class="oc-flt' . ($tg === 'yes' ? ' is-on' : '') . '" href="' . h($mkTgUrl('yes')) . '">есть</a>';
    echo '<a class="oc-flt' . ($tg === 'no' ? ' is-on' : '') . '" href="' . h($mkTgUrl('no')) . '">нет</a>';
    echo '</div>';

    if ($q !== '') {
        // результаты поиска
        $like = '%' . $q . '%';
        $candSql = 'SELECT id, full_name, telegram, telegram_id FROM people WHERE full_name LIKE ?';
        if ($tg === 'yes') {
            $candSql .= " AND ((telegram IS NOT NULL AND telegram <> '') OR (telegram_id IS NOT NULL AND telegram_id <> 0))";
        } elseif ($tg === 'no') {
            $candSql .= " AND ((telegram IS NULL OR telegram = '') AND (telegram_id IS NULL OR telegram_id = 0))";
        }
        $candSql .= ' ORDER BY full_name LIMIT 50';
        $cst = $db->prepare($candSql);
        $cst->bind_param('s', $like);
        $cst->execute();
        $cres = $cst->get_result();
        $any = false;
        echo '<ul class="oc-cand-list">';
        while ($row = $cres->fetch_assoc()) {
            $any = true;
            $pid = (int)$row['id'];
            echo '<li class="oc-cand">';
            echo '<span class="oc-cand-name">' . h((string)$row['full_name']) . '</span>';
            echo org_outreach_tg_html($row);
            if (isset($inCampaign[$pid])) {
                echo '<span class="oc-chip">в списке</span>';
            } else {
                echo '<form method="post" class="oc-add">';
                portal_csrf_field();
                echo '<input type="hidden" name="action" value="add_item">';
                echo '<input type="hidden" name="campaign_id" value="' . $cid . '">';
                echo '<input type="hidden" name="person_id" value="' . $pid . '">';
                echo '<button type="submit" class="btn-ghost">↑ в список</button>';
                echo '</form>';
            }
            echo '</li>';
        }
        echo '</ul>';
        $cst->close();
        if (!$any) {
            echo '<p class="muted">Никого не найдено.</p>';
        }
    } else {
        // рекомендации по умолчанию
        $recs = org_outreach_recs($db, $eventId);
        if ($tg !== '' && $recs) {
            $hasTg = org_outreach_contact_ids($db);
            $recs = array_values(array_filter($recs, static function (array $r) use ($hasTg, $tg): bool {
                $has = isset($hasTg[(int)$r['id']]);
                return $tg === 'yes' ? $has : !$has;
            }));
        }
        if ($recs) {
            $contacts = org_outreach_contacts($db);
            echo '<ul class="oc-recs-list">';
            foreach ($recs as $r) {
                $pid = (int)$r['id'];
                echo '<li class="oc-rec">';
                echo '<span class="oc-rec-name">' . h($r['name']) . '</span>';
                if (!empty($contacts[$pid])) {
                    echo org_outreach_tg_html($contacts[$pid]);
                }
                echo '<span class="oc-rec-why muted">' . h($r['why']) . '</span>';
                if (isset($inCampaign[$pid])) {
                    echo '<span class="oc-chip">в списке</span>';
                } else {
                    echo '<form method="post" class="oc-add">';
                    portal_csrf_field();
                    echo '<input type="hidden" name="action" value="add_item">';
                    echo '<input type="hidden" name="campaign_id" value="' . $cid . '">';
                    echo '<input type="hidden" name="person_id" value="' . $pid . '">';
                    echo '<button type="submit" class="btn-ghost">↑ в список</button>';
                    echo '</form>';
                }
                echo '</li>';
            }
            echo '</ul>';
        } else {
            echo '<p class="muted">Нет рекомендаций — воспользуйтесь поиском по ФИО.</p>';
        }
    }
    echo '</section>';

    echo '</div>';
}
