# -*- coding: utf-8 -*-
"""Выгрузить участников Telegram-чатов (где вы админ) — READ-ONLY, сессия только в памяти.

Безопасность (вариант A):
  - файл сессии НЕ создаётся: используется StringSession в оперативной памяти;
    после выхода ничего на диске не остаётся (кроме выходного CSV);
  - api_id / api_hash берутся из переменных окружения TG_API_ID / TG_API_HASH
    (или вводятся вручную) и никуда не сохраняются, в вывод не печатаются;
  - скрипт ничего не отправляет и не меняет: только читает список участников;
  - вход каждый раз: телефон + код из Telegram (+ облачный пароль, если 2FA).

Запуск (из папки проекта, интерпретатор venv MCP):
  C:/Projects/.kilo/tools/telegram-mcp/.venv/Scripts/python.exe scripts/tg_participants.py https://t.me/+InviteLink @another_chat

Переменные окружения (по желанию, чтобы не вводить api_id/api_hash руками):
  $env:TG_API_ID = '1234567'; $env:TG_API_HASH = 'abcdef0123456789abcdef0123456789'

Результат: data/tg_participants.csv (chat, user_id, username, first_name, last_name, phone, bot, deleted)
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import getpass
import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parents[2] / ".kilo" / "tools" / "telegram-mcp"
sys.path.insert(0, str(TOOLS_DIR))
import tg_common as tg  # noqa: E402

from telethon import functions  # noqa: E402
from telethon.errors import SessionPasswordNeededError  # noqa: E402
from telethon.tl.types import User  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
DEFAULT_OUT = REPO / "data" / "tg_participants.csv"


async def resolve_entity(client, ref: str):
    ref = ref.strip()
    try:
        return await client.get_entity(ref)
    except Exception:
        pass
    if "t.me/+" in ref or "joinchat" in ref:
        invite = ref.split("/")[-1].lstrip("+")
        res = await client(functions.messages.CheckChatInviteRequest(hash=invite))
        chat = getattr(res, "chat", None)
        if chat is not None:
            return chat
    raise SystemExit(f"Не удалось открыть чат: {ref}. Убедитесь, что вы в нём и он корректен.")


async def collect(client, ref: str) -> list[dict]:
    entity = await resolve_entity(client, ref)
    title = getattr(entity, "title", None) or getattr(entity, "username", None) or str(ref)
    rows: list[dict] = []
    async for u in client.iter_participants(entity):
        if not isinstance(u, User):
            continue
        rows.append(
            {
                "chat": title,
                "user_id": u.id,
                "username": u.username or "",
                "first_name": u.first_name or "",
                "last_name": u.last_name or "",
                "phone": u.phone or "",
                "bot": int(bool(u.bot)),
                "deleted": int(bool(u.deleted)),
            }
        )
    return rows


async def run(refs: list[str], out_path: Path) -> int:
    client = await tg.connect_best("", interactive=True)  # сессия только в памяти, через прокси
    if not await client.is_user_authorized():
        phone = input("Телефон (в формате +7...): ").strip()
        try:
            await client.send_code_request(phone)
            code = input("Код из Telegram: ").strip()
            try:
                await client.sign_in(phone=phone, code=code)
            except SessionPasswordNeededError:
                pwd = getpass.getpass("Облачный пароль (2FA, ввод скрыт): ")
                await client.sign_in(password=pwd)
        except Exception as e:
            print("Ошибка входа:", type(e).__name__, file=sys.stderr)
            raise

    all_rows: list[dict] = []
    for ref in refs:
        try:
            rows = await collect(client, ref)
            print(f"OK: {ref} -> участников: {len(rows)}")
            all_rows.extend(rows)
        except SystemExit as e:
            print(str(e), file=sys.stderr)
        except Exception as e:
            print(f"Ошибка по {ref}: {type(e).__name__}: {e}", file=sys.stderr)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["chat", "user_id", "username", "first_name", "last_name", "phone", "bot", "deleted"],
        )
        w.writeheader()
        w.writerows(all_rows)
    print(f"Сохранено: {out_path} (строк: {len(all_rows)})")

    await client.disconnect()
    # сессия не сохранялась (StringSession в памяти) — на диске ничего не осталось
    print("Сессия не сохранена. Рекомендую завершить вход в Telegram → Настройки → Устройства.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Список участников Telegram-чатов (read-only, сессия в памяти)")
    ap.add_argument("chats", nargs="+", help="Ссылки/юзернеймы чатов (t.me/..., @name)")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="Путь к CSV (по умолчанию data/tg_participants.csv)")
    args = ap.parse_args()
    return asyncio.run(run(args.chats, Path(args.out)))


if __name__ == "__main__":
    raise SystemExit(main())
