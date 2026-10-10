# -*- coding: utf-8 -*-
"""Выгрузить участников (логины @username) трёх чатов стрима — READ-ONLY.

Использует сохранённую DPAPI-сессию (tg_common.load_session_string), без ввода кода.
Ничего не отправляет и не меняет. Поднимает/гасит локальный Xray при необходимости.

Запуск (из корня проекта):
  .venv-tg/Scripts/python.exe scripts/tg_stream_logins.py

Результат: data/tg_stream_logins.csv (chat, chat_id, user_id, username, first_name, last_name, bot, deleted)
"""
from __future__ import annotations

import asyncio
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tg_common as tg  # noqa: E402

from telethon.tl.types import User  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "data" / "tg_stream_logins.csv"

CHATS = [
    ("Управление стримом я-ИТ-ы Поединки", -1001869749673),
    ("я-ИТ-ы. Стрим развития Управленческих навыков", -1001568380062),
    ("я-ИТ-ы. Основной чат Сообщества", -1001358210558),
]

FIELDS = ["chat", "chat_id", "user_id", "username", "first_name", "last_name", "bot", "deleted"]


async def collect(client, title: str, cid: int) -> list[dict]:
    entity = await client.get_entity(cid)
    rows: list[dict] = []
    async for u in client.iter_participants(entity):
        if not isinstance(u, User):
            continue
        rows.append(
            {
                "chat": title,
                "chat_id": cid,
                "user_id": u.id,
                "username": u.username or "",
                "first_name": u.first_name or "",
                "last_name": u.last_name or "",
                "bot": int(bool(u.bot)),
                "deleted": int(bool(u.deleted)),
            }
        )
    return rows


async def run() -> int:
    session = tg.load_session_string()
    if not session:
        print("Нет сохранённой сессии. Сначала: .venv-tg/Scripts/python.exe scripts/tg_login.py", file=sys.stderr)
        return 2
    client = await tg.connect_best(session)
    try:
        if not await client.is_user_authorized():
            print("Сессия не авторизована.", file=sys.stderr)
            return 2
        all_rows: list[dict] = []
        for title, cid in CHATS:
            try:
                rows = await collect(client, title, cid)
                print(f"OK: {title} -> участников: {len(rows)}")
                all_rows.extend(rows)
            except Exception as e:  # noqa: BLE001
                print(f"Ошибка по «{title}» ({cid}): {type(e).__name__}: {e}", file=sys.stderr)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        with open(OUT, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(all_rows)
        uniq = sorted({r["username"] for r in all_rows if r["username"] and not r["bot"]})
        print("Всего строк:", len(all_rows), "| уникальных @username (без ботов):", len(uniq))
        print("Файл:", OUT)
    finally:
        await client.disconnect()
        if tg.XRAY_STARTED_BY_US:
            tg.stop_local_socks()
    return 0


def main() -> int:
    return asyncio.run(run())


if __name__ == "__main__":
    raise SystemExit(main())
