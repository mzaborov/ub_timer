<?php
/**
 * Часы → БД: тонкий same-origin JSON-эндпоинт (PHP 5.2).
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
    $events = array();
    $r = mysql_query(
        'SELECT e.id, e.title, e.event_type, e.starts_on, e.starts_at, e.status ' .
        'FROM events e WHERE ' . $where . ' ORDER BY e.starts_on DESC, e.id DESC',
        $link
    );
    if ($r) {
        while ($row = mysql_fetch_assoc($r)) {
            $events[] = array(
                'id' => (int)$row['id'],
                'title' => (string)$row['title'],
                'event_type' => (string)$row['event_type'],
                'starts_on' => ($row['starts_on'] === null ? null : (string)$row['starts_on']),
                'starts_at' => ($row['starts_at'] === null ? null : (string)$row['starts_at']),
                'status' => (string)$row['status']
            );
        }
    }
    dbj_out(array('ok' => true, 'scope' => $scope, 'events' => $events));
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

$cfg = dirname(__FILE__) . '/../db.inc.php';
if (!is_file($cfg)) {
    dbj_err('no_db_config', 500);
}
require $cfg;

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
}
dbj_err('unknown_action', 400);
