/*--------------------------Часы → БД: чтение канона (план 06, шаг 2)----------------------------*/
/* Same-origin эндпоинт db.php на хосте часов; без CORS и ключа. Работа без БД сохраняется. */

var DB_API_URL = "db.php";

/** Боевой хост — как favicon в index.html. Прод: только сегодняшние мероприятия. */
function dbScheduleIsProd_() {
    var h = location.hostname;
    return h === "timer.zaborov.ru" || h === "www.timer.zaborov.ru";
}

/** scope списка мероприятий: прод — сегодня; тест/локально — не прошедшие. */
function dbScheduleScope_() {
    return dbScheduleIsProd_() ? "today" : "upcoming";
}

function fetchDatabaseJson_(query, what) {
    if (location.protocol === "file:") {
        return Promise.reject(new Error("База доступна только на сервере (не через file://)"));
    }
    return fetch(DB_API_URL + query, { credentials: "same-origin" })
        .then(function (resp) {
            return resp.text().then(function (txt) {
                var data = null;
                try { data = JSON.parse(txt); } catch (e) {
                    throw new Error(what + ": ответ БД не JSON");
                }
                if (!data || data.ok !== true) {
                    throw new Error((data && data.error) ? (what + ": " + data.error) : (what + ": ошибка БД"));
                }
                return data;
            });
        });
}

/** POST JSON на тот же эндпоинт (для входа орга). */
function postDatabaseJson_(query, body, what) {
    if (location.protocol === "file:") {
        return Promise.reject(new Error("База доступна только на сервере (не через file://)"));
    }
    return fetch(DB_API_URL + query, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body || {})
    }).then(function (resp) {
        return resp.text().then(function (txt) {
            var data = null;
            try { data = JSON.parse(txt); } catch (e) { throw new Error(what + ": ответ БД не JSON"); }
            if (!data || data.ok !== true) {
                throw new Error((data && data.error) ? data.error : (what + ": ошибка БД"));
            }
            return data;
        });
    });
}

/** Обновить надпись пункта «Режим организатора». */
function updateDbOrgUi_() {
    var label = document.getElementById("org-mode-label");
    var item = document.getElementById("org-mode-menu-item");
    if (label) label.textContent = dbOrgMode ? "Организатор: вкл (выйти)" : "Режим организатора";
    if (item) {
        var ico = item.querySelector("i");
        if (ico) ico.className = dbOrgMode ? "fa-solid fa-lock-open me-2" : "fa-solid fa-lock me-2";
    }
    var badge = document.getElementById("org-mode-badge");
    if (badge) badge.style.display = dbOrgMode ? "" : "none";
    if (typeof duelsList !== "undefined" && duelsList && typeof renderDuelChooser === "function"
        && (duelsList.length || (typeof scheduleSource !== "undefined" && scheduleSource === "db"))) {
        renderDuelChooser();
    }
    if (typeof renderJudgesAddDuelTools_ === "function") renderJudgesAddDuelTools_();
}

/** Узнать статус орга на сервере (по cookie). */
function refreshDbOrgStatus_() {
    if (location.protocol === "file:") return Promise.resolve();
    return fetch(DB_API_URL + "?action=org_status", { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d && d.ok) {
                dbOrgMode = !!d.org;
                updateDbOrgUi_();
            }
        })
        .catch(function () { /* без БД — не мешаем */ });
}

function dbOrgLogin_(password) {
    return postDatabaseJson_("?action=org_login", { password: password }, "Вход орга")
        .then(function () {
            dbOrgMode = true;
            updateDbOrgUi_();
            return true;
        });
}

function dbOrgLogout_() {
    return postDatabaseJson_("?action=org_logout", {}, "Выход орга")
        .then(function () {
            dbOrgMode = false;
            updateDbOrgUi_();
        })
        .catch(function () { dbOrgMode = false; updateDbOrgUi_(); });
}

/** Пункт меню «Режим организатора»: войти или выйти. */
function onOrgModeMenuItem_(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    closeFileMenuDropdown_();
    if (dbOrgMode) {
        dbOrgLogout_().then(function () {
            showLoadDiagnostics("Орг", [], [], "Режим организатора выключен.");
        });
        return false;
    }
    var modalEl = document.getElementById("dbOrgLoginModal");
    if (modalEl && typeof bootstrap !== "undefined") {
        var inp = document.getElementById("db-org-password");
        if (inp) inp.value = "";
        var errEl = document.getElementById("db-org-error");
        if (errEl) errEl.textContent = "";
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
        setTimeout(function () { if (inp) inp.focus(); }, 300);
    } else {
        var pw = prompt("Пароль организатора:");
        if (pw) dbOrgLogin_(pw).then(function () { showLoadDiagnostics("Орг", [], [], "Режим организатора включён."); })
            .catch(function (e) { alert("Не удалось войти: " + (e && e.message ? e.message : e)); });
    }
    return false;
}

function submitDbOrgLogin_() {
    var inp = document.getElementById("db-org-password");
    var errEl = document.getElementById("db-org-error");
    var pw = inp ? inp.value : "";
    if (!pw) { if (errEl) errEl.textContent = "Введите пароль"; return; }
    dbOrgLogin_(pw).then(function () {
        var modalEl = document.getElementById("dbOrgLoginModal");
        if (modalEl && typeof bootstrap !== "undefined") {
            var m = bootstrap.Modal.getInstance(modalEl);
            if (m) m.hide();
        }
        showLoadDiagnostics("Орг", [], [], "Режим организатора включён. События «Подготовка» доступны.");
        refreshDbEventsList();
    }).catch(function (e) {
        if (errEl) errEl.textContent = (e && e.message === "bad_password") ? "Неверный пароль" : ("Ошибка: " + (e && e.message ? e.message : e));
    });
}

/** Ярлык сервера → значение experience в часах. */
function dbScheduleExperience_(person) {
    var lbl = person && person.experience_label ? String(person.experience_label) : "";
    return (lbl === "expert" || lbl === "org" || lbl === "experienced" || lbl === "novice") ? lbl : "none";
}

/** Код ситуации в БД: «12-Увидеть лес за деревьями» → num «12», name «Увидеть лес за деревьями». */
function splitSituationCode_(sit) {
    var code = sit ? String(sit.code || "").trim() : "";
    var m = code.match(/^(\d+)/);
    var num = m ? m[1] : (sit && sit.num != null && sit.num !== "" ? String(sit.num) : "");
    var name = code.replace(/^\s*\d+\s*[-–—.:]?\s*/, "").trim();
    return { num: num, name: name || code };
}

/** duelsList из payload БД — форма как у buildDuelsListFromGoogleMeeting_. */
function buildDuelsListFromDatabase_(payload) {
    var out = [];
    var duels = (payload && payload.duels) ? payload.duels : [];
    for (var i = 0; i < duels.length; i++) {
        var src = duels[i];
        var sit = src.situation;
        var sitParts = splitSituationCode_(sit);
        var defaults = googleScheduleDefaultsForType_(src.duel_type || "");
        var roles = null;
        if (sit && sit.roles_json) {
            try {
                roles = JSON.parse(String(sit.roles_json).trim().replace(/^"(.*)"$/, "$1"));
            } catch (e) {
                roles = null;
            }
        }
        var duel = {
            DuelId: src.id,
            DuelNum: i + 1,
            SortOrder: src.sort_order,
            Player1: src.player1 ? src.player1.full_name : "",
            Player2: src.player2 ? src.player2.full_name : "",
            Second1: src.second1 ? src.second1.full_name : "",
            Second2: src.second2 ? src.second2.full_name : "",
            "Cornerman 1": src.second1 ? src.second1.full_name : "",
            "Cornerman 2": src.second2 ? src.second2.full_name : "",
            Player1Id: src.player1 ? src.player1.id : null,
            Player2Id: src.player2 ? src.player2.id : null,
            Second1Id: src.second1 ? src.second1.id : null,
            Second2Id: src.second2 ? src.second2.id : null,
            SituationNum: sit ? sitParts.num : "",
            SituationName: sit ? sitParts.name : "",
            SituationId: sit ? sit.id : null,
            SituationDescription: (sit && sit.description) ? String(sit.description) : "",
            SituationRoles: roles || [],
            Type: defaults.typeLabel,
            DuelMinutesLength: src.round_minutes || defaults.minutes,
            RefereeQty: (src.referee_qty != null ? src.referee_qty : defaults.refereeQty),
            PrepMode: src.prep_mode || ""
        };
        if (!sit) {
            duel.SituationName = "Случайная ситуация";
            duel.wasRandomSlot = true;
        }
        normalizeDuelHiddenFlag(duel);
        out.push(duel);
    }
    return out;
}

/** Судьи и персональные *Id из БД поверх шаблона initDuelAssignmentsFromDuels. */
function applyDatabaseAssignments_(payload) {
    if (typeof initDuelAssignmentsFromDuels === "function") initDuelAssignmentsFromDuels();
    var duels = (payload && payload.duels) ? payload.duels : [];
    for (var i = 0; i < duels.length && i < duelAssignments.length; i++) {
        var d = duels[i];
        var a = duelAssignments[i];
        if (d.player1) a.player1Id = String(d.player1.id);
        if (d.player2) a.player2Id = String(d.player2.id);
        if (d.second1) a.second1Id = String(d.second1.id);
        if (d.second2) a.second2Id = String(d.second2.id);
        while (a.judges.length < 9) a.judges.push({ personId: null, category: "negotiators" });
        var js = d.judges || [];
        var slots = (typeof getJudgeSlotsForDuel === "function") ? getJudgeSlotsForDuel(i) : [];
        var limit = slots.length ? Math.min(js.length, slots.length) : js.length;
        if (js.length > limit && typeof console !== "undefined" && console.warn) {
            console.warn("duel " + d.id + ": в БД " + js.length + " судей, активных слотов " + limit + "; лишние проигнорированы");
        }
        for (var j = 0; j < limit; j++) {
            var slotKey = slots.length ? slots[j] : ("j" + j);
            var idx = parseInt(slotKey.slice(1), 10);
            if (isNaN(idx) || idx < 0) idx = j;
            var slot = a.judges[idx] || (a.judges[idx] = { personId: null, category: "negotiators" });
            if (typeof getSlotCategory === "function") slot.category = getSlotCategory(i, slotKey);
            slot.personId = (js[j].person_id != null) ? String(js[j].person_id) : null;
            if (js[j].vote != null) slot.vote = js[j].vote;
            if (js[j].college != null) slot.college = js[j].college;
        }
    }
}

/** Применить состав из БД к часам. */
function applyDatabaseEvent_(payload) {
    if (!payload || !payload.event) throw new Error("Пустой ответ БД");

    duelsList = buildDuelsListFromDatabase_(payload);

    people = {};
    peopleNextId = 1;
    peopleDirectory = Array.isArray(payload.people_directory) ? payload.people_directory : [];
    var pmap = payload.people || [];
    for (var i = 0; i < pmap.length; i++) {
        var p = pmap[i];
        var key = String(p.id);
        people[key] = {
            id: key,
            fullName: p.full_name || "",
            isActive: true, // участие в текущем онлайне, не глобальный is_active
            experience: dbScheduleExperience_(p),
            notes: ""
        };
    }

    scheduleSource = "db";
    dbEventId = payload.event.id;
    if (typeof clearGoogleCompositionContext_ === "function") clearGoogleCompositionContext_();
    else googleCompositionContext = null;
    if (typeof setLiveProtocolEnabled === "function") setLiveProtocolEnabled(false);

    var fakeName = (payload.event.title ? payload.event.title : "База") + ".xlsx";
    processDuelsJson({ name: fakeName });

    applyDatabaseAssignments_(payload);
    if (typeof renderParticipantsTab === "function") renderParticipantsTab();
    if (typeof renderJudgesLayoutTab === "function") renderJudgesLayoutTab();
    if (typeof saveProtocolStateToLocalStorage === "function") saveProtocolStateToLocalStorage();
}

function loadScheduleFromDatabaseEvent_(eventId, title) {
    showLoadDiagnostics("БД", [], [], "Загрузка расписания из БД…");
    return fetchDatabaseJson_("?action=event&id=" + encodeURIComponent(eventId), "состав мероприятия")
        .then(function (data) {
            applyDatabaseEvent_(data);
            var name = title || (data.event ? data.event.title : "");
            showLoadDiagnostics("БД", [], [], "Загружено из БД: «" + name + "». Поединков: " + duelsList.length + ".");
            return data;
        })
        .catch(function (err) {
            var msg = (err && err.message) ? err.message : String(err);
            showLoadDiagnostics("БД", [msg], [], null);
            console.error("loadScheduleFromDatabase", err);
            alert("Не удалось загрузить расписание из БД:\n" + msg);
            throw err;
        });
}

/** Загрузить последнее подходящее мероприятие из БД (без выбора). */
function loadScheduleFromDatabaseLatest_() {
    closeFileMenuDropdown_();
    return fetchDatabaseJson_("?action=events&scope=" + encodeURIComponent(dbScheduleScope_()), "список мероприятий")
        .then(function (data) {
            var events = data.events || [];
            if (!events.length) {
                showLoadDiagnostics("БД", ["Нет мероприятий (" + dbScheduleScope_() + ")"], [], null);
                alert("В БД нет подходящих мероприятий (" + dbScheduleScope_() + ").");
                return null;
            }
            return loadScheduleFromDatabaseEvent_(events[0].id, events[0].title);
        });
}

function setDbPickerStatus_(msg, isError) {
    var el = document.getElementById("db-schedule-picker-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "small mb-2 " + (isError ? "text-danger" : "text-muted");
}

function fillDbEventsSelect_(events, selectFirst) {
    var sel = document.getElementById("db-schedule-event-list");
    if (!sel) return;
    sel.innerHTML = "";
    for (var i = 0; i < events.length; i++) {
        var e = events[i];
        var opt = document.createElement("option");
        opt.value = String(e.id);
        var when = e.starts_on ? String(e.starts_on) : "";
        opt.textContent = (e.title || ("#" + e.id)) + (when ? " (" + when + ")" : "") + (e.status ? " — " + e.status : "");
        sel.appendChild(opt);
    }
    if (selectFirst && sel.options.length) sel.selectedIndex = 0;
}

function openDatabaseSchedulePicker() {
    closeFileMenuDropdown_();
    var modalEl = document.getElementById("dbSchedulePickerModal");
    if (!modalEl || typeof bootstrap === "undefined") {
        alert("Модалка выбора мероприятия недоступна");
        return;
    }
    setDbPickerStatus_("Загрузка списка…", false);
    fillDbEventsSelect_([], false);
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    fetchDatabaseJson_("?action=events&scope=" + encodeURIComponent(dbScheduleScope_()), "список мероприятий")
        .then(function (data) {
            var events = data.events || [];
            if (typeof data.org !== "undefined") { dbOrgMode = !!data.org; updateDbOrgUi_(); }
            fillDbEventsSelect_(events, true);
            var note = "Мероприятий: " + events.length + " (" + dbScheduleScope_() + ").";
            if (data.hidden_org) note += " Скрыто для оргов: " + data.hidden_org + ".";
            setDbPickerStatus_(note, false);
        })
        .catch(function (err) {
            setDbPickerStatus_((err && err.message) || String(err), true);
        });
}

function refreshDbEventsList() {
    setDbPickerStatus_("Обновление…", false);
    fetchDatabaseJson_("?action=events&scope=" + encodeURIComponent(dbScheduleScope_()), "список мероприятий")
        .then(function (data) {
            var events = data.events || [];
            if (typeof data.org !== "undefined") { dbOrgMode = !!data.org; updateDbOrgUi_(); }
            fillDbEventsSelect_(events, true);
            var note = "Обновлено. Мероприятий: " + events.length + " (" + dbScheduleScope_() + ").";
            if (data.hidden_org) note += " Скрыто для оргов: " + data.hidden_org + ".";
            setDbPickerStatus_(note, false);
        })
        .catch(function (err) {
            setDbPickerStatus_((err && err.message) || String(err), true);
        });
}

function loadScheduleFromDatabaseSelected() {
    var sel = document.getElementById("db-schedule-event-list");
    if (!sel || !sel.value) {
        alert("Выберите мероприятие в списке");
        return;
    }
    var id = parseInt(sel.value, 10);
    var modalEl = document.getElementById("dbSchedulePickerModal");
    if (modalEl && typeof bootstrap !== "undefined") {
        var modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    }
    return loadScheduleFromDatabaseEvent_(id, sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : null);
}

/* Инициализация орг-режима при загрузке страницы. */
document.addEventListener('DOMContentLoaded', function () {
    updateDbOrgUi_();
    refreshDbOrgStatus_();
});
