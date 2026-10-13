<?php
declare(strict_types=1);

/**
 * Метрика силы Elo для генерации пар (изменение generate-pairs-from-registrations).
 * Канон: docs/планы/07_пары_из_заявок.md.
 *
 * Классика/экспресс — 1×1. Парный — 2×2, но Elo считаем КАЖДОМУ участнику стороны
 * (игрок и его второй игрок) как в классике: опорный рейтинг стороны — МАКСИМАЛЬНЫЙ Elo
 * её участников, дельта применяется персонально каждому.
 * Исход — большинство голосов судей (duel_judges.vote = '1'/'2').
 */

const PORTAL_ELO_START = 1500.0;
const PORTAL_ELO_K = 32.0;

/**
 * Чистый расчёт Elo по истории поединков.
 *
 * @param list<array{id:int|string,duel_type:string,p1:int|string,p2:int|string,s1?:int|string,s2?:int|string,date?:string}> $duels
 * @param array<int|string, array{1?:int,2?:int}> $votes  голоса по поединку: ['1'=>n,'2'=>n]
 * @return array<int, array{elo:float,games:int}>  person_id => ['elo','games']
 */
function elo_compute(
    array $duels,
    array $votes,
    float $start = PORTAL_ELO_START,
    float $k = PORTAL_ELO_K
): array {
    usort($duels, static function (array $a, array $b): int {
        $da = (string)($a['date'] ?? '');
        $db = (string)($b['date'] ?? '');
        if ($da !== $db) {
            return strcmp($da, $db);
        }
        return (int)$a['id'] <=> (int)$b['id'];
    });

    $elo = [];
    $games = [];
    foreach ($duels as $d) {
        $type = (string)($d['duel_type'] ?? '');
        if (!in_array($type, ['классика', 'экспресс', 'парный'], true)) {
            continue;
        }
        $p1 = (int)($d['p1'] ?? 0);
        $p2 = (int)($d['p2'] ?? 0);
        $sec1 = $type === 'парный' ? (int)($d['s1'] ?? 0) : 0;
        $sec2 = $type === 'парный' ? (int)($d['s2'] ?? 0) : 0;
        $side1 = [];
        foreach ([$p1, $sec1] as $x) {
            if ($x > 0) {
                $side1[] = $x;
            }
        }
        $side2 = [];
        foreach ([$p2, $sec2] as $x) {
            if ($x > 0) {
                $side2[] = $x;
            }
        }
        if (!$side1 || !$side2 || array_intersect($side1, $side2)) {
            continue;
        }
        $did = (int)$d['id'];
        $v = $votes[$did] ?? $votes[(string)$did] ?? [];
        $v1 = (int)($v['1'] ?? 0);
        $v2 = (int)($v['2'] ?? 0);
        if ($v1 === $v2) {
            continue; // нет голосов или нет большинства
        }

        $r1 = 0.0;
        foreach ($side1 as $pid) {
            $r1 = max($r1, $elo[$pid] ?? $start);
        }
        $r2 = 0.0;
        foreach ($side2 as $pid) {
            $r2 = max($r2, $elo[$pid] ?? $start);
        }

        $e1 = 1.0 / (1.0 + 10 ** (($r2 - $r1) / 400.0));
        $score1 = $v1 > $v2 ? 1.0 : 0.0;
        foreach ($side1 as $pid) {
            $elo[$pid] = ($elo[$pid] ?? $start) + $k * ($score1 - $e1);
            $games[$pid] = ($games[$pid] ?? 0) + 1;
        }
        foreach ($side2 as $pid) {
            $elo[$pid] = ($elo[$pid] ?? $start) + $k * ((1.0 - $score1) - (1.0 - $e1));
            $games[$pid] = ($games[$pid] ?? 0) + 1;
        }
    }

    $out = [];
    foreach ($elo as $pid => $r) {
        $out[(int)$pid] = ['elo' => round($r, 2), 'games' => $games[$pid] ?? 0];
    }
    return $out;
}

/** Пересчитать Elo по всей истории и записать в person_elo (upsert). @return int записей. */
function portal_elo_recompute(mysqli $db): int
{
    $duels = [];
    $r = $db->query(
        "SELECT d.id, d.duel_type, d.player1_id AS p1, d.player2_id AS p2,
                d.second1_id AS s1, d.second2_id AS s2,
                COALESCE(NULLIF(d.duel_date, '0000-00-00'), e.starts_on) AS ddate
         FROM duels d
         JOIN events e ON e.id = d.event_id
         WHERE d.duel_type IN ('классика', 'экспресс', 'парный')"
    );
    if ($r) {
        while ($row = $r->fetch_assoc()) {
            $duels[] = [
                'id' => (int)$row['id'],
                'duel_type' => (string)$row['duel_type'],
                'p1' => (int)$row['p1'],
                'p2' => (int)$row['p2'],
                's1' => (int)$row['s1'],
                's2' => (int)$row['s2'],
                'date' => (string)($row['ddate'] ?? ''),
            ];
        }
    }

    $votes = [];
    $r = $db->query("SELECT duel_id, vote FROM duel_judges WHERE vote IN ('1', '2')");
    if ($r) {
        while ($row = $r->fetch_assoc()) {
            $did = (int)$row['duel_id'];
            $v = (string)$row['vote'];
            if (!isset($votes[$did])) {
                $votes[$did] = ['1' => 0, '2' => 0];
            }
            $votes[$did][$v]++;
        }
    }

    $data = elo_compute($duels, $votes);
    if (!$data) {
        return 0;
    }
    $now = date('Y-m-d H:i:s');
    $st = $db->prepare(
        'INSERT INTO person_elo (person_id, elo, games, updated_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE elo = VALUES(elo), games = VALUES(games), updated_at = VALUES(updated_at)'
    );
    foreach ($data as $pid => $v) {
        $elo = (float)$v['elo'];
        $games = (int)$v['games'];
        $st->bind_param('idis', $pid, $elo, $games, $now);
        $st->execute();
    }
    $st->close();
    return count($data);
}

/** @return array<int, array{elo:float,games:int}> person_id => Elo из кэша (без записи). */
function portal_elo_map(mysqli $db): array
{
    $out = [];
    $r = $db->query('SELECT person_id, elo, games FROM person_elo');
    if ($r) {
        while ($row = $r->fetch_assoc()) {
            $out[(int)$row['person_id']] = [
                'elo' => (float)$row['elo'],
                'games' => (int)$row['games'],
            ];
        }
    }
    return $out;
}
