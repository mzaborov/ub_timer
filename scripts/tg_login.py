# -*- coding: utf-8 -*-
"""Разовый вход в Telegram и сохранение DPAPI-сессии (для MCP).

Запуск:  .venv-tg/Scripts/python.exe scripts/tg_login.py
Спросит телефон, код из Telegram и облачный пароль (если включён 2FA).
Сессия сохраняется зашифрованной (Windows DPAPI) в ~/.config/kilo/tg/tg.session.
"""
from __future__ import annotations

import asyncio
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tg_common as tg  # noqa: E402

from telethon.errors import SessionPasswordNeededError  # noqa: E402


async def main() -> int:
    client = await tg.connect_best("", interactive=True)
    try:
        if not await client.is_user_authorized():
            phone = input("Телефон (+7...): ").strip()
            await client.send_code_request(phone)
            code = input("Код из Telegram: ").strip()
            try:
                await client.sign_in(phone=phone, code=code)
            except SessionPasswordNeededError:
                pwd = getpass.getpass("Облачный пароль (2FA): ")
                await client.sign_in(password=pwd)
        me = await client.get_me()
        tg.save_session_string(client.session.save())
        print(f"OK. Вход выполнен: {me.first_name or ''} @{me.username or me.id}")
        print(f"Сессия сохранена (DPAPI): {tg.SESSION_FILE}")
    finally:
        await client.disconnect()
        if tg.XRAY_STARTED_BY_US:
            tg.stop_local_socks()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
