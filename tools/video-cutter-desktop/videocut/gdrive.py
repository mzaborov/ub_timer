from __future__ import annotations

import json
import mimetypes
from pathlib import Path
from typing import Callable

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

from .config import APP_DIR
from .secure import dpapi_decrypt, dpapi_encrypt

SCOPES = ["https://www.googleapis.com/auth/drive"]
TOKEN_PATH = APP_DIR / "google-token.bin"
CLIENT_SECRET_CANDIDATES = (
    "client_secret_766426364678-pjf2d5gi6a1n1uidsu15imm5si3i55nc.apps.googleusercontent.com.json",
)
FOLDER_MIME = "application/vnd.google-apps.folder"
Progress = Callable[[float], None]


class GDriveError(RuntimeError):
    pass


class GDriveAuthRequired(GDriveError):
    pass


def _client_secret_path() -> Path:
    root = Path(__file__).resolve().parents[3]
    for name in CLIENT_SECRET_CANDIDATES:
        path = root / name
        if path.is_file():
            return path
    raise GDriveError("Не найден client_secret Google OAuth в корне проекта")


def save_credentials(creds: Credentials) -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.write_bytes(dpapi_encrypt(creds.to_json().encode("utf-8")))


def _load() -> Credentials | None:
    if not TOKEN_PATH.is_file():
        return None
    try:
        raw = dpapi_decrypt(TOKEN_PATH.read_bytes()).decode("utf-8")
        info = json.loads(raw)
        return Credentials.from_authorized_user_info(info, SCOPES)
    except (OSError, ValueError):
        return None


def authorize() -> Credentials:
    flow = InstalledAppFlow.from_client_secrets_file(
        str(_client_secret_path()),
        SCOPES,
    )
    creds = flow.run_local_server(
        port=0,
        open_browser=True,
        authorization_prompt_message="Откройте браузер и разрешите доступ к Google Drive.",
        success_message="Доступ к Google Drive получен. Окно можно закрыть.",
    )
    save_credentials(creds)
    return creds


def credentials(interactive: bool = True) -> Credentials:
    creds = _load()
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            save_credentials(creds)
        except RefreshError as exc:
            creds = None
            if not interactive:
                raise GDriveAuthRequired("Нужно заново разрешить доступ к Google Drive") from exc
    if creds and creds.valid:
        return creds
    if not interactive:
        raise GDriveAuthRequired("Нужно разрешить доступ к Google Drive")
    return authorize()


def service(interactive: bool = True):
    return build("drive", "v3", credentials=credentials(interactive), cache_discovery=False)


def account_email(svc) -> str:
    try:
        about = svc.about().get(fields="user(emailAddress,displayName)").execute()
        return str((about.get("user") or {}).get("emailAddress") or "")
    except HttpError:
        return ""


def _esc(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _list_children(svc, parent_id: str, name: str, folders_only: bool = False) -> list[dict]:
    q = f"name = '{_esc(name)}' and '{_esc(parent_id)}' in parents and trashed = false"
    if folders_only:
        q += f" and mimeType = '{FOLDER_MIME}'"
    result = (
        svc.files()
        .list(
            q=q,
            fields="files(id,name,mimeType,size,webViewLink)",
            pageSize=20,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            corpora="allDrives",
        )
        .execute()
    )
    return list(result.get("files") or [])


def ensure_folder(svc, parent_id: str, name: str) -> dict:
    found = _list_children(svc, parent_id, name, folders_only=True)
    if found:
        return found[0]
    body = {"name": name, "mimeType": FOLDER_MIME, "parents": [parent_id]}
    return (
        svc.files()
        .create(
            body=body,
            fields="id,name,webViewLink",
            supportsAllDrives=True,
        )
        .execute()
    )


def folder_link(folder_id: str) -> str:
    return f"https://drive.google.com/drive/folders/{folder_id}"


def _upload_media(path: Path, progress: Progress | None):
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return MediaFileUpload(str(path), mimetype=mime, resumable=True, chunksize=8 * 1024 * 1024)


def _share(svc, file_id: str) -> None:
    try:
        svc.permissions().create(
            fileId=file_id,
            body={"type": "anyone", "role": "reader"},
            fields="id",
            supportsAllDrives=True,
        ).execute()
    except HttpError as exc:
        if getattr(exc.resp, "status", 0) == 409:
            return
        raise GDriveError(
            "Файл загружен, но не удалось открыть доступ по ссылке. "
            "Проверьте права администратора Google Workspace."
        ) from exc


def upload_file(svc, folder_id: str, path: Path, progress: Progress | None = None) -> dict:
    if not path.is_file():
        raise GDriveError(f"Нет файла: {path}")
    media = _upload_media(path, progress)
    existing = _list_children(svc, folder_id, path.name)
    if existing:
        file_id = str(existing[0]["id"])
        request = svc.files().update(
            fileId=file_id,
            body={"name": path.name},
            media_body=media,
            fields="id,name,size,webViewLink",
            supportsAllDrives=True,
        )
    else:
        request = svc.files().create(
            body={"name": path.name, "parents": [folder_id]},
            media_body=media,
            fields="id,name,size,webViewLink",
            supportsAllDrives=True,
        )
    response = None
    while response is None:
        status, response = request.next_chunk()
        if status and progress:
            progress(min(1.0, status.resumable_progress / max(1, path.stat().st_size)))
    if progress:
        progress(1.0)
    file_id = str(response.get("id") or "")
    if not file_id:
        raise GDriveError(f"Google Drive не вернул id для {path.name}")
    _share(svc, file_id)
    link = str(response.get("webViewLink") or "")
    if not link:
        link = f"https://drive.google.com/file/d/{file_id}/view"
    return {
        "id": file_id,
        "name": path.name,
        "size": int(response.get("size") or path.stat().st_size),
        "url": link,
    }
