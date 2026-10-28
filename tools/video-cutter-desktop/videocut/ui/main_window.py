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
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFileDialog,
    QFormLayout,
    QGridLayout,
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
from ..session import load_session, save_session
from ..uploader import UploadError, UploadItem, UploadPlan, day_video_title, drive_folder_name, run_upload
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
        self._workers: set[Worker] = set()

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
        self._restoring = False
        self.source_mode = ""
        self.json_path = ""
        self._session = load_session()
        self._skip_auto_event = bool(self._session)
        self._restore_session = dict(self._session) if self._session else None

        self._build_ui()
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._on_tick)
        self._timer.start(100)
        self._preview_timer = QTimer(self)
        self._preview_timer.setSingleShot(True)
        self._preview_timer.timeout.connect(self._update_previews)
        self._window_timer = QTimer(self)
        self._window_timer.setSingleShot(True)
        self._window_timer.timeout.connect(self._stop_window)
        self._session_timer = QTimer(self)
        self._session_timer.setSingleShot(True)
        self._session_timer.timeout.connect(self._save_session)
        QTimer.singleShot(0, self._equalize_split)
        QTimer.singleShot(200, self._bootstrap)

    def _build_ui(self) -> None:
        split = QSplitter(Qt.Horizontal)
        split.setChildrenCollapsible(False)
        self.setCentralWidget(split)

        left = QWidget()
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(10, 10, 10, 10)

        inspect_group = QGroupBox("Работа с поединком")
        inspect_layout = QVBoxLayout(inspect_group)
        self.lbl_selected = QLabel("Поединок не выбран")
        self.lbl_selected.setStyleSheet("font-size:15px;font-weight:600;")
        inspect_layout.addWidget(self.lbl_selected)

        bounds = QGridLayout()
        bounds.setHorizontalSpacing(14)
        bounds.setVerticalSpacing(8)
        bounds.setColumnStretch(0, 1)
        bounds.setColumnStretch(1, 1)

        self.spin_start = QDoubleSpinBox()
        self.spin_end = QDoubleSpinBox()
        for spin in (self.spin_start, self.spin_end):
            spin.setRange(0.0, 999999.0)
            spin.setDecimals(3)
            spin.setSingleStep(0.04)
            spin.setKeyboardTracking(False)
            spin.setCorrectionMode(QAbstractSpinBox.CorrectToPreviousValue)
            spin.valueChanged.connect(self._spin_changed)

        start_head = QHBoxLayout()
        start_head.addWidget(QLabel("Начало"))
        start_head.addWidget(self.spin_start, 1)
        end_head = QHBoxLayout()
        end_head.addWidget(QLabel("Конец"))
        end_head.addWidget(self.spin_end, 1)
        bounds.addLayout(start_head, 0, 0)
        bounds.addLayout(end_head, 0, 1)

        self.preview_start = QLabel("кадр начала")
        self.preview_end = QLabel("кадр конца")
        for label in (self.preview_start, self.preview_end):
            label.setMinimumSize(200, 140)
            label.setFixedHeight(190)
            label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
            label.setAlignment(Qt.AlignCenter)
            label.setStyleSheet("background:#05070a;color:#566;border:1px solid #2a3038;")
        bounds.addWidget(self.preview_start, 1, 0)
        bounds.addWidget(self.preview_end, 1, 1)

        self.btn_start_prev = QPushButton("◀ старт")
        self.btn_start_prev.setToolTip("Сдвинуть начало на предыдущий I-кадр")
        self.btn_start_prev.clicked.connect(lambda: self._step_edge("start", -1))
        self.btn_start_next = QPushButton("старт ▶")
        self.btn_start_next.setToolTip("Сдвинуть начало на следующий I-кадр")
        self.btn_start_next.clicked.connect(lambda: self._step_edge("start", 1))
        self.btn_play_start = self._button("▶ первые 20 с", lambda: self._play_window("start"))
        self.btn_play_start.setToolTip("Проиграть первые 20 секунд выбранного поединка")
        self.btn_start_here = self._button("Начало здесь", lambda: self._set_here("start"))

        self.btn_end_prev = QPushButton("◀ конец")
        self.btn_end_prev.setToolTip("Сдвинуть конец на предыдущий I-кадр")
        self.btn_end_prev.clicked.connect(lambda: self._step_edge("end", -1))
        self.btn_end_next = QPushButton("конец ▶")
        self.btn_end_next.setToolTip("Сдвинуть конец на следующий I-кадр")
        self.btn_end_next.clicked.connect(lambda: self._step_edge("end", 1))
        self.btn_play_end = self._button("▶ последние 20 с", lambda: self._play_window("end"))
        self.btn_play_end.setToolTip("Проиграть последние 20 секунд выбранного поединка")
        self.btn_end_here = self._button("Конец здесь", lambda: self._set_here("end"))

        start_actions = QVBoxLayout()
        start_step = QHBoxLayout()
        start_step.addWidget(self.btn_start_prev)
        start_step.addWidget(self.btn_start_next)
        start_step.addStretch(1)
        start_use = QHBoxLayout()
        start_use.addWidget(self.btn_play_start)
        start_use.addWidget(self.btn_start_here)
        start_use.addStretch(1)
        start_actions.addLayout(start_step)
        start_actions.addLayout(start_use)
        bounds.addLayout(start_actions, 2, 0)

        end_actions = QVBoxLayout()
        end_step = QHBoxLayout()
        end_step.addWidget(self.btn_end_prev)
        end_step.addWidget(self.btn_end_next)
        end_step.addStretch(1)
        end_use = QHBoxLayout()
        end_use.addWidget(self.btn_play_end)
        end_use.addWidget(self.btn_end_here)
        end_use.addStretch(1)
        end_actions.addLayout(end_step)
        end_actions.addLayout(end_use)
        bounds.addLayout(end_actions, 2, 1)

        self.lbl_kf = QLabel("I-кадры: —")
        self.lbl_kf.setStyleSheet("color:#8a96a3;")
        bottom_row = QHBoxLayout()
        self.lbl_kf.setToolTip("Превью обновляются автоматически при смене поединка, границ и сдвига")
        bottom_row.addWidget(self.lbl_kf, 1)
        bounds.addLayout(bottom_row, 3, 0, 1, 2)

        inspect_layout.addLayout(bounds)
        for btn in (
            self.btn_play_start,
            self.btn_play_end,
            self.btn_start_prev,
            self.btn_start_next,
            self.btn_end_prev,
            self.btn_end_next,
            self.btn_start_here,
            self.btn_end_here,
        ):
            btn.setEnabled(False)
        left_layout.addWidget(inspect_group)
        left_layout.addStretch(1)
        split.addWidget(left)

        right_split = QSplitter(Qt.Vertical)
        right_split.setChildrenCollapsible(False)

        controls_scroll = QScrollArea()
        controls_scroll.setWidgetResizable(True)
        controls_scroll.setMinimumWidth(560)
        controls = QWidget()
        controls_layout = QVBoxLayout(controls)
        controls_layout.setContentsMargins(8, 8, 8, 8)
        controls_scroll.setWidget(controls)
        right_split.addWidget(controls_scroll)

        event_group = QGroupBox("Мероприятие")
        event_layout = QVBoxLayout(event_group)
        row = QHBoxLayout()
        self.combo = QComboBox()
        self.combo.setSizeAdjustPolicy(QComboBox.AdjustToMinimumContentsLengthWithIcon)
        self.combo.setMinimumContentsLength(18)
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
        self.lbl_cal.setWordWrap(True)
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
        self.btn_cal = self._button("Автостарт", self._calibrate)
        shift_row.addWidget(self.btn_cal)
        shift_row.addStretch(1)
        event_layout.addLayout(shift_row)
        controls_layout.addWidget(event_group)

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
        controls_layout.addWidget(table_group, 1)

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
        self.chk_fast = QCheckBox("Умная нарезка: точный старт, быстро")
        self.chk_fast.setChecked(True)
        self.chk_fast.setToolTip(
            "Перекодируется только первый фрагмент до ближайшего I-кадра (обычно 5–35 с), "
            "остальное копируется без перекодирования. Старт и конец точные. "
            "Снимите галочку, чтобы перекодировать весь фрагмент (медленно, максимальная точность)."
        )
        cut_layout.addWidget(self.chk_fast)
        cut_actions = QHBoxLayout()
        self.btn_cut = self._button("Нарезать выбранные", self._start_cut)
        self.btn_upload = self._button("Залить видео…", self._start_upload)
        self.btn_open_out = self._button("Открыть папку", self._open_output)
        cut_actions.addWidget(self.btn_cut)
        cut_actions.addWidget(self.btn_upload)
        cut_actions.addWidget(self.btn_open_out)
        cut_layout.addLayout(cut_actions)
        self.progress = QProgressBar()
        self.progress.setRange(0, 1000)
        self.progress.setVisible(False)
        cut_layout.addWidget(self.progress)
        self.lbl_cut = QLabel("")
        self.lbl_cut.setWordWrap(True)
        cut_layout.addWidget(self.lbl_cut)
        controls_layout.addWidget(cut_group)

        self.lbl_status = QLabel("Готово")
        self.lbl_status.setWordWrap(True)
        self.lbl_status.setStyleSheet("color:#8a96a3;")
        controls_layout.addWidget(self.lbl_status)

        video_panel = QWidget()
        video_layout = QVBoxLayout(video_panel)
        video_layout.setContentsMargins(8, 8, 8, 8)

        video_group = QGroupBox("Видео — вспомогательное")
        video_group_layout = QVBoxLayout(video_group)
        self.btn_local_video = self._button("Загрузить видео из Zoom…", self._open_local_video)
        self.btn_local_video.setMinimumHeight(40)
        self.btn_local_video.setStyleSheet("QPushButton{font-weight:600;padding:8px 12px;}")
        video_group_layout.addWidget(self.btn_local_video)
        self.lbl_video = QLabel("Файл не выбран")
        self.lbl_video.setWordWrap(True)
        self.lbl_video.setStyleSheet("color:#8a96a3;")
        video_group_layout.addWidget(self.lbl_video)

        self.video_host = QWidget()
        self.video_host.setMinimumSize(360, 203)
        self.video_host.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.video_host.setAttribute(Qt.WA_NativeWindow, True)
        self.video_host.setStyleSheet("background:#000;")
        video_group_layout.addWidget(self.video_host, 1)

        self.timeline = TimelineWidget()
        self.timeline.seek_requested.connect(self._seek)
        self.timeline.duel_clicked.connect(self._select_duel)
        self.timeline.edge_clicked.connect(self._timeline_edge)
        video_group_layout.addWidget(self.timeline)

        transport = QHBoxLayout()
        self.btn_play = self._button("▶", self._toggle_play, 38)
        self.lbl_time = QLabel("0:00:00.000 / 0:00:00.000")
        self.lbl_time.setMinimumWidth(150)
        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(0, 0)
        self.slider.sliderPressed.connect(self._slider_pressed)
        self.slider.sliderReleased.connect(self._slider_released)
        self.slider.valueChanged.connect(self._slider_moved)
        transport.addWidget(self.btn_play)
        transport.addWidget(self.slider, 1)
        transport.addWidget(self.lbl_time)
        video_group_layout.addLayout(transport)

        nudge = QHBoxLayout()
        nudge.setSpacing(3)
        for delta in (-60, -30, -15, -5, -1, 1, 5, 15, 30, 60):
            btn = self._button(f"{delta:+d}", lambda _=False, d=delta: self._nudge(d))
            btn.setFixedWidth(36)
            nudge.addWidget(btn)
        nudge.addStretch(1)
        video_group_layout.addLayout(nudge)

        video_layout.addWidget(video_group, 1)
        right_split.addWidget(video_panel)
        right_split.setSizes([470, 430])
        split.addWidget(right_split)
        split.setStretchFactor(0, 1)
        split.setStretchFactor(1, 1)
        split.setSizes([1, 1])

    def _equalize_split(self) -> None:
        split = self.centralWidget()
        if not isinstance(split, QSplitter):
            return
        half = max(1, split.width() // 2)
        split.setSizes([half, half])

    def _restore_last_session(self) -> None:
        data = self._restore_session or {}
        if not data:
            return
        self._restoring = True
        try:
            ev = EventState(
                event_id=int(data.get("event_id") or 0),
                title=str(data.get("title") or ""),
                date=str(data.get("date") or ""),
                start_time=str(data.get("start_time") or ""),
                status=str(data.get("status") or ""),
                recording_start_ms=int(data.get("recording_start_ms") or 0),
                recording_start_source=str(data.get("recording_start_source") or "api"),
                media_url=str(data.get("media_url") or ""),
                media_title=str(data.get("media_title") or ""),
            )
            for item in data.get("duels") or []:
                ev.duels.append(
                    Duel(
                        duel_id=int(item.get("duel_id") or 0),
                        order=int(item.get("order") or 0),
                        p1=str(item.get("p1") or ""),
                        p2=str(item.get("p2") or ""),
                        situation=str(item.get("situation") or ""),
                        round_minutes=int(item.get("round_minutes") or 0),
                        proto_start_ms=item.get("proto_start_ms"),
                        proto_end_ms=item.get("proto_end_ms"),
                        base_start=float(item.get("base_start") or 0.0),
                        base_end=float(item.get("base_end") or 0.0),
                        source=str(item.get("source") or "manual"),
                        include=bool(item.get("include", True)),
                    )
                )
            self.current_event = ev if (ev.event_id or ev.title or ev.duels) else None
            self.duels = ev.duels if self.current_event else []
            self.source_mode = str(data.get("source") or "")
            self.json_path = str(data.get("json_path") or "")
            self.shift = float(data.get("shift") or 0.0)
            saved_selected = int(data.get("selected") if data.get("selected") is not None else -1)
            target = saved_selected if 0 <= saved_selected < len(self.duels) else (-1 if not self.duels else 0)
            self.selected = target
            if self.current_event:
                meta = f"{self.current_event.title} · {self.current_event.date}"
                if self.current_event.start_time:
                    meta += " " + self.current_event.start_time[:5]
                meta += f" · {len(self.duels)} поединков"
                self.lbl_meta.setText(meta)
                self._update_cal_label()
            self._populate_table()
            self._spin_guard = True
            self.spin_shift.setValue(self.shift)
            self._spin_guard = False
            if self.duels:
                self._select_duel(target if target >= 0 else 0, seek=False)
            self.timeline.set_data(self.duels, 0.0, self.selected, self.shift, 0.0)
            video_path = str(data.get("video_path") or "")
            if video_path and Path(video_path).is_file():
                self._video_ready(Path(video_path))
                self._status("Продолжаем прошлую сессию")
            elif self.current_event:
                self._status("Состояние восстановлено, видео не найдено — выберите мероприятие заново или загрузите запись")
            else:
                self._status("Прошлая сессия пуста")
        except Exception as exc:
            self.current_event = None
            self.duels = []
            self.selected = -1
            self._status(f"Не удалось восстановить прошлую сессию: {exc}")
        finally:
            self._restoring = False

    def _session_payload(self) -> dict:
        ev = self.current_event
        if ev is None and self.video_path is None:
            return {}
        duels = []
        for d in self.duels:
            duels.append(
                {
                    "duel_id": d.duel_id,
                    "order": d.order,
                    "p1": d.p1,
                    "p2": d.p2,
                    "situation": d.situation,
                    "round_minutes": d.round_minutes,
                    "proto_start_ms": d.proto_start_ms,
                    "proto_end_ms": d.proto_end_ms,
                    "base_start": d.base_start,
                    "base_end": d.base_end,
                    "source": d.source,
                    "include": d.include,
                }
            )
        return {
            "version": 1,
            "saved_at": datetime.now().isoformat(timespec="seconds"),
            "video_path": str(self.video_path) if self.video_path else "",
            "source": self.source_mode,
            "json_path": self.json_path,
            "event_id": ev.event_id if ev else 0,
            "title": ev.title if ev else "",
            "date": ev.date if ev else "",
            "start_time": ev.start_time if ev else "",
            "status": ev.status if ev else "",
            "recording_start_ms": ev.recording_start_ms if ev else 0,
            "recording_start_source": ev.recording_start_source if ev else "",
            "media_url": ev.media_url if ev else "",
            "media_title": ev.media_title if ev else "",
            "selected": self.selected,
            "shift": self.shift,
            "duels": duels,
        }

    def _schedule_session_save(self) -> None:
        if self._restoring or self._closing:
            return
        if hasattr(self, "_session_timer"):
            self._session_timer.start(400)

    def _save_session(self) -> None:
        data = self._session_payload()
        if data:
            try:
                save_session(data)
            except Exception:
                pass

    def _button(self, text: str, slot, width: int | None = None) -> QPushButton:
        btn = QPushButton(text)
        btn.clicked.connect(slot)
        if width:
            btn.setFixedWidth(width)
        return btn

    # ----------------------------- lifecycle -----------------------------

    def _bootstrap(self) -> None:
        if self._restore_session:
            self._restore_last_session()
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
        try:
            self._save_session()
        except Exception:
            pass
        try:
            if self.mpv:
                self.mpv.close()
        except Exception:
            pass
        try:
            self.client.close()
        except Exception:
            pass
        super().closeEvent(event)

    def _status(self, text: str) -> None:
        self.lbl_status.setText(text)

    def _error(self, text: str) -> None:
        self.lbl_status.setText("Ошибка: " + text)
        QMessageBox.warning(self, "Ошибка", text)

    def _run(self, fn, on_done, on_error=None, pass_progress=False) -> None:
        worker = Worker(fn, pass_progress=pass_progress)
        self._workers.add(worker)
        worker.signals.done.connect(on_done)
        worker.signals.error.connect(on_error or self._error)
        worker.signals.done.connect(lambda *_: self._workers.discard(worker))
        worker.signals.error.connect(lambda *_: self._workers.discard(worker))
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
        self.events = [
            ev
            for ev in events
            if str(ev.get("eventType", "")).strip().lower() == "онлайн"
            and str(ev.get("status", "")).strip().lower() == "проведено"
        ]
        self._combo_guard = True
        self.combo.clear()
        for ev in self.events:
            label = f"{ev.get('title', '')} — {ev.get('startsOn', '')}"
            if ev.get("startsAt"):
                label += " " + str(ev["startsAt"])[:5]
            label += f" ({ev.get('duelCount', 0)})"
            self.combo.addItem(label, int(ev.get("id") or 0))
        self._combo_guard = False
        saved_id = int((self._restore_session or {}).get("event_id") or 0)
        if saved_id:
            for i in range(self.combo.count()):
                if int(self.combo.itemData(i) or 0) == saved_id:
                    self._combo_guard = True
                    self.combo.setCurrentIndex(i)
                    self._combo_guard = False
                    break
        if self.events and not self._skip_auto_event:
            self._combo_guard = True
            self.combo.setCurrentIndex(0)
            self._combo_guard = False
            self._load_event(int(self.events[0].get("id") or 0))
        elif self.events:
            if not saved_id:
                self._combo_guard = True
                self.combo.setCurrentIndex(-1)
                self._combo_guard = False
            self._status("Продолжаем прошлую сессию")
        elif self._skip_auto_event:
            self._status("Продолжаем прошлую сессию")
        else:
            self._status("Нет проведённых онлайн-мероприятий с поединками")
        self._skip_auto_event = False
        self._restore_session = None

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
        self.source_mode = "api"
        self.json_path = ""
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
            self._status("На портале нет ссылки на видео — загрузите запись дня из Zoom")
        self._schedule_session_save()

    def _load_remote_video(self, url: str, title: str) -> None:
        if self.video_url == url and self.video_path and self.video_path.is_file():
            return
        self._status("Скачивание видео в кэш…")
        self.progress.setVisible(True)
        self.progress.setValue(0)
        self.video_url = url
        self.lbl_video.setText("Скачивание записи дня…")

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
            self.json_path = path
            self.source_mode = "json"
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
        self._schedule_session_save()

    def _open_local_video(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Загрузить запись дня (Zoom)",
            str(Path.home() / "Documents" / "Zoom"),
            "Видео (*.mp4 *.mov *.mkv *.webm *.m4v);;Все файлы (*)",
        )
        if path:
            self.video_url = ""
            if self.current_event is None:
                self.source_mode = "local"
            self._video_ready(Path(path))
            self._schedule_session_save()

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
        self.lbl_video.setText(path.name)
        self.lbl_video.setToolTip(str(path))
        self._status("Чтение индекса I-кадров…")
        try:
            index = read_index(path)
        except Exception as exc:
            self._error(f"Не удалось прочитать MP4: {exc}")
            return
        self.keyframes = index.keyframes
        self.fps = index.fps or 25.0
        self.duration = index.duration
        step = self.duration / max(1, len(self.keyframes) - 1) if self.keyframes else 0.0
        self.lbl_kf.setText(
            f"I-кадры: {len(self.keyframes)} · fps {self.fps:.3f} · шаг ~{step:.0f} с"
        )
        if not self._ensure_mpv():
            return
        try:
            assert self.mpv is not None
            self.mpv.load(path)
            self.duration = index.duration or self.mpv.duration
        except (MpvError, Exception) as exc:
            self._error(f"mpv не открыл видео: {exc}")
            return
        if (
            not self._restoring
            and self.current_event
            and self.current_event.auto_calibrate(self.duration, self.cfg.tail_sec)
        ):
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
        self._schedule_session_save()

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
        self._seek(self.slider.value() / 1000.0, exact=True)

    def _slider_moved(self, value: int) -> None:
        if self._slider_dragging:
            self.lbl_time.setText(f"{_fmt_time(value / 1000.0)} / {_fmt_time(self.duration)}")

    def _seek(self, seconds: float, exact: bool = False) -> None:
        if not self.mpv:
            return
        seconds = max(0.0, min(self.duration or seconds, seconds))
        try:
            if exact:
                self.mpv.seek_exact(seconds)
            else:
                self.mpv.seek(seconds, keyframes=True)
        except MpvError as exc:
            self._status(str(exc))
        self.timeline.set_playhead(seconds)

    def _nudge(self, delta: int) -> None:
        if not self.mpv:
            return
        self._seek(self.mpv.time_pos + delta, exact=True)

    def _play_window(self, edge: str) -> None:
        if not self.mpv:
            return
        if 0 <= self.selected < len(self.duels):
            duel = self.duels[self.selected]
            start = max(0.0, duel.base_start + self.shift)
            end = max(start + 0.04, duel.base_end + self.shift)
        else:
            start = 0.0
            end = max(0.04, self.duration)
        span = min(20.0, end - start)
        if edge == "end":
            start = max(start, end - span)
        stop_at = start + span
        self._seek(start, exact=True)
        try:
            self.mpv.play()
        except MpvError as exc:
            self._status(str(exc))
            return
        self._window_timer.start(max(100, int(span * 1000)))
        self._status(f"Просмотр: {_fmt_time(start)} — {_fmt_time(stop_at)}")

    def _stop_window(self) -> None:
        if not self.mpv:
            return
        try:
            self.mpv.pause()
        except MpvError:
            pass

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
        self._schedule_session_save()

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
            self._schedule_session_save()

    def _select_duel(self, index: int, seek: bool = True) -> None:
        if not (0 <= index < len(self.duels)):
            return
        changed = index != self.selected
        self.selected = index
        duel = self.duels[index]
        self.active_edge = "start"
        self.lbl_selected.setText(f"#{duel.order} · {duel.label}")
        for btn in (
            self.btn_play_start,
            self.btn_play_end,
            self.btn_start_prev,
            self.btn_start_next,
            self.btn_end_prev,
            self.btn_end_next,
            self.btn_start_here,
            self.btn_end_here,
        ):
            btn.setEnabled(True)
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
            self._seek(duel.base_start + self.shift, exact=True)
        self._schedule_preview()
        self._schedule_session_save()

    def _timeline_edge(self, index: int, edge: str) -> None:
        self._select_duel(index, seek=False)
        self.active_edge = edge
        self._seek(
            (self.duels[index].base_start if edge == "start" else self.duels[index].base_end)
            + self.shift,
            exact=True,
        )

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
        self._schedule_session_save()

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
        self._schedule_session_save()

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

    def _step_edge(self, edge: str, direction: int) -> None:
        self.active_edge = edge
        self._step_keyframe(direction)

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
        self._status(f"I-кадр: {_fmt_time(value)}")

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
        fast = self.chk_fast.isChecked()
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
        self.btn_upload.setEnabled(False)
        mode = "Умная нарезка" if fast else "Точно: перекодирование"
        self.lbl_cut.setText(f"{mode}…")
        crf = int(self.spin_crf.value())
        preset = self.combo_preset.currentText()
        ffmpeg = self.cfg.ffmpeg_path

        def run_cut(progress):
            def on_progress(index: int, total: int, frac: float, path: Path) -> None:
                progress(int(((index - 1) + frac) / max(1, total) * 1000), 1000, f"{index}/{total} {path.name}")

            return cut_many(
                jobs,
                ffmpeg=ffmpeg,
                crf=crf,
                preset=preset,
                smart=fast,
                keyframes=self.keyframes,
                progress=on_progress,
            )

        def done(paths) -> None:
            self.btn_cut.setEnabled(True)
            self.btn_upload.setEnabled(True)
            self.progress.setValue(1000)
            self.lbl_cut.setText(f"Готово: {len(paths)} файл(ов) в {out_dir}")
            self._status("Нарезка завершена")
            QMessageBox.information(self, "Нарезка", f"Готово: {len(paths)} файл(ов)\n{out_dir}")

        def failed(text: str) -> None:
            self.btn_cut.setEnabled(True)
            self.btn_upload.setEnabled(True)
            self.progress.setVisible(False)
            self.lbl_cut.setText("Ошибка нарезки")
            self._error(text)

        self._run(run_cut, done, failed, pass_progress=True)

    def _start_upload(self) -> None:
        if not self.current_event:
            self._error("Сначала выберите мероприятие")
            return
        if not self.video_path or not self.video_path.is_file():
            self._error("Сначала выберите видео")
            return
        if not self.cfg.token:
            self._error("Нет токена портала: проверьте настройки доступа")
            return
        included = [d for d in self.duels if d.include]
        if not included:
            self._error("Нет отмеченных поединков")
            return
        out_dir = Path(self.cfg.output_dir)
        items: list[UploadItem] = []
        missing: list[str] = []
        for duel in included:
            ctx = {
                "дата": self.current_event.date,
                "мероприятие": self.current_event.title,
                "номер": str(duel.order),
                "игрок1": duel.p1,
                "игрок2": duel.p2,
                "ситуация": duel.situation,
            }
            filename = render_filename(self.cfg.template, ctx)
            path = out_dir / filename
            if not path.is_file():
                missing.append(filename)
                continue
            items.append(UploadItem(path, "duel", duel.duel_id, filename))
        if missing:
            self._error("Сначала нарежьте выбранные поединки. Нет файлов:\n" + "\n".join(missing))
            return
        items.insert(
            0,
            UploadItem(
                self.video_path,
                "day",
                0,
                day_video_title(self.current_event.title, self.video_path.name),
            ),
        )
        total_mb = sum(item.path.stat().st_size for item in items) / (1024 * 1024)
        folder_name = drive_folder_name(self.current_event.title, self.current_event.date)
        plan = UploadPlan(
            event_id=self.current_event.event_id,
            event_title=self.current_event.title,
            folder_name=folder_name,
            items=items,
            portal_url=self.cfg.api_base.rstrip("/") + "/?p=events",
            tg_chat_id=int(self.cfg.tg_chat_id),
            tg_topic_id=int(self.cfg.tg_topic_id),
        )
        answer = QMessageBox.question(
            self,
            "Залить видео",
            "Загрузить в Google Drive и опубликовать?\n\n"
            f"Папка: {folder_name}\n"
            f"Файлов: {len(items)}, {total_mb:.0f} МБ\n"
            "Портал: ссылки на поединки и полную запись\n"
            "Telegram: я-ИТ-ы. Стрим развития Управленческих навыков / General\n\n"
            "При первом запуске откроется браузер для доступа к Drive (аккаунт mzaborov@ciocdo.ru).",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        )
        if answer != QMessageBox.Yes:
            return
        self.progress.setVisible(True)
        self.progress.setValue(0)
        self.btn_cut.setEnabled(False)
        self.btn_upload.setEnabled(False)
        self.lbl_cut.setText("Заливка в Google Drive…")

        def run_upload_worker(progress):
            def on_progress(stage: str, frac: float, label: str) -> None:
                progress(int(frac * 1000), 1000, label)

            return run_upload(self.cfg, plan, on_progress)

        def done(result) -> None:
            self.btn_cut.setEnabled(True)
            self.btn_upload.setEnabled(True)
            self.progress.setValue(1000)
            self.lbl_cut.setText(
                f"Готово: {len(result.files)} файл(ов), ссылки на портале, Telegram отправлен"
            )
            QApplication.clipboard().setText(result.folder_url)
            self._status("Видео загружены")
            QMessageBox.information(
                self,
                "Заливка видео",
                f"Готово: {len(result.files)} файл(ов)\n"
                f"Ссылка на папку скопирована:\n{result.folder_url}\n\n"
                f"Скриншот: {result.screenshot}",
            )

        def failed(text: str) -> None:
            self.btn_cut.setEnabled(True)
            self.btn_upload.setEnabled(True)
            self.progress.setVisible(False)
            self.lbl_cut.setText("Ошибка заливки")
            self._error(text)

        self._run(run_upload_worker, done, failed, pass_progress=True)

    def _open_output(self) -> None:
        path = Path(self.cfg.output_dir)
        path.mkdir(parents=True, exist_ok=True)
        os.startfile(path)  # noqa: S606
