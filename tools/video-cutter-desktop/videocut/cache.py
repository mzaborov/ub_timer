from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import requests


Progress = Callable[[int, int], None]


@dataclass(frozen=True)
class CachedVideo:
    path: Path
    url: str
    size: int
    from_cache: bool


def _safe_ext(title: str) -> str:
    ext = Path(title).suffix.lower()
    return ext if ext in {".mp4", ".mov", ".mkv", ".webm", ".m4v"} else ".mp4"


class VideoCache:
    def __init__(self, cache_dir: str | Path, token: str = "") -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.token = token.strip()

    def _paths(self, url: str, title: str) -> tuple[Path, Path, Path]:
        key = hashlib.sha1(url.encode("utf-8")).hexdigest()[:20]
        final = self.cache_dir / (key + _safe_ext(title))
        part = final.with_suffix(final.suffix + ".part")
        meta = final.with_suffix(final.suffix + ".json")
        return final, part, meta

    def ensure(
        self,
        url: str,
        title: str = "",
        progress: Progress | None = None,
    ) -> CachedVideo:
        if not re.match(r"^https?://", url, re.I):
            path = Path(url)
            if not path.is_file():
                raise FileNotFoundError(url)
            return CachedVideo(path, url, path.stat().st_size, True)

        final, part, meta_path = self._paths(url, title)
        meta = {}
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                meta = {}
        if final.is_file() and final.stat().st_size > 0:
            if not meta or int(meta.get("size") or 0) == final.stat().st_size:
                return CachedVideo(final, url, final.stat().st_size, True)

        headers = {"Accept-Encoding": "identity"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        offset = part.stat().st_size if part.is_file() else 0
        if offset:
            headers["Range"] = f"bytes={offset}-"

        try:
            resp = requests.get(url, headers=headers, stream=True, timeout=(15, 120))
        except requests.RequestException as exc:
            raise RuntimeError(f"Не удалось скачать видео: {exc}") from exc

        if resp.status_code == 416 and offset:
            part.replace(final)
            return CachedVideo(final, url, final.stat().st_size, True)
        if resp.status_code not in (200, 206):
            raise RuntimeError(f"Видео не отдаётся: HTTP {resp.status_code}")

        total = 0
        if resp.status_code == 206:
            content_range = resp.headers.get("Content-Range", "")
            match = re.search(r"/(\d+)$", content_range)
            if match:
                total = int(match.group(1))
        else:
            offset = 0
            total = int(resp.headers.get("Content-Length") or 0)

        mode = "ab" if offset else "wb"
        done = offset
        try:
            with open(part, mode) as fh:
                for chunk in resp.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    fh.write(chunk)
                    done += len(chunk)
                    if progress:
                        progress(done, total)
        finally:
            resp.close()

        if total and done != total:
            raise RuntimeError(f"Видео скачано не полностью: {done} из {total} байт")

        os.replace(part, final)
        meta_path.write_text(
            json.dumps(
                {"url": url, "size": final.stat().st_size, "title": title},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return CachedVideo(final, url, final.stat().st_size, False)
