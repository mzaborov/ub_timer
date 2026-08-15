# -*- coding: utf-8 -*-
"""Дополняет фамилии в protocols-batch JSON по индексу из листа «протоколы игр».

Приоритет: ФИО, уже участвовавшие в этом же JSON (другие роли/поединки),
затем индекс прошлых протоколов в Google-таблице.
"""
import json
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

SID = "1-qUmFGvuG2SOvueNUWr55zTZyFEXFFqiWTz8m-OVHZg"
SHEET = "протоколы игр"

# Синонимы фамилий на бланке → канон в таблице
SURNAME_ALIASES = {
    "чистохин": "чистюхин",
    "чистяхин": "чистюхин",
    "кунилова": "куликова",
    "лисовик": "мельник",
}
GIVEN_ALIASES = {
    "ярославэ": "ярослав",
}


def fetch_name_index():
    q = urllib.parse.quote(SHEET)
    url = f"https://docs.google.com/spreadsheets/d/{SID}/gviz/tq?tqx=out:json&sheet={q}"
    with urllib.request.urlopen(url, timeout=90) as r:
        raw = r.read().decode("utf-8")
    m = re.search(r"setResponse\((\{.*\})\)\s*;?\s*$", raw, re.DOTALL)
    if not m:
        raise ValueError("gviz parse failed")
    data = json.loads(m.group(1))
    by_surname = defaultdict(set)
    for row in data.get("table", {}).get("rows", []):
        for cell in row.get("c") or []:
            if not cell:
                continue
            v = cell.get("v")
            if not isinstance(v, str):
                continue
            v = re.sub(r"\s+", " ", v.strip())
            if not v or v.startswith("http") or "Команда" in v:
                continue
            parts = v.split()
            if len(parts) < 2:
                continue
            if not re.match(r"^[А-ЯЁA-Z]", parts[0]):
                continue
            by_surname[parts[0].lower()].add(v)
    return {k: sorted(v) for k, v in by_surname.items()}


def first_name(full):
    parts = full.split()
    return parts[1].lower() if len(parts) > 1 else ""


def collect_tournament_roster(data):
    """ФИО с полным именем, уже встречающиеся в этом batch (roles + judges)."""
    by_surname = defaultdict(set)
    for duel in data.get("duels", []):
        roles = duel.get("roles") or {}
        for field in ("player1", "second1", "player2", "second2"):
            _add_full_name_to_roster(roles.get(field, ""), by_surname)
        for j in duel.get("judges") or []:
            _add_full_name_to_roster(j.get("name", ""), by_surname)
    return {k: sorted(v) for k, v in by_surname.items()}


def _add_full_name_to_roster(name, by_surname):
    if not name or not name.strip():
        return
    name = re.sub(r"\s+", " ", name.strip())
    parts = name.split()
    if len(parts) < 2:
        return
    key = SURNAME_ALIASES.get(parts[0].lower(), parts[0].lower())
    if len(parts) >= 2:
        gkey = parts[1].lower().replace("ё", "е")
        galias = GIVEN_ALIASES.get(gkey)
        if galias:
            parts[1] = galias[:1].upper() + galias[1:]
            name = " ".join(parts)
    by_surname[key].add(name)


def tournament_match(surname_key, given, tournament_by_surname):
    cands = tournament_by_surname.get(surname_key, [])
    if not cands:
        return None
    if given:
        for c in cands:
            fn = first_name(c)
            if fn == given or fn.startswith(given[:3]):
                return c
    if len(cands) == 1:
        return cands[0]
    return None


def enrich_name(name, index, tournament_by_surname):
    if not name or not name.strip():
        return name
    name = re.sub(r"\s+", " ", name.strip())
    parts = name.split()

    if len(parts) == 1:
        key = SURNAME_ALIASES.get(parts[0].lower(), parts[0].lower())
        t = tournament_match(key, None, tournament_by_surname)
        if t:
            return t
        cands = index.get(key, [])
        if len(cands) == 1:
            return cands[0]
        return name

    sur = SURNAME_ALIASES.get(parts[0].lower(), parts[0].lower())
    given = GIVEN_ALIASES.get(parts[1].lower().replace("ё", "е"), parts[1].lower())
    t = tournament_match(sur, given, tournament_by_surname)
    if t:
        return t
    cands = index.get(sur, [])
    for c in cands:
        if first_name(c) == given or first_name(c).startswith(given[:3]):
            return c
    return name


def enrich_json(data, index):
    tournament_by_surname = collect_tournament_roster(data)
    changed = []
    for duel in data.get("duels", []):
        roles = duel.get("roles") or {}
        for field in ("player1", "second1", "player2", "second2"):
            if field not in roles:
                continue
            old = roles[field]
            new = enrich_name(old, index, tournament_by_surname)
            if new != old:
                changed.append((duel.get("situationNum"), field, old, new))
                roles[field] = new
                _add_full_name_to_roster(new, tournament_by_surname)
        for j in duel.get("judges") or []:
            old = j.get("name", "")
            new = enrich_name(old, index, tournament_by_surname)
            if new != old:
                changed.append((duel.get("situationNum"), "judge", old, new))
                j["name"] = new
                _add_full_name_to_roster(new, tournament_by_surname)
    return changed


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/protocols/kupala-2026.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    index = fetch_name_index()
    changed = enrich_json(data, index)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {path} — {len(changed)} changes:")
    for item in changed:
        print(f"  sit {item[0]}: {item[1]}: {item[2]!r} -> {item[3]!r}")


if __name__ == "__main__":
    main()
