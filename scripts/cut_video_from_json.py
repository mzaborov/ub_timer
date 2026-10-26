#!/usr/bin/env python3
"""Нарезка видео по JSON, экспортированному из формы «Нарезка видео».

Пример:
    python scripts/cut_video_from_json.py videocut-55.json "C:\\...\\video.mp4"
    python scripts/cut_video_from_json.py videocut-55.json video.mp4 -o cuts --dry-run

Скрипт использует ffmpeg из PATH. По умолчанию существующие файлы не перезаписываются.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or not isinstance(data.get("fragments"), list):
        raise ValueError("В JSON нет массива fragments")
    return data


def safe_name(name, fallback):
    name = os.path.basename(str(name or "")).strip()
    if not name:
        name = fallback
    if not name.lower().endswith(".mp4"):
        name += ".mp4"
    return name


def cut_one(src, dst, start, duration, crf, preset, copy_mode, dry_run, overwrite):
    if dst.exists() and not overwrite:
        print(f"  пропуск (уже есть): {dst.name}")
        return True
    if copy_mode:
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-ss", f"{start:.3f}",
            "-i", str(src),
            "-t", f"{max(0.001, duration):.3f}",
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            "-y" if overwrite else "-n",
            str(dst),
        ]
    else:
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-ss", f"{start:.3f}",
            "-i", str(src),
            "-t", f"{max(0.001, duration):.3f}",
            "-c:v", "libx264",
            "-preset", str(preset),
            "-crf", str(crf),
            "-c:a", "copy",
            "-movflags", "+faststart",
            "-y" if overwrite else "-n",
            str(dst),
        ]
    if dry_run:
        print("  " + " ".join(cmd))
        return True

    print(f"  {dst.name}: {start:.3f} + {duration:.3f} с")
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode == 0:
        return True

    # Некоторые записи не позволяют скопировать аудио — повторяем с AAC.
    if "-c:a" in cmd:
        cmd2 = list(cmd)
        idx = cmd2.index("copy", cmd2.index("-c:a"))
        cmd2[idx] = "aac"
        cmd2[cmd2.index("-c:a") + 1:cmd2.index("-c:a") + 2] = ["aac", "-b:a", "160k"]
        print("  аудио не копируется, повтор с AAC…")
        res2 = subprocess.run(cmd2, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if res2.returncode == 0:
            return True
        res = res2

    eprint(f"  ОШИБКА: {dst.name}")
    err = (res.stderr or res.stdout or "").strip()
    if err:
        eprint("  " + err[-2000:])
    return False


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Нарезать видео по JSON из формы нарезки")
    ap.add_argument("json", help="файл videocut-<id>.json")
    ap.add_argument("source", help="исходная запись (mp4/mov/mkv)")
    ap.add_argument("-o", "--out", default="", help="папка для фрагментов (по умолчанию cuts рядом с JSON)")
    ap.add_argument("--overwrite", action="store_true", help="перезаписывать существующие файлы")
    ap.add_argument("--dry-run", action="store_true", help="только показать команды ffmpeg")
    ap.add_argument("--preset", default="", help="переопределить preset (например, veryfast)")
    ap.add_argument("--crf", type=int, default=0, help="переопределить CRF")
    ap.add_argument("--copy", action="store_true", help="без перекодирования (-c copy), быстро, но рез по ключевым кадрам")
    args = ap.parse_args()

    if not shutil.which("ffmpeg"):
        eprint("ffmpeg не найден в PATH. Установите ffmpeg и повторите.")
        return 2

    json_path = Path(args.json).expanduser().resolve()
    src = Path(args.source).expanduser().resolve()
    if not json_path.is_file():
        eprint(f"Нет JSON: {json_path}")
        return 2
    if not src.is_file():
        eprint(f"Нет исходного видео: {src}")
        return 2

    try:
        data = load_json(json_path)
    except Exception as exc:
        eprint(f"Не удалось прочитать JSON: {exc}")
        return 2

    out_dir = Path(args.out).expanduser().resolve() if args.out else json_path.parent / "cuts"
    out_dir.mkdir(parents=True, exist_ok=True)

    ff = data.get("ffmpeg") or {}
    crf = args.crf if args.crf > 0 else ff.get("crf", 20)
    preset = args.preset or ff.get("preset", "medium")
    fragments = data["fragments"]
    if not fragments:
        eprint("В JSON нет фрагментов (ни один поединок не отмечен «в нарезку»).")
        return 2

    print(f"Источник: {src}")
    print(f"Фрагментов: {len(fragments)}")
    print(f"Куда: {out_dir}")
    print("ffmpeg: " + ("copy без перекодирования" if args.copy else f"crf={crf}, preset={preset}, audio=copy"))

    ok = 0
    for n, frag in enumerate(fragments, 1):
        start = float(frag["start"])
        end = float(frag["end"])
        if end <= start:
            eprint(f"[{n}] пропуск: end <= start ({start}..{end})")
            continue
        name = safe_name(frag.get("filename"), f"duel-{frag.get('order', n)}.mp4")
        dst = out_dir / name
        print(f"[{n}/{len(fragments)}] {name}")
        if cut_one(src, dst, start, end - start, crf, preset, args.copy, args.dry_run, args.overwrite):
            ok += 1

    print(f"Готово: {ok} из {len(fragments)}")
    return 0 if ok == len(fragments) else 1


if __name__ == "__main__":
    raise SystemExit(main())
