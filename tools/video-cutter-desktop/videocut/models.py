from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Duel:
    duel_id: int
    order: int
    p1: str
    p2: str
    situation: str = ""
    round_minutes: int = 0
    proto_start_ms: int | None = None
    proto_end_ms: int | None = None
    base_start: float = 0.0
    base_end: float = 0.0
    source: str = "guess"
    include: bool = True

    @property
    def label(self) -> str:
        left = self.p1 or "—"
        right = self.p2 or "—"
        return f"{left} vs {right}"


@dataclass
class EventState:
    event_id: int
    title: str
    date: str = ""
    start_time: str = ""
    status: str = ""
    recording_start_ms: int = 0
    recording_start_source: str = "api"
    duels: list[Duel] = field(default_factory=list)
    media_url: str = ""
    media_title: str = ""

    @classmethod
    def from_api(cls, data: dict[str, Any], tail_sec: float = 5.0) -> "EventState":
        event = data.get("event") or {}
        rec = int(data.get("recordingStartMs") or data.get("eventStartMs") or 0)
        state = cls(
            event_id=int(event.get("id") or 0),
            title=str(event.get("title") or ""),
            date=str(event.get("startsOn") or ""),
            start_time=str(event.get("startsAt") or ""),
            status=str(event.get("status") or ""),
            recording_start_ms=rec,
        )
        media = data.get("media") or {}
        state.media_url = str(media.get("mediaUrl") or "")
        state.media_title = str(media.get("title") or "")

        cursor = 0.0
        for item in data.get("duels") or []:
            proto_start = item.get("protoStartMs")
            proto_end = item.get("protoEndMs")
            if rec and proto_start:
                start = (int(proto_start) - rec) / 1000.0
                if proto_end:
                    end = (int(proto_end) - rec) / 1000.0 + tail_sec
                else:
                    duration = item.get("protoDurationSec")
                    end = start + (float(duration) + tail_sec if duration else 600.0)
                source = "proto"
            else:
                start = max(0.0, cursor)
                end = start + 600.0
                source = "guess"
            start = max(0.0, start)
            end = max(start + 1.0, end)
            state.duels.append(
                Duel(
                    duel_id=int(item.get("duelId") or 0),
                    order=int(item.get("order") or 0),
                    p1=str(item.get("p1") or ""),
                    p2=str(item.get("p2") or ""),
                    situation=str(item.get("situation") or ""),
                    round_minutes=int(item.get("roundMinutes") or 0),
                    proto_start_ms=int(proto_start) if proto_start else None,
                    proto_end_ms=int(proto_end) if proto_end else None,
                    base_start=start,
                    base_end=end,
                    source=source,
                )
            )
            cursor = end
        return state

    def recompute_base_times(self, tail_sec: float = 5.0) -> None:
        rec = self.recording_start_ms
        cursor = 0.0
        for duel in self.duels:
            if rec and duel.proto_start_ms:
                start = (duel.proto_start_ms - rec) / 1000.0
                if duel.proto_end_ms:
                    end = (duel.proto_end_ms - rec) / 1000.0 + tail_sec
                else:
                    end = start + 600.0
                duel.source = "proto"
            else:
                start = max(cursor, 0.0)
                end = max(start + 20.0, duel.base_end)
                duel.source = duel.source if duel.source == "manual" else "guess"
            duel.base_start = max(0.0, start)
            duel.base_end = max(duel.base_start + 1.0, end)
            cursor = duel.base_end

    def auto_calibrate(self, duration_sec: float, tail_sec: float = 5.0, force: bool = False) -> bool:
        """Выровнять старт записи по последнему решению протокола и длительности видео."""
        if not force and self.recording_start_source in ("manual", "qr", "json"):
            return False
        if not duration_sec or duration_sec <= 0:
            return False
        last_end = max((duel.proto_end_ms or 0 for duel in self.duels), default=0)
        if not last_end:
            return False
        self.recording_start_ms = int(round(last_end - duration_sec * 1000.0 + tail_sec * 1000.0))
        self.recording_start_source = "auto"
        self.recompute_base_times(tail_sec)
        return True

    @classmethod
    def from_export(cls, data: dict[str, Any]) -> "EventState":
        rec = int(data.get("recordingStartMs") or 0)
        state = cls(
            event_id=int(data.get("eventId") or 0),
            title=str(data.get("event") or ""),
            date=str(data.get("date") or ""),
            recording_start_ms=rec,
            recording_start_source="json",
        )
        for fragment in data.get("fragments") or []:
            players = fragment.get("players") or ["", ""]
            start = float(fragment.get("start") or 0.0)
            end = float(fragment.get("end") or start)
            state.duels.append(
                Duel(
                    duel_id=int(fragment.get("duelId") or 0),
                    order=int(fragment.get("order") or 0),
                    p1=str(players[0] if len(players) > 0 else ""),
                    p2=str(players[1] if len(players) > 1 else ""),
                    base_start=start,
                    base_end=end,
                    source="json",
                )
            )
        return state


def fmt_clock(seconds: float) -> str:
    if seconds is None or seconds < 0:
        return "—"
    total = int(round(seconds))
    h = total // 3600
    m = (total % 3600) // 60
    s = total % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def fmt_seconds(seconds: float) -> str:
    return f"{seconds:.3f}"
