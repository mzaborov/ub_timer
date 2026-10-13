# -*- coding: utf-8 -*-
"""Сопоставить участников Telegram-чатов (data/tg_participants.csv) с людьми и заполнить people.telegram / telegram_id.

Порядок сопоставления:
  1) по @username — если у человека уже стоит telegram и он совпал с участником;
  2) по ФИО — «Фамилия Имя» (нормализация, ё→е); при нескольких кандидатах — не угадываем (в отчёт).

Заполнение — аддитивное: пишем только в пустые поля (ручные значения не затираем).
Запись в БД — через временный PHP на сервере (как в load_domain_mysql.py).

Режимы:
  (по умолчанию) dry-run — только отчёт и счётчики;
  --apply — выполнить UPDATE.

Сначала получите CSV:  C:/Projects/.kilo/tools/telegram-mcp/.venv/Scripts/python.exe scripts/tg_participants.py <чаты...>
Отчёт: data/tg_enrich_report.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import secrets
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
from load_domain_mysql import _php_preamble, load_env, run_remote_php  # noqa: E402

PART_CSV = REPO / "data" / "tg_participants.csv"
PEOPLE_JSON = REPO / "docs" / "планы" / "05_данные" / "люди.json"
REPORT = REPO / "data" / "tg_enrich_report.csv"


def esc(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def norm(s: str) -> list[str]:
    s = (s or "").lower().replace("ё", "е")
    return [t for t in re.sub(r"[^a-zа-я ]", " ", s).split() if t]


def part_name_keys(p: dict) -> list[tuple[str, str]]:
    last = (p.get("last_name") or "").strip()
    first = (p.get("first_name") or "").strip()
    keys: list[tuple[str, str]] = []
    if last:
        ft = norm(first)
        if ft:
            keys.append((last.lower().replace("ё", "е"), ft[0]))
    else:
        t = norm(first)
        if len(t) >= 2:
            keys.append((t[0], t[1]))
    return keys


def load_participants(path: Path = PART_CSV) -> tuple[dict[tuple[str, str], list[dict]], dict[str, dict]]:
    by_name: dict[tuple[str, str], list[dict]] = {}
    by_uname: dict[str, dict] = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for p in csv.DictReader(f):
            if p.get("deleted") == "1":
                continue
            for k in part_name_keys(p):
                by_name.setdefault(k, []).append(p)
            un = (p.get("username") or "").strip().lstrip("@").lower()
            if un:
                by_uname[un] = p
    return by_name, by_uname


def main() -> int:
    ap = argparse.ArgumentParser(description="Обогатить people из участников Telegram-чатов")
    ap.add_argument("--apply", action="store_true", help="выполнить UPDATE (иначе dry-run)")
    ap.add_argument("--in", dest="in_path", default=str(PART_CSV), help="CSV участников (по умолчанию data/tg_participants.csv)")
    args = ap.parse_args()

    part_csv = Path(args.in_path)
    if not part_csv.exists():
        print(f"Нет файла {part_csv}. Сначала запустите scripts/tg_participants.py", file=sys.stderr)
        return 2

    by_name, by_uname = load_participants(part_csv)
    people = json.load(open(PEOPLE_JSON, encoding="utf-8"))

    user_pairs: list[tuple[int, str]] = []
    id_pairs: list[tuple[int, int]] = []
    report: list[dict] = []
    stat = {"username": 0, "fio": 0, "ambig": 0, "none": 0}

    for person in people:
        pid = int(person["id"])
        fio = (person.get("ФИО") or "").strip()
        cur_tg = (person.get("telegram") or "").strip().lstrip("@").lower()
        t = norm(fio)
        sur = t[0] if t else ""
        first = t[1] if len(t) > 1 else ""

        pick = None
        how = ""
        if cur_tg and cur_tg in by_uname:
            pick = by_uname[cur_tg]
            how = "username"
        else:
            cands = by_name.get((sur, first), []) if (sur and first) else []
            if len(cands) == 1:
                pick = cands[0]
                how = "fio"
            elif len(cands) > 1:
                stat["ambig"] += 1
                report.append({"person_id": pid, "ФИО": fio, "how": "ambig", "matched": "", "username": "", "user_id": ""})
                continue
        if not pick:
            stat["none"] += 1
            continue

        un = (pick.get("username") or "").strip()
        uid = (pick.get("user_id") or "").strip()
        if how == "username":
            stat["username"] += 1
        else:
            stat["fio"] += 1
        if un and not cur_tg:
            user_pairs.append((pid, un if un.startswith("@") else "@" + un))
        if uid.isdigit():
            id_pairs.append((pid, int(uid)))
        report.append(
            {
                "person_id": pid,
                "ФИО": fio,
                "how": how,
                "matched": ((pick.get("first_name") or "") + " " + (pick.get("last_name") or "")).strip(),
                "username": un,
                "user_id": uid,
            }
        )

    with open(REPORT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["person_id", "ФИО", "how", "matched", "username", "user_id"])
        w.writeheader()
        w.writerows(report)

    print("Людей:", len(people))
    print("Сопоставлено по username:", stat["username"], "| по ФИО:", stat["fio"])
    print("Неоднозначных ФИО:", stat["ambig"], "| не найдено:", stat["none"])
    print("К записи: username=", len(user_pairs), "telegram_id=", len(id_pairs))
    print("Отчёт:", REPORT)

    env = load_env()
    token = secrets.token_hex(16)
    mode = "APPLY" if args.apply else "DRY"
    php = _php_preamble(token) + build_php(user_pairs, id_pairs, mode)
    run_remote_php(env, php, token)
    return 0


def build_php(user_pairs: list[tuple[int, str]], id_pairs: list[tuple[int, int]], mode: str) -> str:
    u_rows = ",\n".join("  array(%d, %s)" % (pid, esc(tg)) for pid, tg in user_pairs)
    i_rows = ",\n".join("  array(%d, %d)" % (pid, tid) for pid, tid in id_pairs)
    return f"""
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
if (!col_exists('people', 'telegram_id') && $mode === 'APPLY') {{
    if (q("ALTER TABLE people ADD COLUMN telegram_id INT NULL")) echo "ALTER people ADD telegram_id\\n";
}}

$u_changed=0; $u_empty=0;
foreach ($users as $r) {{
    $id=(int)$r[0]; $tg=$r[1];
    $q=q("SELECT telegram FROM people WHERE id=" . s($id));
    if (!$q || mysql_num_rows($q)==0) {{ echo "MISSING $id\\n"; continue; }}
    $cur=mysql_result($q,0,'telegram');
    if ($cur===null || trim($cur)==='') {{
        $u_empty++;
        if ($mode==='APPLY' && q("UPDATE people SET telegram=" . s($tg) . " WHERE id=" . s($id) . " AND (telegram IS NULL OR telegram='')")) $u_changed+=mysql_affected_rows($link);
    }}
}}
echo "username: empty=$u_empty changed=$u_changed\\n";

$i_changed=0; $i_empty=0;
if (col_exists('people','telegram_id')) {{
    foreach ($ids as $r) {{
        $id=(int)$r[0]; $tid=(int)$r[1];
        $q=q("SELECT telegram_id FROM people WHERE id=" . s($id));
        if (!$q || mysql_num_rows($q)==0) {{ echo "ID_MISSING $id\\n"; continue; }}
        $cur=mysql_result($q,0,'telegram_id');
        if ($cur===null || (int)$cur === 0) {{
            $i_empty++;
            if ($mode==='APPLY' && q("UPDATE people SET telegram_id=" . s($tid) . " WHERE id=" . s($id) . " AND (telegram_id IS NULL OR telegram_id=0)")) $i_changed+=mysql_affected_rows($link);
        }}
    }}
}}
echo "telegram_id: empty=$i_empty changed=$i_changed\\n";
"""


if __name__ == "__main__":
    raise SystemExit(main())
