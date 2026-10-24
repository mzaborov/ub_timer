<?php
/**
 * Часы → БД: тонкий same-origin JSON-эндпоинт (PHP 5.2–8.x).
 *
 * Читает канон мероприятия из общей БД портала (u10190_ubtimer).
 * Без CORS и без ключа: часы и портал — соседние папки одного аккаунта Masterhost.
 * Контракт: openspec/changes/timer-on-portal-db/design.md (§13).
 *
 *   ?action=events[&scope=today|upcoming]
 *   ?action=event&id=<int>
 *
 * Запись канона (СобытиеПротокола, состав, судьи) добавится сюда же на шаге 3.
 */
error_reporting(E_ALL);
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');

// PHP 8.x: mysql_* удалены — совместимость через mysqli (legacy-режим ошибок)
mysqli_report(MYSQLI_REPORT_OFF);
function mysql_connect($host, $user, $pass) { return mysqli_connect($host, $user, $pass); }
function mysql_select_db($db, $link) { return mysqli_select_db($link, $db); }
function mysql_query($sql, $link) { return mysqli_query($link, $sql); }
function mysql_fetch_assoc($res) { return mysqli_fetch_assoc($res); }
function mysql_fetch_row($res) { return mysqli_fetch_row($res); }
function mysql_num_rows($res) { return mysqli_num_rows($res); }
function mysql_insert_id($link) { return mysqli_insert_id($link); }
function mysql_real_escape_string($str, $link) { return mysqli_real_escape_string($link, $str); }
function mysql_error($link) { return mysqli_error($link); }

function dbj_out($arr) {
    echo json_encode($arr);
    exit;
}

function dbj_err($msg, $code) {
    if ($code) {
        header('HTTP/1.1 ' . $code);
    }
    dbj_out(array('ok' => false, 'error' => $msg));
}

/*---- Режим организатора ----------------------------------------------------
  События в статусе «Подготовка» видны и редактируемы только организаторам.
  Авторизация — пароль орга (тот же, что в портале: $portal_org_password из
  секретного ../db.inc.php). В cookie кладём HMAC от пароля, не сам пароль. */

/** Статус «только для организаторов» (событие ещё не публикуется участникам). */
function dbj_org_only_status() {
    return 'Подготовка';
}

function dbj_org_cookie_name() {
    return 'ub_org_t';
}

/** HMAC-токен орга (без пароля в cookie). */
function dbj_org_token($password) {
    return hash_hmac('sha256', 'ub_timer_org_v1', $password);
}

function dbj_org_password() {
    return isset($GLOBALS['dbj_org_password']) ? (string)$GLOBALS['dbj_org_password'] : '';
}

function dbj_org_configured() {
    return dbj_org_password() !== '';
}

/** Постоянное по времени сравнение строк (PHP 5.2, без hash_equals). */
function dbj_const_eq($a, $b) {
    if (strlen($a) !== strlen($b)) {
        return false;
    }
    $diff = 0;
    for ($i = 0; $i < strlen($a); $i++) {
        $diff |= ord($a[$i]) ^ ord($b[$i]);
    }
    return $diff === 0;
}

/** Авторизован ли текущий браузер как организатор. */
function dbj_is_org() {
    $pw = dbj_org_password();
    if ($pw === '') {
        return false;
    }
    $name = dbj_org_cookie_name();
    if (!isset($_COOKIE[$name])) {
        return false;
    }
    return dbj_const_eq(dbj_org_token($pw), (string)$_COOKIE[$name]);
}

function dbj_org_status($link) {
    dbj_out(array('ok' => true, 'org' => dbj_is_org(), 'can_login' => dbj_org_configured()));
}

function dbj_org_login($link) {
    if (!dbj_org_configured()) {
        dbj_err('org_disabled', 403);
    }
    $in = json_decode(file_get_contents('php://input'), true);
    $pw = '';
    if (is_array($in) && isset($in['password'])) {
        $pw = (string)$in['password'];
    } elseif (isset($_POST['password'])) {
        $pw = (string)$_POST['password'];
    }
    $expected = dbj_org_password();
    if ($pw === '' || !dbj_const_eq($expected, $pw)) {
        dbj_err('bad_password', 401);
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    setcookie(dbj_org_cookie_name(), dbj_org_token($expected), time() + 86400 * 400, '/', '', $secure, true);
    dbj_out(array('ok' => true, 'org' => true));
}

function dbj_org_out() {
    setcookie(dbj_org_cookie_name(), '', time() - 3600, '/');
    dbj_out(array('ok' => true, 'org' => false));
}

/** Ступень воронки (план 05) по статистике человека. */
function dbj_funnel_stage($games, $judged, $seconded) {
    if ($games >= 3 && $seconded > 0) {
        return 'наставник';
    }
    if ($games >= 3) {
        return 'профи';
    }
    if ($games === 2) {
        return 'сыграл 2';
    }
    if ($games === 1) {
        return 'сыграл 1';
    }
    if ($judged > 0) {
        return 'посудил';
    }
    return 'без игр';
}

/** Статистика по всем поединкам: id человека => {games, judged, seconded}. */
function dbj_career($link) {
    $out = array();
    $r = mysql_query('SELECT id FROM people', $link);
    while ($row = mysql_fetch_assoc($r)) {
        $out[(int)$row['id']] = array('games' => 0, 'judged' => 0, 'seconded' => 0);
    }
    $r = mysql_query('SELECT duel_type, player1_id, player2_id, second1_id, second2_id FROM duels', $link);
    while ($row = mysql_fetch_assoc($r)) {
        $paired = ((string)$row['duel_type'] === 'парный');
        $classic = ((string)$row['duel_type'] === 'классика');
        foreach (array('player1_id', 'player2_id') as $k) {
            $pid = (int)$row[$k];
            if ($pid && isset($out[$pid])) {
                $out[$pid]['games']++;
            }
        }
        if ($paired) {
            foreach (array('second1_id', 'second2_id') as $k) {
                $pid = (int)$row[$k];
                if ($pid && isset($out[$pid])) {
                    $out[$pid]['games']++;
                }
            }
        }
        if ($classic) {
            foreach (array('second1_id', 'second2_id') as $k) {
                $pid = (int)$row[$k];
                if ($pid && isset($out[$pid])) {
                    $out[$pid]['seconded']++;
                }
            }
        }
    }
    $r = mysql_query('SELECT person_id, COUNT(*) AS judged FROM duel_judges WHERE person_id IS NOT NULL GROUP BY person_id', $link);
    while ($row = mysql_fetch_assoc($r)) {
        $pid = (int)$row['person_id'];
        if (isset($out[$pid])) {
            $out[$pid]['judged'] = (int)$row['judged'];
        }
    }
    return $out;
}

/** id людей со степенью вовлечения «Профессиональный судья» (круг ФУБ). */
function dbj_fub_ids($link) {
    $out = array();
    $r = mysql_query("SELECT DISTINCT person_id FROM circle_memberships WHERE involvement = 'Профессиональный судья'", $link);
    if ($r) {
        while ($row = mysql_fetch_assoc($r)) {
            $out[(int)$row['person_id']] = true;
        }
    }
    return $out;
}

/** id организаторов мероприятия с ролями, дающими ярлык «орг» (группы I и II). */
function dbj_org_ids($link, $eventId) {
    $roles = array(
        'экспертныйКомментарий', 'показывалЧасы', 'настраивалКомнатыZoom',
        'велЗапись', 'планированиеМероприятия', 'подведениеИтогов'
    );
    $in = '';
    foreach ($roles as $role) {
        $in .= ($in === '' ? '' : ',') . "'" . mysql_real_escape_string($role, $link) . "'";
    }
    $out = array();
    $r = mysql_query('SELECT DISTINCT person_id FROM event_organizers WHERE event_id = ' . (int)$eventId . ' AND role IN (' . $in . ')', $link);
    if ($r) {
        while ($row = mysql_fetch_assoc($r)) {
            $out[(int)$row['person_id']] = true;
        }
    }
    return $out;
}

/** Ярлык назначения → значение experience в часах. Приоритет: ФУБ > орг > воронка. */
function dbj_label($pid, $career, $fub, $org) {
    if (isset($fub[$pid])) {
        return 'expert';
    }
    if (isset($org[$pid])) {
        return 'org';
    }
    $c = isset($career[$pid]) ? $career[$pid] : array('games' => 0, 'judged' => 0, 'seconded' => 0);
    $stage = dbj_funnel_stage((int)$c['games'], (int)$c['judged'], (int)$c['seconded']);
    if ($stage === 'профи' || $stage === 'наставник') {
        return 'experienced';
    }
    return 'novice';
}

function dbj_person($names, $id) {
    $pid = (int)$id;
    if ($pid <= 0) {
        return null;
    }
    return array('id' => $pid, 'full_name' => isset($names[$pid]) ? $names[$pid] : '');
}

function dbj_events($link) {
    $scope = isset($_GET['scope']) ? (string)$_GET['scope'] : 'upcoming';
    $where = ($scope === 'today')
        ? 'e.starts_on = CURDATE()'
        : "e.status NOT IN ('Проведено', 'Отменено')";
    $isOrg = dbj_is_org();
    $events = array();
    $hidden = 0;
    $r = mysql_query(
        'SELECT e.id, e.title, e.event_type, e.starts_on, e.starts_at, e.status ' .
        'FROM events e WHERE ' . $where . ' ORDER BY e.starts_on DESC, e.id DESC',
        $link
    );
    if ($r) {
        while ($row = mysql_fetch_assoc($r)) {
            $status = (string)$row['status'];
            $orgOnly = ($status === dbj_org_only_status());
            if ($orgOnly && !$isOrg) {
                $hidden++;
                continue;
            }
            $events[] = array(
                'id' => (int)$row['id'],
                'title' => (string)$row['title'],
                'event_type' => (string)$row['event_type'],
                'starts_on' => ($row['starts_on'] === null ? null : (string)$row['starts_on']),
                'starts_at' => ($row['starts_at'] === null ? null : (string)$row['starts_at']),
                'status' => $status,
                'org_only' => $orgOnly
            );
        }
    }
    dbj_out(array(
        'ok' => true,
        'scope' => $scope,
        'org' => $isOrg,
        'can_login' => dbj_org_configured(),
        'hidden_org' => $hidden,
        'events' => $events
    ));
}

/** Опубликованные ситуации для выбора в расписании. */
function dbj_situations($link) {
    $out = array();
    $r = mysql_query(
        'SELECT id, code, num, duel_type, description, roles_json ' .
        'FROM situations WHERE is_published = 1 ORDER BY num IS NULL, num, code',
        $link
    );
    if ($r) {
        while ($row = mysql_fetch_assoc($r)) {
            $out[] = array(
                'id' => (int)$row['id'],
                'code' => ($row['code'] === null ? '' : (string)$row['code']),
                'num' => ($row['num'] === null ? null : (int)$row['num']),
                'duel_type' => ($row['duel_type'] === null ? '' : (string)$row['duel_type']),
                'description' => ($row['description'] === null ? '' : (string)$row['description']),
                'roles_json' => ($row['roles_json'] === null ? '' : (string)$row['roles_json'])
            );
        }
    }
    dbj_out(array('ok' => true, 'situations' => $out));
}

function dbj_event($link) {
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
    if ($id <= 0) {
        dbj_err('bad_id', 400);
    }
    $r = mysql_query(
        'SELECT id, slug, title, event_type, starts_on, starts_at, ends_at, status, referee_person_id ' .
        'FROM events WHERE id = ' . $id,
        $link
    );
    $ev = $r ? mysql_fetch_assoc($r) : null;
    if (!$ev) {
        dbj_err('event_not_found', 404);
    }
    if ((string)$ev['status'] === dbj_org_only_status() && !dbj_is_org()) {
        dbj_err('org_only', 403);
    }

    $career = dbj_career($link);
    $fub = dbj_fub_ids($link);
    $org = dbj_org_ids($link, $id);

    $names = array();
    $active = array();
    $r = mysql_query('SELECT id, full_name, is_active FROM people', $link);
    while ($row = mysql_fetch_assoc($r)) {
        $pid = (int)$row['id'];
        $names[$pid] = (string)$row['full_name'];
        $active[$pid] = ((int)$row['is_active'] === 1);
    }

    $used = array();
    $duels = array();
    $duelIds = array();
    $r = mysql_query(
        'SELECT d.id, d.sort_order, d.duel_type, d.prep_mode, d.round_minutes, d.referee_qty, d.notes, ' .
        'd.situation_id, d.player1_id, d.second1_id, d.player2_id, d.second2_id, ' .
        's.code AS s_code, s.num AS s_num, s.duel_type AS s_type, s.description AS s_desc, s.roles_json AS s_roles ' .
        'FROM duels d LEFT JOIN situations s ON s.id = d.situation_id ' .
        'WHERE d.event_id = ' . $id . ' ORDER BY d.sort_order, d.id',
        $link
    );
    while ($d = mysql_fetch_assoc($r)) {
        $did = (int)$d['id'];
        $duelIds[] = $did;
        foreach (array('player1_id', 'second1_id', 'player2_id', 'second2_id') as $k) {
            $pid = (int)$d[$k];
            if ($pid) {
                $used[$pid] = true;
            }
        }
        $duels[] = array(
            'id' => $did,
            'sort_order' => (int)$d['sort_order'],
            'duel_type' => (string)$d['duel_type'],
            'prep_mode' => (string)$d['prep_mode'],
            'round_minutes' => (int)$d['round_minutes'],
            'referee_qty' => ($d['referee_qty'] === null ? null : (int)$d['referee_qty']),
            'notes' => ($d['notes'] === null ? null : (string)$d['notes']),
            'situation' => ($d['situation_id'] === null ? null : array(
                'id' => (int)$d['situation_id'],
                'code' => ($d['s_code'] === null ? '' : (string)$d['s_code']),
                'num' => ($d['s_num'] === null ? null : (int)$d['s_num']),
                'duel_type' => ($d['s_type'] === null ? '' : (string)$d['s_type']),
                'description' => ($d['s_desc'] === null ? null : (string)$d['s_desc']),
                'roles_json' => ($d['s_roles'] === null ? null : (string)$d['s_roles'])
            )),
            'player1' => dbj_person($names, $d['player1_id']),
            'second1' => dbj_person($names, $d['second1_id']),
            'player2' => dbj_person($names, $d['player2_id']),
            'second2' => dbj_person($names, $d['second2_id']),
            'judges' => array()
        );
    }

    if ($duelIds) {
        $in = implode(',', array_map('intval', $duelIds));
        $judges = array();
        $r = mysql_query('SELECT duel_id, person_id, college, vote FROM duel_judges WHERE duel_id IN (' . $in . ') ORDER BY id', $link);
        while ($row = mysql_fetch_assoc($r)) {
            $did = (int)$row['duel_id'];
            $pid = (int)$row['person_id'];
            if ($pid) {
                $used[$pid] = true;
            }
            $judges[$did][] = array(
                'person_id' => ($pid > 0 ? $pid : null),
                'college' => ($row['college'] === null ? null : (string)$row['college']),
                'vote' => ($row['vote'] === null ? null : (string)$row['vote'])
            );
        }
        foreach ($duels as $i => $d) {
            $duels[$i]['judges'] = isset($judges[$d['id']]) ? $judges[$d['id']] : array();
        }
    }

    $peopleOut = array();
    foreach (array_keys($used) as $pid) {
        $c = isset($career[$pid]) ? $career[$pid] : array('games' => 0, 'judged' => 0, 'seconded' => 0);
        $peopleOut[] = array(
            'id' => (int)$pid,
            'full_name' => isset($names[$pid]) ? $names[$pid] : '',
            'is_active' => isset($active[$pid]) ? $active[$pid] : true,
            'experience_label' => dbj_label($pid, $career, $fub, $org),
            'stats' => array(
                'played' => (int)$c['games'],
                'judged' => (int)$c['judged'],
                'seconded' => (int)$c['seconded']
            )
        );
    }

    dbj_out(array(
        'ok' => true,
        'event' => array(
            'id' => (int)$ev['id'],
            'slug' => ($ev['slug'] === null ? null : (string)$ev['slug']),
            'title' => (string)$ev['title'],
            'event_type' => (string)$ev['event_type'],
            'starts_on' => ($ev['starts_on'] === null ? null : (string)$ev['starts_on']),
            'starts_at' => ($ev['starts_at'] === null ? null : (string)$ev['starts_at']),
            'ends_at' => ($ev['ends_at'] === null ? null : (string)$ev['ends_at']),
            'status' => (string)$ev['status'],
            'referee_person_id' => ($ev['referee_person_id'] === null ? null : (int)$ev['referee_person_id'])
        ),
        'duels' => $duels,
        'people' => $peopleOut
    ));
}

/** Запись: POST JSON {event_id, ops:[...]}. Каждая операция — маленькая идемпотентная. */
function dbj_write($link) {
    if (dbj_org_configured() && !dbj_is_org()) {
        dbj_err('org_required', 403);
    }
    $raw = file_get_contents('php://input');
    $in = json_decode($raw, true);
    if (!is_array($in)) {
        dbj_err('bad_json', 400);
    }
    $eventId = isset($in['event_id']) ? (int)$in['event_id'] : 0;
    $ops = isset($in['ops']) && is_array($in['ops']) ? $in['ops'] : array();
    if (!$ops) {
        dbj_out(array('ok' => true, 'applied' => 0));
    }

    $allowedDuelFields = array(
        'situation_id', 'player1_id', 'second1_id', 'player2_id', 'second2_id',
        'referee_qty', 'duel_type', 'prep_mode', 'round_minutes', 'sort_order', 'notes'
    );

    $applied = 0;
    $results = array();
    $added = array();
    foreach ($ops as $op) {
        if (!is_array($op) || !isset($op['op'])) {
            continue;
        }
        $kind = (string)$op['op'];

        if ($kind === 'event') {
            $duelId = isset($op['duel_id']) ? (int)$op['duel_id'] : 0;
            if ($duelId <= 0) { $results[] = 'event:no_duel'; continue; }
            $type = isset($op['type']) ? (string)$op['type'] : '';
            if ($type === '') { $results[] = 'event:no_type'; continue; }
            $moment = (isset($op['moment_sec']) && $op['moment_sec'] !== null && $op['moment_sec'] !== '') ? (int)$op['moment_sec'] : null;
            $payload = isset($op['payload']) ? json_encode($op['payload']) : null;
            $r = mysql_query('SELECT IFNULL(MAX(seq_num),0)+1 FROM protocol_events WHERE duel_id=' . $duelId, $link);
            $seqRow = $r ? mysql_fetch_row($r) : array(1);
            $seq = (int)$seqRow[0];
            if (!$seq) { $seq = 1; }
            $ok = mysql_query(
                'INSERT INTO protocol_events (duel_id, seq_num, moment_sec, event_type, payload_json) VALUES ('
                . $duelId . ', ' . $seq . ', '
                . ($moment === null ? 'NULL' : (int)$moment) . ', '
                . "'" . mysql_real_escape_string($type, $link) . "', "
                . ($payload === null ? 'NULL' : "'" . mysql_real_escape_string($payload, $link) . "'") . ')',
                $link
            );
            if ($ok) { $applied++; } else { $results[] = 'event:' . mysql_error($link); }
            continue;
        }

        if ($kind === 'duel') {
            $duelId = isset($op['duel_id']) ? (int)$op['duel_id'] : 0;
            $fields = isset($op['fields']) && is_array($op['fields']) ? $op['fields'] : array();
            if ($duelId <= 0 || !$fields) { $results[] = 'duel:bad'; continue; }
            $set = array();
            foreach ($fields as $f => $v) {
                if (!in_array($f, $allowedDuelFields, true)) { continue; }
                if ($v === null || $v === '') {
                    $set[] = '`' . $f . '`=NULL';
                } elseif ($f === 'situation_id' || $f === 'player1_id' || $f === 'second1_id'
                    || $f === 'player2_id' || $f === 'second2_id' || $f === 'referee_qty'
                    || $f === 'round_minutes' || $f === 'sort_order') {
                    $set[] = '`' . $f . '`=' . (int)$v;
                } else {
                    $set[] = '`' . $f . "`='" . mysql_real_escape_string((string)$v, $link) . "'";
                }
            }
            if (!$set) { $results[] = 'duel:no_fields'; continue; }
            $ok = mysql_query('UPDATE duels SET ' . implode(',', $set) . ' WHERE id=' . $duelId, $link);
            if ($ok) { $applied++; } else { $results[] = 'duel:' . mysql_error($link); }
            continue;
        }

        if ($kind === 'log') {
            $duelId = isset($op['duel_id']) ? (int)$op['duel_id'] : 0;
            if ($duelId <= 0) { $results[] = 'log:no_duel'; continue; }
            $field = isset($op['field']) ? substr((string)$op['field'], 0, 64) : '';
            if ($field === '') { $results[] = 'log:no_field'; continue; }
            $old = array_key_exists('old', $op) ? $op['old'] : null;
            $new = array_key_exists('new', $op) ? $op['new'] : null;
            $author = (isset($op['author_id']) && $op['author_id'] !== null && $op['author_id'] !== '') ? (int)$op['author_id'] : null;
            $sql = 'INSERT INTO duel_change_log (duel_id, changed_at, field_name, old_value, new_value, author_id) VALUES ('
                . $duelId . ", '" . date('Y-m-d H:i:s') . "', "
                . "'" . mysql_real_escape_string($field, $link) . "', "
                . ($old === null ? 'NULL' : "'" . mysql_real_escape_string((string)$old, $link) . "'") . ', '
                . ($new === null ? 'NULL' : "'" . mysql_real_escape_string((string)$new, $link) . "'") . ', '
                . ($author === null ? 'NULL' : (int)$author) . ')';
            $ok = mysql_query($sql, $link);
            if ($ok) { $applied++; } else { $results[] = 'log:' . mysql_error($link); }
            continue;
        }

        if ($kind === 'judges') {
            $duelId = isset($op['duel_id']) ? (int)$op['duel_id'] : 0;
            $list = isset($op['judges']) && is_array($op['judges']) ? $op['judges'] : array();
            if ($duelId <= 0) { $results[] = 'judges:no_duel'; continue; }
            $hasAgreed = dbj_has_column($link, 'duel_judges', 'agreed');
            mysql_query('DELETE FROM duel_judges WHERE duel_id=' . $duelId, $link);
            $n = 0;
            foreach ($list as $j) {
                if (!is_array($j)) { continue; }
                $pid = (isset($j['person_id']) && $j['person_id'] !== null && $j['person_id'] !== '') ? (int)$j['person_id'] : null;
                if ($pid === null) { continue; }
                $college = isset($j['college']) ? $j['college'] : null;
                $vote = isset($j['vote']) ? $j['vote'] : null;
                $agreed = (isset($j['agreed']) && $j['agreed']) ? 1 : 0;
                $cols = 'duel_id, person_id, college, vote';
                $vals = $duelId . ', ' . $pid . ', '
                    . ($college === null || $college === '' ? 'NULL' : "'" . mysql_real_escape_string((string)$college, $link) . "'") . ', '
                    . ($vote === null || $vote === '' ? 'NULL' : "'" . mysql_real_escape_string((string)$vote, $link) . "'");
                if ($hasAgreed) { $cols .= ', agreed'; $vals .= ', ' . $agreed; }
                if (mysql_query('INSERT INTO duel_judges (' . $cols . ') VALUES (' . $vals . ')', $link)) { $n++; }
            }
            $applied++;
            continue;
        }

        if ($kind === 'agree') {
            $duelId = isset($op['duel_id']) ? (int)$op['duel_id'] : 0;
            $pid = (isset($op['person_id']) && $op['person_id'] !== null && $op['person_id'] !== '') ? (int)$op['person_id'] : 0;
            if ($duelId <= 0 || $pid <= 0) { $results[] = 'agree:bad'; continue; }
            if (!dbj_has_column($link, 'duel_judges', 'agreed')) { $results[] = 'agree:no_column'; continue; }
            $val = !empty($op['agreed']) ? 1 : 0;
            $ok = mysql_query('UPDATE duel_judges SET agreed=' . $val . ' WHERE duel_id=' . $duelId . ' AND person_id=' . $pid, $link);
            if ($ok) { $applied++; } else { $results[] = 'agree:' . mysql_error($link); }
            continue;
        }

        if ($kind === 'vote') {
            $duelId = isset($op['duel_id']) ? (int)$op['duel_id'] : 0;
            $pid = (isset($op['person_id']) && $op['person_id'] !== null && $op['person_id'] !== '') ? (int)$op['person_id'] : 0;
            if ($duelId <= 0 || $pid <= 0) { $results[] = 'vote:bad'; continue; }
            $vote = isset($op['vote']) ? $op['vote'] : null;
            $ok = mysql_query('UPDATE duel_judges SET vote='
                . ($vote === null || $vote === '' ? 'NULL' : "'" . mysql_real_escape_string((string)$vote, $link) . "'")
                . ' WHERE duel_id=' . $duelId . ' AND person_id=' . $pid, $link);
            if ($ok) { $applied++; } else { $results[] = 'vote:' . mysql_error($link); }
            continue;
        }

        if ($kind === 'duel_add') {
            $type = isset($op['duel_type']) ? (string)$op['duel_type'] : 'классика';
            if ($type !== 'классика' && $type !== 'экспресс') { $type = 'классика'; }
            $random = !empty($op['random']);
            $r = mysql_query(
                'SELECT e.starts_on,
                        (SELECT d.duel_date FROM duels d
                          WHERE d.event_id = e.id AND d.duel_date IS NOT NULL
                          ORDER BY d.sort_order DESC, d.id DESC LIMIT 1) AS last_date,
                        (SELECT MAX(d.sort_order) FROM duels d WHERE d.event_id = e.id) AS max_order
                   FROM events e WHERE e.id = ' . $eventId . ' LIMIT 1',
                $link
            );
            $ev = ($r && mysql_num_rows($r)) ? mysql_fetch_assoc($r) : null;
            if (!$ev) { $results[] = 'duel_add:no_event'; continue; }
            $order = (int)$ev['max_order'] + 1;
            $date = ($ev['last_date'] !== null && $ev['last_date'] !== '')
                ? (string)$ev['last_date']
                : (($ev['starts_on'] !== null && $ev['starts_on'] !== '') ? (string)$ev['starts_on'] : null);
            $mins = ($type === 'экспресс') ? 1 : 5;
            $qty = ($type === 'экспресс') ? 5 : 9;
            $note = $random ? 'Случайная ситуация' : null;
            $dateSql = ($date === null) ? 'NULL' : "'" . mysql_real_escape_string($date, $link) . "'";
            $noteSql = ($note === null) ? 'NULL' : "'" . mysql_real_escape_string($note, $link) . "'";
            $ok = mysql_query(
                'INSERT INTO duels (event_id, sort_order, duel_date, duel_type, prep_mode,
                                    round_minutes, referee_qty, notes)
                 VALUES (' . $eventId . ', ' . $order . ', ' . $dateSql . ", '" . $type . "', 'обычный', "
                    . $mins . ', ' . $qty . ', ' . $noteSql . ')',
                $link
            );
            if ($ok) {
                $newId = (int)mysql_insert_id($link);
                $added[] = array(
                    'id' => $newId,
                    'event_id' => $eventId,
                    'sort_order' => $order,
                    'duel_date' => $date,
                    'duel_type' => $type,
                    'prep_mode' => 'обычный',
                    'round_minutes' => $mins,
                    'referee_qty' => $qty,
                    'notes' => $note,
                    'random' => $random
                );
                $applied++;
            } else {
                $results[] = 'duel_add:' . mysql_error($link);
            }
            continue;
        }

        if ($kind === 'sort') {
            $order = isset($op['order']) && is_array($op['order']) ? $op['order'] : array();
            $n = 0;
            foreach ($order as $i => $did) {
                $did = (int)$did;
                if ($did <= 0) { continue; }
                if (mysql_query('UPDATE duels SET sort_order=' . ($i + 1) . ' WHERE id=' . $did, $link)) { $n++; }
            }
            $applied += $n;
            continue;
        }

        $results[] = 'unknown_op:' . $kind;
    }

    dbj_out(array('ok' => true, 'applied' => $applied, 'results' => $results, 'added' => $added));
}

function dbj_has_column($link, $table, $col) {
    static $cache = array();
    $key = $table . '.' . $col;
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }
    $r = mysql_query('SHOW COLUMNS FROM `' . $table . '` LIKE ' . "'" . mysql_real_escape_string($col, $link) . "'", $link);
    $cache[$key] = ($r && mysql_num_rows($r) > 0);
    return $cache[$key];
}

$cfg = dirname(__FILE__) . '/../db.inc.php';
if (!is_file($cfg)) {
    dbj_err('no_db_config', 500);
}
require $cfg;

$GLOBALS['dbj_org_password'] = isset($portal_org_password) ? (string)$portal_org_password : '';

$link = @mysql_connect($mysql_host, $mysql_user, $mysql_password);
if (!$link || !mysql_select_db($mysql_database, $link)) {
    dbj_err('no_db', 500);
}
mysql_query('SET NAMES utf8mb4', $link);

$action = isset($_GET['action']) ? (string)$_GET['action'] : '';
if ($action === 'events') {
    dbj_events($link);
} elseif ($action === 'event') {
    dbj_event($link);
} elseif ($action === 'situations') {
    dbj_situations($link);
} elseif ($action === 'write') {
    dbj_write($link);
} elseif ($action === 'org_status') {
    dbj_org_status($link);
} elseif ($action === 'org_login') {
    dbj_org_login($link);
} elseif ($action === 'org_logout') {
    dbj_org_out();
}
dbj_err('unknown_action', 400);
