# -*- coding: utf-8 -*-
"""Заполнить people.telegram (@username) и people.telegram_id (числовой id) из Бипиума.

Источник: data/bpium_telegram_all.csv (person_id, ФИО, username, tg_id, ...).

Правила:
  - @username пишем в people.telegram, только если там пусто (не затираем ручное).
  - числовой id пишем в people.telegram_id (колонка добавляется аддитивно, если её нет).
  - колонка telegram_id нужна для кнопки «открыть чат по ID» (tg://user?id=).

Хост БД с дома недоступен: SQL выполняется временным PHP на timer.zaborov.ru
(механизм из load_domain_mysql.py). Затем файл удаляется по FTP.

Режимы:
  --dry-run (по умолчанию) — только показать, сколько строк изменится.
  --apply — выполнить ALTER (при необходимости) и UPDATE.
"""
from __future__ import annotations

import argparse
import csv
import secrets
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
from load_domain_mysql import load_env, _php_preamble, run_remote_php  # noqa: E402

CSV_PATH = REPO / "data" / "bpium_telegram_all.csv"


def esc(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def load_pairs() -> tuple[list[tuple[int, str]], list[tuple[int, int]]]:
    user_pairs: list[tuple[int, str]] = []
    id_pairs: list[tuple[int, int]] = []
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            pid = (row.get("person_id") or "").strip()
            if not pid.isdigit():
                continue
            pid = int(pid)
            name = (row.get("username") or "").strip()
            if name:
                user_pairs.append((pid, name if name.startswith("@") else "@" + name))
            tid = (row.get("tg_id") or "").strip()
            if tid.isdigit():
                id_pairs.append((pid, int(tid)))
    return user_pairs, id_pairs


def build_php(token: str, user_pairs: list[tuple[int, str]], id_pairs: list[tuple[int, int]], dry_run: bool) -> str:
    u_rows = ",\n".join("  array(%d, %s)" % (pid, esc(tg)) for pid, tg in user_pairs)
    i_rows = ",\n".join("  array(%d, %d)" % (pid, tid) for pid, tid in id_pairs)
    mode = "DRY" if dry_run else "APPLY"
    return _php_preamble(token) + f"""
$users = array(
{u_rows}
);
$ids = array(
{i_rows}
);
$mode = '{mode}';
echo "MODE $mode users=" . count($users) . " ids=" . count($ids) . "\\n";

function col_exists($table, $col) {{
    $r = q("SHOW COLUMNS FROM `$table` LIKE " . s($col));
    return $r && mysql_num_rows($r) > 0;
}}
if (!col_exists('people', 'telegram_id')) {{
    if ($mode === 'APPLY') {{
        if (q("ALTER TABLE people ADD COLUMN telegram_id INT NULL")) echo "ALTER people ADD telegram_id\\n";
    }} else {{
        echo "WOULD add column telegram_id\\n";
    }}
}} else {{
    echo "COLUMN telegram_id exists\\n";
}}

$u_target=0; $u_empty=0; $u_changed=0;
foreach ($users as $r) {{
    $id=(int)$r[0]; $tg=$r[1];
    $q=q("SELECT telegram FROM people WHERE id=" . s($id));
    if (!$q || mysql_num_rows($q)==0) {{ echo "MISSING $id\\n"; continue; }}
    $u_target++;
    $cur=mysql_result($q,0,'telegram');
    if ($cur===null || trim($cur)==='') {{
        $u_empty++;
        if ($mode==='APPLY') {{
            if (q("UPDATE people SET telegram=" . s($tg) . " WHERE id=" . s($id) . " AND (telegram IS NULL OR telegram='')")) $u_changed+=mysql_affected_rows($link);
        }}
    }}
}}
echo "username: target=$u_target empty=$u_empty changed=$u_changed\\n";

$i_target=0; $i_empty=0; $i_changed=0;
if ($mode==='APPLY' && col_exists('people','telegram_id')) {{
    foreach ($ids as $r) {{
        $id=(int)$r[0]; $tid=(int)$r[1];
        $q=q("SELECT telegram_id FROM people WHERE id=" . s($id));
        if (!$q || mysql_num_rows($q)==0) {{ echo "ID_MISSING $id\\n"; continue; }}
        $i_target++;
        $cur=mysql_result($q,0,'telegram_id');
        if ($cur===null || (int)$cur === 0) {{
            $i_empty++;
            if (q("UPDATE people SET telegram_id=" . s($tid) . " WHERE id=" . s($id) . " AND (telegram_id IS NULL OR telegram_id=0)")) $i_changed+=mysql_affected_rows($link);
        }}
    }}
    echo "telegram_id: target=$i_target empty=$i_empty changed=$i_changed\\n";
}} else {{
    echo "telegram_id: skipped (dry-run или нет колонки) would_set=" . count($ids) . "\\n";
}}

$q=q("SELECT COUNT(*) c FROM people WHERE telegram IS NOT NULL AND telegram<>''");
echo "people_with_telegram=" . mysql_result($q,0,'c') . "\\n";
if (col_exists('people','telegram_id')) {{
    $q=q("SELECT COUNT(*) c FROM people WHERE telegram_id IS NOT NULL AND telegram_id<>0");
    echo "people_with_telegram_id=" . mysql_result($q,0,'c') . "\\n";
}}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="выполнить ALTER/UPDATE (иначе dry-run)")
    args = ap.parse_args()
    user_pairs, id_pairs = load_pairs()
    print(f"CSV: usernames={len(user_pairs)}, ids={len(id_pairs)}")
    env = load_env()
    token = secrets.token_hex(16)
    php = build_php(token, user_pairs, id_pairs, dry_run=not args.apply)
    run_remote_php(env, php, token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
