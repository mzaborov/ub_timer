from __future__ import annotations

import os
from pathlib import Path


_DLL_DIR_HANDLES: list = []


_LIB_CANDIDATES = [
    Path(os.environ.get("APPDATA", "")) / "Subtitle Edit" / "libmpv-2.dll",
    Path(r"C:\Program Files\MPV Player\libmpv-2.dll"),
    Path(__file__).resolve().parent.parent / "libmpv-2.dll",
]


def _configure_libmpv(path: str | Path | None = None) -> Path | None:
    candidates = [Path(path)] if path else []
    env = os.environ.get("UB_MPV_DLL", "").strip()
    if env:
        candidates.append(Path(env))
    candidates.extend(_LIB_CANDIDATES)
    for dll in candidates:
        if dll.is_file():
            os.environ["PATH"] = str(dll.parent) + os.pathsep + os.environ.get("PATH", "")
            _DLL_DIR_HANDLES.append(os.add_dll_directory(str(dll.parent)))
            return dll
    return None


_mpv = None
_MPV_IMPORT_ERROR = ""


def _load_libmpv(path: str | Path | None = None):
    global _mpv, _MPV_IMPORT_ERROR
    if _mpv is not None:
        return _mpv
    _configure_libmpv(path)
    try:
        import mpv as module
    except OSError as exc:
        _MPV_IMPORT_ERROR = str(exc)
        raise MpvError(
            "Не найден libmpv-2.dll. Укажите его в настройках или положите рядом с приложением. "
            + _MPV_IMPORT_ERROR
        ) from exc
    _mpv = module
    return _mpv


class MpvError(RuntimeError):
    pass


class MpvPlayer:
    """Thin wrapper around libmpv (python-mpv) embedded into a Qt window."""

    def __init__(
        self,
        wid: int,
        libmpv_path: str | Path | None = None,
        extra_options: dict | None = None,
    ) -> None:
        module = _load_libmpv(libmpv_path)
        options = {
            "wid": str(int(wid)),
            "vo": "gpu",
            "hwdec": "auto-safe",
            "osc": False,
            "input_default_bindings": False,
            "input_vo_keyboard": False,
            "keep_open": True,
            "cache": True,
            "demuxer_max_bytes": "512MiB",
            "demuxer_readahead_secs": 30,
        }
        if extra_options:
            options.update(extra_options)
        try:
            self._player = module.MPV(**options)
        except Exception as exc:
            raise MpvError(f"libmpv не создал плеер: {exc}") from exc

    def load(self, path: str | Path, timeout: float = 30.0) -> None:
        try:
            self._player.play(str(path))
            self._player.wait_until_playing(timeout=timeout)
            self._player.pause = True
        except Exception as exc:
            raise MpvError(f"libmpv не открыл видео: {exc}") from exc

    def get(self, prop: str, default=None):
        name = prop.replace("-", "_")
        try:
            value = getattr(self._player, name)
        except Exception:
            return default
        return default if value is None else value

    def set(self, prop: str, value) -> None:
        name = prop.replace("-", "_")
        try:
            setattr(self._player, name, value)
        except Exception as exc:
            raise MpvError(f"libmpv: {exc}") from exc

    @property
    def duration(self) -> float:
        return float(self.get("duration", 0.0) or 0.0)

    @property
    def time_pos(self) -> float:
        return float(self.get("time-pos", 0.0) or 0.0)

    @property
    def paused(self) -> bool:
        return bool(self.get("pause", False))

    def play(self) -> None:
        self.set("pause", False)

    def pause(self) -> None:
        self.set("pause", True)

    def toggle_pause(self) -> None:
        self.set("pause", not self.paused)

    def seek(self, seconds: float, keyframes: bool = True) -> None:
        flags = "absolute+keyframes" if keyframes else "absolute+exact"
        try:
            self._player.command("seek", max(0.0, float(seconds)), flags)
        except Exception as exc:
            raise MpvError(f"libmpv seek: {exc}") from exc

    def seek_exact(self, seconds: float) -> None:
        self.seek(seconds, keyframes=False)

    def close(self) -> None:
        try:
            self._player.terminate()
        except Exception:
            pass
