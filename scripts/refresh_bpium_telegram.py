# -*- coding: utf-8 -*-
"""Обновить список Telegram-контактов из Бипиума.

Что делает:
  1. Тянет каталог «Люди сообщества» (#37) из Бипиума (Basic auth, пагинация).
  2. Берёт людей портала из docs/планы/05_данные/люди.json (id, ФИО).
  3. Сопоставляет по «Фамилия Имя» (при неоднозначности — по отчеству).
  4. Пишет data/bpium_telegram_all.csv (person_id, ФИО, username, tg_id, ...).
  5. С флагом --apply сразу запускает scripts/fill_telegram_from_bpium.py --apply
     (пишет people.telegram / people.telegram_id в БД; не затирает ручные значения).

Если людей портала меняли — сначала обнови слепок:
  python scripts/export_domain_dump.py

Запуск:
  python scripts/refresh_bpium_telegram.py          # только CSV
  python scripts/refresh_bpium_telegram.py --apply  # CSV + запись в БД
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PEOPLE_JSON = REPO / "docs" / "планы" / "05_данные" / "люди.json"
CSV_OUT = REPO / "data" / "bpium_telegram_all.csv"
CATALOG_ID = 37
LIMIT = 200

# поля каталога: 2=Фамилия, 3=Имя, 4=Отчество, 85=Телеграм, 99=Ник, 100=Telegram ID, 105=ID
F_SURNAME, F_FIRST, F_PATR = "2", "3", "4"
F_TG, F_NICK, F_TGID, F_ID = "85", "99", "100", "105"


def load_env() -> dict[str, str]:
    """Конфиг из settings.env + секреты из окружения (инжектит kvault)."""
    env: dict[str, str] = {}
    path = REPO / "settings.env"
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if v})
    return env


def api_get(url: str, tok: str, path: str):
    req = urllib.request.Request(url + path)
    req.add_header("Authorization", "Basic " + tok)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(3)
                continue
            raise
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2)


def fetch_records(url: str, tok: str) -> list[dict]:
    out: list[dict] = []
    offset = 0
    while True:
        page = api_get(url, tok, f"/api/v1/catalogs/{CATALOG_ID}/records?limit={LIMIT}&offset={offset}")
        items = page if isinstance(page, list) else page.get("items", [])
        if not items:
            break
        out.extend(items)
        offset += len(items)
        if len(items) < LIMIT:
            break
    return out


def val_str(v) -> list[str]:
    if isinstance(v, list):
        return [c["contact"] for c in v if isinstance(c, dict) and c.get("contact")]
    if isinstance(v, dict):
        return [v.get("value")] if v.get("value") else []
    if isinstance(v, str):
        return [v.strip()] if v.strip() else []
    if isinstance(v, (int, float)):
        return [str(int(v))]
    return []


def rec_tg(r: dict) -> tuple[list[str], list[int]]:
    vals = r.get("values", {})
    handles: list[str] = []
    ids: list[int] = []
    for f in (F_TG, F_NICK, F_ID):
        for s in val_str(vals.get(f)):
            low = s.lower()
            if not s or "не заполн" in low or "есть в чате" in low or " " in s:
                continue
            s2 = s.lstrip("@")
            if re.fullmatch(r"\d{5,15}", s2):
                ids.append(int(s2))
            elif re.fullmatch(r"[A-Za-z0-9_]{4,32}", s2):
                handles.append(s2)
    for s in val_str(vals.get(F_TGID)):
        if s.isdigit():
            ids.append(int(s))
    return handles, ids


def norm(s: str) -> list[str]:
    s = s.lower().replace("ё", "е")
    return [t for t in re.sub(r"[^a-zа-я ]", " ", s).split() if t]


def build_index(recs: list[dict]) -> dict:
    idx: dict = {}
    for r in recs:
        v = r.get("values", {})
        sur = (val_str(v.get(F_SURNAME)) or [""])[0]
        first = (val_str(v.get(F_FIRST)) or [""])[0]
        patr = (val_str(v.get(F_PATR)) or [""])[0]
        if not sur or not first:
            p = norm(r.get("title", "").split(":")[0])
            if len(p) >= 2:
                sur, first = p[0], p[1]
            if len(p) >= 3:
                patr = p[2]
        idx.setdefault((sur.lower(), first.lower()), []).append((r, patr, rec_tg(r)))
    return idx


def main() -> int:
    ap = argparse.ArgumentParser(description="Обновить Telegram-контакты из Бипиума")
    ap.add_argument("--apply", action="store_true", help="после CSV записать значения в БД")
    args = ap.parse_args()

    env = load_env()
    url = env["BIPIUM_URL"].rstrip("/")
    tok = base64.b64encode(f"{env['BIPIUM_LOGIN']}:{env['BIPIUM_PASSWORD']}".encode()).decode()

    print("Читаю Бипиум, каталог #", CATALOG_ID, "...")
    recs = fetch_records(url, tok)
    print("Записей в Бипиуме:", len(recs))

    people = json.load(open(PEOPLE_JSON, encoding="utf-8"))
    idx = build_index(recs)

    matched = got_u = got_id = 0
    out = []
    for p in people:
        fio = (p.get("ФИО") or "").strip()
        t = norm(fio)
        sur = t[0] if t else ""
        first = t[1] if len(t) > 1 else ""
        patr = t[2] if len(t) > 2 else ""
        cands = idx.get((sur, first), [])
        pick = None
        if len(cands) == 1:
            pick = cands[0]
        elif len(cands) > 1:
            exact = [c for c in cands if c[1].lower() == patr and patr]
            pick = (exact or cands)[0]
        row = {"person_id": p["id"], "ФИО": fio, "username": "", "tg_id": "", "bpium": "", "cands": len(cands)}
        if pick:
            matched += 1
            h, ids = pick[2]
            if h:
                got_u += 1
                row["username"] = "@" + h[0]
            if ids:
                got_id += 1
                row["tg_id"] = ids[0]
            row["bpium"] = pick[0].get("title", "")[:70]
        out.append(row)

    print("Людей портала:", len(people), "| сопоставлено:", matched)
    print("с @username:", got_u, "| с числовым id:", got_id)

    with open(CSV_OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["person_id", "ФИО", "username", "tg_id", "bpium", "cands"])
        w.writeheader()
        w.writerows(out)
    print("SAVED:", CSV_OUT)

    if args.apply:
        print("Записываю в БД...")
        rc = subprocess.call([sys.executable, str(REPO / "scripts" / "fill_telegram_from_bpium.py"), "--apply"])
        return rc
    print("Дальше: python scripts/fill_telegram_from_bpium.py --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
