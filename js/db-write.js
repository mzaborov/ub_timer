/*--------------------------Часы → БД: запись канона (план 06, шаг 3)----------------------------*/
/* Активно только когда состав загружен из БД (scheduleSource === "db"). Same-origin db.php?action=write.
   Очередь + дебаунс + ретраи; при ошибке операции ставятся обратно и повторяются. */

var DB_WRITE_URL = "db.php?action=write";
var dbWriteQueue_ = [];
var dbWriteTimer_ = null;
var dbWriteInFlight_ = false;
var dbWriteFailCount_ = 0;
var dbWriteOrgWarned_ = false;
var dbDuelLogStartMs_ = {};

/** Запись активна: состав из БД и известно мероприятие. */
function dbWriteActive_() {
    return (typeof scheduleSource !== "undefined") && scheduleSource === "db"
        && (typeof dbEventId !== "undefined") && dbEventId;
}

/** id поединка в БД по индексу duelsList (или текущему поединку). 0 — если неизвестно. */
function dbWriteDuelId_(idx) {
    var i = (idx === undefined || idx === null || idx === "-1") ? currentDuel : idx;
    if (i === undefined || i === null || i === "-1") return 0;
    i = (typeof i === "string") ? parseInt(i, 10) : i;
    if (isNaN(i) || !duelsList || !duelsList[i]) return 0;
    return Number(duelsList[i].DuelId) || 0;
}

/** Поставить операцию в очередь. critical — отправить сразу (важные вехи протокола). */
function dbWriteNotify_(op, critical) {
    if (!dbWriteActive_() || !op) return;
    dbWriteQueue_.push(op);
    if (critical) {
        dbWriteFlush_();
    } else if (!dbWriteTimer_) {
        dbWriteTimer_ = setTimeout(dbWriteFlush_, 300);
    }
}

function dbWriteFlush_() {
    if (dbWriteTimer_) { clearTimeout(dbWriteTimer_); dbWriteTimer_ = null; }
    if (dbWriteInFlight_ || !dbWriteQueue_.length || !dbWriteActive_()) return;
    var ops = dbWriteQueue_;
    dbWriteQueue_ = [];
    dbWriteInFlight_ = true;
    var body = JSON.stringify({ event_id: dbEventId, ops: ops });
    var xhr = new XMLHttpRequest();
    xhr.open("POST", DB_WRITE_URL, true);
    xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
    xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        dbWriteInFlight_ = false;
        if (xhr.status >= 200 && xhr.status < 300) {
            dbWriteFailCount_ = 0;
            try {
                var r = JSON.parse(xhr.responseText);
                if (r && r.results && r.results.length) {
                    console.warn("db-write: частичные ошибки", r.results);
                }
            } catch (e) { /* ignore */ }
        } else {
            var errCode = "";
            try { var er = JSON.parse(xhr.responseText); errCode = (er && er.error) ? String(er.error) : ""; } catch (e2) {}
            if (xhr.status === 403 || errCode === "org_required") {
                dbWriteQueue_ = [];
                if (!dbWriteOrgWarned_) {
                    dbWriteOrgWarned_ = true;
                    console.warn("db-write: запись отклонена — нужен режим организатора");
                    alert("Запись в базу доступна только в режиме организатора.\nВойдите: меню «Выберите файл» → «Режим организатора».");
                }
                return;
            }
            dbWriteFailCount_++;
            for (var i = ops.length - 1; i >= 0; i--) dbWriteQueue_.unshift(ops[i]);
            setTimeout(dbWriteFlush_, Math.min(8000, 500 * dbWriteFailCount_));
            return;
        }
        if (dbWriteQueue_.length && !dbWriteTimer_) {
            dbWriteTimer_ = setTimeout(dbWriteFlush_, 100);
        }
    };
    xhr.send(body);
}

/* ---- Операции-обёртки (все проверяют активность сами) ---- */

/** Событие протокола. idx — индекс поединка (по умолчанию текущий). */
function dbLogEvent_(type, payload, idx) {
    var duelId = dbWriteDuelId_(idx);
    if (!dbWriteActive_() || !duelId || !type) return;
    var ts = Date.now();
    if (type === "жеребьёвка" || !dbDuelLogStartMs_[duelId]) {
        dbDuelLogStartMs_[duelId] = ts;
    }
    var momentSec = Math.max(0, Math.round((ts - dbDuelLogStartMs_[duelId]) / 1000));
    var data = {};
    if (payload && typeof payload === "object") {
        for (var k in payload) {
            if (Object.prototype.hasOwnProperty.call(payload, k)) data[k] = payload[k];
        }
    }
    data.ts = ts;
    dbWriteNotify_({ op: "event", duel_id: duelId, type: String(type), payload: data, moment_sec: momentSec }, true);
}

/** Изменения состава поединка: fields — новые значения, changes — [{field, old, new}]. */
function dbSaveComposition_(idx, fields, changes) {
    var duelId = dbWriteDuelId_(idx);
    if (!dbWriteActive_() || !duelId) return;
    if (fields && Object.keys(fields).length) {
        dbWriteNotify_({ op: "duel", duel_id: duelId, fields: fields }, true);
    }
    if (changes && changes.length) {
        for (var i = 0; i < changes.length; i++) {
            var c = changes[i];
            if (!c || !c.field) continue;
            dbWriteNotify_({ op: "log", duel_id: duelId, field: c.field, old: (c.old === undefined ? null : c.old),
                new: (c.new === undefined ? null : c.new), author_id: null }, false);
        }
    }
}

/** Полный список судей поединка (материализация) — перезаписывает duel_judges. */
function dbSaveJudges_(idx, judges) {
    var duelId = dbWriteDuelId_(idx);
    if (!dbWriteActive_() || !duelId) return;
    var list = [];
    for (var i = 0; i < (judges || []).length; i++) {
        var j = judges[i];
        if (!j || !j.person_id) continue;
        list.push({ person_id: Number(j.person_id), college: j.college || null,
            vote: (j.vote === undefined ? null : j.vote), agreed: !!j.agreed });
    }
    dbWriteNotify_({ op: "judges", duel_id: duelId, judges: list }, true);
}

/** Согласие судьи (зелёная ячейка) — материализация Судья.согласовано. */
function dbSetAgreed_(idx, personId, agreed) {
    var duelId = dbWriteDuelId_(idx);
    if (!dbWriteActive_() || !duelId || !personId) return;
    dbWriteNotify_({ op: "agree", duel_id: duelId, person_id: Number(personId), agreed: !!agreed }, true);
}

/** Голос судьи — материализация Судья.голос. */
function dbSetVote_(idx, personId, vote) {
    var duelId = dbWriteDuelId_(idx);
    if (!dbWriteActive_() || !duelId || !personId) return;
    dbWriteNotify_({ op: "vote", duel_id: duelId, person_id: Number(personId), vote: vote }, true);
}

/** Новый порядок поединков в мероприятии. */
function dbSaveSortOrder_(order) {
    if (!dbWriteActive_() || !order || !order.length) return;
    dbWriteNotify_({ op: "sort", order: order }, true);
}

/** Добавить поединок в мероприятие (сразу, без очереди — нужен id нового поединка). */
function dbAddDuel_(options, onDone, onError) {
    if (!dbWriteActive_()) {
        if (onError) onError("расписание не из базы");
        return;
    }
    var op = {
        op: "duel_add",
        duel_type: (options && options.type) || "классика",
        random: !!(options && options.random)
    };
    var xhr = new XMLHttpRequest();
    xhr.open("POST", DB_WRITE_URL, true);
    xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
    xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300 && data && data.ok) {
            if (data.added && data.added.length) {
                if (onDone) onDone(data.added[0]);
            } else if (onError) {
                onError("поединок не добавлен");
            }
            return;
        }
        var msg = (data && data.error) ? String(data.error) : ("HTTP " + xhr.status);
        if (xhr.status === 403 || msg === "org_required") msg = "нужен режим организатора";
        if (onError) onError(msg);
    };
    xhr.send(JSON.stringify({ event_id: dbEventId, ops: [op] }));
}

/** id человека, сидящего в слоте refereeList[refIdx] текущего поединка (для материализации голоса). */
function dbJudgePersonForRefereeIndex_(refIdx) {
    if (typeof getJudgeSlotsForDuel !== "function") return null;
    var cd = (currentDuel != null && currentDuel !== "-1") ? (typeof currentDuel === "string" ? parseInt(currentDuel, 10) : currentDuel) : 0;
    if (isNaN(cd) || cd < 0 || !duelsList || !duelsList[cd]) return null;
    var slots = getJudgeSlotsForDuel(cd);
    var vis = [];
    for (var i = 0; i < 11; i++) if (refereeList[i] && refereeList[i].visible) vis.push(i);
    var k = vis.indexOf(refIdx);
    if (k < 0 || k >= slots.length) return null;
    return getAssignmentSlot(cd, slots[k]) || null;
}

/** Согласован ли слот (зелёная ячейка) в клиентской раскладке. */
function dbConfirmedSlot_(idx, key) {
    return !!(duelAssignments[idx] && duelAssignments[idx].confirmed && duelAssignments[idx].confirmed[key]);
}

/** true — подавить запись журнала изменений состава (массовые пересчёты/автозаполнение). */
var dbSlotLogSuppressed_ = false;

var DB_SLOT_LABELS_ = { player1: "игрок1", player2: "игрок2", second1: "секундант1", second2: "секундант2" };

/** Запись изменения слота состава в ЖурналИзмененияПоединка. */
function dbLogSlotChange_(duelIdx, slotKey, oldId, newId) {
    if (!dbWriteActive_() || dbSlotLogSuppressed_) return;
    if (typeof isRestoringProtocol !== "undefined" && isRestoringProtocol) return;
    var duelId = dbWriteDuelId_(duelIdx);
    if (!duelId || !slotKey) return;
    var field = DB_SLOT_LABELS_[slotKey] || slotKey;
    var oldName = oldId ? (getPersonName(oldId) || String(oldId)) : null;
    var newName = newId ? (getPersonName(newId) || String(newId)) : null;
    dbWriteNotify_({ op: "log", duel_id: duelId, field: field, old: oldName, new: newName, author_id: null }, false);
}

/** Полная материализация состава поединка (duels + duel_judges) из клиентской раскладки. */
function dbPersistComposition_(idx) {
    var duelId = dbWriteDuelId_(idx);
    if (!dbWriteActive_() || !duelId) return;
    var a = (typeof duelAssignments !== "undefined" && duelAssignments) ? duelAssignments[idx] : null;
    var d = (duelsList && duelsList[idx]) ? duelsList[idx] : null;
    var fields = {};
    if (a) {
        fields.player1_id = a.player1Id || null;
        fields.player2_id = a.player2Id || null;
        fields.second1_id = a.second1Id || null;
        fields.second2_id = a.second2Id || null;
    }
    if (d) {
        if (d.SituationId != null) fields.situation_id = Number(d.SituationId) || null;
        var q = (typeof normalizeRefereeQty === "function") ? normalizeRefereeQty(d.RefereeQty) : null;
        if (q) fields.referee_qty = q;
    }
    dbWriteNotify_({ op: "duel", duel_id: duelId, fields: fields }, true);

    var judges = [];
    if (a && a.judges) {
        for (var j = 0; j < a.judges.length; j++) {
            var jj = a.judges[j];
            if (!jj || !jj.personId) continue;
            judges.push({ person_id: Number(jj.personId), college: jj.category || null, agreed: dbConfirmedSlot_(idx, "j" + j) });
        }
    }
    dbWriteNotify_({ op: "judges", duel_id: duelId, judges: judges }, true);
}

