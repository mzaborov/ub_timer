# -*- coding: utf-8 -*-
"""MCP-сервер: ЧТЕНИЕ Telegram (MTProto) и подготовка данных для сводок. Только чтение.

Инструменты:
  tg_status()                              — статус (прокси, сессия, аккаунт);
  tg_folders()                             — папки чатов;
  tg_dialogs(limit, folder, unread_only)   — список чатов;
  tg_pending(days, folder, limit)          — чаты, где последнее слово за собеседником;
  tg_read(chat, limit, sender)             — прочитать сообщения чата (для сводки).

Секретов не содержит: сессия — DPAPI, ключи/прокси — из tg_api.env / tg_proxies.txt.
"""
from __future__ import annotations

import asyncio
import atexit
import datetime as dt
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tg_common as tg  # noqa: E402

from mcp.server.fastmcp import FastMCP  # noqa: E402
from telethon import functions  # noqa: E402

mcp = FastMCP("telegram")
_client = None
_lock = asyncio.Lock()

# Гасим Xray по простою (сек). Крутится, пока MCP жив.
IDLE_SECONDS = int(os.environ.get("TG_XRAY_IDLE", "300"))
_last_used = 0.0
_watchdog_started = False


def _touch() -> None:
    global _last_used, _watchdog_started
    _last_used = time.monotonic()
    if not _watchdog_started:
        _watchdog_started = True
        asyncio.get_event_loop().create_task(_watchdog())


async def _watchdog() -> None:
    while True:
        await asyncio.sleep(30)
        if _last_used and (time.monotonic() - _last_used) > IDLE_SECONDS:
            if tg.stop_local_socks():
                pass
            _last_used = 0.0


def _stop_on_exit() -> None:
    try:
        tg.stop_local_socks()
    except Exception:
        pass


atexit.register(_stop_on_exit)


async def _client_or_raise():
    global _client
    async with _lock:
        if _client is None:
            if not tg.has_session():
                raise RuntimeError("Нет сессии Telegram. Запустите: scripts/tg_login.py")
            _client = await tg.connect_best(tg.load_session_string() or "")
        _touch()
        return _client


def _peer_id(p) -> int | None:
    for attr in ("user_id", "chat_id", "channel_id"):
        v = getattr(p, attr, None)
        if v:
            return int(v)
    return None


def _folder_list(filters) -> list[dict]:
    out: list[dict] = []
    for f in filters:
        title = getattr(f, "title", None)
        title = getattr(title, "text", None) or str(title or "")
        peers = [_peer_id(p) for p in (getattr(f, "include_peers", None) or [])]
        out.append(
            {
                "id": int(getattr(f, "id", 0) or 0),
                "title": title,
                "peers": [x for x in peers if x],
            }
        )
    return out


async def _resolve(client, chat: str):
    ref: object = chat.strip()
    if isinstance(ref, str) and ref.lstrip("-").isdigit():
        ref = int(ref)
    return await client.get_entity(ref)


def _allow_send() -> bool:
    env = tg.load_env_file(tg.ENV_FILE)
    val = (env.get("TG_ALLOW_SEND") or os.environ.get("TG_ALLOW_SEND") or "").strip().lower()
    return val in ("1", "true", "yes", "on")


@mcp.tool()
async def tg_status() -> dict:
    """Статус: сколько прокси, есть ли сессия, авторизован ли вход, кто аккаунт."""
    info = {
        "proxies": len(tg.load_proxies()),
        "session_file": str(tg.SESSION_FILE),
        "session_present": tg.has_session(),
    }
    try:
        client = await _client_or_raise()
        me = await client.get_me()
        info.update({"authorized": True, "user_id": me.id, "name": me.first_name or "", "username": me.username or ""})
    except Exception as e:  # noqa: BLE001
        info.update({"authorized": False, "error": str(e)})
    return info


@mcp.tool()
async def tg_folders() -> list[dict]:
    """Список папок чатов (id, название, участники-пееры)."""
    client = await _client_or_raise()
    res = await client(functions.messages.GetDialogFiltersRequest())
    return _folder_list(res.filters)


@mcp.tool()
async def tg_dialogs(limit: int = 50, folder: str = "", unread_only: bool = False) -> list[dict]:
    """Список чатов: id, название, непрочитанные, дата и кто последний написал."""
    client = await _client_or_raise()
    folder_ids: set[int] | None = None
    if folder:
        res = await client(functions.messages.GetDialogFiltersRequest())
        for f in _folder_list(res.filters):
            if folder.lower() in f["title"].lower():
                folder_ids = set(f["peers"])
                break
        if folder_ids is None:
            folder_ids = set()
    items: list[dict] = []
    async for d in client.iter_dialogs():
        eid = getattr(d.entity, "id", None)
        if folder_ids is not None and eid not in folder_ids:
            continue
        if unread_only and not d.unread_count:
            continue
        msg = d.message
        items.append(
            {
                "id": d.id,
                "title": d.title,
                "unread": d.unread_count,
                "last_date": msg.date.strftime("%Y-%m-%d %H:%M") if msg else "",
                "last_out": bool(msg.out) if msg else None,
                "last_text": (msg.message or "")[:200] if msg else "",
            }
        )
        if len(items) >= limit:
            break
    return items


@mcp.tool()
async def tg_pending(days: int = 7, folder: str = "", limit: int = 100) -> list[dict]:
    """Чаты, где последнее сообщение — от собеседника (мяч на нашей стороне) за N дней."""
    client = await _client_or_raise()
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    folder_ids: set[int] | None = None
    if folder:
        res = await client(functions.messages.GetDialogFiltersRequest())
        for f in _folder_list(res.filters):
            if folder.lower() in f["title"].lower():
                folder_ids = set(f["peers"])
                break
        if folder_ids is None:
            folder_ids = set()
    items: list[dict] = []
    async for d in client.iter_dialogs():
        eid = getattr(d.entity, "id", None)
        if folder_ids is not None and eid not in folder_ids:
            continue
        msg = d.message
        if not msg or msg.out or msg.date < since:
            continue
        items.append(
            {
                "id": d.id,
                "title": d.title,
                "date": msg.date.strftime("%Y-%m-%d %H:%M"),
                "text": (msg.message or "")[:300],
            }
        )
        if len(items) >= limit:
            break
    return items


@mcp.tool()
async def tg_read(chat: str, limit: int = 50, only_incoming: bool = False) -> list[dict]:
    """Прочитать сообщения чата (chat: @username, ссылка или числовой id из tg_dialogs)."""
    client = await _client_or_raise()
    entity = await _resolve(client, chat)
    out: list[dict] = []
    msgs = [m async for m in client.iter_messages(entity, limit=limit)]
    for m in reversed(msgs):
        if only_incoming and m.out:
            continue
        sender = ""
        try:
            s = await m.get_sender()
            if s is not None:
                sender = getattr(s, "first_name", None) or getattr(s, "title", None) or ""
        except Exception:
            pass
        out.append(
            {
                "date": m.date.strftime("%Y-%m-%d %H:%M"),
                "sender": sender,
                "out": bool(m.out),
                "text": (m.message or "").strip(),
            }
        )
    return out


@mcp.tool()
async def tg_send(chat: str, text: str, confirm: bool = False) -> dict:
    """Отправить сообщение в чат от вашего имени.

    БЕЗОПАСНОСТЬ: по умолчанию ничего не отправляет, а возвращает черновик (confirm=False).
    Реальная отправка — только при confirm=True И включённом флаге TG_ALLOW_SEND=1 в tg_api.env.
    Правило: сначала покажите текст пользователю и отправляйте только после его явного одобрения.
    """
    if not confirm:
        return {
            "draft": True,
            "to": chat,
            "text": text,
            "note": "Черновик. Для отправки: confirm=True и TG_ALLOW_SEND=1 в tg_api.env.",
        }
    if not _allow_send():
        return {"sent": False, "error": "Отправка выключена. Установите TG_ALLOW_SEND=1 в tg_api.env."}
    client = await _client_or_raise()
    entity = await _resolve(client, chat)
    msg = await client.send_message(entity, text)
    return {"sent": True, "chat": chat, "message_id": msg.id, "date": msg.date.strftime("%Y-%m-%d %H:%M")}


@mcp.tool()
async def tg_mark_read(chat: str) -> dict:
    """Пометить чат прочитанным (входящие). Также требует TG_ALLOW_SEND=1 (это действие, а не чтение)."""
    if not _allow_send():
        return {"ok": False, "error": "Действие выключено. Установите TG_ALLOW_SEND=1 в tg_api.env."}
    client = await _client_or_raise()
    entity = await _resolve(client, chat)
    await client.send_read_acknowledge(entity)
    return {"ok": True, "chat": chat}


if __name__ == "__main__":
    mcp.run()