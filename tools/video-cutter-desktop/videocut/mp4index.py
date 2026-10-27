from __future__ import annotations

import io
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO


@dataclass(frozen=True)
class Box:
    offset: int
    size: int
    header: int
    type: str

    @property
    def payload(self) -> int:
        return self.offset + self.header

    @property
    def end(self) -> int:
        return self.offset + self.size


@dataclass(frozen=True)
class Mp4Index:
    keyframes: list[float]
    duration: float
    fps: float
    timescale: int
    sample_count: int


def _fourcc(raw: bytes) -> str:
    return raw.decode("latin-1", "replace")


def _header(data: bytes, offset: int, limit: int) -> Box | None:
    if offset + 8 > limit:
        return None
    size, raw_type = struct.unpack_from(">I4s", data, offset)
    header = 8
    if size == 1:
        if offset + 16 > limit:
            return None
        size = struct.unpack_from(">Q", data, offset + 8)[0]
        header = 16
    elif size == 0:
        size = limit - offset
    if size < header:
        return None
    return Box(offset=offset, size=size, header=header, type=_fourcc(raw_type))


def _children(data: bytes, start: int, end: int) -> list[Box]:
    out: list[Box] = []
    offset = start
    while offset + 8 <= end:
        box = _header(data, offset, end)
        if box is None or box.end > end:
            break
        out.append(box)
        offset = box.end
    return out


def _find(parent: Box, data: bytes, box_type: str) -> Box | None:
    for box in _children(data, parent.payload, parent.end):
        if box.type == box_type:
            return box
    return None


def _read_moov(file: BinaryIO, file_size: int) -> bytes | None:
    offset = 0
    for _ in range(64):
        if offset >= file_size:
            return None
        file.seek(offset)
        head = file.read(16)
        if len(head) < 8:
            return None
        box = _header(head, 0, file_size)
        if box is None or box.end > file_size:
            return None
        if box.type == "moov":
            file.seek(offset + box.header)
            payload = file.read(box.size - box.header)
            if len(payload) != box.size - box.header:
                return None
            return payload
        offset += box.size
    return None


def _parse_video_track(moov: bytes) -> tuple[int, Box, Box, Box | None] | None:
    data = moov
    root = Box(offset=0, size=len(data), header=0, type="moov")
    stbl: Box | None = None
    timescale = 0

    for trak in _children(data, 0, len(data)):
        if trak.type != "trak":
            continue
        mdia = _find(trak, data, "mdia")
        if mdia is None:
            continue
        hdlr = _find(mdia, data, "hdlr")
        if hdlr is None or hdlr.payload + 12 > len(data):
            continue
        if _fourcc(data[hdlr.payload + 8 : hdlr.payload + 12]) != "vide":
            continue
        mdhd = _find(mdia, data, "mdhd")
        if mdhd is None or mdhd.payload + 4 > len(data):
            continue
        version = data[mdhd.payload]
        ts_off = mdhd.payload + (20 if version == 1 else 12)
        if ts_off + 4 > len(data):
            continue
        timescale = struct.unpack_from(">I", data, ts_off)[0]
        minf = _find(mdia, data, "minf")
        if minf is None:
            continue
        stbl = _find(minf, data, "stbl")
        if stbl is not None:
            break

    if stbl is None or timescale <= 0:
        return None
    stss = _find(stbl, data, "stss")
    stts = _find(stbl, data, "stts")
    if stss is None or stts is None:
        return None
    ctts = _find(stbl, data, "ctts")
    return timescale, stss, stts, ctts


def _keyframe_times(
    data: bytes, timescale: int, stss: Box, stts: Box, ctts: Box | None
) -> tuple[list[float], int, float, float]:
    if stss.payload + 8 > len(data) or stts.payload + 8 > len(data):
        return [], 0, 0.0, 0.0
    sync_count = struct.unpack_from(">I", data, stss.payload + 4)[0]
    sync = {
        struct.unpack_from(">I", data, stss.payload + 8 + i * 4)[0]
        for i in range(sync_count)
        if stss.payload + 12 + i * 4 <= len(data)
    }

    stts_count = struct.unpack_from(">I", data, stts.payload + 4)[0]
    ctts_count = 0
    ctts_version = 0
    if ctts is not None and ctts.payload + 8 <= len(data):
        ctts_version = data[ctts.payload]
        ctts_count = struct.unpack_from(">I", data, ctts.payload + 4)[0]

    times: list[float] = []
    deltas: list[int] = []
    sample = 0
    dts = 0
    ctts_index = 0
    ctts_remaining = 0
    ctts_offset = 0

    for entry in range(stts_count):
        at = stts.payload + 8 + entry * 8
        if at + 8 > len(data):
            break
        count, delta = struct.unpack_from(">II", data, at)
        if delta > 0:
            deltas.append(delta)
        for _ in range(count):
            sample += 1
            if ctts is not None:
                while ctts_remaining == 0 and ctts_index < ctts_count:
                    ca = ctts.payload + 8 + ctts_index * 8
                    if ca + 8 > len(data):
                        break
                    ctts_remaining = struct.unpack_from(">I", data, ca)[0]
                    raw = struct.unpack_from(">I", data, ca + 4)[0]
                    ctts_offset = (
                        struct.unpack_from(">i", data, ca + 4)[0]
                        if ctts_version == 1
                        else raw
                    )
                    ctts_index += 1
                if ctts_remaining > 0:
                    ctts_remaining -= 1
            if sample in sync:
                times.append((dts + ctts_offset) / timescale)
            dts += delta

    times.sort()
    duration = dts / timescale if timescale else 0.0
    fps = 0.0
    if deltas:
        median = sorted(deltas)[len(deltas) // 2]
        if median:
            fps = timescale / median
    return times, sample, duration, fps


def read_index(source: str | Path | BinaryIO) -> Mp4Index:
    """Read keyframe index from an MP4/MOV file or seekable binary stream."""
    close = False
    if isinstance(source, (str, Path)):
        file = open(source, "rb")
        close = True
        size = Path(source).stat().st_size
    else:
        file = source
        pos = file.tell()
        file.seek(0, io.SEEK_END)
        size = file.tell()
        file.seek(pos)

    try:
        moov = _read_moov(file, size)
    finally:
        if close:
            file.close()

    if not moov:
        return Mp4Index([], 0.0, 0.0, 0, 0)
    track = _parse_video_track(moov)
    if track is None:
        return Mp4Index([], 0.0, 0.0, 0, 0)
    timescale, stss, stts, ctts = track
    keyframes, sample_count, duration, fps = _keyframe_times(
        moov, timescale, stss, stts, ctts
    )
    return Mp4Index(keyframes, duration, fps, timescale, sample_count)
