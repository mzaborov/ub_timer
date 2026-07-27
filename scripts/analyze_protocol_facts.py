# -*- coding: utf-8 -*-
"""Разбор плоской таблицы фактов A:F на листе «протоколы игр» (с row 35)."""
import json
import re
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

SID = "1-qUmFGvuG2SOvueNUWr55zTZyFEXFFqiWTz8m-OVHZg"
SHEET = "протоколы игр"


def fetch(range_a1: str) -> dict:
    q = urllib.parse.quote(SHEET)
    url = (
        f"https://docs.google.com/spreadsheets/d/{SID}/gviz/tq"
        f"?tqx=out:json&sheet={q}&range={range_a1}"
    )
    with urllib.request.urlopen(url, timeout=120) as r:
        raw = r.read().decode("utf-8")
    m = re.search(r"google\.visualization\.Query\.setResponse\((.*)\);?\s*$", raw, re.S)
    return json.loads(m.group(1))


def cells(row) -> list[str]:
    c = row.get("c") or []
    out: list[str] = []
    for x in c:
        if x is None:
            out.append("")
        else:
            v = x.get("v")
            out.append("" if v is None else str(v))
    while len(out) < 6:
        out.append("")
    return out


def main() -> None:
    print("=== A30:F36 (контекст над таблицей) ===")
    for i, row in enumerate(fetch("A30:F36")["table"]["rows"]):
        print(f"{30 + i}: " + " | ".join(cells(row)))

    data = fetch("A34:F3000")
    labels = [c.get("label", "") for c in data["table"]["cols"]]
    rows = data["table"]["rows"]
    print("\nЗаголовки колонок (gviz):", labels)
    print(f"Строк фактов (с 34-й): {len(rows)}")

    tournaments = defaultdict(int)
    for row in rows:
        c = cells(row)
        if c[4]:
            tournaments[c[4]] += 1
    print("\nТоп мероприятий:")
    for t, n in sorted(tournaments.items(), key=lambda x: -x[1])[:12]:
        print(f"  {n:4d}  {t}")

    # Онлайн 1, поединок 1
    duel1 = [cells(r) for r in rows if cells(r)[4] == "Онлайн 1 31.10.2021" and cells(r)[0] == "1"]
    print(f"\nОнлайн 1, поединок 1 — {len(duel1)} строк:")
    for c in duel1:
        pts = c[2] or "—"
        nov = c[5] or ""
        print(f"  {c[3]:22s} | {c[1]:25s} | очки:{pts:>3s} | нов:{nov}")

    evt_pts = defaultdict(list)
    for row in rows[:500]:
        c = cells(row)
        if c[2]:
            evt_pts[c[3]].append(float(c[2]))
    print("\nКолонка C «очки» — только у события «Набрал Голосов»:")
    for e in sorted(evt_pts):
        pts = evt_pts[e]
        print(f"  {e}: count={len(pts)}")

    k25 = [cells(r) for r in rows if cells(r)[4] == "Купала  25"]
    d1 = [c for c in k25 if str(c[0]).startswith("1")]
    print(f"\nКупала 25, поединок 1 — {len(d1)} строк:")
    for c in d1:
        pts = c[2] or "—"
        nov = c[5] or "—"
        print(f"  {c[3]:22s} | {c[1]:25s} | очки:{pts:>3s} | нов:{nov}")

    per = Counter(c[0] for c in k25)
    print(f"Купала 25: {len(per)} поединков, строк на поединок: {Counter(per.values())}")

    # Соседство с протокольной сеткой (rows 30-32)
    print("\nНад таблицей (строки 30–32) — подписи из колонки D протокола:")
    for i, row in enumerate(fetch("A30:D32")["table"]["rows"]):
        c = cells(row)
        if c[3]:
            print(f"  row {30+i}: {c[3]}")


if __name__ == "__main__":
    main()
