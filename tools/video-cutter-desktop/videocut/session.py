from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import APP_DIR

SESSION_PATH = APP_DIR / "session.json"


def load_session() -> dict[str, Any]:
    if not SESSION_PATH.is_file():
        return {}
    try:
        data = json.loads(SESSION_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_session(data: dict[str, Any]) -> None:
    if not data:
        return
    APP_DIR.mkdir(parents=True, exist_ok=True)
    tmp = SESSION_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(SESSION_PATH)
