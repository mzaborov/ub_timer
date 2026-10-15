# -*- coding: utf-8 -*-
"""Разовый инструмент: тестовое мероприятие в прод-БД для happy-path часов.

SQL недоступен с домашней машины (только с сервера), поэтому используется тот же
механизм, что и в load_domain_mysql.py: FTP-заливка временного PHP с токеном и вызов
по HTTPS. Скрипт НИЧЕГО не делает по умолчанию.

Подкоманды:
  probe            — список онлайнов с числом поединков по типам и судей (выбор образца).
  create --source ID [--title T]  — создать тестовое мероприятие копией онлайна ID
                     (starts_on = сегодня, статус «Подготовка», все три типа поединков).
  list             — показать тестовые мероприятия.
  drop --id ID     — удалить тестовое мероприятие (только с префиксом «ТЕСТ БД»).

Безопасность: код создания/удаления трогает ТОЛЬКО строки с заголовком-префиксом
«ТЕСТ БД». Боевые события/поединки не изменяются.
"""
from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))

from load_domain_mysql import load_env, run_remote_php, _php_preamble, php_str  # noqa: E402

PREFIX = "ТЕСТ БД"


def _probe_php(token: str) -> str:
    return _php_preamble(token) + f"""
echo "mode=probe\\n";
$r = q("SELECT e.id, e.title, e.event_type, e.status, e.starts_on, e.referee_person_id,
   COUNT(d.id) AS duels,
   SUM(d.duel_type='классика') AS klass, SUM(d.duel_type='парный') AS parn, SUM(d.duel_type='экспресс') AS expr,
   SUM(d.player1_id IS NOT NULL AND d.player2_id IS NOT NULL) AS with_players,
   SUM(d.situation_id IS NOT NULL) AS with_sit
   FROM events e JOIN duels d ON d.event_id = e.id
   GROUP BY e.id ORDER BY e.starts_on DESC, e.id DESC LIMIT 50");
if (!$r) {{ echo "SQL_ERR " . mysql_error() . "\\n"; exit; }}
while ($row = mysql_fetch_assoc($r)) {{
    $j = q("SELECT COUNT(*) FROM duel_judges dj JOIN duels dd ON dd.id=dj.duel_id WHERE dd.event_id=" . (int)$row['id']);
    $jn = $j ? mysql_fetch_row($j) : array(0);
    echo $row['id'] . "\\t" . $row['starts_on'] . "\\t" . $row['status'] . "\\t" . $row['event_type']
        . "\\tduels=" . $row['duels'] . " (k" . (int)$row['klass'] . "/p" . (int)$row['parn'] . "/x" . (int)$row['expr'] . ")"
        . "\\tplayers=" . $row['with_players'] . "\\tsit=" . $row['with_sit'] . "\\tjudges=" . $jn[0]
        . "\\t" . $row['title'] . "\\n";
}}
echo "PROBE_OK\\n";
"""


def _create_php(token: str, source_id: int, title: str) -> str:
    return _php_preamble(token) + f"""
$source_id = {source_id};
$title = {php_str(title)};
$prefix = {php_str(PREFIX)};

$r = q("SELECT * FROM events WHERE id = " . (int)$source_id);
$src = $r ? mysql_fetch_assoc($r) : null;
if (!$src) {{ echo "SRC_NOT_FOUND\\n"; exit; }}

$today = date('Y-m-d');
$ok = q("INSERT INTO events (slug, title, event_type, starts_on, ends_on, starts_at, ends_at, status, zoom_url, referee_person_id) VALUES ("
    . "NULL, " . s($title) . ", " . s($src['event_type']) . ", " . s($today) . ", " . s($today) . ", "
    . s($src['starts_at']) . ", " . s($src['ends_at']) . ", 'Подготовка', " . s($src['zoom_url']) . ", " . s($src['referee_person_id']) . ")");
if (!$ok) {{ echo "EVENT_INSERT_FAIL\\n"; exit; }}
$event_id = (int)mysql_insert_id();
echo "new_event_id=$event_id\\n";

// Копия поединков образца.
$map = array();
$r = q("SELECT * FROM duels WHERE event_id = " . (int)$source_id . " ORDER BY sort_order, id");
while ($d = mysql_fetch_assoc($r)) {{
    $ok = q("INSERT INTO duels (event_id, sort_order, duel_date, duel_type, prep_mode, round_minutes, situation_id, player1_id, second1_id, player2_id, second2_id, referee_qty, notes) VALUES ("
        . $event_id . ", " . s($d['sort_order']) . ", " . s($today) . ", " . s($d['duel_type']) . ", " . s($d['prep_mode']) . ", "
        . s($d['round_minutes']) . ", " . s($d['situation_id']) . ", " . s($d['player1_id']) . ", " . s($d['second1_id']) . ", "
        . s($d['player2_id']) . ", " . s($d['second2_id']) . ", " . s($d['referee_qty']) . ", " . s($d['notes']) . ")");
    if (!$ok) {{ echo "DUEL_INSERT_FAIL\\n"; exit; }}
    $map[(int)$d['id']] = (int)mysql_insert_id();
}}
echo "duels_copied=" . count($map) . "\\n";

// Все три типа: если какого-то нет — дублируем первый поединок с нужным типом.
$have = array('классика' => 0, 'парный' => 0, 'экспресс' => 0);
$r = q("SELECT duel_type, COUNT(*) c FROM duels WHERE event_id=$event_id GROUP BY duel_type");
while ($row = mysql_fetch_assoc($r)) $have[$row['duel_type']] = (int)$row['c'];
$firstr = q("SELECT * FROM duels WHERE event_id=$event_id ORDER BY sort_order, id LIMIT 1");
$first = $firstr ? mysql_fetch_assoc($firstr) : null;
$r = q("SELECT IFNULL(MAX(sort_order),0)+1 FROM duels WHERE event_id=$event_id"); $orow = mysql_fetch_row($r); $nextorder = (int)$orow[0];
foreach (array('классика','парный','экспресс') as $t) {{
    if ($have[$t] > 0 || !$first) continue;
    q("INSERT INTO duels (event_id, sort_order, duel_date, duel_type, prep_mode, round_minutes, situation_id, player1_id, second1_id, player2_id, second2_id, referee_qty, notes) VALUES ("
        . $event_id . ", " . $nextorder . ", " . s($today) . ", " . s($t) . ", " . s($first['prep_mode']) . ", "
        . s($first['round_minutes']) . ", " . s($first['situation_id']) . ", " . s($first['player1_id']) . ", " . s($first['second1_id']) . ", "
        . s($first['player2_id']) . ", " . s($first['second2_id']) . ", " . s($first['referee_qty']) . ", " . s($first['notes']) . ")");
    $map[-1 - $nextorder] = (int)mysql_insert_id();
    $nextorder++;
    echo "added_type=$t\\n";
}}

// Копия судей по карте поединков.
$jn = 0;
foreach ($map as $oldd => $newd) {{
    if ($oldd < 0) continue;
    $r = q("SELECT person_id, college, vote FROM duel_judges WHERE duel_id=" . (int)$oldd);
    while ($j = mysql_fetch_assoc($r)) {{
        q("INSERT INTO duel_judges (duel_id, person_id, college, vote) VALUES (" . (int)$newd . ", " . s($j['person_id']) . ", " . s($j['college']) . ", " . s($j['vote']) . ")");
        $jn++;
    }}
}}
echo "judges_copied=$jn\\n";

// Копия организаторов мероприятия.
$on = 0;
$r = q("SELECT person_id, role FROM event_organizers WHERE event_id=" . (int)$source_id);
while ($o = mysql_fetch_assoc($r)) {{
    q("INSERT INTO event_organizers (event_id, person_id, role) VALUES (" . $event_id . ", " . s($o['person_id']) . ", " . s($o['role']) . ")");
    $on++;
}}
echo "organizers_copied=$on\\n";
echo "CREATE_OK event_id=$event_id\\n";
"""


def _list_php(token: str) -> str:
    return _php_preamble(token) + f"""
echo "mode=list\\n";
$r = q("SELECT e.id, e.title, e.starts_on, e.status, COUNT(d.id) duels FROM events e LEFT JOIN duels d ON d.event_id=e.id WHERE e.title LIKE " . s({php_str(PREFIX)} . "%") . " GROUP BY e.id ORDER BY e.id DESC");
if ($r) while ($row = mysql_fetch_assoc($r)) {{
    echo $row['id'] . "\\t" . $row['starts_on'] . "\\t" . $row['status'] . "\\tduels=" . $row['duels'] . "\\t" . $row['title'] . "\\n";
}}
echo "LIST_OK\\n";
"""


def _drop_php(token: str, event_id: int) -> str:
    return _php_preamble(token) + f"""
$event_id = {event_id};
$prefix = {php_str(PREFIX)};
$r = q("SELECT id, title FROM events WHERE id=" . (int)$event_id);
$ev = $r ? mysql_fetch_assoc($r) : null;
if (!$ev) {{ echo "NOT_FOUND\\n"; exit; }}
if (strpos($ev['title'], $prefix) !== 0) {{ echo "REFUSE_NOT_TEST\\n"; exit; }}
$r = q("SELECT id FROM duels WHERE event_id=" . (int)$event_id);
while ($d = mysql_fetch_assoc($r)) {{ q("DELETE FROM duel_judges WHERE duel_id=" . (int)$d['id']); }}
q("DELETE FROM duels WHERE event_id=" . (int)$event_id);
q("DELETE FROM event_organizers WHERE event_id=" . (int)$event_id);
q("DELETE FROM events WHERE id=" . (int)$event_id);
echo "DROP_OK event_id=$event_id\\n";
"""


def _migrate_php(token: str) -> str:
    return _php_preamble(token) + """
echo "mode=migrate\\n";
function has_col($t, $c) { $r = q("SHOW COLUMNS FROM `$t` LIKE " . s($c)); return $r && mysql_num_rows($r) > 0; }
if (!has_col('duel_judges', 'agreed')) {
    if (q("ALTER TABLE duel_judges ADD COLUMN agreed TINYINT(1) NOT NULL DEFAULT 0")) echo "ALTER duel_judges ADD agreed\\n";
    else { echo "ALTER_FAIL\\n"; exit; }
} else { echo "duel_judges.agreed OK\\n"; }
echo "MIGRATE_OK\\n";
"""


def main() -> int:
    ap = argparse.ArgumentParser(description="Тестовое мероприятие в прод-БД (kwargs happy path).")
    ap.add_argument("cmd", choices=["probe", "create", "list", "drop", "migrate"])
    ap.add_argument("--source", type=int, default=0)
    ap.add_argument("--id", type=int, default=0)
    ap.add_argument("--title", default="")
    args = ap.parse_args()

    env = load_env()
    token = secrets.token_hex(16)

    if args.cmd == "probe":
        body = run_remote_php(env, _probe_php(token), token)
        return 0 if "PROBE_OK" in body else 1
    if args.cmd == "create":
        if not args.source:
            print("нужен --source ID (см. probe)")
            return 2
        title = args.title or (PREFIX + " " + __import__("datetime").date.today().isoformat())
        body = run_remote_php(env, _create_php(token, args.source, title), token)
        return 0 if "CREATE_OK" in body else 1
    if args.cmd == "list":
        body = run_remote_php(env, _list_php(token), token)
        return 0 if "LIST_OK" in body else 1
    if args.cmd == "drop":
        if not args.id:
            print("нужен --id ID (см. list)")
            return 2
        body = run_remote_php(env, _drop_php(token, args.id), token)
        return 0 if "DROP_OK" in body else 1
    if args.cmd == "migrate":
        body = run_remote_php(env, _migrate_php(token), token)
        return 0 if "MIGRATE_OK" in body else 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
