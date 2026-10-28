from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path


class MpvError(RuntimeError):
    pass


def _dbg(message: str) -> None:
    if os.environ.get("UB_MPV_DEBUG"):
        print("MPVDBG " + message, flush=True)


def _find_mpv(explicit: str | Path | None = None) -> Path:
    candidates: list[Path] = []
    if explicit:
        p = Path(explicit)
        candidates.append(p)
        if p.suffix.lower() != ".exe":
            candidates.append(p.with_name("mpv.exe"))
    env = os.environ.get("UB_MPV_EXE", "").strip()
    if env:
        candidates.append(Path(env))
    which = shutil.which("mpv")
    if which:
        candidates.append(Path(which))
    candidates.extend(
        [
            Path(r"C:\Program Files\MPV Player\mpv.exe"),
            Path(r"C:\Program Files\mpv\mpv.exe"),
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "mpv" / "mpv.exe",
        ]
    )
    for path in candidates:
        if path and path.is_file():
            return path
    raise MpvError("mpv.exe не найден. Укажите путь в настройках или UB_MPV_EXE")


class MpvPlayer:
    """mpv.exe as a separate process, embedded with --wid and controlled via JSON IPC."""

    _counter = 0

    def __init__(
        self,
        wid: int,
        libmpv_path: str | Path | None = None,
        extra_options: dict | None = None,
    ) -> None:
        self._exe = _find_mpv(libmpv_path)
        MpvPlayer._counter += 1
        self._pipe = rf"\\.\pipe\ub-timer-mpv-{os.getpid()}-{MpvPlayer._counter}"
        args = [
            str(self._exe),
            f"--wid={int(wid)}",
            "--idle=yes",
            "--pause=yes",
            "--mute=yes",
            "--osc=no",
            f"--input-ipc-server={self._pipe}",
        ]
        if extra_options:
            for key, value in extra_options.items():
                args.append(f"--{key.replace('_', '-')}={value}")
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self._proc = subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=flags,
        )
        self._conn = None
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            if self._proc.poll() is not None:
                raise MpvError(f"mpv завершился с кодом {self._proc.returncode}")
            try:
                self._conn = open(self._pipe, "r+b")
                break
            except OSError:
                time.sleep(0.05)
        if self._conn is None:
            self._proc.terminate()
            raise MpvError("mpv не создал IPC-канал")
        self._next_id = 0
        self._stop = False

    def _request(self, command: list, timeout: float = 8.0):
        self._next_id += 1
        rid = self._next_id
        payload = json.dumps({"command": command, "request_id": rid}).encode("utf-8") + b"\n"
        _dbg(f"send {rid} {command}")
        try:
            self._conn.write(payload)
            self._conn.flush()
        except Exception as exc:
            raise MpvError(f"mpv IPC: {exc}") from exc
        while True:
            line = self._conn.readline()
            if not line:
                raise MpvError("mpv закрыл IPC-канал")
            _dbg("recv " + line.decode("utf-8", "replace").strip())
            try:
                msg = json.loads(line.decode("utf-8", "replace"))
            except ValueError:
                continue
            if msg.get("request_id") != rid:
                continue
            if msg.get("error") not in (None, "success"):
                raise MpvError(f"mpv: {msg.get('error')}")
            return msg.get("data")

    def load(self, path: str | Path, timeout: float = 30.0) -> None:
        self._request(["set_property", "mute", True])
        self._request(["loadfile", str(path), "replace"], timeout=timeout)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                if float(self._request(["get_property", "duration"], timeout=2.0) or 0) > 0:
                    break
            except MpvError:
                pass
            time.sleep(0.05)
        self._request(["set_property", "pause", True])
        self._request(["set_property", "mute", True])

    def get(self, prop: str, default=None):
        try:
            value = self._request(["get_property", prop], timeout=2.0)
        except MpvError:
            return default
        return default if value is None else value

    def set(self, prop: str, value) -> None:
        self._request(["set_property", prop, value])

    @property
    def duration(self) -> float:
        try:
            return float(self.get("duration", 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0

    @property
    def time_pos(self) -> float:
        try:
            return float(self.get("time-pos", 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0

    @property
    def paused(self) -> bool:
        return bool(self.get("pause", True))

    def play(self) -> None:
        self.set("mute", False)
        self.set("pause", False)

    def pause(self) -> None:
        self.set("pause", True)
        self.set("mute", True)

    def toggle_pause(self) -> None:
        if self.paused:
            self.play()
        else:
            self.pause()

    def seek(self, seconds: float, keyframes: bool = True) -> None:
        flags = "absolute+keyframes" if keyframes else "absolute+exact"
        self._request(["seek", max(0.0, float(seconds)), flags])

    def seek_exact(self, seconds: float) -> None:
        self.seek(seconds, keyframes=False)

    def close(self) -> None:
        self._stop = True
        try:
            if self._conn is not None:
                self._conn.close()
        except Exception:
            pass
        self._conn = None
        if getattr(self, "_proc", None) is not None and self._proc.poll() is None:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=2)
            except Exception:
                try:
                    self._proc.kill()
                except Exception:
                    pass
        self._proc = None

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass
