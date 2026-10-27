from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path


APP_DIR = Path(os.environ.get("APPDATA", Path.home())) / "ub-timer-videocut"
CONFIG_PATH = APP_DIR / "config.json"


def default_cache_dir() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or Path.home())
    return base / "ub-timer-videocut" / "cache"


def default_output_dir() -> Path:
    return Path.home() / "Documents" / "ub-timer-cuts"


@dataclass
class AppConfig:
    api_base: str = "https://ciocdo-org-skills.zaborov.ru"
    token: str = ""
    cache_dir: str = field(default_factory=lambda: str(default_cache_dir()))
    output_dir: str = field(default_factory=lambda: str(default_output_dir()))
    mpv_path: str = r"C:\Program Files\MPV Player\mpv.exe"
    libmpv_path: str = ""
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    crf: int = 20
    preset: str = "medium"
    tail_sec: float = 5.0
    gap_sec: float = 2.0
    template: str = "{дата}_{мероприятие}_{номер}_{игрок1}_vs_{игрок2}.mp4"

    @classmethod
    def load(cls) -> "AppConfig":
        cfg = cls()
        if CONFIG_PATH.is_file():
            try:
                raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                for key, value in raw.items():
                    if hasattr(cfg, key):
                        setattr(cfg, key, value)
            except (OSError, ValueError):
                pass
        env_token = os.environ.get("UB_VIDEOCUT_TOKEN", "").strip()
        if env_token:
            cfg.token = env_token
        return cfg

    def save(self) -> None:
        APP_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(
            json.dumps(asdict(self), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def ensure_dirs(self) -> None:
        Path(self.cache_dir).mkdir(parents=True, exist_ok=True)
        Path(self.output_dir).mkdir(parents=True, exist_ok=True)
