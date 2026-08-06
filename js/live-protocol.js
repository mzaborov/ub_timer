/*--------------------------Протокол → Google (фаза A)----------------------------*/

var LIVE_PROTOCOL_URL_KEY = "ub-timer-live-protocol-url";
var LIVE_PROTOCOL_KEY_KEY = "ub-timer-live-protocol-key";
var LIVE_PROTOCOL_ENABLED_KEY = "ub-timer-live-protocol-enabled";

/** Web App GAS (не секрет). Переопределение — localStorage, если URL вида …/macros/s/…/exec */
var LIVE_PROTOCOL_DEFAULT_URL =
    "https://script.google.com/macros/s/AKfycbxbWIMTYLPKAY2RRbC_-XgDPVEvH5kgD_Dz4XP0u0g2RoriiQGMuMoV-33u9ruAwfjq6w/exec";
/** Должен совпадать с Script Property LIVE_PROTOCOL_KEY */
var LIVE_PROTOCOL_DEFAULT_KEY = "ub-live-2026";

function setGoogleCompositionContext_(meeting) {
    if (!meeting || !meeting.name || !meeting.columns || !meeting.columns.length) {
        googleCompositionContext = null;
        return;
    }
    var cols = [];
    for (var i = 0; i < meeting.columns.length; i++) {
        var c0 = meeting.columns[i];
        if (typeof c0 !== "number" || isNaN(c0) || c0 < 0) continue;
        cols.push(c0 + 1); // CSV/матрица 0-based → лист 1-based
    }
    googleCompositionContext = {
        meetingName: String(meeting.name).trim(),
        columnsSheet1Based: cols,
        snapshotCells: (meeting.snapshotCells && meeting.snapshotCells.length) ? meeting.snapshotCells.slice() : null
    };
    updateProtocolGoogleMenuItems_();
}

function clearGoogleCompositionContext_() {
    googleCompositionContext = null;
    updateProtocolGoogleMenuItems_();
}

function hasGoogleCompositionContextForProtocol_() {
    return !!(googleCompositionContext
        && googleCompositionContext.meetingName
        && googleCompositionContext.columnsSheet1Based
        && duelsList
        && googleCompositionContext.columnsSheet1Based.length === duelsList.length);
}

function hasGoogleProtocolLoadSnapshot_() {
    return !!(hasGoogleCompositionContextForProtocol_()
        && googleCompositionContext.snapshotCells
        && googleCompositionContext.snapshotCells.length);
}

function updateProtocolGoogleMenuItems_() {
    var saveEl = document.getElementById("protocol-google-save-item");
    var clearEl = document.getElementById("protocol-google-clear-item");
    var canSave = hasGoogleCompositionContextForProtocol_();
    var canClear = hasGoogleProtocolLoadSnapshot_();
    function setItem(el, ok, titleOff) {
        if (!el) return;
        if (ok) {
            el.classList.remove("disabled");
            el.removeAttribute("aria-disabled");
            el.removeAttribute("title");
        } else {
            el.classList.add("disabled");
            el.setAttribute("aria-disabled", "true");
            el.setAttribute("title", titleOff);
        }
    }
    setItem(saveEl, canSave, "Доступно только после загрузки расписания из Google");
    setItem(clearEl, canClear, "Нет снимка на момент загрузки — загрузите расписание из Google");
}

function isLiveProtocolEnabled() {
    try {
        return localStorage.getItem(LIVE_PROTOCOL_ENABLED_KEY) === "1";
    } catch (e) {
        return false;
    }
}

function setLiveProtocolEnabled(on) {
    try {
        localStorage.setItem(LIVE_PROTOCOL_ENABLED_KEY, on ? "1" : "0");
    } catch (e) {}
    updateLiveProtocolToggleLabel_();
}

function updateLiveProtocolToggleLabel_() {
    var el = document.getElementById("protocol-live-toggle-item");
    if (!el) return;
    var on = isLiveProtocolEnabled();
    el.innerHTML = '<i class="fa-solid fa-circle-' + (on ? "play" : "pause") + ' me-2"></i>Live-запись: ' + (on ? "вкл" : "выкл");
    el.title = on
        ? "Live-запись включена: состав, ситуация, жребий, голоса → Google"
        : "Live-запись выключена";
}

function toggleLiveProtocolRecording(ev) {
    if (ev) ev.preventDefault();
    if (!duelsList || !duelsList.length) {
        showAppToast_("Сначала загрузите расписание.", "err");
        return false;
    }
    setLiveProtocolEnabled(!isLiveProtocolEnabled());
    showAppToast_(isLiveProtocolEnabled() ? "Live-запись включена" : "Live-запись выключена", "info");
    return false;
}

function closeProtocolSubmenu_() {
    var li = document.getElementById("protocol-submenu");
    if (li) li.classList.remove("show");
    var toggle = document.getElementById("protocol-submenu-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function toggleProtocolSubmenu_(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    if (!duelsList || !duelsList.length) {
        alert("Сначала загрузите файл расписания.");
        return false;
    }
    var li = document.getElementById("protocol-submenu");
    if (!li) return false;
    var open = !li.classList.contains("show");
    li.classList.toggle("show", open);
    var toggle = document.getElementById("protocol-submenu-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
        updateLiveProtocolToggleLabel_();
        updateProtocolGoogleMenuItems_();
    }
    return false;
}

function onProtocolSubmenuItem_(event, action) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    }
    if (action === "file") {
        closeFileMenuDropdown_();
        tryBuildProtocolAndDownload(null);
    } else if (action === "google-save") {
        if (!hasGoogleCompositionContextForProtocol_()) {
            alert("Сохранить в Google можно только после загрузки расписания из Google.");
            return false;
        }
        closeFileMenuDropdown_();
        saveProtocolToGoogle_();
    } else if (action === "google-clear") {
        if (!hasGoogleProtocolLoadSnapshot_()) {
            alert("Очистить Google можно после загрузки расписания из Google (нужен снимок на момент загрузки).");
            return false;
        }
        closeFileMenuDropdown_();
        clearProtocolInGoogle_();
    } else if (action === "live-toggle") {
        toggleLiveProtocolRecording(null);
        // подменю не закрываем — видно новое состояние
    }
    return false;
}

function normalizePersonNameForMatch_(s) {
    return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * UI Player1/Player2 после жребия могут быть переставлены относительно Команда 1/2.
 * Ориентир команд — duelAssignments (мигание жребия их не трогает).
 */
function isUiSidesFlippedVsGoogle_(duelIdx) {
    if (!duelsList || !duelAssignments || duelIdx == null) return false;
    var duel = duelsList[duelIdx];
    var a = duelAssignments[duelIdx];
    if (!duel || !a) return false;
    var assignP1 = a.player1Id ? getPersonName(a.player1Id) : "";
    var uiP1 = duel.Player1 || "";
    if (!normalizePersonNameForMatch_(assignP1) || !normalizePersonNameForMatch_(uiP1)) return false;
    return normalizePersonNameForMatch_(uiP1) !== normalizePersonNameForMatch_(assignP1);
}

/** UI-голос/whoStarts 1|2 → номер команды в Google 1|2. */
function mapUiSideToGoogleTeam_(duelIdx, uiSide) {
    var side = uiSide === 2 ? 2 : 1;
    if (isUiSidesFlippedVsGoogle_(duelIdx)) return side === 1 ? 2 : 1;
    return side;
}

function formatSituationCellForGoogle_(duel) {
    if (!duel) return "";
    var num = duel.SituationNum != null ? String(duel.SituationNum).trim() : "";
    var name = duel.SituationName != null ? String(duel.SituationName).trim() : "";
    if (num && name) return num + "-" + name;
    return num || name || "";
}

function isValidLiveProtocolUrl_(url) {
    var s = String(url || "").trim();
    return /^https:\/\/script\.google\.com\/macros\/s\/[^/\s]+\/exec\/?$/i.test(s);
}

/** Убрать кривые значения из prompt (например ключ вместо URL). */
function sanitizeLiveProtocolLocalStorage_() {
    try {
        var url = localStorage.getItem(LIVE_PROTOCOL_URL_KEY) || "";
        if (url && !isValidLiveProtocolUrl_(url)) {
            localStorage.removeItem(LIVE_PROTOCOL_URL_KEY);
        }
        var key = localStorage.getItem(LIVE_PROTOCOL_KEY_KEY);
        if (key != null && !String(key).trim()) {
            localStorage.removeItem(LIVE_PROTOCOL_KEY_KEY);
        }
    } catch (e) {}
}

function ensureLiveProtocolConfig_() {
    sanitizeLiveProtocolLocalStorage_();
    var url = "";
    var key = "";
    try {
        url = (localStorage.getItem(LIVE_PROTOCOL_URL_KEY) || "").trim();
        key = localStorage.getItem(LIVE_PROTOCOL_KEY_KEY);
        key = key == null ? "" : String(key);
    } catch (e) {}
    if (!isValidLiveProtocolUrl_(url)) url = LIVE_PROTOCOL_DEFAULT_URL;
    if (!key) key = LIVE_PROTOCOL_DEFAULT_KEY;
    return { url: url, key: key };
}

function showAppToast_(message, kind, durationMs) {
    var el = document.getElementById("app-toast");
    if (!el) return;
    var text = String(message || "").trim();
    if (!text) return;
    el.textContent = text;
    el.classList.remove("app-toast-ok", "app-toast-err", "app-toast-info", "app-toast-visible");
    if (kind === "ok") el.classList.add("app-toast-ok");
    else if (kind === "err") el.classList.add("app-toast-err");
    else el.classList.add("app-toast-info");
    el.hidden = false;
    // reflow for transition
    void el.offsetWidth;
    el.classList.add("app-toast-visible");
    clearTimeout(showAppToast_._t);
    var ms = typeof durationMs === "number" ? durationMs : (kind === "err" ? 5000 : 3200);
    showAppToast_._t = setTimeout(function () {
        el.classList.remove("app-toast-visible");
        setTimeout(function () { el.hidden = true; }, 220);
    }, ms);
}

function setProtocolGoogleBusy_(busy) {
    var ids = ["protocol-google-save-item", "protocol-google-clear-item"];
    for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (!el) continue;
        if (busy) {
            el.classList.add("disabled");
            el.setAttribute("aria-disabled", "true");
        }
    }
    if (!busy) updateProtocolGoogleMenuItems_();
}

function resolveGoogleCompositionContextForSave_() {
    if (!hasGoogleCompositionContextForProtocol_()) {
        return Promise.reject(new Error("Сохранение в Google доступно только после загрузки расписания из Google."));
    }
    return Promise.resolve(googleCompositionContext);
}

/** Раскладка судей в сетке состава: 9→0, 7→1, 5→2 (как import-protocols). */
function getGoogleJudgeLayout_(judgeCount) {
    var count = normalizeRefereeQty(judgeCount);
    return { offset: Math.floor((9 - count) / 2), count: count };
}

/**
 * Имена и голоса — плотный порядок слотов поединка, затем центрирование в 9 ячеек.
 * Экспресс: j3–j7 → Судья 3–7; классика 7 → Судья 2–8; 9 → 1–9.
 */
function buildGoogleJudgesAndVotes_(duelIdx) {
    var duel = duelsList[duelIdx] || {};
    var a = duelAssignments[duelIdx] || {};
    var slots = (typeof getJudgeSlotsForDuel === "function")
        ? getJudgeSlotsForDuel(duelIdx)
        : [];
    var layout = getGoogleJudgeLayout_(slots.length || duel.RefereeQty || 9);

    var namesDense = [];
    for (var s = 0; s < layout.count; s++) {
        var name = "";
        var slotKey = slots[s];
        if (slotKey && slotKey.indexOf("j") === 0) {
            var ji = parseInt(slotKey.slice(1), 10);
            if (!isNaN(ji) && a.judges && a.judges[ji] && a.judges[ji].personId) {
                name = getPersonName(a.judges[ji].personId) || "";
            }
        }
        namesDense.push(name);
    }

    var votesDense = [];
    if (sessionPhase === "judges" && String(currentDuel) === String(duelIdx)
        && typeof refereeList !== "undefined" && refereeList) {
        for (var ri = 0; ri < refereeList.length; ri++) {
            if (refereeList[ri].visible) votesDense.push(refereeList[ri].vote);
        }
    } else if (duel.JudgeVotes && Array.isArray(duel.JudgeVotes)) {
        votesDense = duel.JudgeVotes.slice();
    }
    while (votesDense.length < layout.count) votesDense.push(0);
    if (votesDense.length > layout.count) votesDense = votesDense.slice(0, layout.count);

    var judges = [];
    var votes = [];
    for (var slot = 0; slot < 9; slot++) {
        judges.push("");
        votes.push("");
    }
    for (var i = 0; i < layout.count; i++) {
        var gSlot = layout.offset + i;
        judges[gSlot] = namesDense[i] || "";
        var raw = votesDense[i];
        // Голос = UI-игрок (1/2), не Google «Команда». Маппинг только для «Начинал».
        if (raw === 1 || raw === 2) {
            votes[gSlot] = raw;
        } else {
            votes[gSlot] = "";
        }
    }
    return { judges: judges, votes: votes, judgeCount: layout.count };
}

function buildGoogleProtocolDuelPayload_(duelIdx, sheetCol) {
    var duel = duelsList[duelIdx] || {};
    var a = duelAssignments[duelIdx] || {};
    var jv = buildGoogleJudgesAndVotes_(duelIdx);
    var started = null;
    if (String(currentDuel) === String(duelIdx) && (sessionPhase === "round" || sessionPhase === "judges" || duel_is_active)) {
        // После жеребьёвки «Начинал» = Google-команда UI Игрок №1 (не current_player / синяя подсветка).
        var team = mapUiSideToGoogleTeam_(duelIdx, 1);
        started = "Команда " + team;
    }
    return {
        column: sheetCol,
        situation: formatSituationCellForGoogle_(duel),
        player1: a.player1Id ? (getPersonName(a.player1Id) || "") : (duel.Player1 || ""),
        second1: a.second1Id ? (getPersonName(a.second1Id) || "") : (duel.Second1 || ""),
        player2: a.player2Id ? (getPersonName(a.player2Id) || "") : (duel.Player2 || ""),
        second2: a.second2Id ? (getPersonName(a.second2Id) || "") : (duel.Second2 || ""),
        judges: jv.judges,
        votes: jv.votes,
        judgeCount: jv.judgeCount,
        started: started
    };
}

function postLiveProtocol_(payload) {
    var cfg = ensureLiveProtocolConfig_();
    if (!cfg) return Promise.reject(new Error("URL/ключ не заданы"));
    return fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: "follow"
    }).then(function (resp) {
        return resp.text().then(function (text) {
            var data = null;
            try { data = JSON.parse(text); } catch (e) { data = null; }
            if (!resp.ok) {
                throw new Error((data && data.error) || ("HTTP " + resp.status));
            }
            if (data && data.ok === false) {
                throw new Error(data.error || "Ошибка GAS");
            }
            return data || { ok: true, raw: text };
        });
    });
}

/** Полный save встречи (как кнопка «Сохранить в Google»). */
function postLiveProtocolFullSave_() {
    var cfg = ensureLiveProtocolConfig_();
    if (!cfg) return Promise.reject(new Error("URL/ключ не заданы"));
    if (!duelsList || !duelsList.length) {
        return Promise.reject(new Error("Сначала загрузите расписание из Google."));
    }
    return resolveGoogleCompositionContextForSave_().then(function (ctx) {
        var duels = [];
        for (var i = 0; i < duelsList.length; i++) {
            duels.push(buildGoogleProtocolDuelPayload_(i, ctx.columnsSheet1Based[i]));
        }
        return postLiveProtocol_({
            action: "save",
            key: cfg.key,
            meetingName: ctx.meetingName,
            duels: duels
        });
    });
}

function saveProtocolToGoogle_() {
    if (!duelsList || !duelsList.length) {
        showAppToast_("Сначала загрузите расписание из Google.", "err");
        return;
    }
    if (!hasGoogleCompositionContextForProtocol_()) {
        showAppToast_("Сохранение доступно только после загрузки из Google.", "err");
        return;
    }
    if (!ensureLiveProtocolConfig_()) return;
    setProtocolGoogleBusy_(true);
    showAppToast_("Сохраняю протокол в Google…", "info", 15000);
    showLoadDiagnostics("Google", [], [], "Сохранение протокола в Google…");
    postLiveProtocolFullSave_()
        .then(function (res) {
            var msg = (res && res.message) ? res.message : "Протокол сохранён в Google.";
            showLoadDiagnostics("Google", [], [], msg);
            showAppToast_(msg, "ok");
        })
        .catch(function (err) {
            var msg = (err && err.message) ? err.message : String(err);
            showLoadDiagnostics("Google", [msg], [], null);
            console.error("saveProtocolToGoogle_", err);
            showAppToast_("Не удалось сохранить: " + msg, "err");
        })
        .then(function () {
            setProtocolGoogleBusy_(false);
        });
}

function clearProtocolInGoogle_() {
    if (!duelsList || !duelsList.length) {
        showAppToast_("Сначала загрузите расписание из Google.", "err");
        return;
    }
    if (!hasGoogleProtocolLoadSnapshot_()) {
        showAppToast_("Нет снимка загрузки — загрузите расписание из Google ещё раз.", "err");
        return;
    }
    if (!window.confirm("Вернуть ячейки встречи в Google к состоянию на момент загрузки расписания?")) return;
    var cfg = ensureLiveProtocolConfig_();
    if (!cfg) return;
    setProtocolGoogleBusy_(true);
    showAppToast_("Откатываю Google…", "info", 15000);
    showLoadDiagnostics("Google", [], [], "Откат протокола в Google…");
    resolveGoogleCompositionContextForSave_()
        .then(function (ctx) {
            var columnsFormat = [];
            for (var i = 0; i < duelsList.length; i++) {
                columnsFormat.push({
                    column: ctx.columnsSheet1Based[i],
                    judgeCount: normalizeRefereeQty(duelsList[i].RefereeQty)
                });
            }
            return postLiveProtocol_({
                action: "restore",
                key: cfg.key,
                meetingName: ctx.meetingName,
                cells: ctx.snapshotCells,
                columnsFormat: columnsFormat
            });
        })
        .then(function (res) {
            var msg = (res && res.message) ? res.message : "Google откатан к снимку загрузки.";
            showLoadDiagnostics("Google", [], [], msg);
            showAppToast_(msg, "ok");
        })
        .catch(function (err) {
            var msg = (err && err.message) ? err.message : String(err);
            showLoadDiagnostics("Google", [msg], [], null);
            console.error("clearProtocolInGoogle_", err);
            showAppToast_("Не удалось очистить: " + msg, "err");
        })
        .then(function () {
            setProtocolGoogleBusy_(false);
        });
}

/* ---------- Live-пуш по событиям (фаза B) ---------- */

/** После ошибки Live — полный save, не чаще раза в минуту. */
var LIVE_FULL_SAVE_RECOVERY_MIN_MS = 60000;
var _liveFullSaveRecoveryNeeded = false;
var _liveFullSaveRecoveryTimer = null;
var _liveFullSaveRecoveryLastAt = 0;
var _liveFullSaveRecoveryInFlight = false;

function clearLiveProtocolPendingQueues_() {
    clearTimeout(_liveCompositionTimer);
    clearTimeout(_liveVotesTimer);
    _liveCompositionTimer = null;
    _liveVotesTimer = null;
    _liveCompositionDirty = {};
    _liveCompositionReady = false;
    _liveVotesDirty = {};
    _liveVotesReady = false;
    _liveStartedByDuel = {};
    _liveSituationByDuel = {};
}

function scheduleLiveProtocolFullSaveRecovery_() {
    if (!canLiveProtocolPush_()) return;
    _liveFullSaveRecoveryNeeded = true;
    if (_liveFullSaveRecoveryInFlight) return;
    if (_liveFullSaveRecoveryTimer) return;
    var wait = 0;
    if (_liveFullSaveRecoveryLastAt) {
        wait = Math.max(0, LIVE_FULL_SAVE_RECOVERY_MIN_MS - (Date.now() - _liveFullSaveRecoveryLastAt));
    }
    _liveFullSaveRecoveryTimer = setTimeout(function () {
        _liveFullSaveRecoveryTimer = null;
        runLiveProtocolFullSaveRecovery_();
    }, wait);
}

function runLiveProtocolFullSaveRecovery_() {
    if (!_liveFullSaveRecoveryNeeded) return;
    if (!canLiveProtocolPush_()) {
        _liveFullSaveRecoveryNeeded = false;
        return;
    }
    if (_livePushInFlight || _liveFullSaveRecoveryInFlight) {
        _liveFullSaveRecoveryTimer = setTimeout(function () {
            _liveFullSaveRecoveryTimer = null;
            runLiveProtocolFullSaveRecovery_();
        }, 500);
        return;
    }
    if (_liveFullSaveRecoveryLastAt) {
        var elapsed = Date.now() - _liveFullSaveRecoveryLastAt;
        if (elapsed < LIVE_FULL_SAVE_RECOVERY_MIN_MS) {
            _liveFullSaveRecoveryTimer = setTimeout(function () {
                _liveFullSaveRecoveryTimer = null;
                runLiveProtocolFullSaveRecovery_();
            }, LIVE_FULL_SAVE_RECOVERY_MIN_MS - elapsed);
            return;
        }
    }

    _liveFullSaveRecoveryInFlight = true;
    _livePushInFlight = true;
    showAppToast_("полное сохранение протокола", "info", 15000);
    postLiveProtocolFullSave_()
        .then(function (res) {
            _liveFullSaveRecoveryNeeded = false;
            _liveFullSaveRecoveryLastAt = Date.now();
            clearLiveProtocolPendingQueues_();
            console.log("live-protocol full-save recovery", (res && res.message) || "ok");
            showAppToast_("Live: полное сохранение ок", "ok");
        })
        .catch(function (err) {
            var msg = (err && err.message) ? err.message : String(err);
            console.error("live-protocol full-save recovery", err);
            showAppToast_("Live: полное сохранение не удалось: " + msg, "err");
            _liveFullSaveRecoveryLastAt = Date.now();
            if (_liveFullSaveRecoveryNeeded && !_liveFullSaveRecoveryTimer) {
                _liveFullSaveRecoveryTimer = setTimeout(function () {
                    _liveFullSaveRecoveryTimer = null;
                    runLiveProtocolFullSaveRecovery_();
                }, LIVE_FULL_SAVE_RECOVERY_MIN_MS);
            }
        })
        .then(function () {
            _liveFullSaveRecoveryInFlight = false;
            _livePushInFlight = false;
            drainLiveProtocolQueue_();
        });
}

/** Один in-flight POST; urgent (started/votes/situation) выше composition. */
var _livePushInFlight = false;
var _liveCompositionDirty = {};
var _liveCompositionTimer = null;
var _liveCompositionReady = false;
var _liveVotesDirty = {};
var _liveVotesTimer = null;
var _liveVotesReady = false;
var _liveStartedByDuel = {};
var _liveSituationByDuel = {};
var _liveCompositionSuppressDepth = 0;

function canLiveProtocolPush_() {
    if (typeof isRestoringProtocol !== "undefined" && isRestoringProtocol) return false;
    if (!isLiveProtocolEnabled()) return false;
    if (!hasGoogleCompositionContextForProtocol_()) return false;
    return !!(duelsList && duelsList.length);
}

function withLiveProtocolCompositionSuppressed_(fn) {
    _liveCompositionSuppressDepth++;
    try {
        return fn();
    } finally {
        _liveCompositionSuppressDepth--;
    }
}

function isLiveProtocolCompositionSuppressed_() {
    return _liveCompositionSuppressDepth > 0;
}

function buildLiveProtocolCompositionPayload_(idx) {
    if (!googleCompositionContext || !googleCompositionContext.columnsSheet1Based) return null;
    var col = googleCompositionContext.columnsSheet1Based[idx];
    if (col == null) return null;
    var a = duelAssignments[idx] || {};
    var jv = buildGoogleJudgesAndVotes_(idx);
    return {
        column: col,
        player1: a.player1Id ? (getPersonName(a.player1Id) || "") : "",
        second1: a.second1Id ? (getPersonName(a.second1Id) || "") : "",
        player2: a.player2Id ? (getPersonName(a.player2Id) || "") : "",
        second2: a.second2Id ? (getPersonName(a.second2Id) || "") : "",
        judges: jv.judges,
        votes: jv.votes,
        judgeCount: jv.judgeCount
    };
}

function liveProtocolDirtyIdxs_(map) {
    var idxs = [];
    for (var key in map) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
        var idx = parseInt(key, 10);
        if (!isNaN(idx) && idx >= 0) idxs.push(idx);
    }
    idxs.sort(function (a, b) { return a - b; });
    return idxs;
}

function mergeLiveDuelPayload_(byIdx, idx, patch) {
    if (!byIdx[idx]) byIdx[idx] = { column: patch.column };
    var t = byIdx[idx];
    for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) t[k] = patch[k];
    }
}

/** Собрать срочные payload (latest wins); composition не трогаем. */
function takeLiveProtocolUrgentDuels_() {
    var byIdx = {};
    var idxs;
    var i;
    idxs = liveProtocolDirtyIdxs_(_liveStartedByDuel);
    for (i = 0; i < idxs.length; i++) {
        mergeLiveDuelPayload_(byIdx, idxs[i], _liveStartedByDuel[idxs[i]]);
    }
    _liveStartedByDuel = {};
    idxs = liveProtocolDirtyIdxs_(_liveSituationByDuel);
    for (i = 0; i < idxs.length; i++) {
        mergeLiveDuelPayload_(byIdx, idxs[i], _liveSituationByDuel[idxs[i]]);
    }
    _liveSituationByDuel = {};
    if (_liveVotesReady) {
        idxs = liveProtocolDirtyIdxs_(_liveVotesDirty);
        for (i = 0; i < idxs.length; i++) {
            var vIdx = idxs[i];
            var col = googleCompositionContext.columnsSheet1Based[vIdx];
            if (col == null) continue;
            var jv = buildGoogleJudgesAndVotes_(vIdx);
            mergeLiveDuelPayload_(byIdx, vIdx, {
                column: col,
                votes: jv.votes,
                judgeCount: jv.judgeCount
            });
        }
        _liveVotesDirty = {};
        _liveVotesReady = false;
    }
    var out = [];
    idxs = liveProtocolDirtyIdxs_(byIdx);
    for (i = 0; i < idxs.length; i++) out.push(byIdx[idxs[i]]);
    return out;
}

function takeLiveProtocolCompositionDuels_() {
    if (!_liveCompositionReady) return [];
    _liveCompositionReady = false;
    var idxs = liveProtocolDirtyIdxs_(_liveCompositionDirty);
    _liveCompositionDirty = {};
    var duels = [];
    for (var i = 0; i < idxs.length; i++) {
        var payload = buildLiveProtocolCompositionPayload_(idxs[i]);
        if (payload) duels.push(payload);
    }
    return duels;
}

function hasLiveProtocolUrgentPending_() {
    for (var k in _liveStartedByDuel) {
        if (Object.prototype.hasOwnProperty.call(_liveStartedByDuel, k)) return true;
    }
    for (var s in _liveSituationByDuel) {
        if (Object.prototype.hasOwnProperty.call(_liveSituationByDuel, s)) return true;
    }
    if (_liveVotesReady) {
        for (var v in _liveVotesDirty) {
            if (Object.prototype.hasOwnProperty.call(_liveVotesDirty, v)) return true;
        }
        _liveVotesReady = false; // stale ready без dirty
    }
    return false;
}

function liveProtocolUrgentLabel_(duels) {
    var kinds = {};
    for (var i = 0; i < duels.length; i++) {
        var d = duels[i];
        if (Object.prototype.hasOwnProperty.call(d, "started")) kinds.started = true;
        if (Object.prototype.hasOwnProperty.call(d, "votes")) kinds.votes = true;
        if (Object.prototype.hasOwnProperty.call(d, "situation")) kinds.situation = true;
    }
    var parts = [];
    if (kinds.started) parts.push("started");
    if (kinds.votes) parts.push("votes");
    if (kinds.situation) parts.push("situation");
    return (parts.join("+") || "urgent") + "×" + duels.length;
}

/** Один in-flight: сначала urgent, composition — только если нет срочных (payload пересобирается при отправке). */
function drainLiveProtocolQueue_() {
    if (_livePushInFlight) return;
    if (!canLiveProtocolPush_()) return;
    var cfg = ensureLiveProtocolConfig_();
    if (!cfg) return;

    var duels = null;
    var label = "";
    if (hasLiveProtocolUrgentPending_()) {
        duels = takeLiveProtocolUrgentDuels_();
        label = liveProtocolUrgentLabel_(duels);
    } else if (_liveCompositionReady) {
        duels = takeLiveProtocolCompositionDuels_();
        label = "composition×" + duels.length;
    }
    if (!duels || !duels.length) return;

    var meetingName = googleCompositionContext.meetingName;
    _livePushInFlight = true;
    postLiveProtocol_({
        action: "save",
        key: cfg.key,
        meetingName: meetingName,
        duels: duels
    })
        .then(function (res) {
            if (!res) return;
            console.log("live-protocol", label, res.message || "ok");
        })
        .catch(function (err) {
            var msg = (err && err.message) ? err.message : String(err);
            console.error("live-protocol", label, err);
            showAppToast_("Live: " + msg, "err");
            scheduleLiveProtocolFullSaveRecovery_();
        })
        .then(function () {
            _livePushInFlight = false;
            drainLiveProtocolQueue_();
        });
}

function flushLiveProtocolCompositionDirty_() {
    _liveCompositionTimer = null;
    if (!canLiveProtocolPush_()) {
        _liveCompositionDirty = {};
        _liveCompositionReady = false;
        return;
    }
    // Не собираем payload здесь: если придут started/votes — уйдут первыми, состав пересоберём позже.
    _liveCompositionReady = true;
    drainLiveProtocolQueue_();
}

function notifyLiveProtocolComposition_(duelIdx) {
    var idx = typeof duelIdx === "string" ? parseInt(duelIdx, 10) : duelIdx;
    if (isNaN(idx) || idx < 0) return;
    if (isLiveProtocolCompositionSuppressed_()) return;
    if (!canLiveProtocolPush_()) return;
    _liveCompositionDirty[idx] = true;
    clearTimeout(_liveCompositionTimer);
    _liveCompositionTimer = setTimeout(flushLiveProtocolCompositionDirty_, 400);
}

/** Сразу один POST со всеми переданными поединками (после автоназначения). */
function notifyLiveProtocolCompositionBatch_(duelIdxs) {
    if (!canLiveProtocolPush_()) return;
    if (!duelIdxs || !duelIdxs.length) return;
    for (var i = 0; i < duelIdxs.length; i++) {
        var idx = typeof duelIdxs[i] === "string" ? parseInt(duelIdxs[i], 10) : duelIdxs[i];
        if (isNaN(idx) || idx < 0) continue;
        _liveCompositionDirty[idx] = true;
    }
    clearTimeout(_liveCompositionTimer);
    flushLiveProtocolCompositionDirty_();
}

function notifyLiveProtocolSituation_(duelIdx) {
    var idx = typeof duelIdx === "string" ? parseInt(duelIdx, 10) : duelIdx;
    if (isNaN(idx) || idx < 0 || !canLiveProtocolPush_()) return;
    var col = googleCompositionContext.columnsSheet1Based[idx];
    if (col == null) return;
    _liveSituationByDuel[idx] = {
        column: col,
        situation: formatSituationCellForGoogle_(duelsList[idx])
    };
    drainLiveProtocolQueue_();
}

function notifyLiveProtocolStarted_(duelIdx) {
    var idx = typeof duelIdx === "string" ? parseInt(duelIdx, 10) : duelIdx;
    if (idx == null || idx === "" || idx === "-1") idx = currentDuel;
    idx = typeof idx === "string" ? parseInt(idx, 10) : idx;
    if (isNaN(idx) || idx < 0 || !canLiveProtocolPush_()) return;
    var col = googleCompositionContext.columnsSheet1Based[idx];
    if (col == null) return;
    // После жеребьёвки стартует всегда UI Игрок №1 (факт); current_player после finishDice случаен.
    var team = mapUiSideToGoogleTeam_(idx, 1);
    _liveStartedByDuel[idx] = {
        column: col,
        started: "Команда " + team
    };
    drainLiveProtocolQueue_();
}

function flushLiveProtocolVotesDirty_() {
    _liveVotesTimer = null;
    if (!canLiveProtocolPush_()) {
        _liveVotesDirty = {};
        _liveVotesReady = false;
        return;
    }
    _liveVotesReady = true;
    drainLiveProtocolQueue_();
}

function notifyLiveProtocolVotes_(duelIdx) {
    var idx = typeof duelIdx === "string" ? parseInt(duelIdx, 10) : duelIdx;
    if (idx == null || idx === "" || idx === "-1") idx = currentDuel;
    idx = typeof idx === "string" ? parseInt(idx, 10) : idx;
    if (isNaN(idx) || idx < 0 || !canLiveProtocolPush_()) return;
    var col = googleCompositionContext.columnsSheet1Based[idx];
    if (col == null) return;
    _liveVotesDirty[idx] = true;
    clearTimeout(_liveVotesTimer);
    _liveVotesTimer = setTimeout(flushLiveProtocolVotesDirty_, 200);
}

(function wireProtocolSubmenuClose_() {
    function bind() {
        var btn = document.getElementById("Choose_File_Button_Dropdown");
        if (!btn || btn._protocolSubmenuWired) return;
        btn._protocolSubmenuWired = true;
        btn.addEventListener("hidden.bs.dropdown", closeProtocolSubmenu_);
        btn.addEventListener("hide.bs.dropdown", closeProtocolSubmenu_);
        sanitizeLiveProtocolLocalStorage_();
        updateLiveProtocolToggleLabel_();
        updateProtocolGoogleMenuItems_();
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bind);
    } else {
        bind();
    }
})();
