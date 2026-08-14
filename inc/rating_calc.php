<?php
/**
 * Единый расчёт рейтинга (PHP 5.2). Без mysql_/mysqli: только массивы.
 * Веса: турнир 10, победа 5, поражение 3, сек.победа 4, сек.поражение 2,
 * судил 1, голос 0.3.
 * Турнир ×10 — только «участник Турнира» стрима я-ИТ-ы: каждый бой
 * игроком (проигрыш тоже; в парном оба игрока стороны) плюс 1 раз за встречу,
 * если ни разу не был игроком, но секундировал (проигрыш секунданта тоже).
 * Бой не за команду (оппонент/помощник вроде Шиловой на встрече 1) в tourn не входит.
 * Ничья / нет голосов — без победы и поражения.
 * Гости не в таблице: ФУБ вне стрима «Стрим поединки я-ИТ-ы»
 * и оппоненты Лидер (игрок/секундант на тип=турнир) вне этого стрима.
 * Неизвестный судья (person_id NULL) — без «судил».
 */

function rating_weights() {
    return array(
        'tourn' => 10,
        'win' => 5,
        'lose' => 3,
        'swin' => 4,
        'slose' => 2,
        'judge' => 1,
        'votes' => 0.3,
    );
}

function rating_empty_stats() {
    return array(
        'tourn' => 0, 'win' => 0, 'lose' => 0,
        'swin' => 0, 'slose' => 0, 'judge' => 0, 'votes' => 0,
    );
}

function rating_bump(&$st, $pid, $field, $n) {
    if (!$pid) return;
    $pid = (int)$pid;
    if (!isset($st[$pid])) {
        $st[$pid] = rating_empty_stats();
    }
    $st[$pid][$field] += $n;
}

function rating_add_detail(&$details, $pid, $kind, $ev, $sit, $bits) {
    if (!$pid) return;
    $pid = (int)$pid;
    if (!isset($details[$pid])) {
        $details[$pid] = array(
            'tourn' => array(), 'win' => array(), 'lose' => array(),
            'swin' => array(), 'slose' => array(), 'judge' => array(), 'votes' => array(),
        );
    }
    $rec = array('ev' => $ev);
    if ($sit !== '') $rec['sit'] = $sit;
    $clean = array();
    $n = count($bits);
    $i = 0;
    for ($i = 0; $i < $n; $i++) {
        if ($bits[$i] !== '') $clean[] = $bits[$i];
    }
    if (count($clean)) $rec['bits'] = $clean;
    $details[$pid][$kind][] = $rec;
}

function rating_credit_tourn(&$st, &$details, &$seen, $pid, $key, $ev, $sit, $bits) {
    if (!$pid) return;
    $pid = (int)$pid;
    if (isset($seen[$key])) return;
    $seen[$key] = true;
    rating_bump($st, $pid, 'tourn', 1);
    rating_add_detail($details, $pid, 'tourn', $ev, $sit, $bits);
}

function rating_sit_label($sits, $sid) {
    $sid = (int)$sid;
    if (!$sid || !isset($sits[$sid])) return '';
    $code = $sits[$sid]['code'];
    if ($code !== '') return $code;
    $num = $sits[$sid]['num'];
    if ($num !== '' && $num !== null) return (string)$num;
    return '';
}

function rating_skip_guests($circleRows, $duelRows) {
    $in_stream = array();
    $in_fub = array();
    $n = count($circleRows);
    $i = 0;
    for ($i = 0; $i < $n; $i++) {
        $row = $circleRows[$i];
        $pid = (int)$row['person_id'];
        $title = $row['title'];
        if ($title === 'Стрим поединки я-ИТ-ы') $in_stream[$pid] = true;
        if ($title === 'ФУБ') $in_fub[$pid] = true;
    }
    $skip = array();
    foreach ($in_fub as $pid => $ok) {
        if (!isset($in_stream[$pid])) $skip[$pid] = true;
    }
    $dn = count($duelRows);
    $di = 0;
    for ($di = 0; $di < $dn; $di++) {
        $d = $duelRows[$di];
        if (!isset($d['event_type']) || $d['event_type'] !== 'турнир') continue;
        $ids = array(
            isset($d['player1_id']) ? (int)$d['player1_id'] : 0,
            isset($d['player2_id']) ? (int)$d['player2_id'] : 0,
            isset($d['second1_id']) ? (int)$d['second1_id'] : 0,
            isset($d['second2_id']) ? (int)$d['second2_id'] : 0,
        );
        $k = 0;
        for ($k = 0; $k < 4; $k++) {
            $pid = $ids[$k];
            if (!$pid) continue;
            if (!isset($in_stream[$pid])) $skip[$pid] = true;
        }
    }
    return $skip;
}

/** id «участник Турнира» в круге «Стрим поединки я-ИТ-ы». */
function rating_yaity_team($circleRows) {
    $team = array();
    $n = count($circleRows);
    $i = 0;
    for ($i = 0; $i < $n; $i++) {
        $row = $circleRows[$i];
        if ($row['title'] !== 'Стрим поединки я-ИТ-ы') continue;
        $inv = isset($row['involvement']) ? $row['involvement'] : '';
        if ($inv !== 'участник Турнира') continue;
        $pid = (int)$row['person_id'];
        if ($pid) $team[$pid] = true;
    }
    return $team;
}

function rating_cmp($a, $b) {
    if ($a['rating'] == $b['rating']) {
        return strcasecmp($a['name'], $b['name']);
    }
    return ($a['rating'] < $b['rating']) ? 1 : -1;
}

/**
 * $people     id => full_name
 * $circleRows list of array(person_id, title, involvement)
 * $judgeRows  list of array(duel_id, person_id, vote)
 * $duelRows   list of array(id, player1_id, second1_id, player2_id, second2_id,
 *             situation_id, event_id, event_type, title, duel_type)
 * $sitRows    id => array(code, num); можно array()
 *
 * @return array rows, details
 */
function rating_compute($people, $circleRows, $judgeRows, $duelRows, $sitRows) {
    $W = rating_weights();
    $skip = rating_skip_guests($circleRows, $duelRows);
    $team = rating_yaity_team($circleRows);
    $st = array();
    $details = array();

    $votes = array();
    $jn = count($judgeRows);
    $ji = 0;
    for ($ji = 0; $ji < $jn; $ji++) {
        $row = $judgeRows[$ji];
        $did = (int)$row['duel_id'];
        if (!isset($votes[$did])) $votes[$did] = array('1' => 0, '2' => 0, 'judges' => array());
        $v = trim($row['vote']);
        if ($v === '1' || $v === '2') $votes[$did][$v]++;
        if ($row['person_id'] !== '' && $row['person_id'] !== null) {
            $votes[$did]['judges'][] = array('id' => (int)$row['person_id'], 'vote' => $v);
        }
    }

    $tourn_seen = array();
    $tourn_player_at = array();
    $tourn_second_at = array();
    $dn = count($duelRows);
    $di = 0;
    for ($di = 0; $di < $dn; $di++) {
        $d = $duelRows[$di];
        $did = (int)$d['id'];
        $eid = (int)$d['event_id'];
        $p1 = (int)$d['player1_id'];
        $p2 = (int)$d['player2_id'];
        $s1 = (int)$d['second1_id'];
        $s2 = (int)$d['second2_id'];
        $vv = isset($votes[$did]) ? $votes[$did] : array('1' => 0, '2' => 0, 'judges' => array());
        $v1 = $vv['1'];
        $v2 = $vv['2'];
        $ev = (isset($d['title']) && $d['title'] !== '' && $d['title'] !== null) ? $d['title'] : 'мероприятие';
        $sit = rating_sit_label($sitRows, isset($d['situation_id']) ? $d['situation_id'] : 0);
        $p1name = isset($people[$p1]) ? $people[$p1] : '';
        $p2name = isset($people[$p2]) ? $people[$p2] : '';
        $paired = (isset($d['duel_type']) && $d['duel_type'] === 'парный');
        if (isset($d['event_type']) && $d['event_type'] === 'турнир') {
            $side1 = $paired ? array($p1, $s1) : array($p1);
            $side2 = $paired ? array($p2, $s2) : array($p2);
            $ai = 0;
            for ($ai = 0; $ai < count($side1); $ai++) {
                $pid = $side1[$ai];
                if (!$pid || !isset($team[$pid])) continue;
                rating_credit_tourn($st, $details, $tourn_seen, $pid, $pid . ':d:' . $did, $ev, $sit, array());
                if (!isset($tourn_player_at[$pid])) $tourn_player_at[$pid] = array();
                $tourn_player_at[$pid][$eid] = true;
            }
            for ($ai = 0; $ai < count($side2); $ai++) {
                $pid = $side2[$ai];
                if (!$pid || !isset($team[$pid])) continue;
                rating_credit_tourn($st, $details, $tourn_seen, $pid, $pid . ':d:' . $did, $ev, $sit, array());
                if (!isset($tourn_player_at[$pid])) $tourn_player_at[$pid] = array();
                $tourn_player_at[$pid][$eid] = true;
            }
            if (!$paired) {
                $secs = array($s1, $s2);
                $si = 0;
                for ($si = 0; $si < 2; $si++) {
                    $spid = $secs[$si];
                    if (!$spid || !isset($team[$spid])) continue;
                    if (!isset($tourn_second_at[$spid])) $tourn_second_at[$spid] = array();
                    if (!isset($tourn_second_at[$spid][$eid])) {
                        $tourn_second_at[$spid][$eid] = array('ev' => $ev, 'sit' => $sit);
                    }
                }
            }
        }
        rating_bump($st, $p1, 'votes', $v1);
        rating_bump($st, $p2, 'votes', $v2);
        if ($paired) {
            rating_bump($st, $s1, 'votes', $v1);
            rating_bump($st, $s2, 'votes', $v2);
        }
        if ($v1 > 0) {
            rating_add_detail($details, $p1, 'votes', $ev, $sit, array($v1 . ' голосов', $v1 . ':' . $v2));
            if ($paired) rating_add_detail($details, $s1, 'votes', $ev, $sit, array($v1 . ' голосов', $v1 . ':' . $v2));
        }
        if ($v2 > 0) {
            rating_add_detail($details, $p2, 'votes', $ev, $sit, array($v2 . ' голосов', $v2 . ':' . $v1));
            if ($paired) rating_add_detail($details, $s2, 'votes', $ev, $sit, array($v2 . ' голосов', $v2 . ':' . $v1));
        }
        if ($v1 > $v2) {
            rating_bump($st, $p1, 'win', 1);
            rating_bump($st, $p2, 'lose', 1);
            rating_add_detail($details, $p1, 'win', $ev, $sit, array($v1 . ':' . $v2));
            rating_add_detail($details, $p2, 'lose', $ev, $sit, array($v2 . ':' . $v1));
            if ($paired) {
                rating_bump($st, $s1, 'win', 1);
                rating_bump($st, $s2, 'lose', 1);
                rating_add_detail($details, $s1, 'win', $ev, $sit, array($v1 . ':' . $v2));
                rating_add_detail($details, $s2, 'lose', $ev, $sit, array($v2 . ':' . $v1));
            } else {
                rating_bump($st, $s1, 'swin', 1);
                rating_bump($st, $s2, 'slose', 1);
                $sec1 = $p1name !== '' ? ('секундант у ' . $p1name) : 'секундант';
                $sec2 = $p2name !== '' ? ('секундант у ' . $p2name) : 'секундант';
                rating_add_detail($details, $s1, 'swin', $ev, $sit, array($v1 . ':' . $v2, $sec1));
                rating_add_detail($details, $s2, 'slose', $ev, $sit, array($v2 . ':' . $v1, $sec2));
            }
        } elseif ($v2 > $v1) {
            rating_bump($st, $p2, 'win', 1);
            rating_bump($st, $p1, 'lose', 1);
            rating_add_detail($details, $p2, 'win', $ev, $sit, array($v2 . ':' . $v1));
            rating_add_detail($details, $p1, 'lose', $ev, $sit, array($v1 . ':' . $v2));
            if ($paired) {
                rating_bump($st, $s2, 'win', 1);
                rating_bump($st, $s1, 'lose', 1);
                rating_add_detail($details, $s2, 'win', $ev, $sit, array($v2 . ':' . $v1));
                rating_add_detail($details, $s1, 'lose', $ev, $sit, array($v1 . ':' . $v2));
            } else {
                rating_bump($st, $s2, 'swin', 1);
                rating_bump($st, $s1, 'slose', 1);
                $sec1 = $p1name !== '' ? ('секундант у ' . $p1name) : 'секундант';
                $sec2 = $p2name !== '' ? ('секундант у ' . $p2name) : 'секундант';
                rating_add_detail($details, $s2, 'swin', $ev, $sit, array($v2 . ':' . $v1, $sec2));
                rating_add_detail($details, $s1, 'slose', $ev, $sit, array($v1 . ':' . $v2, $sec1));
            }
        }
        $jcount = count($vv['judges']);
        $jk = 0;
        for ($jk = 0; $jk < $jcount; $jk++) {
            $jid = $vv['judges'][$jk]['id'];
            $jv = $vv['judges'][$jk]['vote'];
            rating_bump($st, $jid, 'judge', 1);
            $voteBit = ($jv === '1' || $jv === '2') ? ('голос ' . $jv) : '';
            rating_add_detail($details, $jid, 'judge', $ev, $sit, array($voteBit));
        }
    }

    foreach ($tourn_second_at as $pid => $events) {
        foreach ($events as $eid => $info) {
            if (isset($tourn_player_at[$pid][$eid])) continue;
            rating_credit_tourn($st, $details, $tourn_seen, $pid, $pid . ':e:' . $eid, $info['ev'], $info['sit'], array('секундант'));
        }
    }

    $rows = array();
    foreach ($st as $pid => $s) {
        if (isset($skip[$pid])) continue;
        $rating = $s['tourn'] * $W['tourn']
            + $s['win'] * $W['win']
            + $s['lose'] * $W['lose']
            + $s['swin'] * $W['swin']
            + $s['slose'] * $W['slose']
            + $s['judge'] * $W['judge']
            + $s['votes'] * $W['votes'];
        if ($rating == 0) continue;
        $rows[] = array(
            'pid' => $pid,
            'name' => isset($people[$pid]) ? $people[$pid] : ('#' . $pid),
            'rating' => $rating,
            'tourn' => $s['tourn'],
            'win' => $s['win'],
            'lose' => $s['lose'],
            'swin' => $s['swin'],
            'slose' => $s['slose'],
            'judge' => $s['judge'],
            'votes' => $s['votes'],
        );
    }
    usort($rows, 'rating_cmp');
    $place = 1;
    $ri = 0;
    $rn = count($rows);
    for ($ri = 0; $ri < $rn; $ri++) {
        $rows[$ri]['place'] = $place;
        $place++;
    }
    return array('rows' => $rows, 'details' => $details);
}
