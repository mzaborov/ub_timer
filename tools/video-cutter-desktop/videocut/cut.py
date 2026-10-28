from __future__ import annotations

import bisect
import re
import shutil
import subprocess
import tempfile
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
        "-nostdin",
        "-y",
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


def _ffmpeg_base() -> list[str]:
    return ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]


def _copy_fragment(
    source: Path,
    output: Path,
    start: float,
    end: float,
    ffmpeg: str,
    progress: ProgressCallback | None,
) -> None:
    duration = max(0.0, end - start)
    args = [
        "-ss",
        f"{start:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration:.3f}",
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        "-movflags",
        "+faststart",
        str(output),
    ]
    _run_ffmpeg(ffmpeg, args, duration, progress)


def _encode_fragment(
    source: Path,
    output: Path,
    start: float,
    end: float,
    ffmpeg: str,
    crf: int,
    preset: str,
    progress: ProgressCallback | None,
) -> None:
    duration = max(0.0, end - start)
    args = [
        "-ss",
        f"{start:.3f}",
        "-i",
        str(source),
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
        str(output),
    ]
    _run_ffmpeg(ffmpeg, args, duration, progress)


def _smart_cut(
    job: CutJob,
    ffmpeg: str,
    crf: int,
    preset: str,
    keyframes: list[float] | None,
    progress: ProgressCallback | None,
) -> Path:
    duration = max(0.0, job.end - job.start)
    keyframes = keyframes if keyframes is not None else read_index(job.source).keyframes
    pos = bisect.bisect_left(keyframes, job.start - 0.001)
    on_key = pos < len(keyframes) and abs(keyframes[pos] - job.start) <= 0.05
    if on_key:
        _copy_fragment(job.source, job.output, job.start, job.end, ffmpeg, progress)
        return job.output
    next_key = keyframes[pos] if pos < len(keyframes) else None
    if next_key is None or next_key >= job.end - 0.02 or next_key - job.start <= 0.05:
        _encode_fragment(job.source, job.output, job.start, job.end, ffmpeg, crf, preset, progress)
        return job.output

    parts = Path(tempfile.mkdtemp(prefix="ub-cut-", dir=str(job.output.parent)))
    head = parts / "head.ts"
    tail = parts / "tail.ts"
    listing = parts / "list.txt"
    try:
        def head_progress(frac: float, msg: str) -> None:
            if progress:
                progress(frac * 0.3, "умная нарезка: начало")

        def tail_progress(frac: float, msg: str) -> None:
            if progress:
                progress(0.3 + frac * 0.55, "умная нарезка: копия")

        head_args = [
            "-ss",
            f"{job.start:.3f}",
            "-i",
            str(job.source),
            "-t",
            f"{next_key - job.start:.3f}",
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-f",
            "mpegts",
            str(head),
        ]
        _run_ffmpeg(ffmpeg, head_args, next_key - job.start, head_progress)

        tail_args = [
            "-ss",
            f"{next_key:.3f}",
            "-i",
            str(job.source),
            "-t",
            f"{job.end - next_key:.3f}",
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "copy",
            "-c:a",
            "copy",
            "-f",
            "mpegts",
            str(tail),
        ]
        try:
            _run_ffmpeg(ffmpeg, tail_args, job.end - next_key, tail_progress)
        except RuntimeError:
            for index, value in enumerate(tail_args):
                if value == "copy" and index > 0 and tail_args[index - 1] == "-c:a":
                    tail_args[index] = "aac"
                    tail_args[index + 1:index + 1] = ["-b:a", "160k"]
                    break
            _run_ffmpeg(ffmpeg, tail_args, job.end - next_key, tail_progress)

        listing.write_text(
            "file '" + str(head).replace("'", "'\\''") + "'\n"
            "file '" + str(tail).replace("'", "'\\''") + "'\n",
            encoding="utf-8",
        )
        concat_args = [
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(listing),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(job.output),
        ]
        _run_ffmpeg(ffmpeg, concat_args, 1.0, lambda frac, msg: progress(0.85 + frac * 0.15, "сборка") if progress else None)
    finally:
        shutil.rmtree(parts, ignore_errors=True)
    return job.output


def cut_one(
    job: CutJob,
    ffmpeg: str = "ffmpeg",
    crf: int = 20,
    preset: str = "medium",
    copy_streams: bool = False,
    smart: bool = False,
    keyframes: list[float] | None = None,
    progress: ProgressCallback | None = None,
) -> Path:
    duration = max(0.0, job.end - job.start)
    if duration <= 0.05:
        raise ValueError("Пустой фрагмент")
    job.output.parent.mkdir(parents=True, exist_ok=True)
    if smart:
        return _smart_cut(job, ffmpeg, crf, preset, keyframes, progress)
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
    ]
    if copy_streams:
        args += [
            "-c",
            "copy",
            "-avoid_negative_ts",
            "make_zero",
            "-movflags",
            "+faststart",
            str(job.output),
        ]
    else:
        args += [
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
    copy_streams: bool = False,
    smart: bool = False,
    keyframes: list[float] | None = None,
    progress: Callable[[int, int, float, Path], None] | None = None,
) -> list[Path]:
    jobs = list(jobs)
    out: list[Path] = []
    for index, job in enumerate(jobs, 1):
        def on_progress(frac: float, _msg: str, idx=index) -> None:
            if progress:
                progress(idx, len(jobs), frac, job.output)

        cut_one(
            job,
            ffmpeg=ffmpeg,
            crf=crf,
            preset=preset,
            copy_streams=copy_streams,
            smart=smart,
            keyframes=keyframes,
            progress=on_progress,
        )
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
