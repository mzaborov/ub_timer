from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from .mp4index import read_index


@dataclass(frozen=True)
class CutJob:
    source: Path
    output: Path
    start: float
    end: float


ProgressCallback = Callable[[float, str], None]


def sanitize_name(name: str, max_len: int = 180) -> str:
    name = re.sub(r"[\x00-\x1f\x7f]", " ", name)
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    return (name[:max_len].rstrip(" .") or "video") + ("" if name.lower().endswith(".mp4") else ".mp4")


def render_filename(template: str, ctx: dict[str, str]) -> str:
    out = template or "{дата}_{мероприятие}_{номер}_{игрок1}_vs_{игрок2}.mp4"
    for key, value in ctx.items():
        out = out.replace("{" + key + "}", str(value))
    out = re.sub(r"\{[^{}]+\}", "", out)
    return sanitize_name(out)


def _run_ffmpeg(
    ffmpeg: str,
    args: list[str],
    duration: float,
    progress: ProgressCallback | None,
) -> None:
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-progress",
        "pipe:1",
        *args,
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    assert proc.stdout is not None
    try:
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("out_time_us=") and duration > 0:
                try:
                    us = int(line.split("=", 1)[1])
                except ValueError:
                    continue
                if progress:
                    progress(min(1.0, us / 1_000_000 / duration), "кодирование")
            elif line == "progress=end":
                if progress:
                    progress(1.0, "готово")
        proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()
    err = (proc.stderr.read() if proc.stderr else "").strip()
    if proc.returncode != 0:
        raise RuntimeError(err or f"ffmpeg завершился с кодом {proc.returncode}")


def cut_one(
    job: CutJob,
    ffmpeg: str = "ffmpeg",
    crf: int = 20,
    preset: str = "medium",
    progress: ProgressCallback | None = None,
) -> Path:
    duration = max(0.0, job.end - job.start)
    if duration <= 0.05:
        raise ValueError("Пустой фрагмент")
    job.output.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "-y",
        "-ss",
        f"{job.start:.3f}",
        "-i",
        str(job.source),
        "-t",
        f"{duration:.3f}",
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        str(int(crf)),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        str(job.output),
    ]
    _run_ffmpeg(ffmpeg, args, duration, progress)
    return job.output


def cut_many(
    jobs: Iterable[CutJob],
    ffmpeg: str = "ffmpeg",
    crf: int = 20,
    preset: str = "medium",
    progress: Callable[[int, int, float, Path], None] | None = None,
) -> list[Path]:
    jobs = list(jobs)
    out: list[Path] = []
    for index, job in enumerate(jobs, 1):
        def on_progress(frac: float, _msg: str, idx=index) -> None:
            if progress:
                progress(idx, len(jobs), frac, job.output)

        cut_one(job, ffmpeg=ffmpeg, crf=crf, preset=preset, progress=on_progress)
        out.append(job.output)
    return out


def probe_media(path: str | Path, ffprobe: str = "ffprobe") -> dict:
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,avg_frame_rate,codec_name",
        "-show_entries",
        "format=duration,size",
        "-of",
        "json",
        str(path),
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "ffprobe не смог прочитать файл")
    import json

    return json.loads(proc.stdout)


def nearest_keyframe(keyframes: list[float], value: float, direction: int = 0) -> float:
    if not keyframes:
        return max(0.0, value)
    import bisect

    idx = bisect.bisect_left(keyframes, value)
    if direction < 0:
        idx = max(0, idx - 1)
    elif direction > 0:
        idx = min(len(keyframes) - 1, idx)
    else:
        idx = min(len(keyframes) - 1, idx)
        if idx > 0 and abs(keyframes[idx] - value) > abs(value - keyframes[idx - 1]):
            idx -= 1
    return keyframes[idx]


def source_index(path: str | Path):
    return read_index(path)
