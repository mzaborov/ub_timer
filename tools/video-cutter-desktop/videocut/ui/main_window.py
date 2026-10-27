from __future__ import annotations

import bisect
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import QObject, QRunnable, QThreadPool, QTimer, Qt, Signal, Slot
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QAbstractItemView,
    QAbstractSpinBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHeaderView,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QSlider,
    QSpinBox,
    QSplitter,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ..api import AuthError, PortalClient, PortalError
from ..cache import CachedVideo, VideoCache
from ..config import AppConfig
from ..cut import CutJob, cut_many, render_filename, sanitize_name
from ..models import Duel, EventState, fmt_clock
from ..mp4index import read_index
from ..mpv import MpvError, MpvPlayer
from .timeline import TimelineWidget


class WorkerSignals(QObject):
    done = Signal(object)
    error = Signal(str)
    progress = Signal(int, int, str)


class Worker(QRunnable):
    def __init__(self, fn, *args, pass_progress: bool = False, **kwargs) -> None:
        super().__init__()
        self.fn = fn
        self.args = args
        self.kwargs = kwargs
        self.pass_progress = pass_progress
        self.signals = WorkerSignals()

    @Slot()
    def run(self) -> None:
        try:
            if self.pass_progress:
                result = self.fn(
                    *self.args,
                    progress=lambda done, total, msg="": self.signals.progress.emit(
                        int(done), int(total), str(msg)
                    ),
                    **self.kwargs,
                )
            else:
                result = self.fn(*self.args, **self.kwargs)
        except Exception as exc:
            self.signals.error.emit(str(exc))
        else:
            self.signals.done.emit(result)


def _fmt_time(seconds: float) -> str:
    if seconds < 0:
        return "—"
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:06.3f}" if h else f"{m:02d}:{s:06.3f}"


class SettingsDialog(QDialog):
    def __init__(self, cfg: AppConfig, parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Настройки")
        self.resize(680, 500)
        self.cfg = cfg
        form = QFormLayout(self)

        self.api_base = QLineEdit(cfg.api_base)
        self.token = QLineEdit(cfg.token)
        self.token.setEchoMode(QLineEdit.Password)
        self.token.setPlaceholderText("Токен доступа (org-пароль или отдельный токен)")
        self.cache_dir = QLineEdit(cfg.cache_dir)
        self.output_dir = QLineEdit(cfg.output_dir)
        self.mpv_path = QLineEdit(cfg.libmpv_path)
        self.ffmpeg_path = QLineEdit(cfg.ffmpeg_path)
        self.tail_sec = QDoubleSpinBox()
        self.tail_sec.setRange(0.0, 120.0)
        self.tail_sec.setDecimals(1)
        self.tail_sec.setSuffix(" с")
        self.tail_sec.setValue(float(cfg.tail_sec))
        self.crf = QSpinBox()
        self.crf.setRange(0, 51)
        self.crf.setValue(int(cfg.crf))
        self.preset = QComboBox()
        for preset in ("ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"):
            self.preset.addItem(preset)
        if self.preset.findText(cfg.preset) < 0:
            self.preset.addItem(cfg.preset)
        self.preset.setCurrentText(cfg.preset)

        form.addRow("Адрес портала", self.api_base)
        form.addRow("Токен", self.token)
        form.addRow("Кэш видео", self._path_row(self.cache_dir))
        form.addRow("Папка результатов", self._path_row(self.output_dir))
        form.addRow("libmpv-2.dll", self._file_row(self.mpv_path, "libmpv-2.dll"))
        form.addRow("ffmpeg", self._file_row(self.ffmpeg_path, "ffmpeg.exe"))
        form.addRow("Хвост после решения", self.tail_sec)
        form.addRow("CRF (меньше — лучше)", self.crf)
        form.addRow("Пресет x264", self.preset)

        hint = QLabel(
            "Токен хранится локально в %APPDATA%\\ub-timer-videocut\\config.json. "
            "Для доступа к событиям используется тот же пароль org-раздела, если отдельный токен не задан."
        )
        hint.setWordWrap(True)
        form.addRow(hint)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

    def _path_row(self, edit: QLineEdit) -> QWidget:
        box = QWidget()
        layout = QHBoxLayout(box)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(edit, 1)
        btn = QPushButton("…")
        btn.setFixedWidth(32)
        btn.clicked.connect(lambda: self._pick_dir(edit))
        layout.addWidget(btn)
        return box

    def _file_row(self, edit: QLineEdit, name: str) -> QWidget:
        box = QWidget()
        layout = QHBoxLayout(box)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(edit, 1)
        btn = QPushButton("…")
        btn.setFixedWidth(32)
        btn.clicked.connect(lambda: self._pick_file(edit, name))
        layout.addWidget(btn)
        return box

    def _pick_dir(self, edit: QLineEdit) -> None:
        path = QFileDialog.getExistingDirectory(self, "Выбрать папку", edit.text())
        if path:
            edit.setText(path)

    def _pick_file(self, edit: QLineEdit, name: str) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Выбрать файл", edit.text(), name)
        if path:
            edit.setText(path)

    def result_config(self) -> AppConfig:
        cfg = AppConfig(**self.cfg.__dict__)
        cfg.api_base = self.api_base.text().strip().rstrip("/")
        cfg.token = self.token.text().strip()
        cfg.cache_dir = self.cache_dir.text().strip()
        cfg.output_dir = self.output_dir.text().strip()
        cfg.libmpv_path = self.mpv_path.text().strip()
        cfg.ffmpeg_path = self.ffmpeg_path.text().strip()
        cfg.tail_sec = float(self.tail_sec.value())
        cfg.crf = int(self.crf.value())
        cfg.preset = self.preset.currentText()
        return cfg


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("UB Timer — нарезка видео")
        screen = QApplication.primaryScreen()
        if screen is not None:
            geo = screen.availableGeometry()
            width = max(1120, min(1500, int(geo.width() * 0.92)))
            height = max(720, min(940, int(geo.height() * 0.92)))
        else:
            width, height = 1400, 860
        self.resize(width, height)
        if screen is not None:
            self.move(
                max(0, geo.x() + (geo.width() - width) // 2),
                max(0, geo.y() + (geo.height() - height) // 2),
            )
        self.cfg = AppConfig.load()
        self.cfg.ensure_dirs()
        self.client = PortalClient(self.cfg.api_base, self.cfg.token)
        self.cache = VideoCache(self.cfg.cache_dir, self.cfg.token)
        self.pool = QThreadPool.globalInstance()
        self.pool.setMaxThreadCount(4)

        self.events: list[dict] = []
        self.current_event: EventState | None = None
        self.duels: list[Duel] = []
        self.selected = -1
        self.active_edge = "start"
        self.shift = 0.0
        self.duration = 0.0
        self.fps = 25.0
        self.keyframes: list[float] = []
        self.video_path: Path | None = None
        self.video_url = ""
        self.mpv: MpvPlayer | None = None
        self._table_guard = False
        self._spin_guard = False
        self._combo_guard = False
        self._slider_dragging = False
        self._preview_seq = 0
        self._closing = False

        self._build_ui()
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._on_tick)
        self._timer.start(100)
        self._preview_timer = QTimer(self)
        self._preview_timer.setSingleShot(True)
        self._preview_timer.timeout.connect(self._update_previews)
        QTimer.singleShot(200, self._bootstrap)

    def _build_ui(self) -> None:
        split = QSplitter(Qt.Horizontal)
        split.setChildrenCollapsible(False)
        self.setCentralWidget(split)

        left = QWidget()
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(0, 0, 0, 0)

        self.video_host = QWidget()
        self.video_host.setMinimumSize(560, 315)
        self.video_host.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.video_host.setAttribute(Qt.WA_NativeWindow, True)
        self.video_host.setStyleSheet("background:#000;")
        left_layout.addWidget(self.video_host, 1)

        controls = QHBoxLayout()
        self.btn_play = self._button("▶", self._toggle_play, 38)
        self.lbl_time = QLabel("0:00:00.000 / 0:00:00.000")
        self.lbl_time.setMinimumWidth(190)
        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(0, 0)
        self.slider.sliderPressed.connect(self._slider_pressed)
        self.slider.sliderReleased.connect(self._slider_released)
        self.slider.valueChanged.connect(self._slider_moved)
        controls.addWidget(self.btn_play)
        controls.addWidget(self.slider, 1)
        controls.addWidget(self.lbl_time)
        left_layout.addLayout(controls)

        nudge = QHBoxLayout()
        for delta in (-60, -30, -15, -5, -1, 1, 5, 15, 30, 60):
            nudge.addWidget(self._button(f"{delta:+d}", lambda _=False, d=delta: self._nudge(d)))
        nudge.addStretch(1)
        left_layout.addLayout(nudge)

        kf_row = QHBoxLayout()
        self.btn_edge = QPushButton("Граница: начало")
        self.btn_edge.clicked.connect(self._toggle_edge)
        self.btn_kf_prev = QPushButton("◀ I-кадр")
        self.btn_kf_prev.clicked.connect(lambda: self._step_keyframe(-1))
        self.btn_kf_next = QPushButton("I-кадр ▶")
        self.btn_kf_next.clicked.connect(lambda: self._step_keyframe(1))
        self.lbl_kf = QLabel("I-кадры: —")
        self.lbl_kf.setStyleSheet("color:#8a96a3;")
        kf_row.addWidget(self.btn_edge)
        kf_row.addWidget(self.btn_kf_prev)
        kf_row.addWidget(self.btn_kf_next)
        kf_row.addWidget(self.lbl_kf, 1)
        left_layout.addLayout(kf_row)

        self.timeline = TimelineWidget()
        self.timeline.seek_requested.connect(self._seek)
        self.timeline.duel_clicked.connect(self._select_duel)
        self.timeline.edge_clicked.connect(self._timeline_edge)
        left_layout.addWidget(self.timeline)
        split.addWidget(left)

        right_scroll = QScrollArea()
        right_scroll.setWidgetResizable(True)
        right_scroll.setMinimumWidth(540)
        right = QWidget()
        right_layout = QVBoxLayout(right)
        right_layout.setContentsMargins(8, 8, 8, 8)
        right_scroll.setWidget(right)
        split.addWidget(right_scroll)

        event_group = QGroupBox("Мероприятие")
        event_layout = QVBoxLayout(event_group)
        row = QHBoxLayout()
        self.combo = QComboBox()
        self.combo.currentIndexChanged.connect(self._combo_changed)
        self.btn_refresh = self._button("Обновить", self.refresh_events)
        self.btn_json = self._button("JSON", self._open_json)
        self.btn_settings = self._button("Настройки", self.open_settings)
        row.addWidget(self.combo, 1)
        row.addWidget(self.btn_refresh)
        row.addWidget(self.btn_json)
        row.addWidget(self.btn_settings)
        event_layout.addLayout(row)
        self.lbl_meta = QLabel("Событие не выбрано")
        self.lbl_meta.setWordWrap(True)
        event_layout.addWidget(self.lbl_meta)
        self.lbl_cal = QLabel("Старт записи: —")
        self.lbl_cal.setStyleSheet("color:#8a96a3;")
        event_layout.addWidget(self.lbl_cal)
        shift_row = QHBoxLayout()
        shift_row.addWidget(QLabel("Сдвиг, с"))
        self.spin_shift = QDoubleSpinBox()
        self.spin_shift.setRange(-3600.0, 3600.0)
        self.spin_shift.setDecimals(2)
        self.spin_shift.setSingleStep(0.5)
        self.spin_shift.valueChanged.connect(self._shift_changed)
        shift_row.addWidget(self.spin_shift)
        self.btn_local_video = self._button("Выбрать видео", self._open_local_video)
        shift_row.addWidget(self.btn_local_video)
        self.btn_cal = self._button("Автостарт", self._calibrate)
        shift_row.addWidget(self.btn_cal)
        shift_row.addStretch(1)
        event_layout.addLayout(shift_row)
        right_layout.addWidget(event_group)

        table_group = QGroupBox("Поединки")
        table_layout = QVBoxLayout(table_group)
        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["#", "Поединок", "Начало", "Конец", "Вкл"])
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.horizontalHeader().setStretchLastSection(False)
        self.table.setColumnWidth(0, 36)
        self.table.setColumnWidth(2, 92)
        self.table.setColumnWidth(3, 92)
        self.table.setColumnWidth(4, 44)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table.itemSelectionChanged.connect(self._table_selected)
        self.table.itemChanged.connect(self._table_item_changed)
        self.table.setMinimumHeight(220)
        table_layout.addWidget(self.table)
        right_layout.addWidget(table_group, 1)

        inspect_group = QGroupBox("Границы")
        inspect_layout = QVBoxLayout(inspect_group)
        self.lbl_selected = QLabel("Поединок не выбран")
        self.lbl_selected.setStyleSheet("font-weight:600;")
        inspect_layout.addWidget(self.lbl_selected)
        grid = QHBoxLayout()
        self.spin_start = QDoubleSpinBox()
        self.spin_end = QDoubleSpinBox()
        for spin in (self.spin_start, self.spin_end):
            spin.setRange(0.0, 999999.0)
            spin.setDecimals(3)
            spin.setSingleStep(0.04)
            spin.valueChanged.connect(self._spin_changed)
        grid.addWidget(QLabel("Начало"))
        grid.addWidget(self.spin_start)
        grid.addWidget(QLabel("Конец"))
        grid.addWidget(self.spin_end)
        inspect_layout.addLayout(grid)
        buttons = QHBoxLayout()
        buttons.addWidget(self._button("Начало здесь", lambda: self._set_here("start")))
        buttons.addWidget(self._button("Конец здесь", lambda: self._set_here("end")))
        buttons.addWidget(self._button("Превью", self._schedule_preview))
        inspect_layout.addLayout(buttons)
        previews = QHBoxLayout()
        self.preview_start = QLabel("начало")
        self.preview_end = QLabel("конец")
        for label in (self.preview_start, self.preview_end):
            label.setFixedSize(200, 112)
            label.setAlignment(Qt.AlignCenter)
            label.setStyleSheet("background:#05070a;color:#566;border:1px solid #2a3038;")
            previews.addWidget(label)
        inspect_layout.addLayout(previews)
        right_layout.addWidget(inspect_group)

        cut_group = QGroupBox("Нарезка")
        cut_layout = QVBoxLayout(cut_group)
        out_row = QHBoxLayout()
        self.edit_out = QLineEdit(self.cfg.output_dir)
        self.edit_out.setReadOnly(True)
        out_row.addWidget(self.edit_out, 1)
        out_row.addWidget(self._button("…", self._pick_output))
        cut_layout.addLayout(out_row)
        params = QHBoxLayout()
        params.addWidget(QLabel("CRF"))
        self.spin_crf = QDoubleSpinBox()
        self.spin_crf.setRange(0, 51)
        self.spin_crf.setDecimals(0)
        self.spin_crf.setValue(self.cfg.crf)
        params.addWidget(self.spin_crf)
        params.addWidget(QLabel("Пресет"))
        self.combo_preset = QComboBox()
        self.combo_preset.addItems(["ultrafast", "veryfast", "faster", "fast", "medium", "slow"])
        self.combo_preset.setCurrentText(self.cfg.preset)
        params.addWidget(self.combo_preset, 1)
        cut_layout.addLayout(params)
        cut_actions = QHBoxLayout()
        self.btn_cut = self._button("Нарезать выбранные", self._start_cut)
        self.btn_open_out = self._button("Открыть папку", self._open_output)
        cut_actions.addWidget(self.btn_cut)
        cut_actions.addWidget(self.btn_open_out)
        cut_layout.addLayout(cut_actions)
        self.progress = QProgressBar()
        self.progress.setRange(0, 1000)
        self.progress.setVisible(False)
        cut_layout.addWidget(self.progress)
        self.lbl_cut = QLabel("")
        self.lbl_cut.setWordWrap(True)
        cut_layout.addWidget(self.lbl_cut)
        right_layout.addWidget(cut_group)

        self.lbl_status = QLabel("Готово")
        self.lbl_status.setStyleSheet("color:#8a96a3;")
        right_layout.addWidget(self.lbl_status)
        right_layout.addStretch(1)

        split.setSizes([900, 560])

    def _button(self, text: str, slot, width: int | None = None) -> QPushButton:
        btn = QPushButton(text)
        btn.clicked.connect(slot)
        if width:
            btn.setFixedWidth(width)
        return btn

    # ----------------------------- lifecycle -----------------------------

    def _bootstrap(self) -> None:
        if not self.cfg.token.strip():
            self.open_settings(required=True)
            return
        self.refresh_events()

    def keyPressEvent(self, event) -> None:
        focus = QApplication.focusWidget()
        editing = isinstance(focus, (QLineEdit, QAbstractSpinBox))
        if event.key() == Qt.Key_Space and not editing:
            self._toggle_play()
            return
        if event.key() in (Qt.Key_Left, Qt.Key_Right) and not editing:
            delta = -1 if event.key() == Qt.Key_Left else 1
            if event.modifiers() & Qt.ShiftModifier:
                delta *= 5
            self._nudge(delta)
            return
        if event.key() == Qt.Key_BracketLeft and not editing:
            self._step_keyframe(-1)
            return
        if event.key() == Qt.Key_BracketRight and not editing:
            self._step_keyframe(1)
            return
        if event.key() == Qt.Key_O and event.modifiers() & Qt.ControlModifier:
            self._open_local_video()
            return
        if event.key() == Qt.Key_J and event.modifiers() & Qt.ControlModifier:
            self._open_json()
            return
        super().keyPressEvent(event)

    def closeEvent(self, event) -> None:
        self._closing = True
        if self.mpv:
            self.mpv.close()
        self.client.close()
        super().closeEvent(event)

    def _status(self, text: str) -> None:
        self.lbl_status.setText(text)

    def _error(self, text: str) -> None:
        self.lbl_status.setText("Ошибка: " + text)
        QMessageBox.warning(self, "Ошибка", text)

    def _run(self, fn, on_done, on_error=None, pass_progress=False) -> None:
        worker = Worker(fn, pass_progress=pass_progress)
        worker.signals.done.connect(on_done)
        worker.signals.error.connect(on_error or self._error)
        self.pool.start(worker)

    # ----------------------------- settings / events -----------------------------

    def open_settings(self, required: bool = False) -> None:
        dlg = SettingsDialog(self.cfg, self)
        if dlg.exec() == QDialog.Accepted:
            self.cfg = dlg.result_config()
            self.cfg.save()
            self.cfg.ensure_dirs()
            self.client.close()
            self.client = PortalClient(self.cfg.api_base, self.cfg.token)
            self.cache = VideoCache(self.cfg.cache_dir, self.cfg.token)
            self.edit_out.setText(self.cfg.output_dir)
            self.spin_crf.setValue(int(self.cfg.crf))
            if self.combo_preset.findText(self.cfg.preset) < 0:
                self.combo_preset.addItem(self.cfg.preset)
            self.combo_preset.setCurrentText(self.cfg.preset)
            if self.cfg.token:
                self.refresh_events()
        elif required:
            self._status("Без токена доступен только режим JSON + локальный файл")

    def refresh_events(self) -> None:
        if not self.cfg.token:
            self.open_settings(required=True)
            return
        self._status("Загрузка мероприятий…")
        self.btn_refresh.setEnabled(False)
        self._run(self.client.events, self._events_loaded, self._events_failed)

    def _events_failed(self, text: str) -> None:
        self.btn_refresh.setEnabled(True)
        if "токен" in text.lower():
            self._status("Токен отклонён")
            if QMessageBox.question(
                self,
                "Доступ",
                "Портал отклонил токен. Открыть настройки?",
            ) == QMessageBox.Yes:
                self.open_settings(required=True)
        else:
            self._error(text)

    def _events_loaded(self, events) -> None:
        self.btn_refresh.setEnabled(True)
        self.events = list(events)
        self._combo_guard = True
        self.combo.clear()
        for ev in self.events:
            label = f"{ev.get('title', '')} — {ev.get('startsOn', '')}"
            if ev.get("startsAt"):
                label += " " + str(ev["startsAt"])[:5]
            label += f" ({ev.get('duelCount', 0)})"
            self.combo.addItem(label, int(ev.get("id") or 0))
        self._combo_guard = False
        if self.events:
            self._combo_guard = True
            self.combo.setCurrentIndex(0)
            self._combo_guard = False
            self._load_event(int(self.events[0].get("id") or 0))
        else:
            self._status("На портале нет мероприятий с поединками")

    def _combo_changed(self, index: int) -> None:
        if self._combo_guard or index < 0:
            return
        event_id = int(self.combo.itemData(index) or 0)
        if event_id:
            self._load_event(event_id)

    def _load_event(self, event_id: int) -> None:
        self._status(f"Загрузка мероприятия #{event_id}…")
        self._run(lambda: self.client.event(event_id), self._event_loaded)

    def _event_loaded(self, data: dict) -> None:
        self.current_event = EventState.from_api(data, self.cfg.tail_sec)
        self.duels = self.current_event.duels
        self.shift = 0.0
        self._spin_guard = True
        self.spin_shift.setValue(0.0)
        self._spin_guard = False
        meta = f"{self.current_event.title} · {self.current_event.date}"
        if self.current_event.start_time:
            meta += " " + self.current_event.start_time[:5]
        meta += f" · {len(self.duels)} поединков"
        self.lbl_meta.setText(meta)
        self._update_cal_label()
        self._populate_table()
        if self.duels:
            self._select_duel(0, seek=False)
        self.timeline.set_data(self.duels, self.duration, self.selected, self.shift, 0.0)
        self._status("Мероприятие загружено")
        if self.current_event.media_url:
            self._load_remote_video(self.current_event.media_url, self.current_event.media_title)
        else:
            self._status("У мероприятия нет записи дня — выберите видео вручную")

    def _load_remote_video(self, url: str, title: str) -> None:
        if self.video_url == url and self.video_path and self.video_path.is_file():
            return
        self._status("Скачивание видео в кэш…")
        self.progress.setVisible(True)
        self.progress.setValue(0)
        self.video_url = url

        def download(progress):
            return self.cache.ensure(
                url,
                title,
                progress=lambda done, total: progress(done, total, "скачивание"),
            )

        self._run(download, self._video_downloaded, self._video_failed, pass_progress=True)

    def _video_downloaded(self, cached: CachedVideo) -> None:
        self.progress.setVisible(False)
        self._video_ready(cached.path)

    def _video_failed(self, text: str) -> None:
        self.progress.setVisible(False)
        self._status("Видео не загружено: " + text)
        QMessageBox.warning(self, "Видео", text)

    def _open_json(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "JSON разметки", "", "JSON (*.json)")
        if not path:
            return
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            self.current_event = EventState.from_export(data)
        except Exception as exc:
            self._error(f"Не удалось прочитать JSON: {exc}")
            return
        self.duels = self.current_event.duels
        self.shift = 0.0
        self._spin_guard = True
        self.spin_shift.setValue(0.0)
        self._spin_guard = False
        self.lbl_meta.setText(f"{self.current_event.title} · JSON · {len(self.duels)} поединков")
        self._update_cal_label()
        self._populate_table()
        if self.duels:
            self._select_duel(0, seek=False)
        self.timeline.set_data(self.duels, self.duration, self.selected, self.shift, 0.0)
        self._status("JSON загружен")

    def _open_local_video(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Выбрать запись",
            str(Path.home() / "Documents" / "Zoom"),
            "Видео (*.mp4 *.mov *.mkv *.webm *.m4v);;Все файлы (*)",
        )
        if path:
            self.video_url = ""
            self._video_ready(Path(path))

    # ----------------------------- video / mpv -----------------------------

    def _ensure_mpv(self) -> bool:
        if self.mpv:
            return True
        try:
            self.mpv = MpvPlayer(int(self.video_host.winId()), libmpv_path=self.cfg.libmpv_path or None)
        except Exception as exc:
            self._error(f"Не удалось запустить mpv: {exc}")
            return False
        return True

    def _video_ready(self, path: Path) -> None:
        if not path.is_file():
            self._error(f"Файл не найден: {path}")
            return
        self.video_path = path
        self._status("Чтение индекса I-кадров…")
        try:
            index = read_index(path)
        except Exception as exc:
            self._error(f"Не удалось прочитать MP4: {exc}")
            return
        self.keyframes = index.keyframes
        self.fps = index.fps or 25.0
        self.duration = index.duration
        self.lbl_kf.setText(f"I-кадры: {len(self.keyframes)} · fps {self.fps:.3f}")
        if not self._ensure_mpv():
            return
        try:
            assert self.mpv is not None
            self.mpv.load(path)
            self.duration = index.duration or self.mpv.duration
        except (MpvError, Exception) as exc:
            self._error(f"mpv не открыл видео: {exc}")
            return
        if self.current_event and self.current_event.auto_calibrate(self.duration, self.cfg.tail_sec):
            self.duels = self.current_event.duels
            self._populate_table()
            if self.duels:
                self._select_duel(0, seek=False)
            self._update_cal_label()
            self._status("Старт записи выровнен по протоколу")
        self.slider.setRange(0, int(self.duration * 1000))
        self.timeline.set_data(self.duels, self.duration, self.selected, self.shift, 0.0)
        if self.selected >= 0:
            self._select_duel(self.selected, seek=True)
        self._schedule_preview()
        self._status(f"Видео готово: {path.name} · {fmt_clock(self.duration)}")

    def _toggle_play(self) -> None:
        if not self.mpv:
            return
        try:
            self.mpv.toggle_pause()
        except MpvError as exc:
            self._status(str(exc))

    def _on_tick(self) -> None:
        if not self.mpv or self.duration <= 0:
            return
        try:
            pos = self.mpv.time_pos
            paused = self.mpv.paused
        except Exception:
            return
        self.btn_play.setText("▶" if paused else "⏸")
        if not self._slider_dragging:
            self._spin_guard = True
            self.slider.setValue(int(pos * 1000))
            self._spin_guard = False
        self.lbl_time.setText(f"{_fmt_time(pos)} / {_fmt_time(self.duration)}")
        self.timeline.set_playhead(pos)

    def _slider_pressed(self) -> None:
        self._slider_dragging = True

    def _slider_released(self) -> None:
        self._slider_dragging = False
        self._seek(self.slider.value() / 1000.0)

    def _slider_moved(self, value: int) -> None:
        if self._slider_dragging:
            self.lbl_time.setText(f"{_fmt_time(value / 1000.0)} / {_fmt_time(self.duration)}")

    def _seek(self, seconds: float) -> None:
        if not self.mpv:
            return
        seconds = max(0.0, min(self.duration or seconds, seconds))
        try:
            self.mpv.seek(seconds, keyframes=True)
        except MpvError as exc:
            self._status(str(exc))
        self.timeline.set_playhead(seconds)

    def _nudge(self, delta: int) -> None:
        if not self.mpv:
            return
        self._seek(self.mpv.time_pos + delta)

    # ----------------------------- table / selection -----------------------------

    def _update_cal_label(self) -> None:
        ev = self.current_event
        if not ev or not ev.recording_start_ms:
            self.lbl_cal.setText("Старт записи: —")
            return
        try:
            stamp = datetime.fromtimestamp(ev.recording_start_ms / 1000.0).strftime("%Y-%m-%d %H:%M:%S")
        except (OverflowError, OSError, ValueError):
            stamp = f"{ev.recording_start_ms} ms"
        names = {"auto": "авто", "manual": "вручную", "api": "из API", "json": "из JSON"}
        self.lbl_cal.setText(f"Старт записи: {stamp} ({names.get(ev.recording_start_source, ev.recording_start_source)})")

    def _calibrate(self) -> None:
        if not self.current_event or not self.duration:
            self._status("Сначала загрузите видео")
            return
        if not self.current_event.auto_calibrate(self.duration, self.cfg.tail_sec, force=True):
            self._status("Нет данных протокола для автостарта")
            return
        self.duels = self.current_event.duels
        self.shift = 0.0
        self._spin_guard = True
        self.spin_shift.setValue(0.0)
        self._spin_guard = False
        self._populate_table()
        if self.duels:
            self._select_duel(0, seek=True)
        self._update_cal_label()
        self._status("Старт записи пересчитан по протоколу")

    def _populate_table(self) -> None:
        self._table_guard = True
        self.table.setRowCount(len(self.duels))
        for row, duel in enumerate(self.duels):
            num = QTableWidgetItem(str(duel.order))
            num.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row, 0, num)
            self.table.setItem(row, 1, QTableWidgetItem(duel.label))
            self.table.setItem(row, 2, QTableWidgetItem(_fmt_time(duel.base_start + self.shift)))
            self.table.setItem(row, 3, QTableWidgetItem(_fmt_time(duel.base_end + self.shift)))
            check = QTableWidgetItem()
            check.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            check.setCheckState(Qt.Checked if duel.include else Qt.Unchecked)
            self.table.setItem(row, 4, check)
        self._table_guard = False
        if self.duels:
            self.table.selectRow(0)

    def _table_selected(self) -> None:
        if self._table_guard:
            return
        rows = self.table.selectionModel().selectedRows()
        if rows:
            self._select_duel(rows[0].row(), seek=True)

    def _table_item_changed(self, item: QTableWidgetItem) -> None:
        if self._table_guard or item.column() != 4:
            return
        row = item.row()
        if 0 <= row < len(self.duels):
            self.duels[row].include = item.checkState() == Qt.Checked
            self.timeline.set_data(
                self.duels, self.duration, self.selected, self.shift, self.mpv.time_pos if self.mpv else 0
            )

    def _select_duel(self, index: int, seek: bool = True) -> None:
        if not (0 <= index < len(self.duels)):
            return
        changed = index != self.selected
        self.selected = index
        duel = self.duels[index]
        self.active_edge = "start"
        self.btn_edge.setText("Граница: начало")
        self.lbl_selected.setText(f"#{duel.order} · {duel.label}")
        self._spin_guard = True
        self.spin_start.setValue(duel.base_start + self.shift)
        self.spin_end.setValue(duel.base_end + self.shift)
        self._spin_guard = False
        if changed:
            self._table_guard = True
            self.table.selectRow(index)
            self._table_guard = False
        self.timeline.set_data(
            self.duels,
            self.duration,
            self.selected,
            self.shift,
            self.mpv.time_pos if self.mpv else 0,
        )
        if seek and self.mpv:
            self._seek(duel.base_start + self.shift)
        self._schedule_preview()

    def _timeline_edge(self, index: int, edge: str) -> None:
        self._select_duel(index, seek=False)
        self.active_edge = edge
        self.btn_edge.setText("Граница: " + ("начало" if edge == "start" else "конец"))
        self._seek(
            (self.duels[index].base_start if edge == "start" else self.duels[index].base_end)
            + self.shift
        )

    def _toggle_edge(self) -> None:
        self.active_edge = "end" if self.active_edge == "start" else "start"
        self.btn_edge.setText("Граница: " + ("начало" if self.active_edge == "start" else "конец"))

    def _set_here(self, edge: str) -> None:
        if not self.mpv or self.selected < 0:
            return
        self.active_edge = edge
        self._set_boundary(edge, self.mpv.time_pos)

    def _set_boundary(self, edge: str, value: float) -> None:
        if not (0 <= self.selected < len(self.duels)):
            return
        duel = self.duels[self.selected]
        value = max(0.0, value)
        if edge == "start":
            if value >= duel.base_end + self.shift - 0.04:
                value = max(0.0, duel.base_end + self.shift - 0.04)
            duel.base_start = value - self.shift
            duel.source = "manual"
            if self.current_event:
                self.current_event.recording_start_source = "manual"
        else:
            if value <= duel.base_start + self.shift + 0.04:
                value = duel.base_start + self.shift + 0.04
            duel.base_end = value - self.shift
            duel.source = "manual"
            if self.current_event:
                self.current_event.recording_start_source = "manual"
        self._spin_guard = True
        self.spin_start.setValue(duel.base_start + self.shift)
        self.spin_end.setValue(duel.base_end + self.shift)
        self._spin_guard = False
        self._refresh_row(self.selected)
        self.timeline.set_data(
            self.duels,
            self.duration,
            self.selected,
            self.shift,
            self.mpv.time_pos if self.mpv else 0,
        )
        self._schedule_preview()

    def _spin_changed(self) -> None:
        if self._spin_guard or self.selected < 0:
            return
        if self.sender() is self.spin_start:
            self._set_boundary("start", self.spin_start.value())
        elif self.sender() is self.spin_end:
            self._set_boundary("end", self.spin_end.value())

    def _shift_changed(self, value: float) -> None:
        if self._spin_guard:
            return
        self.shift = float(value)
        for row in range(len(self.duels)):
            self._refresh_row(row)
        if self.selected >= 0:
            self._spin_guard = True
            self.spin_start.setValue(self.duels[self.selected].base_start + self.shift)
            self.spin_end.setValue(self.duels[self.selected].base_end + self.shift)
            self._spin_guard = False
        self.timeline.set_data(
            self.duels,
            self.duration,
            self.selected,
            self.shift,
            self.mpv.time_pos if self.mpv else 0,
        )

    def _refresh_row(self, row: int) -> None:
        if not (0 <= row < len(self.duels)):
            return
        duel = self.duels[row]
        self._table_guard = True
        item = self.table.item(row, 2)
        if item:
            item.setText(_fmt_time(duel.base_start + self.shift))
        item = self.table.item(row, 3)
        if item:
            item.setText(_fmt_time(duel.base_end + self.shift))
        self._table_guard = False

    # ----------------------------- keyframes / previews -----------------------------

    def _step_keyframe(self, direction: int) -> None:
        if not self.keyframes or self.selected < 0:
            return
        duel = self.duels[self.selected]
        current = (duel.base_start if self.active_edge == "start" else duel.base_end) + self.shift
        if direction < 0:
            index = bisect.bisect_left(self.keyframes, current - 0.001) - 1
        else:
            index = bisect.bisect_right(self.keyframes, current + 0.001)
        if index < 0 or index >= len(self.keyframes):
            return
        value = self.keyframes[index]
        self._set_boundary(self.active_edge, value)
        self._seek(value)

    def _schedule_preview(self) -> None:
        self._preview_timer.start(300)

    def _update_previews(self) -> None:
        if not self.video_path or self.selected < 0 or not self.video_path.is_file():
            return
        duel = self.duels[self.selected]
        start = max(0.0, duel.base_start + self.shift)
        end = max(start + 0.04, duel.base_end + self.shift)
        self._preview_seq += 1
        seq = self._preview_seq
        path = str(self.video_path)
        ffmpeg = self.cfg.ffmpeg_path

        def grab(progress=None):
            return [
                self._extract_frame(ffmpeg, path, start),
                self._extract_frame(ffmpeg, path, max(0.0, end - 0.04)),
            ]

        def done(frames) -> None:
            if seq != self._preview_seq:
                return
            for label, data in zip((self.preview_start, self.preview_end), frames):
                pix = QPixmap()
                if data:
                    pix.loadFromData(data, "PNG")
                label.setPixmap(pix.scaled(label.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation))

        self._run(grab, done, lambda _text: None)

    def _extract_frame(self, ffmpeg: str, path: str, seconds: float) -> bytes:
        cmd = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{seconds:.3f}",
            "-i",
            path,
            "-frames:v",
            "1",
            "-vf",
            "scale=400:-2",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return proc.stdout if proc.returncode == 0 else b""

    # ----------------------------- cutting -----------------------------

    def _pick_output(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Папка результатов", self.edit_out.text())
        if path:
            self.cfg.output_dir = path
            self.cfg.save()
            self.edit_out.setText(path)

    def _start_cut(self) -> None:
        if not self.video_path or not self.video_path.is_file():
            self._error("Сначала выберите видео")
            return
        included = [d for d in self.duels if d.include]
        if not included:
            self._error("Нет отмеченных поединков")
            return
        out_dir = Path(self.cfg.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        jobs: list[CutJob] = []
        for duel in included:
            start = duel.base_start + self.shift
            end = duel.base_end + self.shift
            if self.duration:
                start = max(0.0, min(self.duration - 0.04, start))
                end = max(start + 0.04, min(self.duration, end))
            if end - start < 0.05:
                continue
            ctx = {
                "дата": self.current_event.date if self.current_event else "",
                "мероприятие": self.current_event.title if self.current_event else "",
                "номер": str(duel.order),
                "игрок1": duel.p1,
                "игрок2": duel.p2,
                "ситуация": duel.situation,
            }
            filename = render_filename(self.cfg.template, ctx)
            jobs.append(CutJob(self.video_path, out_dir / filename, start, end))
        if not jobs:
            self._error("Нет корректных фрагментов")
            return
        existing = [job.output.name for job in jobs if job.output.exists()]
        if existing and QMessageBox.question(
            self,
            "Перезапись",
            f"Уже есть файлы ({len(existing)}). Перезаписать?",
        ) != QMessageBox.Yes:
            return
        self.progress.setVisible(True)
        self.progress.setValue(0)
        self.btn_cut.setEnabled(False)
        self.lbl_cut.setText("Нарезка…")
        crf = int(self.spin_crf.value())
        preset = self.combo_preset.currentText()
        ffmpeg = self.cfg.ffmpeg_path

        def run_cut(progress):
            def on_progress(index: int, total: int, frac: float, path: Path) -> None:
                progress(int(((index - 1) + frac) / max(1, total) * 1000), 1000, f"{index}/{total} {path.name}")

            return cut_many(jobs, ffmpeg=ffmpeg, crf=crf, preset=preset, progress=on_progress)

        def done(paths) -> None:
            self.btn_cut.setEnabled(True)
            self.progress.setValue(1000)
            self.lbl_cut.setText(f"Готово: {len(paths)} файл(ов) в {out_dir}")
            self._status("Нарезка завершена")
            QMessageBox.information(self, "Нарезка", f"Готово: {len(paths)} файл(ов)\n{out_dir}")

        def failed(text: str) -> None:
            self.btn_cut.setEnabled(True)
            self.progress.setVisible(False)
            self.lbl_cut.setText("Ошибка нарезки")
            self._error(text)

        self._run(run_cut, done, failed, pass_progress=True)

    def _open_output(self) -> None:
        path = Path(self.cfg.output_dir)
        path.mkdir(parents=True, exist_ok=True)
        os.startfile(path)  # noqa: S606
