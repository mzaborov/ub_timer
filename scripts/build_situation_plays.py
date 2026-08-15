# -*- coding: utf-8 -*-
"""Собрать js/situation-plays.json для банка ситуаций (таймер).

Источник: JSON-дамп docs/планы/05_данные/. Счёт — по Судья.голос (1/2).
Видео: сначала ролик поединка, иначе ДеньЦеликом мероприятия.

Запуск из корня репо:
  $env:PYTHONIOENCODING='utf-8'; chcp 65001 >$null 2>&1; python scripts/build_situation_plays.py
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DUMP = REPO / "docs" / "планы" / "05_данные"
OUT = REPO / "js" / "situation-plays.json"

TRAILING_DATE_RE = re.compile(r"\s+\d{2}\.\d{2}\.\d{2,4}\s*$")


def load(name: str):
    path = DUMP / name
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def fmt_date(iso: str | None) -> str:
    raw = (iso or "").strip()
    if not raw or raw.startswith("0000"):
        return ""
    parts = raw.split("-")
    if len(parts) == 3 and len(parts[0]) == 4:
        return f"{parts[2]}.{parts[1]}.{parts[0]}"
    return raw


def surname(fio: str | None) -> str:
    name = (fio or "").strip()
    if not name:
        return ""
    return name.split()[0]


def side_label(player_fio: str | None, second_fio: str | None, paired: bool) -> str:
    p = surname(player_fio)
    if paired:
        s = surname(second_fio)
        if p and s:
            return f"{p}, {s}"
        return p or s
    return p


def event_title(ev: dict, date_disp: str) -> str:
    name = (ev.get("название") or "").strip()
    if date_disp and name.endswith(date_disp):
        name = name[: -len(date_disp)].strip()
    else:
        name = TRAILING_DATE_RE.sub("", name).strip()
    return name


def pick_url(videos: list[dict]) -> str:
    for row in videos:
        url = (row.get("ссылка") or "").strip()
        if url.lower().startswith("http"):
            return url
    return ""


def main() -> None:
    situations = load("ситуации.json")
    people = {p["id"]: p for p in load("люди.json")}
    events = {e["id"]: e for e in load("мероприятия.json")}
    duels = load("поединки.json")
    judges = load("судьи.json")
    videos = load("видео.json")

    sit_by_id = {s["id"]: s for s in situations}

    votes: dict[int, list[str]] = defaultdict(list)
    for j in judges:
        did = j.get("поединокId")
        v = str(j.get("голос") or "").strip()
        if did is not None and v in ("1", "2"):
            votes[int(did)].append(v)

    duel_videos: dict[int, list[dict]] = defaultdict(list)
    event_day_videos: dict[int, list[dict]] = defaultdict(list)
    for v in videos:
        url = (v.get("ссылка") or "").strip()
        if not url.lower().startswith("http"):
            continue
        did = v.get("поединокId")
        eid = v.get("мероприятиеId")
        kind = (v.get("тип") or "").strip()
        if did is not None:
            duel_videos[int(did)].append(v)
        elif eid is not None and kind == "ДеньЦеликом":
            event_day_videos[int(eid)].append(v)

    by_code: dict[str, list[dict]] = defaultdict(list)
    skipped_no_sit = 0

    for d in duels:
        sit_id = d.get("ситуацияId")
        if sit_id is None:
            skipped_no_sit += 1
            continue
        sit = sit_by_id.get(int(sit_id))
        if not sit:
            continue
        code = (sit.get("код") or "").strip()
        if not code:
            continue

        ev = events.get(d.get("мероприятиеId")) or {}
        iso = (d.get("дата") or ev.get("датаНачала") or "").strip()
        date_disp = fmt_date(iso)
        paired = (d.get("тип") or "") == "парный"

        p1 = people.get(d.get("игрок1Id")) or {}
        p2 = people.get(d.get("игрок2Id")) or {}
        s1 = people.get(d.get("секундантИлиВторойИгрок1Id")) or {}
        s2 = people.get(d.get("секундантИлиВторойИгрок2Id")) or {}

        vv = votes.get(int(d["id"]), [])
        v1 = sum(1 for x in vv if x == "1")
        v2 = sum(1 for x in vv if x == "2")
        if v1 > v2:
            winner = 1
        elif v2 > v1:
            winner = 2
        else:
            winner = 0
        score = f"{v1}:{v2}" if (v1 + v2) > 0 else ""

        own = duel_videos.get(int(d["id"]), [])
        own_bout = [x for x in own if (x.get("тип") or "") == "Поединок"]
        video = pick_url(own_bout) or pick_url(own)
        if not video:
            eid = d.get("мероприятиеId")
            if eid is not None:
                video = pick_url(event_day_videos.get(int(eid), []))

        row: dict = {
            "date": date_disp,
            "iso": iso,
            "event": event_title(ev, date_disp),
            "p1": side_label(p1.get("ФИО"), s1.get("ФИО"), paired) or "—",
            "p2": side_label(p2.get("ФИО"), s2.get("ФИО"), paired) or "—",
            "score": score,
            "winner": winner,
        }
        if video:
            row["video"] = video
        by_code[code].append(row)

    for code, rows in by_code.items():
        rows.sort(key=lambda r: (r.get("iso") or "", r.get("event") or ""), reverse=True)
        for r in rows:
            r.pop("iso", None)

    payload = {"byCode": dict(by_code)}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")

    n_plays = sum(len(v) for v in by_code.values())
    n_with_video = sum(1 for rows in by_code.values() for r in rows if r.get("video"))
    print(
        f"OK {OUT.relative_to(REPO)}: ситуаций с играми {len(by_code)}, "
        f"поединков {n_plays}, со ссылкой видео {n_with_video}, "
        f"без ситуации {skipped_no_sit}"
    )
    sample_code = next(iter(sorted(by_code.keys())), "")
    if sample_code:
        print("пример", sample_code, by_code[sample_code][0])


if __name__ == "__main__":
    main()
