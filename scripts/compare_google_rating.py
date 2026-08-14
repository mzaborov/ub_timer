# -*- coding: utf-8 -*-
"""Сверка рейтинга JSON-слепка с листом Google «Рейтинг»."""
from __future__ import annotations

import json
import re
import urllib.request
import zipfile
from collections import defaultdict
from io import BytesIO
from pathlib import Path
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[1]
DUMP = REPO / "docs" / "планы" / "05_данные"
SID = "1-qUmFGvuG2SOvueNUWr55zTZyFEXFFqiWTz8m-OVHZg"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
W = dict(tourn=10, win=5, lose=3, swin=4, slose=2, judge=1, votes=0.3)


def nk(n: str) -> str:
    return re.sub(r"\s+", " ", (n or "").lower().replace("ё", "е")).strip()


def guests_not_in_stream() -> set[int]:
    circles = {c["id"]: c["название"] for c in json.loads((DUMP / "круги.json").read_text(encoding="utf-8"))}
    mem = json.loads((DUMP / "членстваВКруге.json").read_text(encoding="utf-8"))
    stream: set[int] = set()
    fub: set[int] = set()
    for m in mem:
        title = circles.get(m["кругId"]) or ""
        pid = m["idУчастника"]
        if title == "Стрим поединки я-ИТ-ы":
            stream.add(pid)
        if title == "ФУБ":
            fub.add(pid)
    skip = fub - stream
    events = {e["id"]: e for e in json.loads((DUMP / "мероприятия.json").read_text(encoding="utf-8"))}
    duels = json.loads((DUMP / "поединки.json").read_text(encoding="utf-8"))
    for d in duels:
        if events[d["мероприятиеId"]]["тип"] != "турнир":
            continue
        for key in (
            "игрок1Id",
            "игрок2Id",
            "секундантИлиВторойИгрок1Id",
            "секундантИлиВторойИгрок2Id",
        ):
            pid = d.get(key)
            if pid and pid not in stream:
                skip.add(pid)
    return skip


def yaity_team() -> set[int]:
    circles = {c["id"]: c["название"] for c in json.loads((DUMP / "круги.json").read_text(encoding="utf-8"))}
    mem = json.loads((DUMP / "членстваВКруге.json").read_text(encoding="utf-8"))
    team: set[int] = set()
    for m in mem:
        if (circles.get(m["кругId"]) or "") != "Стрим поединки я-ИТ-ы":
            continue
        if m.get("степеньВовлечения") == "участник Турнира":
            team.add(m["idУчастника"])
    return team


def load_ours() -> dict[str, dict]:
    people = {p["id"]: p["ФИО"] for p in json.loads((DUMP / "люди.json").read_text(encoding="utf-8"))}
    events = {e["id"]: e for e in json.loads((DUMP / "мероприятия.json").read_text(encoding="utf-8"))}
    duels = json.loads((DUMP / "поединки.json").read_text(encoding="utf-8"))
    judges = json.loads((DUMP / "судьи.json").read_text(encoding="utf-8"))
    by_duel: dict[int, list] = defaultdict(list)
    for j in judges:
        by_duel[j["поединокId"]].append(j)
    st: dict[int, dict] = defaultdict(
        lambda: dict(tourn=0, win=0, lose=0, swin=0, slose=0, judge=0, votes=0)
    )
    seen_tourn: set[tuple[str, int, int]] = set()
    player_at: dict[int, set[int]] = defaultdict(set)
    second_at: dict[int, set[int]] = defaultdict(set)
    team = yaity_team()
    for d in duels:
        js = by_duel.get(d["id"], [])
        v1 = sum(1 for j in js if str(j.get("голос") or "") == "1")
        v2 = sum(1 for j in js if str(j.get("голос") or "") == "2")
        p1, p2 = d.get("игрок1Id"), d.get("игрок2Id")
        s1, s2 = d.get("секундантИлиВторойИгрок1Id"), d.get("секундантИлиВторойИгрок2Id")
        paired = d.get("тип") == "парный"
        if events[d["мероприятиеId"]]["тип"] == "турнир":
            did = d["id"]
            eid = d["мероприятиеId"]
            players = (p1, s1, p2, s2) if paired else (p1, p2)
            for pid in players:
                if pid and pid in team:
                    player_at[pid].add(eid)
                    key = ("d", pid, did)
                    if key not in seen_tourn:
                        seen_tourn.add(key)
                        st[pid]["tourn"] += 1
            if not paired:
                for pid in (s1, s2):
                    if pid and pid in team:
                        second_at[pid].add(eid)
        if p1:
            st[p1]["votes"] += v1
        if p2:
            st[p2]["votes"] += v2
        if paired:
            if s1:
                st[s1]["votes"] += v1
            if s2:
                st[s2]["votes"] += v2
        if v1 > v2:
            if p1:
                st[p1]["win"] += 1
            if p2:
                st[p2]["lose"] += 1
            if paired:
                if s1:
                    st[s1]["win"] += 1
                if s2:
                    st[s2]["lose"] += 1
            else:
                if s1:
                    st[s1]["swin"] += 1
                if s2:
                    st[s2]["slose"] += 1
        elif v2 > v1:
            if p2:
                st[p2]["win"] += 1
            if p1:
                st[p1]["lose"] += 1
            if paired:
                if s2:
                    st[s2]["win"] += 1
                if s1:
                    st[s1]["lose"] += 1
            else:
                if s2:
                    st[s2]["swin"] += 1
                if s1:
                    st[s1]["slose"] += 1
        for j in js:
            if j.get("idУчастника"):
                st[j["idУчастника"]]["judge"] += 1
    for pid, eids in second_at.items():
        for eid in eids:
            if eid in player_at[pid]:
                continue
            key = ("e", pid, eid)
            if key not in seen_tourn:
                seen_tourn.add(key)
                st[pid]["tourn"] += 1

    def rating(s: dict) -> float:
        return (
            s["tourn"] * W["tourn"]
            + s["win"] * W["win"]
            + s["lose"] * W["lose"]
            + s["swin"] * W["swin"]
            + s["slose"] * W["slose"]
            + s["judge"] * W["judge"]
            + s["votes"] * W["votes"]
        )

    out = {}
    skip = guests_not_in_stream()
    for pid, s in st.items():
        if pid in skip:
            continue
        name = people.get(pid)
        if not name:
            continue
        rec = dict(s)
        rec["rating"] = rating(s)
        out[name] = rec
    return out


def cell_val(c, strings: list[str]) -> str:
    t = c.get("t")
    v = c.find("m:v", NS)
    if v is None or v.text is None:
        return ""
    if t == "s":
        return strings[int(v.text)]
    return v.text


def load_google() -> dict[str, dict]:
    cache = REPO / "_tmp_rating_sheets" / "sheet.xlsx"
    if cache.is_file():
        data = cache.read_bytes()
    else:
        url = f"https://docs.google.com/spreadsheets/d/{SID}/export?format=xlsx"
        with urllib.request.urlopen(url, timeout=180) as r:
            data = r.read()
    z = zipfile.ZipFile(BytesIO(data))
    strings = []
    si_root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    for si in si_root.findall("m:si", NS):
        texts = [t.text or "" for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")]
        strings.append("".join(texts))
    root = ET.fromstring(z.read("xl/worksheets/sheet3.xml"))
    google = {}
    for row in root.findall("m:sheetData/m:row", NS):
        rec = {}
        for c in row.findall("m:c", NS):
            ref = c.get("r", "")
            col = "".join(ch for ch in ref if ch.isalpha())
            rec[col] = cell_val(c, strings)
        name = rec.get("A") or ""
        if name in ("", "Человек", "Очки к рейтингу"):
            continue
        try:
            google[name] = {
                "tourn": float(rec.get("B") or 0),
                "win": float(rec.get("C") or 0),
                "lose": float(rec.get("D") or 0),
                "swin": float(rec.get("E") or 0),
                "slose": float(rec.get("F") or 0),
                "judge": float(rec.get("G") or 0),
                "votes": float(rec.get("H") or 0),
                "rating": float(rec.get("I") or 0),
            }
        except ValueError:
            continue
    return merge_google_rows(google)


def merge_google_rows(google: dict[str, dict]) -> dict[str, dict]:
    """Склеить дубли ФИО (ведущий пробел, ё/е, лишние пробелы) суммой колонок."""
    by: dict[str, tuple[str, dict]] = {}
    for name, rec in google.items():
        k = nk(name)
        stripped = (name or "").strip() or name
        if k not in by:
            by[k] = (stripped, dict(rec))
            continue
        canon, acc = by[k]
        for fld, val in rec.items():
            acc[fld] = acc.get(fld, 0) + val
        if stripped and (canon != stripped) and (name == stripped or canon != canon.strip()):
            canon = stripped
        by[k] = (canon, acc)
    return {canon: acc for canon, acc in by.values()}


def main() -> int:
    ours = load_ours()
    google = load_google()
    skip_nk = set()
    people = {p["id"]: p["ФИО"] for p in json.loads((DUMP / "люди.json").read_text(encoding="utf-8"))}
    for pid in guests_not_in_stream():
        skip_nk.add(nk(people.get(pid) or ""))
    google = {n: v for n, v in google.items() if nk(n) not in skip_nk}
    gmap = {nk(n): (n, v) for n, v in google.items()}
    omap = {nk(n): (n, v) for n, v in ours.items()}
    close = 0
    diffs = []
    for k, (gn, gv) in gmap.items():
        if k not in omap:
            continue
        ov = omap[k][1]
        if abs(ov["rating"] - gv["rating"]) <= 0.05:
            close += 1
        elif gv["rating"] > 0 or ov["rating"] > 0:
            diffs.append((abs(ov["rating"] - gv["rating"]), gn, gv, ov))
    diffs.sort(reverse=True)
    top_o = sorted(ours.items(), key=lambda x: -x[1]["rating"])[:10]
    lines = [
        "# Сверка рейтинга с Google",
        "",
        "Формула слепка: "
        "турнир×10 (каждый бой игроком + 1 раз за встречу, если только секундант, в т.ч. проигрыш) "
        "+ победа×5 + поражение×3 + сек.победа×4 + сек.поражение×2 + судил×1 + голоса×0.3.",
        "Ничья по голосам в нашем пересчёте не даёт победу/поражение. "
        "Гости (ФУБ вне стрима я-ИТ-ы и оппоненты Лидер вне стрима) не в сверке.",
        "",
        f"Google (лист «Рейтинг»): {len(google)} строк. Слепок: {sum(1 for v in ours.values() if v['rating']>0)} с ненулевым рейтингом.",
        f"Совпали с точностью 0.05: **{close}**. Расхождений: **{len(diffs)}**.",
        "Дубли ФИО в Google (пробел/ё) склеиваются при сверке. Актуальные расхождения: [`verify-issues.md`](verify-issues.md).",
        "",
        "## Топ-10 слепка",
        "",
        "| Рейтинг | ФИО | Турнир | П | Пор | СекП | СекПор | Судил | Голоса |",
        "|--:|---|--:|--:|--:|--:|--:|--:|--:|",
    ]
    for n, s in top_o:
        lines.append(
            f"| {s['rating']:.1f} | {n} | {s['tourn']} | {s['win']} | {s['lose']} | {s['swin']} | {s['slose']} | {s['judge']} | {s['votes']} |"
        )
    lines += ["", "## Крупнейшие расхождения", ""]
    if not diffs:
        lines.append("_нет_")
    else:
        lines.append("| ФИО | Google | Слепок | Δ |")
        lines.append("|---|--:|--:|--:|")
        for dlt, gn, gv, ov in diffs[:20]:
            lines.append(f"| {gn} | {gv['rating']:.1f} | {ov['rating']:.1f} | {ov['rating']-gv['rating']:+.1f} |")
        lines += [
            "",
            "Актуальные расхождения: [`verify-issues.md`](verify-issues.md).",
        ]
    out = DUMP / "rating-compare.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:25]))
    print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
