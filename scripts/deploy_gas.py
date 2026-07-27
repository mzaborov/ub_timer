# -*- coding: utf-8 -*-
"""Деплой Google Apps Script из scripts/google-apps-script/ через Apps Script API.

Один раз: OAuth (браузер) + GAS_SCRIPT_ID в secrets.env.
Запуск: python scripts/deploy_gas.py
        python scripts/deploy_gas.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GAS_DIR = REPO_ROOT / "scripts" / "google-apps-script"
DEFAULT_CREDS = GAS_DIR / "gas-oauth-client.json"
DEFAULT_TOKEN = GAS_DIR / ".gas-token.json"
SCOPES = ["https://www.googleapis.com/auth/script.projects"]


def load_secrets_env() -> dict[str, str]:
    path = REPO_ROOT / "secrets.env"
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        env[key.strip()] = val.strip()
    return env


def collect_gas_files(gas_dir: Path) -> list[dict[str, str]]:
    files: list[dict[str, str]] = []
    manifest = gas_dir / "appsscript.json"
    if not manifest.is_file():
        raise FileNotFoundError(f"Нет {manifest}")
    files.append(
        {
            "name": "appsscript",
            "type": "JSON",
            "source": manifest.read_text(encoding="utf-8"),
        }
    )
    for path in sorted(gas_dir.glob("*.gs")):
        files.append(
            {
                "name": path.stem,
                "type": "SERVER_JS",
                "source": path.read_text(encoding="utf-8"),
            }
        )
    if not any(f["type"] == "SERVER_JS" for f in files):
        raise FileNotFoundError(f"Нет *.gs в {gas_dir}")
    return files


def get_credentials(creds_path: Path, token_path: Path):
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError as e:
        raise SystemExit(
            "Установите зависимости: pip install google-api-python-client google-auth-oauthlib"
        ) from e

    creds = None
    if token_path.is_file():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not creds_path.is_file():
                raise SystemExit(
                    f"Нет OAuth-клиента: {creds_path}\n"
                    "Скачайте JSON (Desktop app) из Google Cloud Console → "
                    "положите как gas-oauth-client.json. См. README."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), SCOPES)
            creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json(), encoding="utf-8")
    return creds


def push_files(script_id: str, files: list[dict[str, str]], creds) -> dict:
    from googleapiclient.discovery import build

    service = build("script", "v1", credentials=creds, cache_discovery=False)
    return (
        service.projects()
        .updateContent(scriptId=script_id, body={"files": files})
        .execute()
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Деплой GAS (Apps Script API)")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Только показать файлы, без загрузки",
    )
    args = parser.parse_args()

    env = load_secrets_env()
    script_id = env.get("GAS_SCRIPT_ID", "").strip()
    if not script_id and not args.dry_run:
        print("Задайте GAS_SCRIPT_ID в secrets.env (Apps Script → Настройки → идентификатор).", file=sys.stderr)
        return 1

    creds_path = Path(env.get("GAS_OAUTH_CREDENTIALS", str(DEFAULT_CREDS)))
    if not creds_path.is_absolute():
        creds_path = REPO_ROOT / creds_path
    token_path = DEFAULT_TOKEN

    files = collect_gas_files(GAS_DIR)
    if script_id:
        print(f"Проект: {script_id}")
    else:
        print("Проект: (GAS_SCRIPT_ID не задан)")
    print(f"Файлов: {len(files)}")
    for f in files:
        size = len(f["source"])
        print(f"  - {f['name']} ({f['type']}, {size} симв.)")

    if args.dry_run:
        print("dry-run — загрузка пропущена.")
        return 0

    creds = get_credentials(creds_path, token_path)
    result = push_files(script_id, files, creds)
    uploaded = result.get("files") or files
    print(f"Загружено: {len(uploaded)} файлов. Обновите страницу таблицы.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
