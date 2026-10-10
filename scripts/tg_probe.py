# -*- coding: utf-8 -*-
"""Проверка: проходит ли подключение через каждый прокси из tg_proxies.txt (без входа)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tg_common as tg  # noqa: E402


async def main() -> int:
    status, started = tg.ensure_local_socks()
    print("ensure:", status)
    proxies = list(tg.load_proxies()) or [None]
    print(f"Прокси в списке: {len(tg.load_proxies())}")
    for i, pr in enumerate(proxies):
        label = f"{pr['type']} {pr['host']}:{pr['port']}" if pr else "direct (без прокси)"
        client = tg.build_client("", pr)
        try:
            await client.connect()
            ok = await client.is_user_authorized()
            print(f"[{i}] {label}: connect OK (authorized={ok})")
        except Exception as e:  # noqa: BLE001
            print(f"[{i}] {label}: FAIL {type(e).__name__}: {e}")
        finally:
            try:
                await client.disconnect()
            except Exception:
                pass
    if tg.XRAY_STARTED_BY_US:
        print("stop Xray:", tg.stop_local_socks())
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
