from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import gdrive
from .api import PortalClient
from .config import AppConfig

Progress = Callable[[str, float, str], None]


class UploadError(RuntimeError):
    pass


def day_video_title(event_title: str, source_name: str) -> str:
    match = re.search(r"(?:онлайн\s*#?\s*|#\s*)(\d+)", event_title, re.I)
    return f"Онлайн {match.group(1)}.mp4" if match else Path(source_name).name


def drive_folder_name(event_title: str, event_date: str) -> str:
    match = re.search(r"(?:онлайн\s*#?\s*|#\s*)(\d+)", event_title, re.I)
    number = match.group(1) if match else ""
    if number:
        date = event_date.strip()
        suffix = f" {date}" if date else ""
        return f"Онлайн #{number}{suffix} Управленческие поединки"
    return event_title.strip() or "Онлайн"


@dataclass
class UploadItem:
    path: Path
    kind: str
    duel_id: int = 0
    title: str = ""


@dataclass
class UploadPlan:
    event_id: int
    event_title: str
    folder_name: str
    items: list[UploadItem] = field(default_factory=list)
    portal_url: str = ""
    tg_chat_id: int = 0
    tg_topic_id: int = 0


@dataclass
class UploadResult:
    folder_url: str
    files: list[dict] = field(default_factory=list)
    published: int = 0
    screenshot: str = ""
    telegram_sent: bool = False


def _total_bytes(items: list[UploadItem]) -> int:
    return sum(max(1, item.path.stat().st_size) for item in items)


def _notify(progress: Progress | None, stage: str, frac: float, label: str) -> None:
    if progress:
        progress(stage, max(0.0, min(1.0, frac)), label)


def _screenshot(portal_url: str, out: Path) -> Path:
    script = Path(__file__).resolve().parents[1] / "portal_shot.py"
    if not script.is_file():
        raise UploadError("Не найден portal_shot.py")
    proc = subprocess.run(
        [sys.executable, str(script), portal_url, str(out)],
        cwd=str(script.parent),
        capture_output=True,
        text=True,
        timeout=90,
    )
    if proc.returncode != 0 or not out.is_file():
        detail = (proc.stderr or proc.stdout or "").strip()[-300:]
        raise UploadError(f"Не удалось сделать скриншот портала: {detail}")
    return out


def _send_telegram(cfg: AppConfig, plan: UploadPlan, text: str, photo: Path) -> None:
    script = Path(__file__).resolve().parents[1] / "tg_send.py"
    if not script.is_file():
        raise UploadError("Не найден tg_send.py")
    python = Path(cfg.tg_python)
    if not python.is_file():
        raise UploadError(f"Не найден Python для Telegram: {python}")
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", suffix=".txt", delete=False
    ) as handle:
        handle.write(text)
        text_path = Path(handle.name)
    try:
        args = [
            str(python),
            str(script),
            "--chat",
            str(plan.tg_chat_id),
            "--topic",
            str(plan.tg_topic_id),
            "--text-file",
            str(text_path),
        ]
        if photo.is_file():
            args += ["--photo", str(photo)]
        proc = subprocess.run(
            args,
            cwd=str(script.parent),
            capture_output=True,
            text=True,
            timeout=180,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    finally:
        text_path.unlink(missing_ok=True)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[-400:]
        raise UploadError(f"Telegram не отправил сообщение: {detail}")


def run_upload(cfg: AppConfig, plan: UploadPlan, progress: Progress | None = None) -> UploadResult:
    if not plan.items:
        raise UploadError("Нет файлов для загрузки")
    total = _total_bytes(plan.items)
    done = 0
    _notify(progress, "auth", 0.0, "Проверяю доступ к Google Drive…")
    try:
        svc = gdrive.service(interactive=True)
    except gdrive.GDriveError as exc:
        raise UploadError(str(exc)) from exc
    email = gdrive.account_email(svc)
    if email and "ciocdo.ru" not in email.lower():
        raise UploadError(
            f"Google Drive открыт под {email}, а нужен аккаунт mzaborov@ciocdo.ru"
        )

    _notify(progress, "folder", 0.01, f"Папка: {plan.folder_name}")
    try:
        folder = gdrive.ensure_folder(svc, cfg.gdrive_parent_id, plan.folder_name)
    except gdrive.GDriveError as exc:
        raise UploadError(str(exc)) from exc
    folder_id = str(folder.get("id") or "")
    folder_url = gdrive.folder_link(folder_id)
    files: list[dict] = []

    for index, item in enumerate(plan.items, 1):
        if not item.path.is_file():
            raise UploadError(f"Нет файла: {item.path}")
        size = max(1, item.path.stat().st_size)
        base = done

        def on_file(frac: float, *, _base=base, _size=size, _name=item.path.name, _index=index) -> None:
            _notify(
                progress,
                "upload",
                (_base + _size * frac) / total,
                f"{_index}/{len(plan.items)} {_name}",
            )

        _notify(progress, "upload", done / total, f"{index}/{len(plan.items)} {item.path.name}")
        try:
            info = gdrive.upload_file(svc, folder_id, item.path, on_file)
        except gdrive.GDriveError as exc:
            raise UploadError(f"{item.path.name}: {exc}") from exc
        info["kind"] = item.kind
        info["duel_id"] = item.duel_id
        info["title"] = item.title
        files.append(info)
        done += size

    _notify(progress, "publish", 0.93, "Привязываю ссылки на портале…")
    client = PortalClient(cfg.api_base, cfg.token)
    published = 0
    try:
        for item, info in zip(plan.items, files):
            if item.kind == "day":
                client.publish_day(plan.event_id, str(info["url"]), item.title)
            else:
                client.publish_video(plan.event_id, item.duel_id, str(info["url"]), item.title)
            published += 1
    except Exception as exc:
        raise UploadError(f"Файлы загружены, но портал не принял ссылки: {exc}") from exc
    finally:
        client.close()

    _notify(progress, "screenshot", 0.96, "Делаю скриншот портала…")
    shot = Path(cfg.output_dir) / f"_portal_{plan.event_id}.png"
    try:
        _screenshot(plan.portal_url, shot)
    except UploadError as exc:
        raise UploadError(
            f"Ссылки опубликованы, но скриншот не получился: {exc}\n"
            f"Папка Drive: {folder_url}"
        ) from exc

    text = (
        f"Видео размещены: {plan.event_title}\n\n"
        f"Папка с записью и нарезкой: {folder_url}\n"
        f"Портал: {plan.portal_url}\n\n"
        "🤖 сгенерировано роботом (Kilo)"
    )
    _notify(progress, "telegram", 0.98, "Отправляю сообщение в Telegram…")
    try:
        _send_telegram(cfg, plan, text, shot)
    except UploadError as exc:
        raise UploadError(
            f"Ссылки опубликованы, но Telegram не отправил сообщение: {exc}\n"
            f"Папка Drive: {folder_url}"
        ) from exc
    _notify(progress, "done", 1.0, "Готово")
    return UploadResult(
        folder_url=folder_url,
        files=files,
        published=published,
        screenshot=str(shot),
        telegram_sent=True,
    )
