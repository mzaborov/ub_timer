from __future__ import annotations

import bisect

from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QMouseEvent, QPainter, QPen, QPolygonF
from PySide6.QtWidgets import QWidget

from ..models import Duel, fmt_clock


class TimelineWidget(QWidget):
    seek_requested = Signal(float)
    duel_clicked = Signal(int)
    edge_clicked = Signal(int, str)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(110)
        self.setMouseTracking(True)
        self._duration = 0.0
        self._duels: list[Duel] = []
        self._selected = -1
        self._playhead = 0.0
        self._shift = 0.0

    def set_data(
        self,
        duels: list[Duel],
        duration: float,
        selected: int,
        shift: float,
        playhead: float,
    ) -> None:
        self._duels = duels
        self._duration = max(0.0, duration)
        self._selected = selected
        self._shift = shift
        self._playhead = playhead
        self.update()

    def set_playhead(self, seconds: float) -> None:
        self._playhead = seconds
        self.update()

    def _x(self, seconds: float) -> float:
        if self._duration <= 0:
            return 0.0
        return 8.0 + (seconds / self._duration) * max(1.0, self.width() - 16.0)

    def _seconds(self, x: float) -> float:
        if self._duration <= 0:
            return 0.0
        return max(0.0, min(self._duration, (x - 8.0) / max(1.0, self.width() - 16.0) * self._duration))

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.fillRect(self.rect(), QColor("#11151b"))

        bar_top = 34.0
        bar_h = 52.0
        bar = QRectF(8, bar_top, max(1.0, self.width() - 16), bar_h)
        painter.fillRect(bar, QColor("#1e2630"))
        painter.setPen(QPen(QColor("#3a4654"), 1))
        painter.drawRect(bar)

        if self._duration <= 0:
            painter.setPen(QColor("#8a96a3"))
            painter.drawText(self.rect(), Qt.AlignCenter, "Таймлайн появится после загрузки видео")
            return

        ticks = max(2, min(12, int(self.width() / 120)))
        step = self._duration / ticks
        for i in range(ticks + 1):
            t = step * i
            x = self._x(t)
            painter.setPen(QPen(QColor("#2b3540"), 1))
            painter.drawLine(QPointF(x, bar_top - 5), QPointF(x, bar_top + bar_h + 5))
            painter.setPen(QColor("#9aa7b4"))
            painter.drawText(QRectF(x - 45, bar_top + bar_h + 7, 90, 16), Qt.AlignHCenter, fmt_clock(t))

        for index, duel in enumerate(self._duels):
            start = max(0.0, duel.base_start + self._shift)
            end = max(start, duel.base_end + self._shift)
            x1 = self._x(start)
            x2 = max(x1 + 2.0, self._x(end))
            rect = QRectF(x1, bar_top + 6, max(2.0, x2 - x1), bar_h - 12)
            if index == self._selected:
                color = QColor("#f0b429")
            elif not duel.include:
                color = QColor("#4b5563")
            elif duel.source == "guess":
                color = QColor("#8b5cf6")
            else:
                color = QColor("#2f81f7")
            painter.fillRect(rect, color)
            painter.setPen(QPen(QColor("#0b0e12"), 1))
            painter.drawRect(rect)
            if rect.width() > 26:
                painter.setPen(QColor("#ffffff"))
                font = QFont()
                font.setPointSize(8)
                font.setBold(True)
                painter.setFont(font)
                painter.drawText(rect.adjusted(3, 0, -3, 0), Qt.AlignVCenter, str(duel.order))

        x = self._x(max(0.0, min(self._duration, self._playhead)))
        painter.setPen(QPen(QColor("#ff4d4f"), 2))
        painter.drawLine(QPointF(x, bar_top - 10), QPointF(x, bar_top + bar_h + 10))
        painter.setBrush(QColor("#ff4d4f"))
        painter.setPen(Qt.NoPen)
        painter.drawPolygon(
            QPolygonF(
                [
                    QPointF(x - 5, bar_top - 10),
                    QPointF(x + 5, bar_top - 10),
                    QPointF(x, bar_top - 3),
                ]
            )
        )

    def _hit(self, x: float) -> tuple[int, str]:
        if self._duration <= 0:
            return -1, ""
        for index, duel in enumerate(self._duels):
            start = max(0.0, duel.base_start + self._shift)
            end = max(start, duel.base_end + self._shift)
            x1, x2 = self._x(start), self._x(end)
            if x1 - 5 <= x <= x2 + 5:
                if abs(x - x1) <= 6:
                    return index, "start"
                if abs(x - x2) <= 6:
                    return index, "end"
                return index, ""
        return -1, ""

    def mousePressEvent(self, event: QMouseEvent) -> None:
        if event.button() != Qt.LeftButton or self._duration <= 0:
            return
        x = event.position().x()
        index, edge = self._hit(x)
        if index >= 0:
            self.duel_clicked.emit(index)
        if index >= 0 and edge:
            self.edge_clicked.emit(index, edge)
        self.seek_requested.emit(self._seconds(x))

    def mouseMoveEvent(self, event: QMouseEvent) -> None:
        if event.buttons() & Qt.LeftButton and self._duration > 0:
            self.seek_requested.emit(self._seconds(event.position().x()))
