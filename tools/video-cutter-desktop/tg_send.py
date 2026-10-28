from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

TOOLS_DIR = Path(r"C:\Projects\.kilo\tools\telegram-mcp")
sys.path.insert(0, str(TOOLS_DIR))

import tg_common as tg  # noqa: E402


async def run(chat_id: int, topic_id: int, text: str, photo: str) -> None:
    session = tg.load_session_string()
    if not session:
        raise SystemExit("Нет сохранённой сессии Telegram")
    client = await tg.connect_best(session, interactive=False)
    try:
        entity = await client.get_entity(chat_id)
        reply_to = topic_id if topic_id > 0 else None
        await client.send_message(entity, text, reply_to=reply_to, link_preview=True)
        if photo:
            path = Path(photo)
            if path.is_file():
                await client.send_file(entity, str(path), reply_to=reply_to)
                print(f"PHOTO: {path.name}")
        print("OK")
    finally:
        await client.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chat", type=int, required=True)
    parser.add_argument("--topic", type=int, default=0)
    parser.add_argument("--text-file", required=True)
    parser.add_argument("--photo", default="")
    args = parser.parse_args()
    text = Path(args.text_file).read_text(encoding="utf-8")
    asyncio.run(run(args.chat, args.topic, text, args.photo))


if __name__ == "__main__":
    main()
