# -*- coding: utf-8 -*-
"""Выгрузка Google/Баллы/протоколов в канон домена (шаг 2).

Запуск из корня репо:
  $env:PYTHONIOENCODING='utf-8'; python scripts/export_domain_dump.py

SID: GOOGLE_SHEETS_SID в secrets.env или окружении
     (иначе публичный id таблицы я-ИТ-ы).
Баллы: BALLS_XLSX_DIR, иначе типичный путь Яндекс.Диска, если он есть.
Регистрации: из живой MySQL (meeting_registrations), не [].
  Если MySQL недоступен — существующий регистрации.json не затираем.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "docs" / "планы" / "05_данные"
PROTOCOLS_DIR = REPO / "data" / "protocols"

DEFAULT_SID = "1-qUmFGvuG2SOvueNUWr55zTZyFEXFFqiWTz8m-OVHZg"
GID_GRID = "1172864695"
GID_BANK = "94326902"
DRIVE_ROOT = "16IBd36gvDe3tGQk8urKPKk55yQrn9JCE"

DEFAULT_BALLS = Path(
    r"c:\Users\mzaborov\Yandex.Disk\Работы, тексты, презентации\Я и ТЫ\Поединки\Баллы"
)

SURNAME_ALIASES = {
    "чистохин": "чистюхин",
    "чистяхин": "чистюхин",
    "кунилова": "куликова",
    "лисовик": "мельник",
    "ращевский": "рашевский",
    "матрохина": "митрохина",
}
GIVEN_ALIASES = {
    "ярославэ": "ярослав",
}

# Клип боя: номер + название ситуации. Не день (`Онлайн 24.mp4`, `Суббота 27.06-сжатое.mkv`).
_DATE_LEAD_RE = re.compile(
    r"^(?:\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2})\s*[-–—]?\s*"
)
_SIT_CLIP_RE = re.compile(
    r"^(?P<num>\d{1,3})(?P<suf>[ЭэAaа])?\s*[-–—]\s*(?P<name>\S.+)\.(mkv|mp4|mov|webm)$",
    re.I,
)
_DAY_NAME_RE = re.compile(
    r"сжатое|онлайн|тренировка|поединк|общий|video\d|галерея|выступающ",
    re.I,
)
_SOURCES_DIR_RE = re.compile(r"исходник", re.I)
VIDEO_EXT = {".mp4", ".mkv", ".mov", ".webm"}
DRIVE_DAY_TYPES = ("онлайн", "купала", "новогоднее")
TEMPLATE_ONLINE10_SLUGS = (
    "online_10_20",
    "online_10_21",
    "online_10_22",
    "online_10_23",
    "online_10_24",
)
DEFAULT_ONLINE_ZOOM = (
    ""
)
DEFAULT_ONLINE_START = "11:00"
DEFAULT_ONLINE_END = "13:30"
_DRIVE_LIST_CACHE: dict[str, list[tuple[str, str]]] = {}
NS_XLSX = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

ZABOROV = "Заборов Михаил"
SHEVCHUK = "Шевчук Александр"
OKULOVA = "Окулова Ирина"
KUZMINA = "Кузьмина Екатерина"
COLLEGE_UNKNOWN = "неизвестна"

TODAY = date.today()


def load_secrets() -> dict[str, str]:
    env: dict[str, str] = {}
    path = REPO / "secrets.env"
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    env.update({k: v for k, v in os.environ.items() if v})
    return env


def fetch_bytes(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "ub-timer-domain-dump/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_text(url: str, timeout: int = 120) -> str:
    return fetch_bytes(url, timeout).decode("utf-8", errors="replace")


def fetch_csv(sid: str, gid: str) -> list[list[str]]:
    url = f"https://docs.google.com/spreadsheets/d/{sid}/export?format=csv&gid={gid}"
    text = fetch_text(url)
    return list(csv.reader(io.StringIO(text)))


def fetch_xlsx(sid: str) -> bytes:
    url = f"https://docs.google.com/spreadsheets/d/{sid}/export?format=xlsx"
    return fetch_bytes(url, timeout=180)


def _xlsx_shared_strings(z: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    out: list[str] = []
    for si in root.findall("m:si", NS_XLSX):
        out.append("".join(t.text or "" for t in si.findall(".//m:t", NS_XLSX)))
    return out


def _xlsx_sheet_path(z: zipfile.ZipFile, sheet_name: str) -> str | None:
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid_to = {rel.get("Id"): rel.get("Target") for rel in rels}
    rattr = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    for sh in wb.findall("m:sheets/m:sheet", NS_XLSX):
        if sh.get("name") != sheet_name:
            continue
        target = (rid_to.get(sh.get(rattr)) or "").lstrip("/")
        if target and not target.startswith("xl/"):
            target = "xl/" + target
        return target or None
    return None


def _cell_ref_row_col(ref: str) -> tuple[int, int] | None:
    m = re.match(r"^([A-Z]+)(\d+)$", (ref or "").upper())
    if not m:
        return None
    return int(m.group(2)), col_letter_to_idx(m.group(1))


def parse_bank_review_urls(xlsx_bytes: bytes) -> dict[str, str]:
    """Код ситуации → URL колонки «Разбор ситуации» (гиперссылка xlsx, CSV её теряет)."""
    z = zipfile.ZipFile(io.BytesIO(xlsx_bytes))
    sheet_path = _xlsx_sheet_path(z, "Ситуации")
    if not sheet_path or sheet_path not in z.namelist():
        return {}
    shared = _xlsx_shared_strings(z)
    root = ET.fromstring(z.read(sheet_path))
    values: dict[tuple[int, int], str] = {}
    formula_url: dict[tuple[int, int], str] = {}
    for c in root.findall(".//m:c", NS_XLSX):
        rc = _cell_ref_row_col(c.get("r") or "")
        if not rc:
            continue
        t = c.get("t")
        v_el = c.find("m:v", NS_XLSX)
        is_el = c.find("m:is", NS_XLSX)
        text = ""
        if t == "s" and v_el is not None and v_el.text:
            try:
                text = shared[int(v_el.text)]
            except (ValueError, IndexError):
                text = ""
        elif t == "inlineStr" and is_el is not None:
            text = "".join(x.text or "" for x in is_el.findall(".//m:t", NS_XLSX))
        elif v_el is not None:
            text = v_el.text or ""
        values[rc] = collapse_ws(text)
        f_el = c.find("m:f", NS_XLSX)
        ftxt = (f_el.text or "") if f_el is not None else ""
        if "HYPERLINK" in ftxt.upper():
            m = re.search(r'HYPERLINK\s*\(\s*"([^"]+)"', ftxt, re.I)
            if m:
                formula_url[rc] = m.group(1).strip()

    headers = {c: (values.get((1, c)) or "").lower() for r, c in values if r == 1}
    code_col = next((c for c, h in headers.items() if h in ("код", "code")), 0)
    review_col = next((c for c, h in headers.items() if "разбор" in h), 9)

    href_by_rc: dict[tuple[int, int], str] = dict(formula_url)
    rels_path = str(Path(sheet_path).parent / "_rels" / (Path(sheet_path).name + ".rels")).replace(
        "\\", "/"
    )
    if rels_path in z.namelist():
        rels = ET.fromstring(z.read(rels_path))
        rid_url = {rel.get("Id"): rel.get("Target") for rel in rels}
        rattr = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        for hl in root.findall(".//m:hyperlink", NS_XLSX):
            rc = _cell_ref_row_col(hl.get("ref") or "")
            if not rc:
                continue
            url = (rid_url.get(hl.get(rattr)) or hl.get("location") or "").strip()
            if url.startswith("http"):
                href_by_rc[rc] = url

    out: dict[str, str] = {}
    for rc, url in href_by_rc.items():
        if rc[1] != review_col or not url.startswith("http"):
            continue
        code = values.get((rc[0], code_col), "")
        if code:
            out[code] = url
    return out


def cell(matrix: list[list[str]], row: int, col: int) -> str:
    if row < 0 or col < 0 or row >= len(matrix):
        return ""
    line = matrix[row]
    if col >= len(line):
        return ""
    return str(line[col] or "").strip()


def find_row_label(matrix: list[list[str]], col: int, label: str, max_row: int = 40) -> int:
    want = label.strip().lower()
    for r in range(min(len(matrix), max_row)):
        if cell(matrix, r, col).lower() == want:
            return r
    return -1


def col_letter_to_idx(letters: str) -> int:
    n = 0
    for ch in letters.strip().upper():
        if not ("A" <= ch <= "Z"):
            return -1
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def collapse_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def canon_fio(raw: str) -> str:
    s = collapse_ws(raw)
    if not s:
        return ""
    parts = s.split(" ")
    if parts:
        key = parts[0].lower().replace("ё", "е")
        alias = SURNAME_ALIASES.get(key)
        if alias:
            parts[0] = alias[:1].upper() + alias[1:]
            if alias == "чистюхин":
                parts[0] = "Чистюхин"
            elif alias == "куликова":
                parts[0] = "Куликова"
            elif alias == "мельник":
                parts[0] = "Мельник"
            elif alias == "рашевский":
                parts[0] = "Рашевский"
            elif alias == "митрохина":
                parts[0] = "Митрохина"
        if len(parts) >= 2:
            gkey = parts[1].lower().replace("ё", "е")
            galias = GIVEN_ALIASES.get(gkey)
            if galias:
                parts[1] = galias[:1].upper() + galias[1:]
    return " ".join(parts)


def surname_key(fio: str) -> str:
    p = canon_fio(fio).split(" ")
    return p[0].lower().replace("ё", "е") if p else ""


def parse_situation_cell(val: str) -> tuple[str, str]:
    s = collapse_ws(val)
    if not s:
        return "", ""
    m = re.match(r"^([0-9]+Э?)\s*[-–—]\s*(.+)$", s, re.I)
    if m:
        return m.group(1), m.group(2).strip()
    m = re.match(r"^([0-9]+Э?)(.*)$", s, re.I)
    if m:
        return m.group(1), re.sub(r"^[\s\-–—]+", "", m.group(2) or "").strip()
    return "", s


def is_random_slot(num: str, name: str) -> bool:
    n = (num or "").strip()
    if re.match(r"^00Э?$", n, re.I):
        return True
    low = (name or "").lower()
    return "случайн" in low


def duel_type_from_bank(type_str: str) -> str:
    t = (type_str or "").strip().lower()
    if "экспресс" in t or t == "express":
        return "экспресс"
    if "парн" in t or t == "pair":
        return "парный"
    return "классика"


def minutes_for_type(kind: str) -> int:
    if kind == "экспресс":
        return 1
    if kind == "парный":
        return 5
    return 5


# Поединки офлайна: сб вечер + вс утро. Конференция пт–вс.
# Купала 2022/2023/25: во 2-й строке сетки даты нет.
KUPALA_SPAN = {
    22: (date(2022, 6, 25), date(2022, 6, 26)),
    23: (date(2023, 6, 24), date(2023, 6, 25)),
    25: (date(2025, 7, 12), date(2025, 7, 13)),
}
NYE_SPAN = {
    21: (date(2021, 12, 11), date(2021, 12, 12)),
    22: (date(2022, 12, 10), date(2022, 12, 11)),
    23: (date(2023, 12, 9), date(2023, 12, 10)),
    25: (date(2025, 12, 6), date(2025, 12, 7)),
}
# X турнир Траектория лидера, яИТы. Даты и состав — описания YouTube.
# Формат встречи: пор. 1 парный, 2–3 классика, 4–7 экспресс.
LIDER_DATES = {
    1: date(2022, 10, 14),
    2: date(2022, 10, 21),
    3: date(2022, 11, 14),
    4: date(2022, 11, 18),
}
# Дописать 2-го игрока гостей (слот пустой в сетке). Ключ: (номер встречи, порядок, сторона 1|2).
LIDER_FILL_SECOND = {
    (1, 1, 2): "Шилова Светлана",
    (2, 1, 2): "Таскулин Руслан",
    (3, 1, 1): "Валеев Артур",
    (4, 1, 1): "Синицын Семён",
}
# Сторона 2 в классике пор. 3, если в сетке чужой состав (эвристика «пор. 3 = парный»).
LIDER_REPLACE_P2 = {
    (2, 3): "Земцова Алена",
}
# 2-й слот, ошибочно заполненный как «парный» на пор. 3.
LIDER_CLEAR_SECOND = {
    (1, 3, 1),
    (3, 3, 2),
    (4, 3, 1),
}
LIDER_YOUTUBE_NAMES = (
    "Шилова Светлана",
    "Таскулин Руслан",
    "Валеев Артур",
    "Синицын Семён",
    "Земцова Алена",
)
POLAR_DATE = date(2023, 12, 9)


def apply_lider_youtube(num: int | None, order: int, p1: str, s1: str, p2: str, s2: str) -> tuple[str, str, str, str]:
    """Состав пор. 1 парного и правки пор. 3 по описаниям YouTube."""
    if num is None:
        return p1, s1, p2, s2
    if (num, order) in LIDER_REPLACE_P2:
        p2 = LIDER_REPLACE_P2[(num, order)]
    if (num, order, 1) in LIDER_CLEAR_SECOND:
        s1 = ""
    if (num, order, 2) in LIDER_CLEAR_SECOND:
        s2 = ""
    fill1 = LIDER_FILL_SECOND.get((num, order, 1))
    if fill1 and not s1:
        s1 = fill1
    fill2 = LIDER_FILL_SECOND.get((num, order, 2))
    if fill2 and not s2:
        s2 = fill2
    return p1, s1, p2, s2


def sit_105_classic(situations: list[dict]) -> dict | None:
    for s in situations:
        code = str(s.get("код") or "")
        if code.startswith("105-") and not code.lower().startswith("105a") and s.get("тип") == "классика":
            return s
    return None


def parse_date_from_text(text: str) -> date | None:
    m = re.search(r"(\d{1,2})[.](\d{1,2})[.](\d{4})", text or "")
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(y, mo, d)
        except ValueError:
            return None
    m = re.search(r"(\d{1,2})[.](\d{1,2})[.](\d{2})\b", text or "")
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), 2000 + int(m.group(3))
        try:
            return date(y, mo, d)
        except ValueError:
            return None
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", text or "")
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def classify_event(name: str) -> tuple[str | None, str, int | None]:
    """→ (тип | None, ярлык, номер)."""
    n = collapse_ws(name).lower().replace("ё", "е")
    num = None
    m = re.search(r"нг\s*-?\s*(\d{2,4})", n)
    if m and ("нг" in n[:8] or n.startswith("нг")):
        y = int(m.group(1))
        num = y % 100 if y >= 100 else y
        slug = f"nye_{num}" if num is not None else ""
        return "новогоднее", slug, num
    if "купал" in n:
        m = re.search(r"купал\w*\s*(?:20)?(\d{2})\b", n)
        num = int(m.group(1)) if m else num
        slug = f"kupala_{num}" if num is not None else ""
        return "купала", slug, num
    m = re.search(r"онлайн\D{0,12}(\d{1,2})\b", n)
    if m:
        num = int(m.group(1))
    if not num:
        m = re.search(r"#\s*(\d{1,2})", n)
        if m:
            num = int(m.group(1))
    if "онлайн" in n:
        slug = f"online_{num}" if num is not None else ""
        return "онлайн", slug, num
    if "новый год" in n or "новогод" in n:
        if num is None:
            d = parse_date_from_text(name)
            if d:
                num = d.year % 100
            else:
                m = re.search(r"(20\d{2})", n)
                if m:
                    num = int(m.group(1)) % 100
                else:
                    # «Новый год 22», «Новый год я-ИТ-ы 23» — год в конце, не 20XX.
                    m = re.search(r"\b(\d{2})\s*$", collapse_ws(name))
                    if m:
                        y = int(m.group(1))
                        if 21 <= y <= 29:
                            num = y
        slug = f"nye_{num}" if num is not None else ""
        return "новогоднее", slug, num
    if "воронеж" in n:
        d = parse_date_from_text(name)
        slug = f"voronezh_{d.strftime('%y%m%d')}" if d else "voronezh"
        return "региональный", slug, None
    if "лидер" in n:
        m = re.search(r"встреча\s*(\d+)", n)
        num = int(m.group(1)) if m else None
        slug = f"lider_{num}" if num is not None else "lider"
        return "турнир", slug, num
    if "полярн" in n:
        return "региональный", "polyarny_express", None
    return None, "", num


def is_excluded_bank_row(code: str, num: str, name: str, desc: str, roles: str) -> bool:
    c = (code or "").strip()
    if not c or re.fullmatch(r"-+", c):
        return True
    low = c.lower()
    if "случайн" in low:
        return True
    if re.match(r"^00([-–]|$)", c):
        return True
    if (num or "").strip() == "00":
        return True
    if (name or "").strip().lower() == "случайная ситуация":
        return True
    if not (desc or "").strip() and not (roles or "").strip():
        return True
    return False


def pick_field(row: dict[str, str], names: list[str]) -> str:
    for n in names:
        if n in row and str(row[n] or "").strip():
            return str(row[n]).strip()
    lower = {k.lower(): k for k in row}
    for n in names:
        k = lower.get(n.lower())
        if k and str(row[k] or "").strip():
            return str(row[k]).strip()
    return ""


class People:
    def __init__(self) -> None:
        self.by_canon: dict[str, dict] = {}
        self.variants: dict[str, set[str]] = defaultdict(set)

    def add(self, raw: str) -> int | None:
        fio = canon_fio(raw)
        if not fio or len(fio.split()) < 2:
            return None
        if not re.match(r"^[А-ЯЁA-Z]", fio):
            return None
        key = fio.lower().replace("ё", "е")
        self.variants[key].add(collapse_ws(raw))
        if key not in self.by_canon:
            self.by_canon[key] = {
                "id": 0,
                "ФИО": fio,
                "email": None,
                "telegram": None,
                "активен": True,
                "заметки": None,
            }
        else:
            cur = self.by_canon[key]["ФИО"]
            if "ё" in fio.lower() and "ё" not in cur.lower():
                self.by_canon[key]["ФИО"] = fio
        return -1

    def freeze(self) -> list[dict]:
        names = sorted(self.by_canon, key=lambda s: s)
        out = []
        for i, key in enumerate(names, 1):
            rec = self.by_canon[key]
            rec["id"] = i
            out.append(rec)
        return out

    def id_of(self, raw: str) -> int | None:
        fio = canon_fio(raw)
        rec = self.by_canon.get(fio.lower().replace("ё", "е"))
        return rec["id"] if rec and rec["id"] else None


def normalize_vote(vote) -> str | None:
    if vote in (1, 2, "1", "2"):
        return str(vote)
    s = collapse_ws(str(vote or ""))
    return s if s in ("1", "2") else None


def resolve_judge_identity(
    people: People, fio: str, slot_college: str, vote
) -> tuple[int | None, str | None, str | None]:
    """ФИО есть — обычный судья. Нет ФИО, но есть голос 1/2 — запись без человека, коллегия неизвестна."""
    vote_s = normalize_vote(vote)
    jid = people.id_of(fio)
    if jid:
        return jid, slot_college, vote_s
    if vote_s:
        return None, COLLEGE_UNKNOWN, vote_s
    return None, None, vote_s


def _fact_num(raw) -> str:
    try:
        return str(int(float(str(raw or "0").replace(",", "."))))
    except ValueError:
        return collapse_ws(str(raw or ""))


def fill_unknown_votes_from_facts(
    duels_out: list[dict],
    events: list[dict],
    judges_out: list[dict],
    facts: list[dict],
    people: People,
    judge_id: int,
    report: dict,
) -> int:
    """Для поединков без голосов: факты «Набрал Голосов» → анонимные голоса.

    Номер факта = id поединка (глобальный), не порядок внутри встречи.
    Если судьи уже есть (ФИО), но все голоса пустые — дописываем анонимные,
    именованных не трогаем и количествоСудей не завышаем.
    """
    ev_by_id = {e["id"]: e for e in events}
    facts_nv: dict[tuple[str, str], list[tuple[int, int]]] = defaultdict(list)
    for f in facts:
        if collapse_ws(f.get("событие") or "").lower() != "набрал голосов":
            continue
        try:
            pts = int(float(str(f.get("очки") or "0").replace(",", ".")))
        except ValueError:
            continue
        if pts <= 0:
            continue
        pid = people.id_of(f.get("человек") or "")
        if not pid:
            continue
        meeting = collapse_ws(f.get("мероприятие") or "").lower()
        num = _fact_num(f.get("номер") or "")
        facts_nv[(meeting, num)].append((pid, pts))

    by_duel_js: dict[int, list[dict]] = defaultdict(list)
    for j in judges_out:
        by_duel_js[j["поединокId"]].append(j)

    by_event: dict[int, list[dict]] = defaultdict(list)
    for d in duels_out:
        by_event[d["мероприятиеId"]].append(d)

    for eid, dlist in by_event.items():
        name = collapse_ws(ev_by_id[eid]["название"]).lower()
        for d in dlist:
            js = by_duel_js.get(d["id"], [])
            if any(str(j.get("голос") or "") in ("1", "2") for j in js):
                continue
            recs = facts_nv.get((name, str(d["id"])), [])
            if not recs:
                continue
            p1, p2 = d.get("игрок1Id"), d.get("игрок2Id")
            added = 0
            for pid, pts in recs:
                if pid == p1:
                    vote = "1"
                elif pid == p2:
                    vote = "2"
                else:
                    continue
                for _ in range(pts):
                    judge_id += 1
                    recj = {
                        "id": judge_id,
                        "поединокId": d["id"],
                        "idУчастника": None,
                        "коллегия": COLLEGE_UNKNOWN,
                        "голос": vote,
                    }
                    judges_out.append(recj)
                    by_duel_js[d["id"]].append(recj)
                    added += 1
            named = sum(1 for j in js if j.get("idУчастника"))
            if named:
                d["количествоСудей"] = named
            elif added:
                d["количествоСудей"] = added
            if added:
                report.setdefault("votesFromFacts", []).append(
                    f"{ev_by_id[eid]['название']} id={d['id']} +{added} голосов из фактов"
                )
    return judge_id


def parse_bank(rows: list[list[str]], report: dict) -> tuple[list[dict], dict[str, dict]]:
    if not rows:
        return [], {}
    headers = [collapse_ws(h) for h in rows[0]]
    situations: list[dict] = []
    by_num: dict[str, dict] = {}
    sid = 0
    for line in rows[1:]:
        raw = {headers[i]: (line[i] if i < len(line) else "") for i in range(len(headers))}
        code = pick_field(raw, ["Код", "Code"])
        num_s = pick_field(raw, ["Номер"])
        name = pick_field(raw, ["Название ситуации", "SituationName"])
        desc = pick_field(raw, ["SituationDescription", "Полное описание", "Описание"])
        roles_raw = pick_field(raw, ["SituationRoles", "Роли и интересы", "Roles"])
        if is_excluded_bank_row(code, num_s, name, desc, roles_raw):
            continue
        sid += 1
        num = None
        if num_s.isdigit():
            num = int(num_s)
        else:
            m = re.match(r"^(\d+)", code)
            num = int(m.group(1)) if m else None
        kind = duel_type_from_bank(pick_field(raw, ["Тип", "Type"]))
        roles = None
        if roles_raw:
            try:
                roles = json.loads(roles_raw)
            except json.JSONDecodeError:
                report.setdefault("warnings", []).append(f"банк: невалидный SituationRoles у {code}")
                roles = {"raw": roles_raw}
        rec = {
            "id": sid,
            "код": code,
            "номер": num,
            "тип": kind,
            "описание": desc or None,
            "роли": roles,
            "опубликована": True,
        }
        situations.append(rec)
        if num_s:
            by_num[num_s] = rec
            by_num[num_s.upper()] = rec
        if code:
            by_num[code] = rec
            lead = re.match(r"^(\d+Э?)", code, re.I)
            if lead:
                by_num[lead.group(1)] = rec
    return situations, by_num


def parse_grid(matrix: list[list[str]], people: People, report: dict) -> list[dict]:
    meet_r = find_row_label(matrix, 3, "Встреча")
    sit_r = find_row_label(matrix, 1, "Ситуация")
    started_r = find_row_label(matrix, 3, "Начинал")
    video_r = find_row_label(matrix, 3, "Видео поединка")
    if meet_r < 0 or sit_r < 0:
        raise SystemExit("Сетка: не найдены строки «Встреча» / «Ситуация»")

    p1 = p2 = s1 = s2 = -1
    for r in range(sit_r + 1, min(len(matrix), 35)):
        role = cell(matrix, r, 3).lower()
        if role == "участник":
            if p1 < 0:
                p1 = r
            elif p2 < 0:
                p2 = r
        elif role == "секундант":
            if p1 >= 0 and s1 < 0:
                s1 = r
            elif p2 >= 0 and s2 < 0:
                s2 = r

    judge_rows = []
    vote_rows = []
    for n in range(1, 10):
        jr = find_row_label(matrix, 3, f"Судья {n}")
        vr = find_row_label(matrix, 3, f"Судья {n} Голос")
        judge_rows.append(jr)
        vote_rows.append(vr)

    width = max((len(row) for row in matrix[:35]), default=0)
    meetings: list[dict] = []
    current = None
    for c in range(4, width):
        name = collapse_ws(cell(matrix, meet_r, c))
        sit = cell(matrix, sit_r, c)
        a = cell(matrix, p1, c) if p1 >= 0 else ""
        b = cell(matrix, p2, c) if p2 >= 0 else ""
        if not name:
            continue
        if not sit and not a and not b:
            continue
        if current is None or current["name"] != name:
            current = {"name": name, "columns": []}
            meetings.append(current)
        num, sname = parse_situation_cell(sit)
        started = cell(matrix, started_r, c) if started_r >= 0 else ""
        video = cell(matrix, video_r, c) if video_r >= 0 else ""
        judges = []
        for i, jr in enumerate(judge_rows):
            fio = cell(matrix, jr, c) if jr >= 0 else ""
            vote = cell(matrix, vote_rows[i], c) if vote_rows[i] >= 0 else ""
            college = (
                "нанимающиесяНаРаботу"
                if i < 3
                else "отправляющиеНаПереговоры"
                if i < 6
                else "доверяющиеСобственность"
            )
            judges.append({"fio": fio, "голос": vote or None, "коллегия": college, "slot": i})
        t1p, t1s = a, (cell(matrix, s1, c) if s1 >= 0 else "")
        t2p, t2s = b, (cell(matrix, s2, c) if s2 >= 0 else "")
        current["columns"].append(
            {
                "col": c,
                "situationNum": num,
                "situationName": sname,
                "started": started,
                "video": video,
                "team1p": t1p,
                "team1s": t1s,
                "team2p": t2p,
                "team2s": t2s,
                "judges": judges,
            }
        )
        for raw in (t1p, t1s, t2p, t2s, *[j["fio"] for j in judges]):
            people.add(raw)
    if not meetings:
        report.setdefault("errors", []).append("Сетка: не найдено встреч")
    return meetings


def apply_draw(col: dict, report: dict, meeting_name: str, order: int) -> tuple[str, str, str, str]:
    t1p, t1s, t2p, t2s = col["team1p"], col["team1s"], col["team2p"], col["team2s"]
    started = collapse_ws(col.get("started") or "").lower()
    if "команда 2" in started:
        return t2p, t2s, t1p, t1s
    if "команда 1" in started:
        return t1p, t1s, t2p, t2s
    if started:
        report.setdefault("warnings", []).append(
            f"{meeting_name} #{order}: «Начинал»={col.get('started')!r} — слоты как команда 1"
        )
    else:
        report.setdefault("noStarted", []).append(f"{meeting_name} #{order}")
    return t1p, t1s, t2p, t2s


def parse_facts(matrix: list[list[str]]) -> list[dict]:
    facts = []
    start = 0
    for r, row in enumerate(matrix):
        if row and collapse_ws(row[0] if row else "") == "Номер поединка":
            start = r + 1
            break
    if start == 0:
        start = 35
    for row in matrix[start:]:
        if len(row) < 5:
            continue
        num, person, pts, event, meeting = (row + [""] * 6)[:5]
        novice = row[5] if len(row) > 5 else ""
        if not event and not meeting:
            continue
        if collapse_ws(person) in ("Человек",):
            continue
        facts.append(
            {
                "номер": collapse_ws(num),
                "человек": canon_fio(person) if person else "",
                "очки": collapse_ws(pts),
                "событие": collapse_ws(event),
                "мероприятие": collapse_ws(meeting),
                "новичок": collapse_ws(novice),
            }
        )
    return facts


def xlsx_rows(path: Path) -> list[dict[str, str]]:
    with zipfile.ZipFile(path) as z:
        ss = ET.fromstring(z.read("xl/sharedStrings.xml"))
        strings = []
        for si in ss.findall("m:si", NS_XLSX):
            texts = [t.text or "" for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")]
            strings.append("".join(texts))

        def val(c):
            t = c.get("t")
            is_el = c.find("m:is", NS_XLSX)
            if is_el is not None:
                texts = [x.text or "" for x in is_el.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")]
                return "".join(texts)
            v = c.find("m:v", NS_XLSX)
            if v is None or v.text is None:
                return ""
            if t == "s":
                return strings[int(v.text)]
            return v.text

        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        out = []
        for row in sheet.findall("m:sheetData/m:row", NS_XLSX):
            rec = {}
            for c in row.findall("m:c", NS_XLSX):
                ref = c.get("r", "")
                col = "".join(ch for ch in ref if ch.isalpha())
                rec[col] = val(c)
            out.append(rec)
        return out


def load_balls(dir_path: Path, people: People) -> dict[str, dict]:
    """ключ 'онлайн:27' / 'купала:26' / 'новогоднее:24' → {orgs, arbs}."""
    result: dict[str, dict] = {}
    if not dir_path.is_dir():
        return result
    for path in sorted(dir_path.glob("*.xlsx")):
        stem = path.stem
        kind = num = None
        m = re.search(r"(\d+)\s*онлайн", stem, re.I)
        if m:
            kind, num = "онлайн", int(m.group(1))
        m = re.search(r"купала\s*(\d+)", stem, re.I)
        if m:
            kind, num = "купала", int(m.group(1))
        m = re.search(r"новый\s*год\s*(\d+)", stem, re.I)
        if m:
            kind, num = "новогоднее", int(m.group(1))
        if kind is None:
            continue
        key = f"{kind}:{num}"
        orgs, arbs = [], []
        for rec in xlsx_rows(path):
            name = canon_fio(rec.get("B") or "")
            role = collapse_ws(rec.get("D") or "")
            if not name:
                continue
            people.add(name)
            if role == "Организатор" and name not in orgs:
                orgs.append(name)
            elif role == "Арбитр" and name not in arbs:
                arbs.append(name)
        result[key] = {"orgs": orgs, "arbs": arbs, "file": path.name}
    return result


def load_protocols() -> list[dict]:
    out = []
    if not PROTOCOLS_DIR.is_dir():
        return out
    for path in sorted(PROTOCOLS_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("format") != "protocols-batch":
            continue
        data["_file"] = path.name
        out.append(data)
    return out


def list_drive_folder(fid: str) -> list[tuple[str, str]]:
    url = f"https://drive.google.com/embeddedfolderview?id={fid}#list"
    raw = fetch_text(url, timeout=60)
    return re.findall(
        r'id="entry-([^"]+)".*?class="flip-entry-title">([^<]+)',
        raw,
        re.DOTALL,
    )


def drive_file_url(fid: str) -> str:
    return f"https://drive.google.com/file/d/{fid}/view"


def is_situation_clip(title: str) -> bool:
    """Имя клипа боя: номер и название ситуации, не файл дня."""
    t = _DATE_LEAD_RE.sub("", (title or "").strip(), count=1)
    m = _SIT_CLIP_RE.match(t)
    if not m:
        return False
    name = m.group("name")
    if _DAY_NAME_RE.search(name):
        return False
    if re.match(r"^[йя]\b", name, re.I):
        return False
    return True


def is_drive_url(url: str) -> bool:
    u = (url or "").lower()
    return "drive.google.com" in u or "docs.google.com/file" in u


def google_file_id(url: str) -> str | None:
    """id файла Drive / документа Google из публичной ссылки."""
    u = url or ""
    m = re.search(r"drive\.google\.com/file/d/([^/?#]+)", u, re.I)
    if m:
        return m.group(1)
    m = re.search(
        r"docs\.google\.com/(?:spreadsheets|document|presentation|file)/d/([^/?#]+)",
        u,
        re.I,
    )
    if m:
        return m.group(1)
    m = re.search(r"[?&]id=([A-Za-z0-9_-]{20,})", u)
    if m:
        return m.group(1)
    return None


# Публичный ключ вьюера Drive (лежит в HTML file/d/…/view). Не секрет проекта.
_DRIVE_VIEWER_KEY = "AIzaSyC1eQ1xj69IdTMeii5r7brs3R90eck-m7k"
_DRIVE_CREATED_CACHE: dict[str, str | None] = {}
_DRIVE_API_KEYS: list[str] | None = None


def _drive_api_keys(fid: str) -> list[str]:
    global _DRIVE_API_KEYS
    if _DRIVE_API_KEYS is not None:
        return _DRIVE_API_KEYS
    keys = [_DRIVE_VIEWER_KEY]
    try:
        html = fetch_text(f"https://drive.google.com/file/d/{fid}/view", timeout=40)
        for k in re.findall(r"AIza[0-9A-Za-z_-]{30,}", html):
            if k not in keys:
                keys.append(k)
    except Exception:
        pass
    _DRIVE_API_KEYS = keys
    return keys


def _drive_created_uncached(fid: str) -> str | None:
    """Календарный день createdTime (UTC), не modifiedTime."""
    params = urllib.parse.urlencode(
        {
            "fields": "createdTime",
            "supportsAllDrives": "true",
        }
    )
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Referer": f"https://drive.google.com/file/d/{fid}/view",
        "Origin": "https://drive.google.com",
        "Accept": "application/json",
    }
    last_quota = False
    for key in _drive_api_keys(fid):
        url = (
            f"https://www.googleapis.com/drive/v3/files/{fid}?{params}"
            f"&key={urllib.parse.quote(key)}"
        )
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if e.code == 403 and "rateLimitExceeded" in body:
                last_quota = True
                continue
            continue
        except Exception:
            continue
        raw = (data.get("createdTime") or "").strip()
        m = re.match(r"(\d{4}-\d{2}-\d{2})", raw)
        if m:
            return m.group(1)
    if last_quota:
        time.sleep(2)
        try:
            url = (
                f"https://www.googleapis.com/drive/v3/files/{fid}?{params}"
                f"&key={urllib.parse.quote(_DRIVE_VIEWER_KEY)}"
            )
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
            raw = (data.get("createdTime") or "").strip()
            m = re.match(r"(\d{4}-\d{2}-\d{2})", raw)
            if m:
                return m.group(1)
        except Exception:
            return None
    return None


def drive_created_day(url: str) -> str | None:
    fid = google_file_id(url)
    if not fid:
        return None
    if fid in _DRIVE_CREATED_CACHE:
        return _DRIVE_CREATED_CACHE[fid]
    iso = _drive_created_uncached(fid)
    _DRIVE_CREATED_CACHE[fid] = iso
    return iso


def load_existing_review_dates() -> dict[str, str]:
    """Чтобы повторный экспорт не затирал даты разборов, если Drive API недоступен."""
    path = OUT_DIR / "видео.json"
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return out
    if not isinstance(data, list):
        return out
    for rec in data:
        if not isinstance(rec, dict) or rec.get("тип") != "Разбор":
            continue
        iso = rec.get("дата")
        url = rec.get("ссылка") or ""
        if not iso or not url:
            continue
        out[url] = iso
        fid = google_file_id(url)
        if fid:
            out["gid:" + fid] = iso
    return out


def title_matches_event_date(title: str, ev_date: date | None) -> bool:
    if not ev_date:
        return False
    t = title or ""
    return (
        ev_date.isoformat() in t
        or ev_date.strftime("%d.%m.%Y") in t
        or ev_date.strftime("%d.%m.%y") in t
        or ev_date.strftime("%d.%m") in t
    )


def match_drive_folders(
    entries: list[tuple[str, str]],
    ev_type: str,
    num: int | None,
    name: str,
    ev_date: date | None = None,
) -> list[str]:
    """Кандидаты папок, лучшие первыми (дата в названии, более длинное имя)."""
    if num is None:
        return []
    name_l = collapse_ws(name).lower()
    found: list[tuple[str, str]] = []
    for fid, title in entries:
        t = collapse_ws(title).lower()
        hit = False
        if ev_type == "онлайн" and "онлайн" in t:
            m = re.search(r"#\s*(\d+)", t) or re.search(r"онлайн\s+#?\s*(\d+)", t)
            hit = bool(m and int(m.group(1)) == num)
        elif ev_type == "купала" and "купал" in t and str(num) in t:
            hit = True
        elif ev_type == "новогоднее" and (
            "новый год" in t or "новогодн" in t or re.search(r"\bнг\b", t)
        ):
            hit = str(num) in t or str(2000 + num) in t or str(num).zfill(2) in t
        if hit:
            found.append((fid, title))
    if not found:
        for fid, title in entries:
            if collapse_ws(title).lower()[:20] in name_l:
                found.append((fid, title))
                break

    def _score(item: tuple[str, str]) -> tuple:
        _fid, title = item
        return (-int(title_matches_event_date(title, ev_date)), -len(title))

    found.sort(key=_score)
    return [fid for fid, _title in found]


def match_drive_folder(
    entries: list[tuple[str, str]], ev_type: str, num: int | None, name: str
) -> str | None:
    ids = match_drive_folders(entries, ev_type, num, name)
    return ids[0] if ids else None


def pick_day_video(
    files: list[tuple[str, str]], ev_date: date | None = None
) -> tuple[str, str] | None:
    cands: list[tuple[str, str]] = []
    for fid, title in files:
        ext = Path(title).suffix.lower()
        if ext not in VIDEO_EXT:
            continue
        if is_situation_clip(title):
            continue
        cands.append((fid, title))
    if not cands:
        return None
    dated = [x for x in cands if title_matches_event_date(x[1], ev_date)]
    pool = dated or cands

    def _score(item: tuple[str, str]) -> tuple:
        title = item[1]
        t = title.lower()
        gallery = 1 if "галерея" in t else 0
        named = 1 if _DAY_NAME_RE.search(title) else 0
        mp4 = 0 if t.endswith(".mp4") else 1
        return (-gallery, -named, mp4, -len(title))

    pool.sort(key=_score)
    return pool[0]


def list_drive_folder_cached(fid: str) -> list[tuple[str, str]]:
    if fid not in _DRIVE_LIST_CACHE:
        _DRIVE_LIST_CACHE[fid] = list_drive_folder(fid)
    return _DRIVE_LIST_CACHE[fid]


def strip_timecode(url: str) -> str:
    u = url.split("&t=")[0].split("?t=")[0]
    u = re.sub(r"[?&]t=\d+s?", "", u)
    return u


def video_day_key(url: str) -> str | None:
    """Ключ «день записи» из URL сетки: один ролик = один день. Пусто / «нет видео» — None."""
    u = collapse_ws(url or "")
    if not u or u.lower() in ("нет видео", "нет"):
        return None
    if not u.startswith("http"):
        return None
    base = strip_timecode(u)
    m = re.search(r"(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]+)", base, re.I)
    if m:
        return "yt:" + m.group(1)
    m = re.search(r"vk\.com/video(-?\d+_\d+)", base, re.I)
    if m:
        return "vk:" + m.group(1)
    m = re.search(r"rutube\.ru/video/([0-9a-f]+)", base, re.I)
    if m:
        return "rt:" + m.group(1)
    m = re.search(r"drive\.google\.com/file/d/([^/]+)", base, re.I)
    if m:
        return "gd:" + m.group(1)
    return base


# Явный сплит сб/вс: сколько боёв на дату начала. Эвристика «один ролик = один день»
# не видит 1+4 (префикс из одной колонки без видео отбрасывается). Не гадаем по видео.
DUEL_DAY_SPLIT_SAT = {
    "nye_21": 1,  # НГ 2021: пор. 1 → 11.12, пор. 2–5 → 12.12
    "kupala_22": 2,  # Купала 2022: пор. 1–2 → 25.06, пор. 3–6 → 26.06
}


def duel_dates_for_columns(
    ev_type: str,
    columns: list[dict],
    d_start: date | None,
    d_end: date | None,
    slug: str = "",
) -> list[date | None]:
    """Дата каждого поединка. Второй день — только если в сетке отдельный общий ролик (суффикс).

    Не выдумываем воскресенье: один ролик / нет общего суффикса → все бои на дату начала,
    второй день мероприятия в календаре с 0 поединками.
    Префикс короче 2 колонок (одно «нет видео») не считается отдельным днём.
    DUEL_DAY_SPLIT_SAT — точечный override (ярлык → число боёв в субботу).
    """
    n = len(columns)
    if not d_start:
        return [None] * n
    if not d_end or d_end == d_start or ev_type not in ("купала", "новогоднее"):
        return [d_start] * n
    sat_n = DUEL_DAY_SPLIT_SAT.get(slug or "")
    if sat_n is not None and 0 < sat_n < n:
        return [d_start] * sat_n + [d_end] * (n - sat_n)
    keys = [video_day_key(col.get("video") or "") for col in columns]
    split_at = None
    if n >= 4:
        last = keys[-1]
        if last:
            k = 1
            for i in range(n - 2, -1, -1):
                if keys[i] == last:
                    k += 1
                else:
                    break
            prefix = n - k
            if k >= 2 and prefix >= 2:
                split_at = prefix
    if split_at is None:
        return [d_start] * n
    return [d_start] * split_at + [d_end] * (n - split_at)


def has_timecode(url: str) -> bool:
    return bool(re.search(r"[?&]t=", url) or "?t=" in url)


def org_roles_for_event(
    ev_type: str, num: int | None, listed: list[str], arbs: list[str], name: str = ""
) -> list[tuple[str, str]]:
    """(ФИО, роль)."""
    n = collapse_ws(name).lower().replace("ё", "е")
    if "полярн" in n:
        return [(canon_fio(KUZMINA), "планированиеМероприятия")]
    if ev_type == "турнир":
        return []
    if ev_type == "региональный":
        return [
            (canon_fio(SHEVCHUK), "планированиеМероприятия"),
            (canon_fio(SHEVCHUK), "организацияПомещения"),
            (canon_fio(SHEVCHUK), "подготовкаМатериалов"),
        ]

    listed_s = {surname_key(x): x for x in listed}
    have = set(listed_s)

    def has(sur: str) -> str | None:
        return listed_s.get(sur)

    pairs: list[tuple[str, str]] = []

    def add(fio: str, *roles: str) -> None:
        for role in roles:
            pairs.append((fio, role))

    add(ZABOROV, "подведениеИтогов", "обновлениеДанных", "обработкаВидео")

    if ev_type == "онлайн":
        empty_or_early = not listed or (num is not None and num <= 16)
        if empty_or_early or "шевчук" not in have:
            listed_s["шевчук"] = SHEVCHUK
            have.add("шевчук")
        if empty_or_early and "заборов" not in have:
            listed_s["заборов"] = ZABOROV
            have.add("заборов")
        if "окулова" in {surname_key(a) for a in arbs} or "окулова" in have:
            add(listed_s.get("окулова") or OKULOVA, "экспертныйКомментарий")
        kh = has("хуснутдинов")
        if kh:
            add(kh, "работаСНовичками")
        shorin = has("шорин")
        zab = listed_s.get("заборов") or ZABOROV
        if shorin:
            add(shorin, "планированиеМероприятия")
        else:
            add(zab, "планированиеМероприятия")
        add(zab, "показывалЧасы")
        km = has("кузьмина")
        if km:
            add(km, "подготовкаУчастников")
        sh = listed_s.get("шевчук") or SHEVCHUK
        add(sh, "подготовкаУчастников", "настраивалКомнатыZoom", "велЗапись")
    else:
        kh = has("хуснутдинов")
        if kh:
            add(kh, "подготовкаУчастников")
        ok = has("окулова")
        if ok:
            add(ok, "экспертныйКомментарий", "организацияПомещения")
        sh = has("шевчук")
        if sh:
            add(sh, "организацияПомещения", "подготовкаМатериалов")
        for sur in ("рашевский", "кузьмина"):
            p = has(sur)
            if p:
                add(p, "подготовкаУчастников")
        for sur in ("шорин", "заборов"):
            p = has(sur)
            if p:
                add(p, "планированиеМероприятия")
        if "заборов" not in have:
            add(ZABOROV, "планированиеМероприятия")

    seen = set()
    uniq = []
    for fio, role in pairs:
        key = (canon_fio(fio), role)
        if key in seen:
            continue
        seen.add(key)
        uniq.append((canon_fio(fio), role))
    return uniq


def write_json(name: str, data) -> None:
    path = OUT_DIR / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def pull_live_registrations() -> list | None:
    """Живые заявки портала из MySQL. None — не прочитали, файл не трогать."""
    scripts_dir = str(REPO / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    try:
        from load_domain_mysql import export_registrations_from_mysql, load_env
    except Exception as e:
        print(f"  регистрации: нет загрузчика ({e})")
        return None
    try:
        return export_registrations_from_mysql(load_env())
    except Exception as e:
        print(f"  регистрации: MySQL/FTP ({e})")
        return None


def write_registrations(rows: list | None) -> int:
    """Пишет регистрации.json из MySQL. Если не прочитали — не затирает существующий файл."""
    path = OUT_DIR / "регистрации.json"
    if rows is not None:
        write_json("регистрации.json", rows)
        print(f"  регистрации: {len(rows)} из MySQL")
        return len(rows)
    if path.is_file():
        try:
            cur = json.loads(path.read_text(encoding="utf-8"))
            n = len(cur) if isinstance(cur, list) else 0
        except (OSError, json.JSONDecodeError):
            n = 0
        print(f"  регистрации: MySQL не прочитан, файл не трогаем (сейчас {n})")
        return n
    write_json("регистрации.json", [])
    print("  регистрации: нет MySQL и нет файла — записан []")
    return 0


WALL_OVERLAY = OUT_DIR / "стена_календарь.json"


def apply_online_zoom(events: list[dict]) -> list[dict]:
    """Одна комната стрима на все живые онлайны; шаблонные Online 10 2024–2028 без ссылки."""
    skip = set(TEMPLATE_ONLINE10_SLUGS)
    for ev in events:
        slug = ev.get("ярлык") or ""
        if ev.get("тип") == "онлайн" and slug not in skip:
            ev["ссылкаZoom"] = DEFAULT_ONLINE_ZOOM
        else:
            ev["ссылкаZoom"] = None
    return events


def apply_online_times(events: list[dict]) -> list[dict]:
    """Онлайны с датой: 11:00–13:30 Europe/Moscow. Шаблон Online 10 2024–28 без дат — без времени."""
    for ev in events:
        has_date = bool(ev.get("датаНачала"))
        if ev.get("тип") == "онлайн" and has_date:
            if not ev.get("времяНачала"):
                ev["времяНачала"] = DEFAULT_ONLINE_START
            if not ev.get("времяОкончания"):
                ev["времяОкончания"] = DEFAULT_ONLINE_END
        else:
            ev.setdefault("времяНачала", None)
            ev.setdefault("времяОкончания", None)
    return events


def apply_calendar_overlay(events: list[dict], report: dict | None = None) -> list[dict]:
    """Стена календаря переживает пересборку дампа из Google.

    «добавить» — вставить, если ярлыка ещё нет (Google важнее, дубль не создаём).
    «править» — поля поверх записи с тем же ярлыком (шаблон Онлайн 10: даты null).
    """
    if not WALL_OVERLAY.is_file():
        return events
    overlay = json.loads(WALL_OVERLAY.read_text(encoding="utf-8"))
    by_slug = {e["ярлык"]: e for e in events if e.get("ярлык")}
    used_ids = {int(e["id"]) for e in events if e.get("id") is not None}
    max_id = max(used_ids) if used_ids else 0
    added = 0
    patched = 0

    for patch in overlay.get("править") or []:
        slug = patch.get("ярлык")
        rec = by_slug.get(slug)
        if not rec:
            if report is not None:
                report.setdefault("warnings", []).append(f"overlay правка: нет ярлыка {slug}")
            continue
        for k, v in patch.items():
            if k == "ярлык":
                continue
            rec[k] = v
        patched += 1

    for rec in overlay.get("добавить") or []:
        slug = rec.get("ярлык")
        if slug and slug in by_slug:
            continue
        new = dict(rec)
        want = rec.get("id")
        if want is not None and int(want) not in used_ids:
            new["id"] = int(want)
        else:
            max_id += 1
            new["id"] = max_id
        events.append(new)
        if slug:
            by_slug[slug] = new
        used_ids.add(int(new["id"]))
        max_id = max(max_id, int(new["id"]))
        added += 1

    events.sort(key=lambda e: int(e["id"]))
    print(f"  overlay стены: +{added} добавлено, ~{patched} правок ({WALL_OVERLAY.name})")
    return events


def main() -> int:
    env = load_secrets()
    sid = env.get("GOOGLE_SHEETS_SID") or DEFAULT_SID
    balls_dir = Path(env["BALLS_XLSX_DIR"]) if env.get("BALLS_XLSX_DIR") else DEFAULT_BALLS
    report: dict = {"warnings": [], "errors": [], "noStarted": [], "unmappedMeetings": []}

    print("CSV сетка…")
    grid = fetch_csv(sid, GID_GRID)
    print(f"  {len(grid)} строк, ширина {max((len(r) for r in grid), default=0)}")
    print("CSV банк…")
    bank_rows = fetch_csv(sid, GID_BANK)

    people = People()
    situations, by_num = parse_bank(bank_rows, report)
    print(f"  ситуаций: {len(situations)}")

    meetings = parse_grid(grid, people, report)
    print(f"  встреч: {len(meetings)}")
    facts = parse_facts(grid)
    for f in facts:
        if f["человек"]:
            people.add(f["человек"])

    balls = load_balls(balls_dir, people)
    print(f"  баллы ключей: {len(balls)} ({balls_dir if balls_dir.is_dir() else 'нет каталога'})")

    # Бумажный protocols-batch не читаем: OCR врёт, состав уже в Google (ручной перенос).
    for forced in (ZABOROV, SHEVCHUK, OKULOVA, KUZMINA) + LIDER_YOUTUBE_NAMES:
        people.add(forced)
    people_list = people.freeze()

    drive_root: list[tuple[str, str]] = []
    try:
        print("Drive: список папок…")
        drive_root = list_drive_folder(DRIVE_ROOT)
        print(f"  записей: {len(drive_root)}")
    except Exception as e:
        report["warnings"].append(f"Drive корень недоступен: {e}")

    events: list[dict] = []
    duels_out: list[dict] = []
    judges_out: list[dict] = []
    videos_out: list[dict] = []
    orgs_out: list[dict] = []
    unknown_type: list[str] = []
    missing_bank: list[str] = []
    random_slots = {"00": 0, "00Э": 0}
    event_id = 0
    duel_id = 0
    judge_id = 0
    video_id = 0
    org_id = 0
    slugs_used: set[str] = set()

    for meeting in meetings:
        name = meeting["name"]
        ev_type, slug, num = classify_event(name)
        if ev_type is None:
            unknown_type.append(f"{name} ({len(meeting['columns'])} кол.)")
            continue
        event_id += 1
        dates = []
        d0 = parse_date_from_text(name)
        if d0 and ev_type == "купала" and d0.year == 2024 and d0.month == 7 and d0.day in (29, 30):
            d0 = date(2024, 6, d0.day)
        if d0:
            dates.append(d0)
        if not dates and ev_type == "купала" and num in KUPALA_SPAN:
            dates.extend(KUPALA_SPAN[num])
        if not dates and ev_type == "новогоднее" and num in NYE_SPAN:
            dates.extend(NYE_SPAN[num])
        if not dates and ev_type == "турнир" and num in LIDER_DATES:
            dates.append(LIDER_DATES[num])
        if not dates and slug == "polyarny_express":
            dates.append(POLAR_DATE)
        d_start = min(dates) if dates else None
        d_end = max(dates) if dates else None
        col_dates = duel_dates_for_columns(
            ev_type, meeting["columns"], d_start, d_end, slug
        )
        has_votes = any(
            j.get("голос") for col in meeting["columns"] for j in col["judges"]
        )
        if d_start and d_start < TODAY:
            status = "Проведено"
        elif d_start and d_start > TODAY:
            status = "Запланировано"
        else:
            status = "Проведено" if has_votes else "Запланировано"
        if slug and slug in slugs_used:
            slug = f"{slug}_{event_id}"
        if slug:
            slugs_used.add(slug)

        balls_key = f"{ev_type}:{num}" if num is not None else ""
        b = balls.get(balls_key, {"orgs": [], "arbs": []})
        arb_id = people.id_of(b["arbs"][0]) if b.get("arbs") else None

        ev = {
            "id": event_id,
            "ярлык": slug or None,
            "название": name,
            "тип": ev_type,
            "датаНачала": d_start.isoformat() if d_start else None,
            "датаОкончания": d_end.isoformat() if d_end else None,
            "статус": status,
            "арбитрId": arb_id,
            "ссылкаZoom": None,
        }
        events.append(ev)

        folder_ids = (
            match_drive_folders(drive_root, ev_type, num, name, d_start)
            if drive_root
            else []
        )
        day_url = None
        if ev_type in DRIVE_DAY_TYPES and folder_ids:
            try:
                files: list[tuple[str, str]] = []
                for folder_id in folder_ids:
                    files = list_drive_folder_cached(folder_id)
                    if any(Path(t).suffix.lower() in VIDEO_EXT for _i, t in files):
                        break
                picked = pick_day_video(files, d_start)
                if not picked:
                    extra: list[tuple[str, str]] = []
                    for src_id, src_title in files:
                        if Path(src_title).suffix:
                            continue
                        if _SOURCES_DIR_RE.search(src_title):
                            extra.extend(list_drive_folder_cached(src_id))
                    if extra:
                        picked = pick_day_video(extra, d_start)
                if picked:
                    day_url = drive_file_url(picked[0])
                    video_id += 1
                    videos_out.append(
                        {
                            "id": video_id,
                            "мероприятиеId": event_id,
                            "поединокId": None,
                            "ссылка": day_url,
                            "дата": d_start.isoformat() if d_start else None,
                            "название": picked[1],
                            "тип": "ДеньЦеликом",
                        }
                    )
                else:
                    report["warnings"].append(f"{name}: в папке Диска нет видео дня")
            except Exception as e:
                report["warnings"].append(f"{name}: папка Диска {e}")
        elif ev_type in DRIVE_DAY_TYPES:
            report["warnings"].append(f"{name}: нет папки на Диске")

        day_links_offline: dict[str, int] = {}

        for order, col in enumerate(meeting["columns"], 1):
            num_s, sname = col["situationNum"], col["situationName"]
            random = is_random_slot(num_s, sname)
            if random:
                if re.match(r"^00Э$", num_s or "", re.I):
                    random_slots["00Э"] += 1
                    kind = "экспресс"
                else:
                    random_slots["00"] += 1
                    kind = "классика"
                sit_id = None
            else:
                bank = by_num.get(num_s) or by_num.get((num_s or "").upper())
                if not bank and num_s:
                    missing_bank.append(f"{name} #{order} ситуация {num_s}")
                kind = bank["тип"] if bank else "классика"
                sit_id = bank["id"] if bank else None

            p1, s1, p2, s2 = apply_draw(col, report, name, order)
            # YouTube: пор. 1 парный, 2–3 классика, 4–7 экспресс (не «пор. 3 = парный»).
            if ev_type == "турнир":
                if order == 1:
                    kind = "парный"
                elif order <= 3:
                    kind = "классика"
                else:
                    kind = "экспресс"
                p1, s1, p2, s2 = apply_lider_youtube(num, order, p1, s1, p2, s2)
            if (
                ev_type == "купала"
                and d_start == date(2026, 6, 27)
                and order == 1
            ):
                sit105 = sit_105_classic(situations)
                if sit105:
                    kind = "классика"
                    sit_id = sit105["id"]
            if kind == "экспресс":
                s1 = s2 = ""

            duel_id += 1
            p1id, s1id = people.id_of(p1), people.id_of(s1)
            p2id, s2id = people.id_of(p2), people.id_of(s2)

            judge_recs = []
            for j in col["judges"]:
                # Все заполненные слоты сетки (ФИО и/или голос). Экспресс: таймер
                # пишет 5 судей в строки 3–7 — слоты формы, не три коллегии
                # (канон express-only-sending). Классика/парный — коллегия по слоту.
                slot_college = (
                    "отправляющиеНаПереговоры"
                    if kind == "экспресс"
                    else j["коллегия"]
                )
                jid, college, vote_s = resolve_judge_identity(
                    people, j["fio"], slot_college, j["голос"]
                )
                if jid is None and college != COLLEGE_UNKNOWN:
                    continue
                judge_id += 1
                recj = {
                    "id": judge_id,
                    "поединокId": duel_id,
                    "idУчастника": jid,
                    "коллегия": college,
                    "голос": vote_s if vote_s in ("1", "2") else (vote_s or None),
                }
                judges_out.append(recj)
                judge_recs.append(recj)

            col_d = col_dates[order - 1] if order - 1 < len(col_dates) else d_start
            col_iso = col_d.isoformat() if col_d else None
            duels_out.append(
                {
                    "id": duel_id,
                    "мероприятиеId": event_id,
                    "порядок": order,
                    "дата": col_iso,
                    "тип": kind,
                    "режимПодготовки": "случайный" if random else "обычный",
                    "длительностьРаундаМин": minutes_for_type(kind),
                    "ситуацияId": sit_id,
                    "игрок1Id": p1id,
                    "секундантИлиВторойИгрок1Id": s1id,
                    "игрок2Id": p2id,
                    "секундантИлиВторойИгрок2Id": s2id,
                    "количествоСудей": len(judge_recs),
                    "заметки": sname if (ev_type == "турнир" and sit_id is None and sname) else None,
                    "_googleCol": col["col"],
                    "_meeting": name,
                }
            )

            url = collapse_ws(col.get("video") or "")
            if url and url.lower() not in ("нет видео", "нет"):
                if url.startswith("http"):
                    video_id += 1
                    videos_out.append(
                        {
                            "id": video_id,
                            "мероприятиеId": event_id,
                            "поединокId": duel_id,
                            "ссылка": url,
                            "дата": col_iso,
                            "название": None,
                            "тип": "Поединок",
                        }
                    )
                    # Поток (YouTube/VK/Rutube): клип с t= — Поединок;
                    # без таймкода — один ДеньЦеликом на базовый URL.
                    # Drive-клип боя никогда не становится днём (день — с Диска).
                    if ev_type != "онлайн" and not is_drive_url(url):
                        base = strip_timecode(url)
                        if base not in day_links_offline:
                            video_id += 1
                            day_links_offline[base] = video_id
                            videos_out.append(
                                {
                                    "id": video_id,
                                    "мероприятиеId": event_id,
                                    "поединокId": None,
                                    "ссылка": base,
                                    "дата": col_iso,
                                    "название": None,
                                    "тип": "ДеньЦеликом",
                                }
                            )

        extra = {surname_key(x) for x in (b.get("orgs") or [])} - {
            "заборов",
            "шевчук",
            "хуснутдинов",
            "шорин",
            "кузьмина",
            "окулова",
            "рашевский",
        }
        if extra:
            report.setdefault("orgUnknown", set()).update(extra)
        for fio, role in org_roles_for_event(
            ev_type, num, b.get("orgs") or [], b.get("arbs") or [], name
        ):
            pid = people.id_of(fio)
            if not pid:
                report["warnings"].append(f"орг без карточки человека: {fio}")
                continue
            org_id += 1
            orgs_out.append(
                {
                    "id": org_id,
                    "мероприятиеId": event_id,
                    "idУчастника": pid,
                    "роль": role,
                }
            )

    # Overlay data/protocols/*.json не делаем (OCR «Лисовик» и т.п.; истина — сетка Google).

    review_urls: dict[str, str] = {}
    try:
        print("xlsx банк (разборы)…")
        review_urls = parse_bank_review_urls(fetch_xlsx(sid))
        print(f"  разборов: {len(review_urls)}")
    except Exception as e:
        report["warnings"].append(f"xlsx банк разборы: {e}")
    existing_review_dates = load_existing_review_dates()
    n_drive_dates = 0
    for sit in situations:
        url = review_urls.get(sit["код"] or "") or review_urls.get(str(sit.get("номер") or ""))
        if not url:
            continue
        # Колонка J без даты: день загрузки на Drive (createdTime). Нет API — не затираем старое.
        iso = drive_created_day(url)
        if iso:
            n_drive_dates += 1
        else:
            iso = existing_review_dates.get(url)
            if not iso:
                fid = google_file_id(url)
                if fid:
                    iso = existing_review_dates.get("gid:" + fid)
        video_id += 1
        videos_out.append(
            {
                "id": video_id,
                "мероприятиеId": None,
                "поединокId": None,
                "ситуацияId": sit["id"],
                "ссылка": url,
                "дата": iso,
                "название": "Разбор",
                "тип": "Разбор",
            }
        )
    if n_drive_dates:
        print(f"  дат Drive createdTime: {n_drive_dates}")

    judge_id = fill_unknown_votes_from_facts(
        duels_out, events, judges_out, facts, people, judge_id, report
    )

    # strip private keys
    for d in duels_out:
        d.pop("_googleCol", None)
        d.pop("_meeting", None)

    empty = []
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    events = apply_calendar_overlay(events, report)
    events = apply_online_zoom(events)
    events = apply_online_times(events)
    write_json("люди.json", people_list)
    write_json("ситуации.json", situations)
    write_json("мероприятия.json", events)
    write_json("поединки.json", duels_out)
    write_json("судьи.json", judges_out)
    write_json("участияВОрганизации.json", orgs_out)
    n_regs = write_registrations(pull_live_registrations())
    write_json("видео.json", videos_out)
    # Круги не из Google — не затирать ручную разметку.
    for curated in ("круги.json", "членстваВКруге.json"):
        p = OUT_DIR / curated
        if not p.is_file() or p.read_text(encoding="utf-8").strip() in ("", "[]"):
            write_json(curated, empty)
    write_json("наблюдатели.json", empty)
    write_json("событияПротокола.json", empty)
    write_json("журналИзмененияПоединка.json", empty)

    # facts vs dump: count Судил per named event
    facts_by_ev = defaultdict(int)
    for f in facts:
        if f["событие"] == "Судил" and f["мероприятие"]:
            facts_by_ev[f["мероприятие"]] += 1

    lines = [
        "# Отчёт верификации (шаг 2)",
        "",
        f"Сгенерировано: {datetime.now().strftime('%Y-%m-%d %H:%M')}. SID `{sid}`.",
        "",
        "## Счётчики",
        "",
        f"| Класс | N |",
        f"|-------|---|",
        f"| Человек | {len(people_list)} |",
        f"| Ситуация | {len(situations)} |",
        f"| Мероприятие | {len(events)} |",
        f"| Поединок | {len(duels_out)} |",
        f"| Судья | {len(judges_out)} |",
        f"| из них без человека (коллегия неизвестна) | {sum(1 for j in judges_out if j.get('коллегия') == COLLEGE_UNKNOWN)} |",
        f"| УчастиеВОрганизации | {len(orgs_out)} |",
        f"| Видео | {len(videos_out)} |",
        f"| Регистрация | {n_regs} (живая MySQL, не Google) |",
        f"| Круг / членство / наблюдатель / протокол / журнал | 0 |",
        "",
        "## 00 / 00Э",
        "",
        f"- случайный классика (`00`): {random_slots['00']}",
        f"- случайный экспресс (`00Э`): {random_slots['00Э']}",
        "",
        "## Несмапленные встречи (тип не онлайн/купала/НГ/региональный/турнир)",
        "",
    ]
    if unknown_type:
        lines += [f"- {x}" for x in unknown_type]
    else:
        lines.append("_нет_")
    lines += ["", "## Нет «Начинал» (слоты как команда 1)", "", f"{len(report.get('noStarted') or [])} колонок."]
    if report.get("noStarted"):
        lines.append("Примеры: " + "; ".join((report["noStarted"])[:15]))
    lines += ["", "## Голоса из фактов A:F (сетка без голосов)", ""]
    vff = report.get("votesFromFacts") or []
    if vff:
        lines += [f"- {x}" for x in vff]
    else:
        lines.append("_нет_")
    lines += ["", "## Ситуация не в банке", ""]
    if missing_bank:
        lines += [f"- {x}" for x in missing_bank[:40]]
        if len(missing_bank) > 40:
            lines.append(f"- … ещё {len(missing_bank) - 40}")
    else:
        lines.append("_нет_")
    variants = {people.by_canon[k]["ФИО"]: v for k, v in people.variants.items() if len(v) > 1}
    lines += ["", "## Варианты написания ФИО (слиты в одно id)", ""]
    if variants:
        for k in sorted(variants)[:30]:
            lines.append(f"- {k}: {', '.join(sorted(variants[k]))}")
    else:
        lines.append("_нет_")
    lines += ["", "## Предупреждения", ""]
    warns = report.get("warnings") or []
    if warns:
        lines += [f"- {w}" for w in warns[:80]]
        if len(warns) > 80:
            lines.append(f"- … ещё {len(warns) - 80}")
    else:
        lines.append("_нет_")
    extra_org = report.get("orgUnknown") or set()
    lines += ["", "## Орги из Баллов вне правил по ФИО", ""]
    lines.append(", ".join(sorted(extra_org)) if extra_org else "_нет_")
    lines += [
        "",
        "## Эталон фактов A:F",
        "",
        f"Строк фактов: {len(facts)}. Пересчёт очков/рейтинга в этой версии **не** делается (нужен лист «Правила»).",
        "Сверка «Судил» (имя встречи в фактах vs дамп) — вручную по `verify-report`; автомат по именам встреч нестабилен.",
        "",
        "## Дыры v1",
        "",
        "- регистрации: из живой MySQL (портал); Google Forms по-прежнему не читаем;",
        "- «протоколы игр» vs gid состава: выгрузка идёт с gid `1172864695` (полная сетка + факты);",
        "- размер файла на Диске не сравнивался (берётся не-клип, предпочтение .mp4);",
        "- рейтинг «по алфавиту» не пересчитан.",
        "",
    ]
    (OUT_DIR / "verify-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Записано в {OUT_DIR}")
    print(f"люди={len(people_list)} ситуации={len(situations)} мероприятия={len(events)} поединки={len(duels_out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
