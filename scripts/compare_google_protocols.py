# -*- coding: utf-8 -*-
"""Сверка дампа с листом Google «протоколы игр» (и gid сетки).

Не меняет дамп и формулу. Только отчёт в stdout.
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DUMP = REPO / "docs" / "планы" / "05_данные"
SID = "1-qUmFGvuG2SOvueNUWr55zTZyFEXFFqiWTz8m-OVHZg"
GID_GRID = "1172864695"
SHEET = "протоколы игр"

sys.path.insert(0, str(REPO / "scripts"))
from export_domain_dump import (  # noqa: E402
    People,
    apply_draw,
    apply_lider_youtube,
    canon_fio,
    cell,
    classify_event,
    collapse_ws,
    fetch_csv,
    find_row_label,
    is_random_slot,
    parse_facts,
    parse_grid,
    parse_situation_cell,
    sit_105_classic,
)


def nk(n: str) -> str:
    return re.sub(r"\s+", " ", (n or "").lower().replace("ё", "е")).strip()


def fetch_gviz_matrix(sid: str, sheet: str) -> list[list[str]]:
    q = urllib.parse.quote(sheet)
    url = f"https://docs.google.com/spreadsheets/d/{sid}/gviz/tq?tqx=out:csv&sheet={q}"
    req = urllib.request.Request(url, headers={"User-Agent": "ub-timer-compare-protocols/1"})
    with urllib.request.urlopen(req, timeout=180) as r:
        text = r.read().decode("utf-8", errors="replace")
    return list(csv.reader(io.StringIO(text)))


def fetch_gviz_json_meta(sid: str, sheet: str) -> dict:
    q = urllib.parse.quote(sheet)
    url = f"https://docs.google.com/spreadsheets/d/{sid}/gviz/tq?tqx=out:json&sheet={q}&range=A1:D40"
    req = urllib.request.Request(url, headers={"User-Agent": "ub-timer-compare-protocols/1"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read().decode("utf-8", errors="replace")
    m = re.search(r"setResponse\((\{.*\})\)\s*;?\s*$", raw, re.DOTALL)
    if not m:
        return {}
    data = json.loads(m.group(1))
    return {
        "status": (data.get("status") or ""),
        "cols": len(data.get("table", {}).get("cols") or []),
        "rows": len(data.get("table", {}).get("rows") or []),
    }


def matrix_fingerprint(matrix: list[list[str]], max_row: int = 34) -> tuple[int, int, str]:
    rows = matrix[: max_row + 1]
    width = max((len(r) for r in rows), default=0)
    sample = []
    for r in range(min(len(rows), 12)):
        for c in range(min(width, 12)):
            sample.append(cell(rows, r, c)[:40])
    return len(matrix), width, "|".join(sample)


def load_dump() -> dict:
    people = {p["id"]: p["ФИО"] for p in json.loads((DUMP / "люди.json").read_text(encoding="utf-8"))}
    events = {e["id"]: e for e in json.loads((DUMP / "мероприятия.json").read_text(encoding="utf-8"))}
    duels = json.loads((DUMP / "поединки.json").read_text(encoding="utf-8"))
    judges = json.loads((DUMP / "судьи.json").read_text(encoding="utf-8"))
    sits = {s["id"]: s for s in json.loads((DUMP / "ситуации.json").read_text(encoding="utf-8"))}
    by_duel: dict[int, list] = defaultdict(list)
    for j in judges:
        by_duel[j["поединокId"]].append(j)
    return {
        "people": people,
        "events": events,
        "duels": duels,
        "judges": by_duel,
        "sits": sits,
    }


def fio(people: dict, pid) -> str:
    if not pid:
        return ""
    return people.get(pid) or ""


def votes_of(js: list) -> tuple[int, int]:
    v1 = sum(1 for j in js if str(j.get("голос") or "") == "1")
    v2 = sum(1 for j in js if str(j.get("голос") or "") == "2")
    return v1, v2


def google_votes(col: dict) -> tuple[int, int]:
    v1 = sum(1 for j in col["judges"] if str(j.get("голос") or "") == "1")
    v2 = sum(1 for j in col["judges"] if str(j.get("голос") or "") == "2")
    return v1, v2


def google_judge_names(col: dict) -> list[str]:
    out = []
    for j in col["judges"]:
        name = canon_fio(j.get("fio") or "")
        vote = str(j.get("голос") or "")
        if not name and vote not in ("1", "2"):
            continue
        out.append(nk(name) if name else f"?vote={vote}")
    return out


def dump_judge_names(js: list, people: dict) -> list[str]:
    out = []
    for j in js:
        pid = j.get("idУчастника")
        name = fio(people, pid)
        vote = str(j.get("голос") or "")
        if not name and vote in ("1", "2"):
            out.append(f"?vote={vote}")
        elif name:
            out.append(nk(name))
    return out


def google_type_hint(col: dict, sit_by_num: dict) -> str:
    num, sname = col["situationNum"], col["situationName"]
    if is_random_slot(num, sname):
        if re.match(r"^00Э$", num or "", re.I):
            return "экспресс"
        return "классика"
    bank = sit_by_num.get(num) or sit_by_num.get((num or "").upper())
    if bank:
        return bank.get("тип") or "классика"
    return "классика"


def sit_index(sits: dict) -> dict:
    by_num = {}
    for s in sits.values():
        num = str(s.get("номер") or "")
        code = str(s.get("код") or "")
        if num:
            by_num[num] = s
            by_num[num.upper()] = s
        if code:
            by_num[code] = s
            m = re.match(r"^(\d+Э?)", code, re.I)
            if m:
                by_num[m.group(1)] = s
    return by_num


def classify_known(kind: str, ev: dict, d: dict, extra: str = "") -> str:
    slug = ev.get("ярлык") or ""
    order = d.get("порядок")
    sit = extra
    if ev.get("тип") == "турнир":
        if kind in ("type", "roster_fill", "roster_replace", "roster_clear"):
            return "known:lider-youtube"
        if d.get("id") == 46 and kind == "facts_outcome":
            return "known:lider2-id46-facts-flip"
    if slug.startswith("kupala") and ev.get("датаНачала") == "2026-06-27" and order == 1:
        if kind in ("situation", "type"):
            return "known:kupala26-105-not-105a"
    if d.get("id") == 4 and kind in ("score", "anon_votes"):
        return "known:nye21-id4-facts-votes"
    if kind == "paired_role":
        return "known:paired-second-as-player"
    if kind == "express_college":
        return "known:express-college-sending"
    if kind == "express_seconds":
        return "known:express-no-seconds"
    if kind == "wall_only":
        return "known:wall-calendar"
    if kind == "facts_outcome" and extra:
        return extra
    return "new"


def main() -> int:
    print("=== 1. Листы Google ===")
    csv_grid = fetch_csv(SID, GID_GRID)
    print(f"CSV gid={GID_GRID}: {len(csv_grid)} строк, ширина {max((len(r) for r in csv_grid), default=0)}")
    try:
        gviz = fetch_gviz_matrix(SID, SHEET)
        print(f"gviz sheet={SHEET!r}: {len(gviz)} строк, ширина {max((len(r) for r in gviz), default=0)}")
    except Exception as e:
        gviz = []
        print(f"gviz sheet={SHEET!r}: ОШИБКА {e}")

    fp_csv = matrix_fingerprint(csv_grid)
    fp_gviz = matrix_fingerprint(gviz) if gviz else (0, 0, "")
    print(f"Отпечаток CSV: rows={fp_csv[0]} width={fp_csv[1]}")
    print(f"Отпечаток gviz: rows={fp_gviz[0]} width={fp_gviz[1]}")

    # xlsx: имена листов и gid
    same_sheet = False
    try:
        import zipfile
        import xml.etree.ElementTree as ET
        from io import BytesIO

        url = f"https://docs.google.com/spreadsheets/d/{SID}/export?format=xlsx"
        req = urllib.request.Request(url, headers={"User-Agent": "ub-timer-compare-protocols/1"})
        with urllib.request.urlopen(req, timeout=180) as r:
            xdata = r.read()
        z = zipfile.ZipFile(BytesIO(xdata))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        rns = {"r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid_to_target = {rel.get("Id"): rel.get("Target") for rel in rels}
        print("Листы книги (xlsx):")
        for sh in wb.findall("m:sheets/m:sheet", ns):
            name = sh.get("name")
            gid = sh.get("{http://schemas.google.com/spreadsheets/2006}id") or sh.get("sheetId")
            print(f"  {name!r} sheetId={sh.get('sheetId')} gid?={gid}")
            if name == SHEET:
                same_sheet = str(sh.get("sheetId")) == GID_GRID or str(gid) == GID_GRID
    except Exception as e:
        print(f"xlsx workbook: {e}")

    if gviz:
        people_tmp = People()
        meetings_gviz = parse_grid(gviz, people_tmp, {})
        people_tmp2 = People()
        meetings_csv = parse_grid(csv_grid, people_tmp2, {})
        names_g = [m["name"] for m in meetings_gviz]
        names_c = [m["name"] for m in meetings_csv]
        cols_g = sum(len(m["columns"]) for m in meetings_gviz)
        cols_c = sum(len(m["columns"]) for m in meetings_csv)
        print(f"parse_grid gviz: {len(meetings_gviz)} встреч, {cols_g} кол.")
        print(f"parse_grid csv:  {len(meetings_csv)} встреч, {cols_c} кол.")
        print(f"Имена встреч совпали: {names_g == names_c}")
        if names_g != names_c:
            only_g = [n for n in names_g if n not in names_c]
            only_c = [n for n in names_c if n not in names_g]
            print(f"  только gviz: {only_g}")
            print(f"  только csv: {only_c}")
        # ячейки состава первой колонки каждой встречи
        roster_same = 0
        roster_diff = 0
        for mg, mc in zip(meetings_gviz, meetings_csv):
            for cg, cc in zip(mg["columns"], mc["columns"]):
                keyg = (cg["team1p"], cg["team1s"], cg["team2p"], cg["team2s"], cg["situationNum"])
                keyc = (cc["team1p"], cc["team1s"], cc["team2p"], cc["team2s"], cc["situationNum"])
                if keyg == keyc:
                    roster_same += 1
                else:
                    roster_diff += 1
                    if roster_diff <= 5:
                        print(f"  состав gviz≠csv {mg['name']} #{len(mg['columns'])}: {keyg} vs {keyc}")
        print(f"Колонки состав+ситуация gviz=csv: {roster_same}, разошлись: {roster_diff}")
        same_sheet = same_sheet or (names_g == names_c and roster_diff == 0 and cols_g == cols_c)
    print(f"Один лист? {'ДА' if same_sheet else 'НЕТ / не уверен'}")

    # подписи строк
    print("\n=== 2. Структура сетки (колонка D / индекс 3) ===")
    for r in range(min(40, len(csv_grid))):
        lab = cell(csv_grid, r, 3) or cell(csv_grid, r, 1) or cell(csv_grid, r, 0)
        if lab:
            print(f"  r{r+1:02d}: {lab}")

    dump = load_dump()
    people = dump["people"]
    events = dump["events"]
    sits = dump["sits"]
    sit_by_num = sit_index(sits)
    people_obj = People()
    for p in people.values():
        people_obj.add(p)
    people_obj.freeze()

    report: dict = {"warnings": [], "noStarted": []}
    meetings = parse_grid(csv_grid, people_obj, report)
    facts = parse_facts(csv_grid)
    win_r = find_row_label(csv_grid, 3, "Победитель")
    sc1_r = find_row_label(csv_grid, 3, "Счет Команды 1")
    sc2_r = find_row_label(csv_grid, 3, "Счет Команды 2")
    print(f"Строки формул: Победитель={win_r} Счет1={sc1_r} Счет2={sc2_r}")
    print(f"\nВстреч в сетке: {len(meetings)}")
    print(f"Фактов A:F: {len(facts)}")
    print(f"Поединков в дампе: {len(dump['duels'])}")
    print(f"Мероприятий в дампе: {len(events)}")

    # индекс дампа: (нормализованное имя встречи, порядок) → duel
    by_key: dict[tuple[str, int], dict] = {}
    by_event_order: dict[tuple[int, int], dict] = {}
    for d in dump["duels"]:
        ev = events[d["мероприятиеId"]]
        by_key[(nk(ev["название"]), d["порядок"])] = d
        by_event_order[(ev["id"], d["порядок"])] = d

    wall_slugs = set()
    wall_path = DUMP / "стена_календарь.json"
    if wall_path.is_file():
        wall = json.loads(wall_path.read_text(encoding="utf-8"))
        for rec in wall.get("добавить") or []:
            if rec.get("ярлык"):
                wall_slugs.add(rec["ярлык"])

    google_keys: set[tuple[str, int]] = set()
    diffs: list[dict] = []
    known_n = 0
    new_n = 0
    match_n = 0
    google_cols = 0

    for meeting in meetings:
        name = meeting["name"]
        ev_type, slug, num = classify_event(name)
        for order, col in enumerate(meeting["columns"], 1):
            google_cols += 1
            google_keys.add((nk(name), order))
            d = by_key.get((nk(name), order))
            if not d:
                diffs.append(
                    {
                        "cls": "google_only",
                        "known": False,
                        "tag": "new",
                        "where": f"{name} #{order}",
                        "what": "колонка есть в Google, нет поединка в дампе",
                    }
                )
                new_n += 1
                continue

            ev = events[d["мероприятиеId"]]
            js = dump["judges"].get(d["id"], [])
            issues = []

            # состав после жребия (как в экспорте)
            p1, s1, p2, s2 = apply_draw(col, report, name, order)
            g_type = google_type_hint(col, sit_by_num)
            if ev_type == "турнир":
                yt_type = "парный" if order == 1 else "классика" if order <= 3 else "экспресс"
                yp1, ys1, yp2, ys2 = apply_lider_youtube(num, order, p1, s1, p2, s2)
                if (yp1, ys1, yp2, ys2) != (p1, s1, p2, s2):
                    if (num, order) in {(2, 3)}:
                        issues.append(("roster_replace", "known:lider-youtube", f"YouTube p2={yp2!r} vs сетка {p2!r}"))
                    elif ys1 != s1 or ys2 != s2:
                        if (ys1 and not s1) or (ys2 and not s2):
                            issues.append(("roster_fill", "known:lider-youtube", f"дописан 2-й игрок гостей {ys1 or ys2}"))
                        else:
                            issues.append(("roster_clear", "known:lider-youtube", "снят лишний 2-й слот пор.3"))
                p1, s1, p2, s2 = yp1, ys1, yp2, ys2
                if d["тип"] != g_type and d["тип"] == yt_type:
                    issues.append(("type", "known:lider-youtube", f"тип дамп={d['тип']} сетка/банк={g_type}"))
            else:
                if ev.get("датаНачала") == "2026-06-27" and order == 1:
                    sit105 = sit_105_classic(list(sits.values()))
                    g_num = col.get("situationNum") or ""
                    if sit105 and d.get("ситуацияId") == sit105["id"] and "105a" in (g_num or "").lower() or (
                        g_num == "105a" or (col.get("situationName") or "").lower().startswith("105a")
                    ):
                        issues.append(("situation", "known:kupala26-105-not-105a", f"дамп 105, сетка {col.get('situationNum')} {col.get('situationName')}"))
                    elif sit105 and d.get("ситуацияId") == sit105["id"]:
                        # сетка могла быть 105a в ячейке
                        raw_sit = collapse_ws(
                            # parse_grid already split; check raw-ish
                            f"{col.get('situationNum') or ''} {col.get('situationName') or ''}"
                        )
                        if "105a" in raw_sit.lower() or (col.get("situationNum") or "").lower() == "105a":
                            issues.append(("situation", "known:kupala26-105-not-105a", f"дамп 105, сетка {raw_sit}"))

            if g_type == "экспресс" or d["тип"] == "экспресс":
                g_s1 = cell_second_raw(col, 1)
                g_s2 = cell_second_raw(col, 2)
                if (g_s1 or g_s2) and not (d.get("секундантИлиВторойИгрок1Id") or d.get("секундантИлиВторойИгрок2Id")):
                    issues.append(("express_seconds", "known:express-no-seconds", "экспресс: секунды сетки обнулены в дампе"))

            # сравнение ФИО слотов (после тех же правок, что экспорт)
            ours = (
                nk(fio(people, d.get("игрок1Id"))),
                nk(fio(people, d.get("секундантИлиВторойИгрок1Id"))),
                nk(fio(people, d.get("игрок2Id"))),
                nk(fio(people, d.get("секундантИлиВторойИгрок2Id"))),
            )
            goog = (nk(canon_fio(p1)), nk(canon_fio(s1)), nk(canon_fio(p2)), nk(canon_fio(s2)))
            if ours != goog:
                issues.append(
                    (
                        "roster",
                        "new",
                        f"состав дамп={ours} vs сетка+правки={goog}",
                    )
                )

            if ev_type != "турнир" and d["тип"] != g_type:
                if ev.get("датаНачала") == "2026-06-27" and order == 1 and d["тип"] == "классика":
                    issues.append(("type", "known:kupala26-105-not-105a", f"тип дамп={d['тип']} банк/сетка={g_type}"))
                else:
                    issues.append(("type", "new", f"тип дамп={d['тип']} банк/сетка={g_type}"))

            gv1, gv2 = google_votes(col)
            ov1, ov2 = votes_of(js)
            if (gv1, gv2) != (ov1, ov2):
                if d["id"] == 4 and (ov1, ov2) == (3, 6) and (gv1, gv2) == (0, 0):
                    issues.append(("score", "known:nye21-id4-facts-votes", f"счёт дамп {ov1}:{ov2} сетка {gv1}:{gv2}"))
                else:
                    issues.append(("score", "new", f"счёт дамп {ov1}:{ov2} сетка {gv1}:{gv2}"))

            gnames = google_judge_names(col)
            onames = dump_judge_names(js, people)
            # анонимные голоса id=4
            g_named = [x for x in gnames if not x.startswith("?")]
            o_named = [x for x in onames if not x.startswith("?")]
            if sorted(g_named) != sorted(o_named):
                only_g = sorted(set(g_named) - set(o_named))
                only_o = sorted(set(o_named) - set(g_named))
                issues.append(("judges", "new", f"судьи Δ google-only={only_g} dump-only={only_o}"))

            # коллегия экспресса
            if d["тип"] == "экспресс":
                bad = [j for j in js if j.get("idУчастника") and j.get("коллегия") != "отправляющиеНаПереговоры"]
                if bad:
                    issues.append(("express_college", "known:express-college-sending", f"{len(bad)} судей не sending"))

            if not issues:
                match_n += 1
            else:
                for kind, tag, msg in issues:
                    is_known = tag.startswith("known:")
                    diffs.append(
                        {
                            "cls": "mismatch",
                            "known": is_known,
                            "tag": tag,
                            "where": f"{name} #{order} id={d['id']}",
                            "what": msg,
                            "kind": kind,
                        }
                    )
                    if is_known:
                        known_n += 1
                    else:
                        new_n += 1

    # только у нас
    dump_only = []
    for d in dump["duels"]:
        ev = events[d["мероприятиеId"]]
        key = (nk(ev["название"]), d["порядок"])
        if key not in google_keys:
            slug = ev.get("ярлык") or ""
            if slug in wall_slugs:
                dump_only.append((d, ev, "known:wall-calendar"))
            else:
                dump_only.append((d, ev, "new"))

    # мероприятия без колонок
    google_meetings = {nk(m["name"]) for m in meetings}
    dump_only_events = []
    for ev in events.values():
        if nk(ev["название"]) not in google_meetings:
            slug = ev.get("ярлык") or ""
            tag = "known:wall-calendar" if slug in wall_slugs else "new"
            dump_only_events.append((ev, tag))

    print("\n=== 3. Сводка колонок ===")
    print(f"Колонок Google (непустых): {google_cols}")
    print(f"Полностью совпали (состав/тип/счёт/судьи с учётом известных правок экспорта): {match_n}")
    print(f"Расхождений-меток known: {known_n}")
    print(f"Расхождений-меток new: {new_n}")
    print(f"Поединков только в дампе: {len(dump_only)}")
    print(f"Мероприятий только в дампе: {len(dump_only_events)}")

    print("\n=== 4. Только в дампе (мероприятия) ===")
    for ev, tag in dump_only_events:
        print(f"  [{tag}] {ev['id']} {ev.get('ярлык')} {ev['название']}")

    print("\n=== 5. Только в дампе (поединки) ===")
    if not dump_only:
        print("  нет")
    for d, ev, tag in dump_only:
        print(f"  [{tag}] id={d['id']} {ev['название']} #{d['порядок']}")

    print("\n=== 6. Новые дыры (колонки) ===")
    news = [x for x in diffs if not x["known"]]
    if not news:
        print("  нет")
    else:
        for x in news:
            print(f"  [{x['tag']}] {x['where']}: {x['what']}")

    print("\n=== 7. Известные (счётчик по тегу) ===")
    by_tag = defaultdict(int)
    for x in diffs:
        if x["known"]:
            by_tag[x["tag"]] += 1
    for ev, tag in dump_only_events:
        if tag.startswith("known"):
            by_tag[tag] += 1
    for tag, n in sorted(by_tag.items()):
        print(f"  {n:3d}  {tag}")
    print("  --- детали known ---")
    for x in diffs:
        if x["known"]:
            print(f"  [{x['tag']}] {x['where']}: {x['what']}")

    print("\n=== 7b. Формулы сетки «Счет Команды» vs голоса дампа ===")
    formula_ok = 0
    formula_diff = []
    for meeting in meetings:
        name = meeting["name"]
        for order, col in enumerate(meeting["columns"], 1):
            d = by_key.get((nk(name), order))
            if not d:
                continue
            js = dump["judges"].get(d["id"], [])
            ov1, ov2 = votes_of(js)
            raw1 = cell(csv_grid, sc1_r, col["col"]) if sc1_r >= 0 else ""
            raw2 = cell(csv_grid, sc2_r, col["col"]) if sc2_r >= 0 else ""
            winner = cell(csv_grid, win_r, col["col"]) if win_r >= 0 else ""
            try:
                t1 = int(float(str(raw1 or "0").replace(",", "."))) if raw1 else 0
                t2 = int(float(str(raw2 or "0").replace(",", "."))) if raw2 else 0
            except ValueError:
                t1, t2 = raw1, raw2
            started = collapse_ws(col.get("started") or "").lower()
            if "команда 2" in started:
                mapped = (t2, t1)
            else:
                mapped = (t1, t2)
            if mapped == (ov1, ov2):
                formula_ok += 1
            else:
                formula_diff.append(
                    f"{name} #{order} id={d['id']} дамп {ov1}:{ov2} "
                    f"формула К1:К2={t1}:{t2} после Начинал={mapped} победитель={winner!r}"
                )
    print(f"Формула счёта = голоса дампа (с учётом «Начинал»): {formula_ok}")
    print(f"Разошлись: {len(formula_diff)}")
    for line in formula_diff:
        print(f"  {line}")

    # факты A:F vs исходы дампа
    print("\n=== 8. Факты A:F vs исходы дампа ===")
    facts_outcome = defaultdict(lambda: {"win": [], "lose": [], "votes": {}})
    for f in facts:
        evn = collapse_ws(f.get("мероприятие") or "")
        num = collapse_ws(f.get("номер") or "")
        person = canon_fio(f.get("человек") or "")
        event = collapse_ws(f.get("событие") or "").lower()
        if not evn or not num:
            continue
        key = (nk(evn), num)
        if event == "игрок выиграл":
            facts_outcome[key]["win"].append(nk(person))
        elif event == "игрок проиграл":
            facts_outcome[key]["lose"].append(nk(person))
        elif event == "набрал голосов":
            try:
                pts = int(float(str(f.get("очки") or "0").replace(",", ".")))
            except ValueError:
                pts = 0
            facts_outcome[key]["votes"][nk(person)] = pts

    # номер факта = id поединка (глобальный), см. fill_unknown_votes_from_facts
    fact_flip = []
    fact_match = 0
    fact_skip = 0
    fact_new = []
    for d in dump["duels"]:
        ev = events[d["мероприятиеId"]]
        key = (nk(ev["название"]), str(d["id"]))
        rec = facts_outcome.get(key)
        if not rec:
            fact_skip += 1
            continue
        js = dump["judges"].get(d["id"], [])
        v1, v2 = votes_of(js)
        p1n = nk(fio(people, d.get("игрок1Id")))
        p2n = nk(fio(people, d.get("игрок2Id")))
        s1n = nk(fio(people, d.get("секундантИлиВторойИгрок1Id")))
        s2n = nk(fio(people, d.get("секундантИлиВторойИгрок2Id")))
        paired = d.get("тип") == "парный"
        if v1 > v2:
            dump_winners = {p1n} | ({s1n} if paired and s1n else set())
            dump_losers = {p2n} | ({s2n} if paired and s2n else set())
        elif v2 > v1:
            dump_winners = {p2n} | ({s2n} if paired and s2n else set())
            dump_losers = {p1n} | ({s1n} if paired and s1n else set())
        else:
            dump_winners, dump_losers = set(), set()
        fw = set(rec["win"]) - {""}
        fl = set(rec["lose"]) - {""}
        # Google часто пишет 2-й слот парного как секунданта — победа/поражение игрока без 2-го
        known_paired = False
        if paired and fw and fl:
            core_w = {p1n, p2n} & fw
            core_l = {p1n, p2n} & fl
            extra_w = fw - {p1n, p2n, s1n, s2n}
            extra_l = fl - {p1n, p2n, s1n, s2n}
            if core_w and core_l and not extra_w and not extra_l:
                # секундант в фактах vs игрок у нас
                if (fw | fl) != (dump_winners | dump_losers) and (fw <= (dump_winners | dump_losers | {s1n, s2n})):
                    known_paired = True
        if d["id"] == 46:
            tag = "known:lider2-id46-facts-flip"
            fact_flip.append((d, ev, fw, fl, dump_winners, dump_losers, v1, v2, tag))
            continue
        if not fw and not fl:
            fact_skip += 1
            continue
        if fw == dump_winners and fl == dump_losers:
            fact_match += 1
        elif known_paired or (fw <= dump_winners and fl <= dump_losers):
            fact_match += 1  # факты без 2-го слота парного — известное
        else:
            fact_new.append((d, ev, fw, fl, dump_winners, dump_losers, v1, v2))

    print(f"Факты с исходом, совпали с дампом (или подмножество парного): {fact_match}")
    print(f"Поединков без фактов исхода / ничья: {fact_skip}")
    print(f"Известный переворот id=46: {len(fact_flip)}")
    print(f"Новые расхождения фактов vs дамп: {len(fact_new)}")
    for item in fact_flip:
        d, ev, fw, fl, dw, dl, v1, v2 = item[:8]
        print(f"  [known:lider2-id46] {ev['название']} id={d['id']} сетка/дамп {v1}:{v2} winners={dw} losers={dl} facts W={fw} L={fl}")
    if fact_new:
        print("  --- новые факты ---")
        for d, ev, fw, fl, dw, dl, v1, v2 in fact_new[:40]:
            print(
                f"  [new] {ev['название']} id={d['id']} #{d['порядок']} {d['тип']} "
                f"дамп {v1}:{v2} W={dw} L={dl} | факты W={fw} L={fl}"
            )
        if len(fact_new) > 40:
            print(f"  ... ещё {len(fact_new) - 40}")

    # голоса фактов vs дамп
    vote_mismatch = []
    vote_ok = 0
    for d in dump["duels"]:
        ev = events[d["мероприятиеId"]]
        key = (nk(ev["название"]), str(d["id"]))
        rec = facts_outcome.get(key)
        if not rec or not rec["votes"]:
            continue
        js = dump["judges"].get(d["id"], [])
        v1, v2 = votes_of(js)
        p1n = nk(fio(people, d.get("игрок1Id")))
        p2n = nk(fio(people, d.get("игрок2Id")))
        fv1 = rec["votes"].get(p1n, 0)
        fv2 = rec["votes"].get(p2n, 0)
        if (fv1, fv2) == (v1, v2) or (fv1 + fv2 == 0):
            vote_ok += 1
        elif d["id"] == 4 and (v1, v2) == (3, 6):
            vote_ok += 1
        elif d["id"] == 46:
            vote_mismatch.append((d, ev, v1, v2, fv1, fv2, "known:lider2-id46-facts-flip"))
        else:
            vote_mismatch.append((d, ev, v1, v2, fv1, fv2, "new"))
    print(f"\nГолоса фактов vs дамп: ок={vote_ok}, расхождений={len(vote_mismatch)}")
    for d, ev, v1, v2, fv1, fv2, tag in vote_mismatch[:30]:
        print(f"  [{tag}] {ev['название']} id={d['id']} дамп {v1}:{v2} факты {fv1}:{fv2}")

    # JSON для отчёта
    out = {
        "same_sheet": same_sheet,
        "google_cols": google_cols,
        "match_n": match_n,
        "known_n": known_n,
        "new_n": new_n,
        "dump_only_duels": len(dump_only),
        "dump_only_events": [
            {"id": ev["id"], "ярлык": ev.get("ярлык"), "название": ev["название"], "tag": tag}
            for ev, tag in dump_only_events
        ],
        "new_diffs": news,
        "known_tags": dict(by_tag),
        "fact_match": fact_match,
        "fact_new": [
            {
                "id": d["id"],
                "встреча": ev["название"],
                "порядок": d["порядок"],
                "тип": d["тип"],
                "дамп": f"{v1}:{v2}",
                "dump_w": sorted(dw),
                "dump_l": sorted(dl),
                "fact_w": sorted(fw),
                "fact_l": sorted(fl),
            }
            for d, ev, fw, fl, dw, dl, v1, v2 in fact_new
        ],
        "vote_mismatch": [
            {
                "id": d["id"],
                "встреча": ev["название"],
                "дамп": f"{v1}:{v2}",
                "факты": f"{fv1}:{fv2}",
                "tag": tag,
            }
            for d, ev, v1, v2, fv1, fv2, tag in vote_mismatch
        ],
        "fp_csv": {"rows": fp_csv[0], "width": fp_csv[1]},
        "fp_gviz": {"rows": fp_gviz[0], "width": fp_gviz[1]},
    }
    out_path = DUMP / "_tmp_protocol_compare.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {out_path}")
    return 0


def cell_second_raw(col: dict, side: int) -> str:
    if side == 1:
        return collapse_ws(col.get("team1s") or "")
    return collapse_ws(col.get("team2s") or "")


if __name__ == "__main__":
    raise SystemExit(main())
