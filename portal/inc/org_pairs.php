<?php
declare(strict_types=1);

/**
 * Генерация пар игроков из заявок (изменение generate-pairs-from-registrations).
 * Канон правил: docs/планы/07_пары_из_заявок.md.
 *
 * Алгоритм — многопроходный жадный (по образцу автоназначения судей), но только игроки.
 * Заполняем player1_id/player2_id слотов классика и экспресс. Парный и секунданты — вручную.
 */

/** Приоритет участника на игру (меньше — раньше). */
function org_pairs_priority_key(array $p, string $today): float
{
    $games = (int)($p['games'] ?? 0);
    $judged = !empty($p['judged']);
    $wantsJudge = !empty($p['wants_judge']);
    // «Играть» не просил — мягкий фактор: уходит в конец СВОЕЙ группы (A или B),
    // но не после другой группы. Смещение меньше разрыва между группами (1000).
    $notPlay = array_key_exists('wants_play', $p) && empty($p['wants_play']);

    if ($games < 3) {
        // Группа A: по ступени воронки; несудившие — последними; желающие судить — чуть позже.
        $key = (float)$games;
        if (!$judged) {
            $key += 0.5;
        }
        if ($wantsJudge) {
            $key += 0.25;
        }
        if ($notPlay) {
            $key += 100.0;
        }
    } else {
        // Группа B: давно не игравшие — раньше.
        $last = (string)($p['last_played'] ?? '');
        $days = org_pairs_days_between($last, $today);
        $key = 1000.0 - ($days === null ? 0 : min($days, 5000));
        if ($wantsJudge) {
            $key += 0.25;
        }
        if ($notPlay) {
            $key += 100.0;
        }
    }

    // Группа C: организаторы круга стрима — в самом конце, после A и B.
    if (!empty($p['is_org'])) {
        $key += 10000.0;
    }
    return $key;
}

/** Разница в днях между ISO-датами; null если дата неизвестна/некорректна. */
function org_pairs_days_between(string $from, string $to): ?int
{
    if ($from === '' || $to === '' || str_starts_with($from, '0000')) {
        return null;
    }
    $a = strtotime($from);
    $b = strtotime($to);
    if ($a === false || $b === false) {
        return null;
    }
    return (int)floor(abs($b - $a) / 86400);
}

/** Сила участника: Elo при достаточном числе игр, иначе карьерный прокси. */
function org_pairs_strength(array $p): float
{
    $eg = (int)($p['elo_games'] ?? 0);
    if ($eg >= 3) {
        return (float)($p['elo'] ?? 1500.0);
    }
    // Фолбэк: чем больше игр, тем чуть выше; новичок — нейтрально.
    $strength = 1500.0 + (int)($p['games'] ?? 0) * 5.0;
    // Кто ещё ни играл, ни судил — технологии не знает: считаем слабее тех, кто уже судил.
    if ((int)($p['games'] ?? 0) === 0 && empty($p['judged'])) {
        $strength -= 10.0;
    }
    return $strength;
}

/** Стоимость кандидата $c в пару к $a для слота типа $type (меньше — лучше). */
function org_pairs_cost(array $a, array $c, string $type, array $opts, string $today): float
{
    $wElo = (float)($opts['w_elo'] ?? 0.02);
    $wPair = (float)($opts['w_pair'] ?? 14.0);
    $wPref = (float)($opts['w_pref'] ?? 1.0);
    $wAvoid = (float)($opts['w_avoid'] ?? 24.0);
    $window = (int)($opts['pair_window_days'] ?? 540);

    $cost = $wElo * abs(org_pairs_strength($a) - org_pairs_strength($c));

    // Организатор как соперник — только чтобы занять оставшийся свободный слот,
    // когда обычных кандидатов уже нет. Штраф больше любого разброса по Elo.
    if (!empty($a['is_org']) || !empty($c['is_org'])) {
        $cost += 1000.0;
    }

    $last = (string)($a['recent'][(int)$c['pid']] ?? '');
    if ($last !== '') {
        $days = org_pairs_days_between($last, $today);
        if ($days !== null) {
            // Разнообразие важнее равенства по силе: любой повтор дорог,
            // свежая встреча — дороже всего, но и старая не «бесплатна».
            $cost += $days < $window ? $wPair * (1.0 - $days / $window) : $wPair * 0.25;
        }
    }

    $pref = (string)($a['pref'] ?? '');
    if ($pref !== '' && $pref !== $type) {
        $cost += $wPref;
    }

    $avoid = $opts['avoid_pairs'] ?? [];
    $k1 = (int)$a['pid'] . '|' . (int)$c['pid'];
    $k2 = (int)$c['pid'] . '|' . (int)$a['pid'];
    if (isset($avoid[$k1]) || isset($avoid[$k2])) {
        $cost += $wAvoid;
    }
    return $cost;
}

/** Допустим ли участник к слоту типа $type (нет запрета орга по типу). */
function org_pairs_eligible(array $p, string $type): bool
{
    $banned = $p['banned'] ?? [];
    return empty($banned[$type]);
}

/**
 * Чистое назначение игроков по слотам.
 *
 * @param list<array{id:int,type:string}> $slots  только классика/экспресс
 * @param list<array> $players  см. обработчик: pid,name,games,judged,elo,elo_games,pref,wants_judge,banned,last_played,recent
 * @param array $opts
 * @return array<int, array{p1:int,p2:int}>  slot_id => игроки
 */
function org_pairs_assign(array $slots, array $players, array $opts = []): array
{
    $today = (string)($opts['today'] ?? date('Y-m-d'));
    $maxGames = (int)($opts['max_games'] ?? 2);

    $byId = [];
    foreach ($players as $p) {
        $byId[(int)$p['pid']] = $p;
    }

    $order = [];
    foreach ($players as $p) {
        $order[] = (int)$p['pid'];
    }
    usort($order, static function (int $x, int $y) use ($byId, $today): int {
        $a = $byId[$x];
        $b = $byId[$y];
        $ka = org_pairs_priority_key($a, $today);
        $kb = org_pairs_priority_key($b, $today);
        if (abs($ka - $kb) > 1e-9) {
            return $ka < $kb ? -1 : 1;
        }
        return strcmp((string)$a['name'], (string)$b['name']);
    });

    $assign = [];
    $gamesInGen = [];
    // Предзанятость: игроки, уже закреплённые в зафиксированных орг-ом слотах,
    // тратят свою квоту на игру, поэтому в других слотах идут только «сверх» неё.
    foreach (($opts['preused'] ?? []) as $ppid => $pn) {
        $gamesInGen[(int)$ppid] = (int)$pn;
    }

    for ($limit = 1; $limit <= $maxGames; $limit++) {
        foreach ($slots as $slot) {
            $sid = (int)$slot['id'];
            if (isset($assign[$sid])) {
                continue;
            }
            $type = (string)$slot['type'];

            $picked = null;
            foreach ($order as $apid) {
                $a = $byId[$apid];
                if (!org_pairs_eligible($a, $type)) {
                    continue;
                }
                if (($gamesInGen[$apid] ?? 0) >= $limit) {
                    continue;
                }
                // подбор соперника
                $bestCost = null;
                $cands = [];
                foreach ($order as $cpid) {
                    if ($cpid === $apid) {
                        continue;
                    }
                    $c = $byId[$cpid];
                    if (!org_pairs_eligible($c, $type)) {
                        continue;
                    }
                    if (($gamesInGen[$cpid] ?? 0) >= $limit) {
                        continue;
                    }
                    // жёсткое вето: два новичка
                    if ((int)$a['games'] === 0 && (int)$c['games'] === 0) {
                        continue;
                    }
                    $cost = org_pairs_cost($a, $c, $type, $opts, $today);
                    if ($bestCost === null || $cost < $bestCost - 1e-9) {
                        $bestCost = $cost;
                        $cands = [$c];
                    } elseif (abs($cost - $bestCost) <= 1e-9) {
                        $cands[] = $c;
                    }
                }
                if ($cands) {
                    $partner = $cands[mt_rand(0, count($cands) - 1)];
                    $picked = ['p1' => $apid, 'p2' => (int)$partner['pid']];
                    break;
                }
            }

            if ($picked === null) {
                continue;
            }
            $assign[$sid] = $picked;
            $gamesInGen[$picked['p1']] = ($gamesInGen[$picked['p1']] ?? 0) + 1;
            $gamesInGen[$picked['p2']] = ($gamesInGen[$picked['p2']] ?? 0) + 1;
        }
        if (count($assign) >= count($slots)) {
            break;
        }
    }

    // Пост-проход: локальное улучшение свапами партнёров между слотами одного типа.
    // Цель — убрать повторы пар (разнообразие важнее равенства по силе), не нарушая
    // вето «новичок×новичок», запреты орга по типу и квоты.
    $typeOf = [];
    foreach ($slots as $slot) {
        $typeOf[(int)$slot['id']] = (string)$slot['type'];
    }
    $pairCostFor = static function (int $sid, int $p1, int $p2) use ($byId, $typeOf, $opts, $today): float {
        $type = $typeOf[$sid] ?? '';
        return org_pairs_cost($byId[$p1], $byId[$p2], $type, $opts, $today);
    };
    $okFor = static function (int $sid, int $p1, int $p2) use ($byId, $typeOf): bool {
        $type = $typeOf[$sid] ?? '';
        if ($p1 === $p2) {
            return false;
        }
        if (!org_pairs_eligible($byId[$p1], $type) || !org_pairs_eligible($byId[$p2], $type)) {
            return false;
        }
        return !((int)$byId[$p1]['games'] === 0 && (int)$byId[$p2]['games'] === 0);
    };
    $ids = array_keys($assign);
    $sweeps = 0;
    do {
        $changed = false;
        $sweeps++;
        foreach ($ids as $ia) {
            foreach ($ids as $ib) {
                if ($ia >= $ib || !isset($assign[$ia]) || !isset($assign[$ib])) {
                    continue;
                }
                if (($typeOf[$ia] ?? '') !== ($typeOf[$ib] ?? '')) {
                    continue;
                }
                $a1 = (int)$assign[$ia]['p1'];
                $a2 = (int)$assign[$ia]['p2'];
                $b1 = (int)$assign[$ib]['p1'];
                $b2 = (int)$assign[$ib]['p2'];
                $cur = $pairCostFor($ia, $a1, $a2) + $pairCostFor($ib, $b1, $b2);
                $variants = [
                    [[$a1, $b1], [$a2, $b2]],
                    [[$a1, $b2], [$a2, $b1]],
                ];
                foreach ($variants as $v) {
                    [$n1, $n2] = $v;
                    if (!$okFor($ia, $n1[0], $n1[1]) || !$okFor($ib, $n2[0], $n2[1])) {
                        continue;
                    }
                    $new = $pairCostFor($ia, $n1[0], $n1[1]) + $pairCostFor($ib, $n2[0], $n2[1]);
                    if ($new < $cur - 1e-9) {
                        $assign[$ia] = ['p1' => $n1[0], 'p2' => $n1[1]];
                        $assign[$ib] = ['p1' => $n2[0], 'p2' => $n2[1]];
                        $changed = true;
                        break 2;
                    }
                }
            }
        }
    } while ($changed && $sweeps < 60);

    return $assign;
}

/** Строка запрещённых типов орга -> [тип => true]. */
function org_pairs_parse_banned(string $raw): array
{
    $out = [];
    foreach (explode(',', $raw) as $t) {
        $t = trim($t);
        if ($t !== '') {
            $out[$t] = true;
        }
    }
    return $out;
}

/** Набор duel_id слота, у которых уже есть судьи. @return array<int,true> */
function org_pairs_judged_duel_ids(mysqli $db, int $eventId): array
{
    $out = [];
    $st = $db->prepare(
        'SELECT DISTINCT dj.duel_id
         FROM duel_judges dj
         JOIN duels d ON d.id = dj.duel_id
         WHERE d.event_id = ?'
    );
    $st->bind_param('i', $eventId);
    $st->execute();
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $out[(int)$row['duel_id']] = true;
    }
    $st->close();
    return $out;
}

/** История соперников: pid => [opponent_pid => последняя дата]. */
function org_pairs_recent_opponents(mysqli $db): array
{
    $out = [];
    $r = $db->query(
        "SELECT d.player1_id p1, d.player2_id p2,
                COALESCE(NULLIF(d.duel_date, '0000-00-00'), e.starts_on) dd
         FROM duels d JOIN events e ON e.id = d.event_id
         WHERE d.duel_type IN ('классика', 'экспресс')
           AND LTRIM(e.title) NOT LIKE 'ТЕСТ БД%'"
    );
    if (!$r) {
        return $out;
    }
    while ($row = $r->fetch_assoc()) {
        $p1 = (int)$row['p1'];
        $p2 = (int)$row['p2'];
        if ($p1 <= 0 || $p2 <= 0 || $p1 === $p2) {
            continue;
        }
        $d = (string)($row['dd'] ?? '');
        if (!isset($out[$p1][$p2]) || $d > $out[$p1][$p2]) {
            $out[$p1][$p2] = $d;
        }
        if (!isset($out[$p2][$p1]) || $d > $out[$p2][$p1]) {
            $out[$p2][$p1] = $d;
        }
    }
    return $out;
}

/** Обработчик action org_gen_pairs: собрать пары и сохранить. */
/** История встреч пары: "min|max" => ['count'=>N,'last'=>'YYYY-MM-DD']. $excludeEventId — не учитывать поединки этого события. */
function org_pairs_pair_history(mysqli $db, int $excludeEventId = 0): array
{
    $out = [];
    $r = $db->query(
        "SELECT d.event_id eid, d.player1_id p1, d.player2_id p2,
                COALESCE(NULLIF(d.duel_date, '0000-00-00'), e.starts_on) dd
         FROM duels d JOIN events e ON e.id = d.event_id
         WHERE d.duel_type IN ('классика', 'экспресс', 'парный')
           AND LTRIM(e.title) NOT LIKE 'ТЕСТ БД%'"
    );
    if (!$r) {
        return $out;
    }
    while ($row = $r->fetch_assoc()) {
        if ($excludeEventId > 0 && (int)$row['eid'] === $excludeEventId) {
            continue;
        }
        $p1 = (int)$row['p1'];
        $p2 = (int)$row['p2'];
        if ($p1 <= 0 || $p2 <= 0 || $p1 === $p2) {
            continue;
        }
        $lo = min($p1, $p2);
        $hi = max($p1, $p2);
        $key = $lo . '|' . $hi;
        $d = (string)($row['dd'] ?? '');
        if (str_starts_with($d, '0000')) {
            $d = '';
        }
        if (!isset($out[$key])) {
            $out[$key] = ['count' => 0, 'last' => ''];
        }
        $out[$key]['count']++;
        if ($d !== '' && $d > $out[$key]['last']) {
            $out[$key]['last'] = $d;
        }
    }
    return $out;
}

function org_gen_pairs(mysqli $db): array
{
    $eid = (int)($_POST['event_id'] ?? 0);
    $ev = org_event_load($db, $eid);
    if (!$ev || !org_event_is_planned($ev)) {
        return ['error' => 'Нельзя генерировать пары'];
    }

    $duels = org_event_duels($db, $eid);
    $judged = org_pairs_judged_duel_ids($db, $eid);
    $slots = [];
    $avoid = [];
    $preused = [];
    $locked = 0;
    foreach ($duels as $d) {
        $type = (string)($d['type'] ?? '');
        if ($type !== 'классика' && $type !== 'экспресс') {
            continue;
        }
        $did = (int)$d['id'];
        $p1 = (int)($d['p1_id'] ?? 0);
        $p2 = (int)($d['p2_id'] ?? 0);
        // Зафиксированный орг-ом слот: пару не трогаем (даже без судей), но её
        // состав учитываем как avoid, чтобы та же пара не всплыла в другом слоте.
        if (!empty($d['gen_locked'])) {
            $locked++;
            foreach ([$p1, $p2] as $pp) {
                if ($pp > 0) {
                    $preused[$pp] = ($preused[$pp] ?? 0) + 1;
                }
            }
            if ($p1 > 0 && $p2 > 0) {
                $avoid[$p1 . '|' . $p2] = true;
                $avoid[$p2 . '|' . $p1] = true;
            }
            continue;
        }
        if (isset($judged[$did])) {
            continue;
        }
        $slots[] = ['id' => $did, 'type' => $type];
        if ($p1 > 0 && $p2 > 0) {
            $avoid[$p1 . '|' . $p2] = true;
            $avoid[$p2 . '|' . $p1] = true;
        }
    }
    if (!$slots) {
        return ['error' => $locked > 0
            ? 'Нет свободных слотов классика/экспресс (все заняты судьями или зафиксированы)'
            : 'Нет слотов классика/экспресс без судей'];
    }

    $regs = org_event_regs($db, $eid);
    $career = org_people_career($db);
    $elo = portal_elo_map($db);
    if (!$elo) {
        // Кэш Elo пуст (например, сразу после миграции) — пересчитать один раз.
        portal_elo_recompute($db);
        $elo = portal_elo_map($db);
    }
    $recent = org_pairs_recent_opponents($db);
    $today = function_exists('portal_today_iso') ? portal_today_iso() : date('Y-m-d');

    // Организаторы круга стрима — группа C: в сетку попадают в самом конце.
    $orgIds = function_exists('org_stream_involvement_ids')
        ? org_stream_involvement_ids($db, 'Организатор')
        : [];

    $players = [];
    foreach ($regs as $r) {
        // Жёстко — только пометка орга «не играть»; желание играть судить/секундировать
        // мягкое (см. docs/планы/07_пары_из_заявок.md), учитывается в приоритете.
        if (!empty($r['org_no_play'])) {
            continue;
        }
        $pid = (int)($r['id'] ?? 0);
        if ($pid <= 0) {
            continue;
        }
        $c = $career[$pid] ?? [];
        $e = $elo[$pid] ?? null;
        $players[] = [
            'pid' => $pid,
            'name' => (string)($r['name'] ?? ('#' . $pid)),
            'games' => (int)($c['games'] ?? 0),
            'judged' => ((int)($c['judged'] ?? 0) > 0),
            'elo' => (float)($e['elo'] ?? 1500.0),
            'elo_games' => (int)($e['games'] ?? 0),
            'pref' => (string)($r['duel_type_pref'] ?? ''),
            'wants_play' => !empty($r['play']),
            'wants_judge' => !empty($r['judge']),
            'is_org' => isset($orgIds[$pid]),
            'banned' => org_pairs_parse_banned((string)($r['org_banned_types'] ?? '')),
            'last_played' => (string)($c['last_played'] ?? ''),
            'recent' => $recent[$pid] ?? [],
        ];
    }
    if (!$players) {
        return ['error' => 'Нет заявок на игру'];
    }

    $assign = org_pairs_assign($slots, $players, [
        'today' => $today,
        'avoid_pairs' => $avoid,
        'preused' => $preused,
    ]);
    if (!$assign) {
        return ['error' => 'Не удалось собрать пары'];
    }

    $st = $db->prepare(
        'UPDATE duels SET player1_id=NULLIF(?, 0), player2_id=NULLIF(?, 0) WHERE id=? AND event_id=?'
    );
    $n = 0;
    foreach ($assign as $did => $pair) {
        $p1 = (int)$pair['p1'];
        $p2 = (int)$pair['p2'];
        $st->bind_param('iiii', $p1, $p2, $did, $eid);
        $st->execute();
        $n++;
    }
    $st->close();

    $_SESSION['org_flash'] = 'Пары сгенерированы: ' . $n . ' слотов из ' . count($slots)
        . ($locked > 0 ? ' (зафиксировано пропущено: ' . $locked . ')' : '');
    return ['redirect' => org_event_url($eid) . '#slots'];
}
