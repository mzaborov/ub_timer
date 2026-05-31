/*---------------------Загрузка JSON  и работа со списком поединков ---------------------------------*/
function triggerClick() {
    const JSON_File = document.getElementById("File_Loader")
    JSON_File.click()
}

/** По первой строке листа строит карту: имя заголовка → буква столбца (A, B, …, Z, AA, …). */
function getHeaderToColumnMap(worksheet) {
    var map = {};
    for (var key in worksheet) {
        if (!worksheet.hasOwnProperty(key) || key[0] === '!') continue;
        var match = key.match(/^([A-Z]+)(\d+)$/i);
        if (!match) continue;
        var colLetters = match[1];
        var rowNum = parseInt(match[2], 10);
        if (rowNum !== 1) continue;
        var cell = worksheet[key];
        var header = (cell && (cell.v != null)) ? String(cell.v).trim() : '';
        if (header) map[header] = colLetters.toUpperCase();
    }
    return map;
}

/** Адрес ячейки в формате "Лист1!F5". rowIndex — индекс строки в массиве (0 = вторая строка в Excel). */
function getCellAddress(sheetName, headerToColumn, headerName, rowIndex) {
    var col = headerToColumn[headerName];
    var excelRow = rowIndex + 2;
    if (!col) return sheetName + '!?' + excelRow + ' (столбец "' + headerName + '")';
    return sheetName + '!' + col + excelRow;
}

/** Из сообщения SyntaxError извлекает позицию, например "position 416" → 416. */
function getJsonErrorPosition(err) {
    if (!err || !err.message) return null;
    var m = err.message.match(/position\s+(\d+)/i) || err.message.match(/позици[яи]\s+(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
}

/** Возвращает фрагмент строки вокруг позиции ошибки с пометкой «▼». radius — символов до/после. Переносы в выводе заменяются на пробел. */
function getSnippetAroundPosition(str, pos, radius) {
    if (str == null || str === '') return '(пустая строка)';
    var s = String(str);
    var r = (radius == null || radius < 0) ? 35 : radius;
    var posVal = (pos == null || pos < 0) ? 0 : Math.min(pos, s.length);
    var start = Math.max(0, posVal - r);
    var end = Math.min(s.length, posVal + r + 1);
    var before = s.slice(start, posVal).replace(/\r\n?|\n/g, ' ');
    var after = s.slice(posVal, end).replace(/\r\n?|\n/g, ' ');
    var left = start > 0 ? '…' : '';
    var right = end < s.length ? '…' : '';
    return left + before + '▼' + after + right;
}

/** Показывает блок диагностики загрузки (ошибки/предупреждения). */
function showLoadDiagnostics(fileName, errors, warnings, summary) {
    var block = document.getElementById('load-diagnostics');
    if (!block) return;
    block.style.display = 'none';
    block.innerHTML = '';
    if (!errors.length && !warnings.length) return;
    block.style.display = 'block';
    block.classList.remove('alert-success', 'alert-warning', 'alert-danger');
    if (errors.length) block.classList.add('alert-danger');
    else if (warnings.length) block.classList.add('alert-warning');
    else block.classList.add('alert-success');
    var title = document.createElement('strong');
    title.textContent = 'Диагностика загрузки: ' + fileName;
    block.appendChild(title);
    block.appendChild(document.createElement('br'));
    if (summary) {
        var p = document.createElement('p');
        p.className = 'mb-1 mt-1';
        p.textContent = summary;
        block.appendChild(p);
    }
    if (errors.length) {
        var errTitle = document.createElement('strong');
        errTitle.textContent = 'Ошибки:';
        block.appendChild(errTitle);
        var ul = document.createElement('ul');
        ul.className = 'mb-1 mt-1';
        errors.forEach(function (text) {
            var li = document.createElement('li');
            li.textContent = text;
            ul.appendChild(li);
        });
        block.appendChild(ul);
    }
    if (warnings.length) {
        var warnTitle = document.createElement('strong');
        warnTitle.textContent = 'Предупреждения:';
        block.appendChild(warnTitle);
        var ul = document.createElement('ul');
        ul.className = 'mb-1 mt-1';
        warnings.forEach(function (text) {
            var li = document.createElement('li');
            li.textContent = text;
            ul.appendChild(li);
        });
        block.appendChild(ul);
    }
}

function parseTruthyCell(v) {
    if (v === undefined || v === null) return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    var s = String(v).trim().toLowerCase();
    if (!s || s === "0" || s === "false" || s === "нет" || s === "no") return false;
    if (s === "1" || s === "true" || s === "да" || s === "yes" || s === "+" || s === "x") return true;
    return false;
}

function normalizeDuelHiddenFlag(duel) {
    if (!duel) return;
    if (duel.hideSituationName !== true && duel.hideSituationName !== false) {
        duel.hideSituationName = parseTruthyCell(
            duel.Hidden != null ? duel.Hidden
                : (duel.HideSituationName != null ? duel.HideSituationName
                    : (duel.HideSituation != null ? duel.HideSituation
                        : (duel["Скрыть название"] != null ? duel["Скрыть название"]
                            : duel["Случайная ситуация"])))
        );
    }
    delete duel.Hidden;
    delete duel.HideSituationName;
    delete duel.HideSituation;
    delete duel["Скрыть название"];
    delete duel["Случайная ситуация"];
}

function normalizeDuelsListHiddenFlags(list) {
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) normalizeDuelHiddenFlag(list[i]);
}

function escapeHtmlForChooser(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function isSituationNameHiddenInChooser(duel, index) {
    return !!(duel && duel.hideSituationName && !revealedSituationIndices[index]);
}

function formatSituationNameForChooser(duel, index) {
    var name = (duel && duel.SituationName != null) ? String(duel.SituationName) : "";
    if (!isSituationNameHiddenInChooser(duel, index)) return escapeHtmlForChooser(name);
    return '<span class="situation-name-blurred" aria-hidden="true">' + escapeHtmlForChooser(name || "—") + "</span>";
}

function restoreRevealedSituationIndicesFromPayload(data) {
    revealedSituationIndices = {};
    if (!data || data.revealedSituationIndices == null) return;
    var src = data.revealedSituationIndices;
    if (Array.isArray(src)) {
        for (var i = 0; i < src.length; i++) {
            var idx = parseInt(src[i], 10);
            if (!isNaN(idx) && idx >= 0) revealedSituationIndices[idx] = true;
        }
    } else if (typeof src === "object") {
        for (var k in src) {
            if (src.hasOwnProperty(k) && src[k]) revealedSituationIndices[k] = true;
        }
    }
}

function getRevealedSituationIndicesForPayload() {
    var out = [];
    for (var k in revealedSituationIndices) {
        if (!revealedSituationIndices.hasOwnProperty(k) || !revealedSituationIndices[k]) continue;
        var idx = parseInt(k, 10);
        if (!isNaN(idx) && idx >= 0) out.push(idx);
    }
    out.sort(function (a, b) { return a - b; });
    return out;
}

function renderDuelChooser() {
    var duelChooser = document.getElementById("duel-chooser");
    if (!duelChooser || !duelsList) return;
    duelChooser.innerHTML = "";
    duelsList.forEach(function (duel, index) {
        var figure = document.createElement("figure");
        var duelNum = duel.DuelNum != null ? duel.DuelNum : (index + 1);
        var situationHtml = formatSituationNameForChooser(duel, index);
        figure.innerHTML = '<a class="icon-link" href="#" onclick=\'duelChoosed("' + index + '"); return false;\'>' +
            '<blockquote class="blockquote"><p>№' + duelNum + " :: " + situationHtml + "</p></blockquote></a>" +
            '<figcaption class="blockquote-footer">' + formatDuelPlayersCaption(duel) + "</figcaption>";
        duelChooser.appendChild(figure);
    });
}

function saveProtocolStateToLocalStorage() {
    try {
        if (!scheduleFileName && (!duelsList || duelsList.length === 0)) return;
        var payload = buildSessionStatePayload();
        payload.duelsList = duelsList || [];
        localStorage.setItem(PROTOCOL_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) { console.warn("saveProtocolStateToLocalStorage", e); }
}

function switchToFileDropdown() {
    var simple = document.getElementById("file-button-simple");
    var dropdown = document.getElementById("file-button-dropdown");
    if (simple) simple.style.display = "none";
    if (dropdown) dropdown.style.display = "";
}

function applyRestoredSessionState(data) {
    if (!data || !data.phase) return;
    var phase = data.phase;
    if (phase !== "round" && phase !== "judges") return;
    var cd = data.currentDuel;
    if (cd === undefined || cd === null) return;
    currentDuel = typeof cd === "number" ? cd : parseInt(cd, 10);
    if (currentDuel < 0 || !duelsList || currentDuel >= duelsList.length) return;
    if (data.game_time != null) game_time = data.game_time;
    time[0] = data.time0 != null ? data.time0 : game_time;
    time[1] = data.time1 != null ? data.time1 : game_time;
    roundStartRemaining[0] = data.roundStartRemaining0 != null ? data.roundStartRemaining0 : time[0];
    roundStartRemaining[1] = data.roundStartRemaining1 != null ? data.roundStartRemaining1 : time[1];
    roundDurations = (data.roundDurations && Array.isArray(data.roundDurations)) ? data.roundDurations.slice() : [];
    current_round = data.current_round != null ? data.current_round : 1;
    current_player = data.current_player === 1 || data.current_player === 2 ? data.current_player : 1;
    if (data.duelType) duelType = data.duelType;
    if (data.refereeQty != null && (data.refereeQty === 9 || data.refereeQty === 7 || data.refereeQty === 5)) refereeQty = data.refereeQty;
    roundRoles = (data.roundRoles && Array.isArray(data.roundRoles)) ? data.roundRoles.slice() : [];
    pauseProtestEvents = (data.pauseProtestEvents && Array.isArray(data.pauseProtestEvents)) ? data.pauseProtestEvents.slice() : [];
    if (data.player1Name) { var el1 = document.getElementById("Player1Name"); if (el1) el1.value = data.player1Name; }
    if (data.player2Name) { var el2 = document.getElementById("Player2Name"); if (el2) el2.value = data.player2Name; }
    sessionPhase = phase;
    duel_is_active = true;
    clock_is_active = false;
    donut1.setState({ max: game_time, value: time[0], color: current_player === 1 ? activeTimerColor : inactiveTimerColor, bg: donuttyTrackColor });
    donut2.setState({ max: game_time, value: time[1], color: current_player === 2 ? activeTimerColor : inactiveTimerColor, bg: donuttyTrackColor });
    document.getElementById("timer1").textContent = formatTime(time[0]);
    document.getElementById("timer2").textContent = formatTime(time[1]);
    var roundEl = document.getElementById("current_round");
    if (roundEl) roundEl.textContent = "Раунд №" + current_round;
    setPlayer(current_player);
    document.getElementById("start_stop_duel").textContent = "Завершить поединок";
    document.getElementById("start_stop_duel").classList.remove("btn-primary");
    document.getElementById("start_stop_duel").classList.add("btn-danger");
    enable_disable_duel_options_conrols("visible", true);
    if (isClassicLikeType(duelType)) {
        var duel = duelsList[currentDuel];
        if (duel && duel.SituationRoles) {
            var role1Text = null, role2Text = null;
            if (roundRoles.length >= current_round) {
                var rolesForRound = roundRoles[current_round - 1];
                if (rolesForRound) { role1Text = rolesForRound.player1Role; role2Text = rolesForRound.player2Role; }
            }
            if (!role1Text && !role2Text && (data.currentRoundRole1 || data.currentRoundRole2)) {
                var place = "Выберите Роль...";
                role1Text = (data.currentRoundRole1 && data.currentRoundRole1.trim() !== place) ? data.currentRoundRole1.trim() : null;
                role2Text = (data.currentRoundRole2 && data.currentRoundRole2.trim() !== place) ? data.currentRoundRole2.trim() : null;
            }
            if (role1Text || role2Text) {
                var sel1 = document.getElementById("Player1Roles");
                var sel2 = document.getElementById("Player2Roles");
                if (sel1 && sel2) {
                    var idx1 = -1, idx2 = -1;
                    for (var ri in duel.SituationRoles) {
                        if (duel.SituationRoles[ri].Role === role1Text) idx1 = parseInt(ri, 10);
                        if (duel.SituationRoles[ri].Role === role2Text) idx2 = parseInt(ri, 10);
                    }
                    if (idx1 >= 0) {
                        sel1.value = String(idx1);
                        document.getElementById("Player1RoleGoal").innerHTML = duel.SituationRoles[idx1].Goals || "";
                    }
                    if (idx2 >= 0) {
                        sel2.value = String(idx2);
                        document.getElementById("Player2RoleGoal").innerHTML = duel.SituationRoles[idx2].Goals || "";
                    }
                    for (var o = 0; o < sel2.options.length; o++) sel2.options[o].disabled = (sel2.options[o].value === sel1.value);
                    for (var o = 0; o < sel1.options.length; o++) sel1.options[o].disabled = (sel1.options[o].value === sel2.value);
                }
            }
        }
    }
    if (phase === "judges") {
        initRefereeStructure(refereeQty);
        if (data.refereeVotes && Array.isArray(data.refereeVotes) && refereeList) {
            for (var i = 0; i < data.refereeVotes.length && i < refereeList.length; i++) {
                refereeList[i].vote = data.refereeVotes[i].vote;
                if (data.refereeVotes[i].visible !== undefined) refereeList[i].visible = data.refereeVotes[i].visible;
            }
        }
        activeReferee = (data.activeReferee != null && !isNaN(data.activeReferee)) ? data.activeReferee : 0;
        setReferee(activeReferee);
        highlightReferee();
        var modalEl = document.getElementById("finishDuelModal");
        if (modalEl) {
            var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        }
        var reopenBtn = document.getElementById("reopen_judges_form_btn");
        if (reopenBtn) reopenBtn.style.display = "none";
    }
}

function restoreProtocolStateFromLocalStorage() {
    try {
        isRestoringProtocol = true;
        var raw = localStorage.getItem(PROTOCOL_STORAGE_KEY);
        if (!raw) return false;
        var data = JSON.parse(raw);
        if (!data.duelsList || !Array.isArray(data.duelsList) || data.duelsList.length === 0) return false;
        scheduleFileName = data.scheduleFileName || "";
        duelsList = data.duelsList;
        normalizeDuelsListHiddenFlags(duelsList);
        restoreRevealedSituationIndicesFromPayload(data);
        if (data.people && typeof data.people === "object") {
            people = data.people;
            peopleNextId = (data.peopleNextId != null && !isNaN(data.peopleNextId)) ? data.peopleNextId : (function () { var max = 0; for (var k in people) { var n = parseInt(String(k).replace(/^p_/, ""), 10); if (!isNaN(n) && n > max) max = n; } return max + 1; })();
        }
        if (data.duelAssignments && Array.isArray(data.duelAssignments)) {
            duelAssignments = data.duelAssignments;
            for (var i = 0; i < duelAssignments.length; i++) if (duelAssignments[i] && duelAssignments[i].excludedPersonIds) delete duelAssignments[i].excludedPersonIds;
            ensurePeopleFromSchedule();
            for (var si = 0; si < duelsList.length && si < duelAssignments.length; si++) {
                var du = duelsList[si], as = duelAssignments[si];
                if (!as) continue;
                if ((!as.second1Id || !people[as.second1Id]) && du.Second1) as.second1Id = getOrCreatePersonId(du.Second1);
                if ((!as.second2Id || !people[as.second2Id]) && du.Second2) as.second2Id = getOrCreatePersonId(du.Second2);
            }
        } else {
            ensurePeopleFromSchedule();
            initDuelAssignmentsFromDuels();
        }
        var fileNameEl = document.getElementById("file-name");
        if (fileNameEl) fileNameEl.innerHTML = scheduleFileName || "Восстановлено";
        renderDuelChooser();
        switchToFileDropdown();
        hideRestoreProtocolBanner();
        var currentDuelNum = data.currentDuel;
        if (currentDuelNum !== undefined && currentDuelNum !== null && !isNaN(currentDuelNum) && currentDuelNum >= 0 && currentDuelNum < duelsList.length) {
            duelChoosed(String(currentDuelNum));
        }
        if (data.phase === "idle" && (data.currentRoundRole1 || data.currentRoundRole2) && isClassicLikeType(duelType)) {
            var duel = duelsList[currentDuel];
            if (duel && duel.SituationRoles) {
                var sel1 = document.getElementById("Player1Roles"), sel2 = document.getElementById("Player2Roles");
                if (sel1 && sel2) {
                    var placeIdle = "Выберите Роль...";
                    var r1 = (data.currentRoundRole1 && data.currentRoundRole1.trim() !== placeIdle) ? data.currentRoundRole1.trim() : "";
                    var r2 = (data.currentRoundRole2 && data.currentRoundRole2.trim() !== placeIdle) ? data.currentRoundRole2.trim() : "";
                    var idx1 = -1, idx2 = -1;
                    for (var ri in duel.SituationRoles) {
                        if (r1 && duel.SituationRoles[ri].Role === r1) idx1 = parseInt(ri, 10);
                        if (r2 && duel.SituationRoles[ri].Role === r2) idx2 = parseInt(ri, 10);
                    }
                    if (idx1 >= 0) { sel1.value = String(idx1); document.getElementById("Player1RoleGoal").innerHTML = duel.SituationRoles[idx1].Goals || ""; }
                    if (idx2 >= 0) { sel2.value = String(idx2); document.getElementById("Player2RoleGoal").innerHTML = duel.SituationRoles[idx2].Goals || ""; }
                    for (var o = 0; o < sel2.options.length; o++) sel2.options[o].disabled = (sel2.options[o].value === sel1.value);
                    for (var o = 0; o < sel1.options.length; o++) sel1.options[o].disabled = (sel1.options[o].value === sel2.value);
                }
            }
        }
        applyRestoredSessionState(data);
        if (data.phase === "idle" && data.lastCompletedDuelIndex != null && !isNaN(data.lastCompletedDuelIndex) && data.lastCompletedDuelIndex >= 0 && data.lastCompletedDuelIndex < duelsList.length) {
            lastCompletedDuelIndex = data.lastCompletedDuelIndex;
            var reopenBtn = document.getElementById("reopen_judges_form_btn");
            if (reopenBtn) reopenBtn.style.display = "block";
        }
        isRestoringProtocol = false;
        saveProtocolStateToLocalStorage();
        setImportStatusMenuItemEnabled(true);
        return true;
    } catch (e) { isRestoringProtocol = false; console.warn("restoreProtocolStateFromLocalStorage", e); return false; }
}

function getOrCreatePersonId(fullName) {
    var name = (fullName != null && typeof fullName === "string") ? fullName.trim() : "";
    if (!name) return null;
    for (var id in people) { if (people[id].fullName === name) return id; }
    var id = "p_" + (peopleNextId++);
    people[id] = { id: id, fullName: name, isActive: true, experience: "none" };
    return id;
}

function ensurePeopleFromSchedule() {
    if (!duelsList || !duelsList.length) return;
    var i, duel, name;
    for (i = 0; i < duelsList.length; i++) {
        duel = duelsList[i];
        if (duel.Player1) getOrCreatePersonId(duel.Player1);
        if (duel.Player2) getOrCreatePersonId(duel.Player2);
        if (duel.Second1) getOrCreatePersonId(duel.Second1);
        if (duel.Second2) getOrCreatePersonId(duel.Second2);
    }
}

function getDuelSecondName(duel, which) {
    var v;
    if (which === 1) v = duel.Second1 || duel["Second 1"] || duel["Cornerman 1"] || duel["Секундант 1"] || duel.Cornerman1 || duel["Cornerman1"];
    else v = duel.Second2 || duel["Second 2"] || duel["Cornerman 2"] || duel["Секундант 2"] || duel.Cornerman2 || duel["Cornerman2"];
    return (v != null && String(v).trim() !== "") ? String(v).trim() : null;
}

function getDuelSidePlayerName(duel, which) {
    if (!duel) return null;
    var v = which === 1 ? duel.Player1 : duel.Player2;
    return (v != null && String(v).trim() !== "") ? String(v).trim() : null;
}

/** Заголовок модалки паузы: три строки по центру. */
function applyPauseModalLabel(playerNum) {
    var titleEl = document.getElementById("pauseModalLabel");
    if (!titleEl) return;
    var n = playerNum || 1;
    var duel = (typeof duelsList !== "undefined" && duelsList && typeof currentDuel !== "undefined") ? duelsList[currentDuel] : null;
    var playerName = duel ? getDuelSidePlayerName(duel, n) : null;
    var secondName = duel ? getDuelSecondName(duel, n) : null;
    var line1 = "Секундант" + (secondName ? " (" + secondName + ")" : "");
    var line2 = "Игрока № " + n + (playerName ? "(" + playerName + ")" : "");
    var line3 = "взял паузу";
    titleEl.textContent = "";
    [line1, line2, line3].forEach(function (line) {
        var row = document.createElement("span");
        row.className = "d-block pause-modal-title-line";
        row.textContent = line;
        titleEl.appendChild(row);
    });
}

function initDuelAssignmentsFromDuels() {
    var list = [];
    if (!duelsList || !duelsList.length) { duelAssignments = list; return; }
    var i, duel, a;
    for (i = 0; i < duelsList.length; i++) {
        duel = duelsList[i];
        var name1 = getDuelSecondName(duel, 1);
        var name2 = getDuelSecondName(duel, 2);
        if (name1) duel.Second1 = name1;
        if (name2) duel.Second2 = name2;
        a = { player1Id: duel.Player1 ? getOrCreatePersonId(duel.Player1) : null, player2Id: duel.Player2 ? getOrCreatePersonId(duel.Player2) : null, second1Id: name1 ? getOrCreatePersonId(name1) : null, second2Id: name2 ? getOrCreatePersonId(name2) : null, judges: [], confirmed: {} };
        var j;
        for (j = 0; j < 9; j++) a.judges.push({ personId: null, category: j < 3 ? "hiring" : j < 7 ? "negotiators" : "owners" });
        list.push(a);
    }
    duelAssignments = list;
}

function countTimesJudged(personId) {
    var n = 0;
    if (!personId || !duelAssignments.length) return n;
    for (var d = 0; d < duelAssignments.length; d++) {
        var a = duelAssignments[d];
        if (!a.judges) continue;
        for (var j = 0; j < a.judges.length; j++) { if (a.judges[j].personId === personId) n++; }
    }
    return n;
}

function countTimesPlayed(personId) {
    var n = 0;
    if (!personId || !duelAssignments.length) return n;
    for (var d = 0; d < duelAssignments.length; d++) {
        var a = duelAssignments[d];
        if (a.player1Id === personId || a.player2Id === personId) n++;
    }
    return n;
}

function countTimesSeconded(personId) {
    var n = 0;
    if (!personId || !duelAssignments.length) return n;
    for (var d = 0; d < duelAssignments.length; d++) {
        var a = duelAssignments[d];
        if (a.second1Id === personId || a.second2Id === personId) n++;
    }
    return n;
}

function getSlotCategory(duelIdx, slotKey) {
    var slots = getJudgeSlotsForDuel(duelIdx);
    var i = slots.indexOf(slotKey);
    if (i < 0) return "negotiators";
    var express = isDuelExpress(duelIdx);
    if (express) return "negotiators";
    var n = slots.length;
    if (n === 9) return i < 3 ? "hiring" : i < 6 ? "negotiators" : "owners";
    if (n === 7) return i < 2 ? "hiring" : i < 5 ? "negotiators" : "owners";
    return i < 1 ? "hiring" : i < 4 ? "negotiators" : "owners";
}

function renderParticipantsTab() {
    var tbody = document.getElementById("participants-tbody");
    if (!tbody) return;
    var list = [];
    for (var id in people) list.push(people[id]);
    list.sort(function (a, b) { return (a.fullName || "").localeCompare(b.fullName || ""); });
    tbody.innerHTML = "";
    if (list.length === 0) {
        var tr = document.createElement("tr");
        tr.innerHTML = "<td colspan=\"7\" class=\"text-muted text-center py-3\">Нет участников. Загрузите расписание с именами игроков/секундантов или введите ФИО выше и нажмите «Добавить участника».</td>";
        tbody.appendChild(tr);
        return;
    }
    list.forEach(function (p, index) {
        var judged = countTimesJudged(p.id);
        var played = countTimesPlayed(p.id);
        var seconded = countTimesSeconded(p.id);
        var expVal = p.experience || "none";
        var statusLabel = p.isActive !== false ? "активен" : "неактивен";
        var tr = document.createElement("tr");
        tr.setAttribute("data-person-id", p.id);
        if (p.isActive === false) tr.classList.add("text-muted");
        tr.style.cursor = "pointer";
        tr.addEventListener("click", function () { var t = document.getElementById("participants-tbody"); if (t) { var rows = t.querySelectorAll("tr"); for (var r = 0; r < rows.length; r++) rows[r].classList.remove("table-active"); } tr.classList.add("table-active"); });
        var expName = "exp-" + p.id.replace(/"/g, "");
        tr.innerHTML = "<td class=\"text-nowrap\">" + (index + 1) + "</td><td>" + (p.fullName || "") + "</td>" +
            "<td><button type=\"button\" class=\"btn btn-sm btn-outline-secondary\" onclick=\"setPersonActive('" + p.id + "', " + (p.isActive === false ? "true" : "false") + "); renderParticipantsTab();\">" + statusLabel + "</button></td>" +
            "<td onclick=\"event.stopPropagation();\"><div class=\"d-flex flex-nowrap gap-1\">" +
            "<div class=\"form-check form-check-inline mb-0\"><input class=\"form-check-input\" type=\"radio\" name=\"" + expName + "\" value=\"none\"" + (expVal === "none" ? " checked" : "") + " onchange=\"setPersonExperience('" + p.id.replace(/'/g, "\\'") + "', this.value);\"><label class=\"form-check-label small\">—</label></div>" +
            "<div class=\"form-check form-check-inline mb-0\"><input class=\"form-check-input\" type=\"radio\" name=\"" + expName + "\" value=\"novice\"" + (expVal === "novice" ? " checked" : "") + " onchange=\"setPersonExperience('" + p.id.replace(/'/g, "\\'") + "', this.value);\"><label class=\"form-check-label small\">новичок</label></div>" +
            "<div class=\"form-check form-check-inline mb-0\"><input class=\"form-check-input\" type=\"radio\" name=\"" + expName + "\" value=\"experienced\"" + (expVal === "experienced" ? " checked" : "") + " onchange=\"setPersonExperience('" + p.id.replace(/'/g, "\\'") + "', this.value);\"><label class=\"form-check-label small\">опытный</label></div>" +
            "<div class=\"form-check form-check-inline mb-0\"><input class=\"form-check-input\" type=\"radio\" name=\"" + expName + "\" value=\"org\"" + (expVal === "org" ? " checked" : "") + " onchange=\"setPersonExperience('" + p.id.replace(/'/g, "\\'") + "', this.value);\"><label class=\"form-check-label small\">орг</label></div>" +
            "</div></td>" +
            "<td>" + judged + "</td><td>" + played + "</td><td>" + seconded + "</td>";
        tbody.appendChild(tr);
    });
}

function setPersonActive(personId, active) {
    if (!people[personId]) return;
    people[personId].isActive = !!active;
    saveProtocolStateToLocalStorage();
}

function setPersonExperience(personId, experience) {
    if (!people[personId]) return;
    people[personId].experience = (experience === "novice" || experience === "experienced" || experience === "org") ? experience : "none";
    saveProtocolStateToLocalStorage();
}

function addParticipantFromModal() {
    var input = document.getElementById("participants-new-name");
    var name = (input && input.value) ? String(input.value).trim() : "";
    if (!name) {
        alert("Введите ФИО в поле выше.");
        if (input) input.focus();
        return;
    }
    getOrCreatePersonId(name);
    if (input) input.value = "";
    saveProtocolStateToLocalStorage();
    renderParticipantsTab();
}

function openParticipantsJudgesModal() {
    if (duelsList && duelsList.length) ensurePeopleFromSchedule();
    var modalEl = document.getElementById("participantsJudgesModal");
    if (!modalEl) return;
    var defaultTab = (sessionPhase !== "idle" || (duelsList && duelsList.length && hasProtocolRealData(duelsList))) ? "tab-judges" : "tab-participants";
    var tabParticipants = document.getElementById("tab-participants-btn");
    var tabJudges = document.getElementById("tab-judges-btn");
    if (defaultTab === "tab-judges" && tabJudges) { tabJudges.click(); renderJudgesLayoutTab(); }
    else if (tabParticipants) tabParticipants.click();
    renderParticipantsTab();
    var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    var tabsEl = document.getElementById("participantsJudgesTabs");
    if (tabsEl && !tabsEl._tabShownListener) {
        tabsEl._tabShownListener = true;
        tabsEl.addEventListener("shown.bs.tab", function (e) {
            var target = e.target && e.target.getAttribute("data-bs-target");
            if (target === "#tab-participants") renderParticipantsTab();
            else if (target === "#tab-judges") renderJudgesLayoutTab();
        });
    }
    modal.show();
}

var JUDGES_LAYOUT_BASE_ROWS = [
    { key: "player1", label: "Игрок" },
    { key: "second1", label: "Секундант" },
    { key: "player2", label: "Игрок" },
    { key: "second2", label: "Секундант" }
];

function getJudgeSlotsForDuel(duelIdx) {
    if (!duelsList || duelIdx < 0 || duelIdx >= duelsList.length) return [];
    var duel = duelsList[duelIdx];
    var express = normalizeDuelTypeStr(duel.Type) === "express";
    var q = duel.RefereeQty;
    if (q !== 9 && q !== 7 && q !== 5) q = 9;
    if (express) return ["j3", "j4", "j5", "j6", "j7"];
    if (q === 9) return ["j0", "j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8"];
    if (q === 7) return ["j0", "j1", "j2", "j3", "j4", "j5", "j6"];
    return ["j0", "j1", "j2", "j3", "j4"];
}

function isJudgeSlotUsedInDuel(duelIdx, slotKey) {
    return getJudgeSlotsForDuel(duelIdx).indexOf(slotKey) !== -1;
}

function isLayoutJudgeRowKey(layoutRowKey) {
    return layoutRowKey.indexOf("j") === 0 || /^neg[1-5]$/.test(layoutRowKey) ||
        /^hire[1-3]$/.test(layoutRowKey) || /^own[1-3]$/.test(layoutRowKey);
}

/** Слот j для ячейки таблицы: у смешанного расписания «Отправляющие N» → разный j в классике и экспрессе. */
function getLayoutSlotKey(duelIdx, layoutRowKey) {
    if (!duelsList || duelIdx < 0 || duelIdx >= duelsList.length) return null;
    if (layoutRowKey.indexOf("j") === 0) {
        return isJudgeSlotUsedInDuel(duelIdx, layoutRowKey) ? layoutRowKey : null;
    }
    var express = isDuelExpress(duelIdx);
    var q = duelsList[duelIdx].RefereeQty;
    if (q !== 9 && q !== 7 && q !== 5) q = 9;
    var negM = layoutRowKey.match(/^neg([1-5])$/);
    if (negM) {
        var n = parseInt(negM[1], 10);
        if (express) return "j" + (2 + n);
        if (q === 9) return n <= 3 ? "j" + (2 + n) : null;
        if (q === 7) return n <= 3 ? "j" + (1 + n) : null;
        return n <= 3 ? "j" + n : null;
    }
    var hireM = layoutRowKey.match(/^hire([1-3])$/);
    if (hireM) {
        if (express) return null;
        var h = parseInt(hireM[1], 10);
        if (q === 9) return h <= 3 ? "j" + (h - 1) : null;
        if (q === 7) return h <= 2 ? "j" + (h - 1) : null;
        return h === 1 ? "j0" : null;
    }
    var ownM = layoutRowKey.match(/^own([1-3])$/);
    if (ownM) {
        if (express) return null;
        var o = parseInt(ownM[1], 10);
        if (q === 9) return o <= 3 ? "j" + (5 + o) : null;
        if (q === 7) return o <= 2 ? "j" + (4 + o) : null;
        return o === 1 ? "j4" : null;
    }
    return null;
}

function getMixedJudgesLayoutRows(maxQty) {
    var base = JUDGES_LAYOUT_BASE_ROWS.slice();
    if (maxQty === 9) {
        for (var h = 1; h <= 3; h++) base.push({ key: "hire" + h, label: "Нанимающиеся " + h });
        for (var n = 1; n <= 5; n++) base.push({ key: "neg" + n, label: "Отправляющие " + n });
        for (var o = 1; o <= 3; o++) base.push({ key: "own" + o, label: "Доверяющие " + o });
    } else if (maxQty === 7) {
        for (var h2 = 1; h2 <= 2; h2++) base.push({ key: "hire" + h2, label: "Нанимающиеся " + h2 });
        for (var n2 = 1; n2 <= 5; n2++) base.push({ key: "neg" + n2, label: "Отправляющие " + n2 });
        for (var o2 = 1; o2 <= 2; o2++) base.push({ key: "own" + o2, label: "Доверяющие " + o2 });
    } else {
        base.push({ key: "hire1", label: "Нанимающиеся 1" });
        for (var n3 = 1; n3 <= 5; n3++) base.push({ key: "neg" + n3, label: "Отправляющие " + n3 });
        base.push({ key: "own1", label: "Доверяющие 1" });
    }
    return base;
}

function getJudgesLayoutRows() {
    var base = JUDGES_LAYOUT_BASE_ROWS.slice();
    if (!duelsList || !duelsList.length) return base;
    var allExpress = true, allClassic = true;
    var maxQty = 0;
    for (var i = 0; i < duelsList.length; i++) {
        var t = normalizeDuelTypeStr(duelsList[i].Type);
        if (t === "express") allClassic = false; else allExpress = false;
        var q = duelsList[i].RefereeQty;
        if (q === 9 || q === 7 || q === 5) maxQty = Math.max(maxQty, q); else maxQty = Math.max(maxQty, 9);
    }
    if (maxQty === 0) maxQty = 9;
    if (allExpress) {
        for (var k = 1; k <= 5; k++) base.push({ key: "neg" + k, label: "Отправляющие " + k });
        return base;
    }
    if (!allExpress && scheduleHasExpressDuels()) return getMixedJudgesLayoutRows(maxQty);
    if (maxQty === 9) {
        for (var n = 1; n <= 3; n++) base.push({ key: "j" + (n - 1), label: "Нанимающиеся " + n });
        for (var o = 1; o <= 3; o++) base.push({ key: "j" + (2 + o), label: "Отправляющие " + o });
        for (var d = 1; d <= 3; d++) base.push({ key: "j" + (5 + d), label: "Доверяющие " + d });
    } else if (maxQty === 7) {
        for (var n = 1; n <= 2; n++) base.push({ key: "j" + (n - 1), label: "Нанимающиеся " + n });
        for (var o = 1; o <= 3; o++) base.push({ key: "j" + (1 + o), label: "Отправляющие " + o });
        for (var d = 1; d <= 2; d++) base.push({ key: "j" + (4 + d), label: "Доверяющие " + d });
    } else {
        base.push({ key: "j0", label: "Нанимающиеся 1" });
        for (var o = 1; o <= 3; o++) base.push({ key: "j" + o, label: "Отправляющие " + o });
        base.push({ key: "j4", label: "Доверяющие 1" });
    }
    return base;
}

function isDuelPast(duelIdx) {
    if (duelIdx < 0 || !duelsList || duelIdx >= duelsList.length) return true;
    var d = duelsList[duelIdx];
    return !!(d.Winner != null && String(d.Winner).trim() !== "") || (d.RoundDurations && d.RoundDurations.length > 0);
}

function isDuelExpress(duelIdx) {
    if (duelIdx < 0 || !duelsList || duelIdx >= duelsList.length) return false;
    return normalizeDuelTypeStr(duelsList[duelIdx].Type) === "express";
}

function normalizeDuelTypeStr(typeStr) {
    var t = (typeStr || "").toString().toLowerCase();
    if (t.indexOf("экспресс") !== -1) return "express";
    if (t.indexOf("парн") !== -1) return "pair";
    return "classic";
}

function isDuelPair(duelIdx) {
    if (duelIdx < 0 || !duelsList || duelIdx >= duelsList.length) return false;
    return normalizeDuelTypeStr(duelsList[duelIdx].Type) === "pair";
}

function isClassicLikeType(type) {
    return type === "classic" || type === "pair";
}

function formatPlayerSideDisplay(duel, side) {
    if (!duel) return "";
    var player = side === 1 ? (duel.Player1 || "") : (duel.Player2 || "");
    var second = side === 1 ? (duel.Second1 || "") : (duel.Second2 || "");
    player = String(player).trim();
    second = String(second).trim();
    if (!player) return "";
    var kind = normalizeDuelTypeStr(duel.Type);
    if (kind === "express" || !second) return player;
    if (kind === "pair") return player + " + " + second;
    return player + " (" + second + ")";
}

function formatDuelPlayersCaption(duel) {
    return formatPlayerSideDisplay(duel, 1) + " VS " + formatPlayerSideDisplay(duel, 2);
}

function applyPlayerNameFieldsFromDuel(duel) {
    var el1 = document.getElementById("Player1Name");
    var el2 = document.getElementById("Player2Name");
    if (el1) el1.value = formatPlayerSideDisplay(duel, 1);
    if (el2) el2.value = formatPlayerSideDisplay(duel, 2);
}

function scheduleHasPairDuels() {
    if (!duelsList || !duelsList.length) return false;
    for (var i = 0; i < duelsList.length; i++) {
        if (normalizeDuelTypeStr(duelsList[i].Type) === "pair") return true;
    }
    return false;
}

function scheduleHasExpressDuels() {
    if (!duelsList || !duelsList.length) return false;
    for (var i = 0; i < duelsList.length; i++) {
        if (normalizeDuelTypeStr(duelsList[i].Type) === "express") return true;
    }
    return false;
}

function getPersonName(personId) {
    if (!personId || !people[personId]) return "";
    return people[personId].fullName || "";
}

function getAssignmentSlot(duelIdx, slotKey) {
    if (!duelAssignments[duelIdx]) return null;
    var a = duelAssignments[duelIdx];
    if (slotKey === "player1") return a.player1Id;
    if (slotKey === "player2") return a.player2Id;
    if (slotKey === "second1") return a.second1Id;
    if (slotKey === "second2") return a.second2Id;
    if (slotKey.indexOf("j") === 0) {
        var j = parseInt(slotKey.slice(1), 10);
        if (a.judges && a.judges[j]) return a.judges[j].personId;
    }
    return null;
}

function setAssignmentSlot(duelIdx, slotKey, personId) {
    while (duelAssignments.length <= duelIdx) duelAssignments.push({ player1Id: null, player2Id: null, second1Id: null, second2Id: null, judges: [], confirmed: {} });
    var a = duelAssignments[duelIdx];
    if (!a.judges) a.judges = [];
    while (a.judges.length < 9) a.judges.push({ personId: null, category: a.judges.length < 3 ? "hiring" : a.judges.length < 7 ? "negotiators" : "owners" });
    if (slotKey === "player1") { a.player1Id = personId; if (duelsList && duelsList[duelIdx]) duelsList[duelIdx].Player1 = getPersonName(personId); }
    else if (slotKey === "player2") { a.player2Id = personId; if (duelsList && duelsList[duelIdx]) duelsList[duelIdx].Player2 = getPersonName(personId); }
    else if (slotKey === "second1") { a.second1Id = personId; if (duelsList && duelsList[duelIdx]) duelsList[duelIdx].Second1 = getPersonName(personId); }
    else if (slotKey === "second2") { a.second2Id = personId; if (duelsList && duelsList[duelIdx]) duelsList[duelIdx].Second2 = getPersonName(personId); }
    else if (slotKey.indexOf("j") === 0) {
        var j = parseInt(slotKey.slice(1), 10);
        if (a.judges[j]) a.judges[j].personId = personId;
    }
    var cd = (currentDuel != null && currentDuel !== "-1") ? (typeof currentDuel === "string" ? parseInt(currentDuel, 10) : currentDuel) : -1;
    if (duelIdx === cd && duelsList && duelsList[duelIdx] && (slotKey === "player1" || slotKey === "player2" || slotKey === "second1" || slotKey === "second2")) {
        applyPlayerNameFieldsFromDuel(duelsList[duelIdx]);
    }
    saveProtocolStateToLocalStorage();
}

function getConfirmedSlot(duelIdx, slotKey) {
    if (!duelAssignments[duelIdx] || !duelAssignments[duelIdx].confirmed) return false;
    return !!duelAssignments[duelIdx].confirmed[slotKey];
}

function setConfirmedSlot(duelIdx, slotKey, value) {
    if (!duelAssignments[duelIdx]) return;
    if (!duelAssignments[duelIdx].confirmed) duelAssignments[duelIdx].confirmed = {};
    if (value) duelAssignments[duelIdx].confirmed[slotKey] = true;
    else delete duelAssignments[duelIdx].confirmed[slotKey];
    saveProtocolStateToLocalStorage();
}

function getBusyInDuel(duelIdx) {
    var busy = {};
    var a = duelAssignments[duelIdx];
    if (!a) return busy;
    ["player1", "player2", "second1", "second2"].forEach(function (k) {
        var id = getAssignmentSlot(duelIdx, k);
        if (id) busy[id] = true;
    });
    if (a.judges) for (var j = 0; j < a.judges.length; j++) { if (a.judges[j].personId) busy[a.judges[j].personId] = true; }
    return busy;
}

function getExcludedFromDuel(duelIdx) {
    var a = duelAssignments[duelIdx];
    if (!a || !a.excludedPersonIds) return {};
    var set = {};
    for (var i = 0; i < a.excludedPersonIds.length; i++) set[a.excludedPersonIds[i]] = true;
    return set;
}

function addExcludedFromDuel(duelIdx, personId) {
    if (!personId) return;
    while (duelAssignments.length <= duelIdx) duelAssignments.push({ player1Id: null, player2Id: null, second1Id: null, second2Id: null, judges: [], confirmed: {} });
    var a = duelAssignments[duelIdx];
    if (!a.excludedPersonIds) a.excludedPersonIds = [];
    if (a.excludedPersonIds.indexOf(personId) === -1) a.excludedPersonIds.push(personId);
    saveProtocolStateToLocalStorage();
}

function renderJudgesLayoutTab() {
    var thead = document.getElementById("judges-layout-thead");
    var tbody = document.getElementById("judges-layout-tbody");
    if (!thead || !tbody) return;
    var duels = duelsList || [];
    if (duels.length === 0) { thead.innerHTML = ""; tbody.innerHTML = "<tr><td colspan=\"2\" class=\"text-muted\">Загрузите расписание поединков.</td></tr>"; return; }
    var cd = (currentDuel != null && currentDuel !== "-1") ? (typeof currentDuel === "string" ? parseInt(currentDuel, 10) : currentDuel) : 0;
    if (isNaN(cd) || cd < 0) cd = 0;
    var headerRow = "<tr><th class=\"table-secondary\">Блок / позиция</th>";
    for (var c = 0; c < duels.length; c++) {
        var isPast = isDuelPast(c);
        var isCur = (c === cd);
        var thClass = "table-secondary";
        var duel = duels[c];
        var name = (duel && duel.SituationName != null) ? String(duel.SituationName).trim() : "";
        var situationHtml = formatSituationNameForChooser(duel, c);
        var title = "Поединок " + (c + 1);
        if (name || isSituationNameHiddenInChooser(duel, c)) title += "<br>" + situationHtml;
        if (isPast) {
            headerRow += "<th class=\"" + thClass + "\" data-duel-idx=\"" + c + "\">" + title + "</th>";
        } else {
            headerRow += "<th class=\"" + thClass + "\" data-duel-idx=\"" + c + "\"><div class=\"dropdown\"><button type=\"button\" class=\"btn btn-link btn-sm p-0 text-dark text-decoration-none dropdown-toggle\" data-bs-toggle=\"dropdown\" aria-haspopup=\"true\">" + title + "</button><ul class=\"dropdown-menu\"><li><a class=\"dropdown-item\" href=\"#\" data-autofill-duel=\"" + c + "\">Назначить судей на этот поединок</a></li></ul></div></th>";
        }
    }
    thead.innerHTML = headerRow + "</tr>";
    var table = document.getElementById("judges-layout-table");
    if (table && !table._autofillDelegate) {
        table._autofillDelegate = true;
        table.addEventListener("click", function (e) {
            var t = e.target.closest ? e.target.closest("[data-autofill-duel]") : null;
            if (t) { e.preventDefault(); runJudgesAutofillForDuel(parseInt(t.getAttribute("data-autofill-duel"), 10)); }
        });
    }
    tbody.innerHTML = "";
    var layoutRows = getJudgesLayoutRows();
    var isPlayerOnly = function (key) { return key === "player1" || key === "player2"; };
    var thickBottomKeys = { second2: true };
    var lastRow = layoutRows[layoutRows.length - 1];
    if (lastRow) thickBottomKeys[lastRow.key] = true;
    if (layoutRows.some(function (r) { return r.key === "j8"; })) {
        thickBottomKeys.j2 = true;
        thickBottomKeys.j5 = true;
        thickBottomKeys.j8 = true;
    } else if (layoutRows.some(function (r) { return r.key === "own3"; })) {
        thickBottomKeys.hire3 = true;
        thickBottomKeys.neg5 = true;
        thickBottomKeys.own3 = true;
    } else if (layoutRows.some(function (r) { return r.key === "own2"; })) {
        thickBottomKeys.hire2 = true;
        thickBottomKeys.neg5 = true;
        thickBottomKeys.own2 = true;
    } else if (layoutRows.some(function (r) { return r.key === "own1"; }) && layoutRows.some(function (r) { return r.key === "neg5"; }) && !layoutRows.some(function (r) { return r.key === "hire2"; })) {
        thickBottomKeys.hire1 = true;
        thickBottomKeys.neg5 = true;
        thickBottomKeys.own1 = true;
    } else if (layoutRows.some(function (r) { return r.key === "neg5"; }) && !layoutRows.some(function (r) { return r.key === "hire1"; })) {
        thickBottomKeys.neg5 = true;
    } else if (layoutRows.some(function (r) { return r.key === "j6"; })) {
        thickBottomKeys.j1 = true;
        thickBottomKeys.j4 = true;
        thickBottomKeys.j6 = true;
    } else if (layoutRows.some(function (r) { return r.key === "j4"; })) {
        thickBottomKeys.j0 = true;
        thickBottomKeys.j3 = true;
        thickBottomKeys.j4 = true;
    } else if (layoutRows.some(function (r) { return r.key === "j7"; })) {
        thickBottomKeys.j7 = true;
    }
    var swapMode = window._judgesSwapMode;
    var sourceD = swapMode ? swapMode.duelIdx : null;
    var sourceS = swapMode ? swapMode.slotKey : null;
    var sourcePerson = (sourceD != null && sourceS) ? getAssignmentSlot(sourceD, sourceS) : null;
    function isSwapAvailable(tdD, tdS) {
        if (sourceD === tdD && sourceS === tdS) return "source";
        if (sourceD == null || !sourcePerson) return null;
        var slots = getJudgeSlotsForDuel(tdD);
        if (slots.indexOf(tdS) === -1) return null;
        if (isDuelPast(tdD)) return "unavailable";
        var targetPerson = getAssignmentSlot(tdD, tdS);
        if (!targetPerson) return "unavailable";
        if (sourceD === tdD) return "available";
        var busy1 = getBusyInDuel(sourceD), busy2 = getBusyInDuel(tdD);
        if (busy2[sourcePerson] || busy1[targetPerson]) return "unavailable";
        return "available";
    }
    layoutRows.forEach(function (row) {
        var tr = document.createElement("tr");
        var cellTitle = (row.key === "second1" || row.key === "second2") ? " title=\"Заполняется из файла расписания (колонки Cornerman 1, Cornerman 2). Автоназначение судей секундантов не заполняет.\"" : "";
        var rowLabel = row.label;
        if ((row.key === "second1" || row.key === "second2") && scheduleHasPairDuels()) rowLabel = "Секундант/игрок";
        if (thickBottomKeys[row.key]) tr.classList.add("judges-row-thick-bottom");
        tr.innerHTML = "<td class=\"text-nowrap\"" + cellTitle + ">" + rowLabel + "</td>";
        for (var col = 0; col < duels.length; col++) {
            var isPast = isDuelPast(col);
            var isCur = (col === cd);
            var isPairCol = isDuelPair(col);
            if (isPairCol && (row.key === "second1" || row.key === "second2")) continue;
            var judgeRow = isLayoutJudgeRowKey(row.key);
            var cellSlotKey = getLayoutSlotKey(col, row.key);
            var slotInactive = judgeRow && !cellSlotKey;
            var personId, confirmed;
            if (judgeRow) {
                personId = cellSlotKey ? getAssignmentSlot(col, cellSlotKey) : null;
                confirmed = cellSlotKey ? getConfirmedSlot(col, cellSlotKey) : false;
            } else {
                personId = getAssignmentSlot(col, row.key);
                confirmed = getConfirmedSlot(col, row.key);
            }
            var name = getPersonName(personId);
            var td = document.createElement("td");
            td.setAttribute("data-duel-idx", col);
            td.setAttribute("data-layout-row-key", row.key);
            if (cellSlotKey) td.setAttribute("data-slot-key", cellSlotKey);
            else if (!judgeRow) td.setAttribute("data-slot-key", row.key);
            if (isPast) td.classList.add("table-secondary");
            else if (isCur && judgeRow) td.classList.add("table-primary");
            if (slotInactive) td.classList.add("table-secondary");
            if (isPairCol && (row.key === "player1" || row.key === "player2")) {
                var secondKey = row.key === "player1" ? "second1" : "second2";
                var name2 = getPersonName(getAssignmentSlot(col, secondKey));
                var confirmed2 = getConfirmedSlot(col, secondKey);
                td.rowSpan = 2;
                td.classList.add("judges-pair-block");
                if (confirmed && confirmed2) td.style.backgroundColor = "rgba(200,255,200,0.5)";
                else td.style.backgroundColor = "rgba(173, 216, 230, 0.5)";
                if (row.key === "player2") td.style.borderBottom = "3px solid #000";
                td.textContent = "";
                var line1 = document.createElement("div");
                line1.className = "judges-pair-block-line";
                line1.textContent = name || "—";
                var line2 = document.createElement("div");
                line2.className = "judges-pair-block-line";
                line2.textContent = name2 || "—";
                td.appendChild(line1);
                td.appendChild(line2);
            } else {
                if (confirmed) td.style.backgroundColor = "rgba(200,255,200,0.5)";
                else if (isPlayerOnly(row.key)) td.style.backgroundColor = "rgba(173, 216, 230, 0.5)";
                if (thickBottomKeys[row.key]) td.style.borderBottom = "3px solid #000";
                td.textContent = name || "—";
            }
            if (swapMode && judgeRow && !slotInactive && cellSlotKey) {
                var swapState = isSwapAvailable(col, cellSlotKey);
                if (swapState === "source") td.classList.add("judges-swap-source");
                else if (swapState === "available") td.classList.add("judges-swap-available");
                else if (swapState === "unavailable" && !isPast) td.classList.add("judges-swap-unavailable");
            }
            td.style.minWidth = "100px";
            td.style.cursor = isPast ? "default" : "pointer";
            if (!isPast && !slotInactive) {
                td.addEventListener("click", function (e) {
                    if (e.detail === 2) return;
                    var d = parseInt(this.getAttribute("data-duel-idx"), 10);
                    var s = this.getAttribute("data-slot-key");
                    if (window._judgesSwapMode) {
                        var st = isSwapAvailable(d, s);
                        if (st === "available") {
                            var a = getAssignmentSlot(window._judgesSwapMode.duelIdx, window._judgesSwapMode.slotKey);
                            var b = getAssignmentSlot(d, s);
                            setAssignmentSlot(window._judgesSwapMode.duelIdx, window._judgesSwapMode.slotKey, b);
                            setAssignmentSlot(d, s, a);
                        }
                        window._judgesSwapMode = null;
                        if (window._judgesSwapEscape) { document.removeEventListener("keydown", window._judgesSwapEscape); window._judgesSwapEscape = null; }
                        window._judgesSwapJustHandled = true;
                        setTimeout(function () { window._judgesSwapJustHandled = false; }, 200);
                        renderJudgesLayoutTab();
                        return;
                    }
                    if (d !== cd) return;
                    setConfirmedSlot(d, s, !getConfirmedSlot(d, s));
                    renderJudgesLayoutTab();
                });
                td.addEventListener("dblclick", function () {
                    if (window._judgesSwapMode || window._judgesSwapJustHandled) return;
                    var d = parseInt(this.getAttribute("data-duel-idx"), 10);
                    var s = this.getAttribute("data-slot-key");
                    if (isDuelPast(d) || !s || !isJudgeSlotUsedInDuel(d, s)) return;
                    openJudgesCellCombobox(d, s, this);
                });
                td.addEventListener("contextmenu", function (e) {
                    e.preventDefault();
                    var d = parseInt(this.getAttribute("data-duel-idx"), 10);
                    var s = this.getAttribute("data-slot-key");
                    if (isDuelPast(d)) return;
                    showJudgesCellContextMenu(d, s, e.clientX, e.clientY);
                });
            }
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    });
    var autofillBtn = document.getElementById("judges-autofill-btn");
    if (autofillBtn) autofillBtn.onclick = function (e) { runJudgesAutofill(!!(e && e.ctrlKey)); };
}

function openJudgesCellCombobox(duelIdx, slotKey, cellEl) {
    var busy = getBusyInDuel(duelIdx);
    var list = [];
    for (var id in people) {
        if (busy[id]) continue;
        list.push(people[id]);
    }
    list.sort(function (a, b) { return (a.fullName || "").localeCompare(b.fullName || ""); });
    var div = document.getElementById("judges-cell-dropdown");
    if (!div) return;
    div.innerHTML = "<div class=\"dropdown-menu show\" style=\"max-height:280px; overflow-y:auto;\"><input type=\"text\" class=\"form-control form-control-sm m-1\" placeholder=\"Поиск...\" id=\"judges-cell-search\"><div id=\"judges-cell-list\"></div></div>";
    div.style.display = "block";
    div.style.left = (cellEl.getBoundingClientRect().left) + "px";
    div.style.top = (cellEl.getBoundingClientRect().bottom) + "px";
    var listEl = document.getElementById("judges-cell-list");
    function fillList(filter) {
        var q = (filter || "").trim().toLowerCase();
        listEl.innerHTML = "";
        list.forEach(function (p) {
            if (q && (p.fullName || "").toLowerCase().indexOf(q) === -1) return;
            if (busy[p.id]) return;
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "dropdown-item";
            if (p.isActive === false) btn.classList.add("text-muted");
            btn.textContent = p.fullName || p.id;
            btn.onclick = function () {
                setAssignmentSlot(duelIdx, slotKey, p.id);
                closeJudgesCellDropdown();
                renderJudgesLayoutTab();
            };
            listEl.appendChild(btn);
        });
    }
    fillList();
    var searchEl = document.getElementById("judges-cell-search");
    if (searchEl) searchEl.oninput = function () { fillList(this.value); };
    window._judgesCellDropdownClose = function () { closeJudgesCellDropdown(); };
    window._judgesCellDropdownEsc = function (e) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeJudgesCellDropdown();
        }
    };
    setTimeout(function () { document.addEventListener("click", window._judgesCellDropdownClose); }, 0);
    document.addEventListener("keydown", window._judgesCellDropdownEsc, true);
}

function closeJudgesCellDropdown() {
    var div = document.getElementById("judges-cell-dropdown");
    if (div) { div.innerHTML = ""; div.style.display = "none"; }
    document.removeEventListener("click", window._judgesCellDropdownClose);
    document.removeEventListener("keydown", window._judgesCellDropdownEsc, true);
}

function runJudgesAutofillForOneDuel(d) {
    if (!duelsList || d < 0 || d >= duelsList.length || isDuelPast(d)) return;
    var timesJudged = {};
    for (var id in people) timesJudged[id] = countTimesJudged(id);
    var busy = getBusyInDuel(d);
    var slots = getJudgeSlotsForDuel(d);
    var express = isDuelExpress(d);
    var hiringFirst = [];
    var preferExperiencedSlots = {};
    if (!express && slots.length >= 5) {
        var n = Math.ceil(slots.length / 3);
        for (var hi = 0; hi < n; hi++) hiringFirst.push(slots[hi]);
        for (var pi = slots.length - n; pi < slots.length; pi++) preferExperiencedSlots[slots[pi]] = true;
    }
    for (var hi = 0; hi < hiringFirst.length; hi++) preferExperiencedSlots[hiringFirst[hi]] = true;
    function rolePriority(p) {
        var play = countTimesPlayed(p.id), second = countTimesSeconded(p.id);
        if (play === 0 && second === 0) return 0;
        if (second > 0) return 1;
        if (play > 0) return 2;
        return 3;
    }
    function expRank(p, preferN, preferE) {
        if (preferN && p.experience === "novice") return 0;
        if (preferE && p.experience === "experienced") return 0;
        if (p.experience === "novice") return 1;
        if (p.experience === "experienced") return 2;
        if (p.experience === "org") return 3;
        return 4;
    }
    var excluded = getExcludedFromDuel(d);
    function fillPass(excludeOrg) {
        slots.forEach(function (slotKey) {
            if (excludeOrg === false && getAssignmentSlot(d, slotKey)) return;
            var candidates = [];
            for (var id in people) {
                if (people[id].isActive === false) continue;
                if (busy[id]) continue;
                if (excluded[id]) continue;
                if (excludeOrg && people[id].experience === "org") continue;
                candidates.push(people[id]);
            }
            var preferNovice = hiringFirst.indexOf(slotKey) !== -1 && d < (duelsList.length * 0.4);
            var preferExperienced = !!preferExperiencedSlots[slotKey];
            candidates.sort(function (a, b) {
                var ra = rolePriority(a), rb = rolePriority(b);
                if (ra !== rb) return ra - rb;
                var ta = timesJudged[a.id] || 0, tb = timesJudged[b.id] || 0;
                if (ta !== tb) return ta - tb;
                var ea = expRank(a, preferNovice, preferExperienced), eb = expRank(b, preferNovice, preferExperienced);
                if (ea !== eb) return ea - eb;
                return Math.random() - 0.5;
            });
            var chosen = candidates.length ? candidates[0] : null;
            setAssignmentSlot(d, slotKey, chosen ? chosen.id : null);
            if (chosen) { busy[chosen.id] = true; timesJudged[chosen.id] = (timesJudged[chosen.id] || 0) + 1; }
        });
    }
    fillPass(true);
    fillPass(false);
    renderJudgesLayoutTab();
}

function runJudgesAutofillForDuel(duelIdx) {
    runJudgesAutofillForOneDuel(duelIdx);
}

function findBestCandidateForSlot(duelIdx, slotKey) {
    if (!duelsList || duelIdx < 0 || duelIdx >= duelsList.length || isDuelPast(duelIdx)) return null;
    var busy = getBusyInDuel(duelIdx);
    var excluded = getExcludedFromDuel(duelIdx);
    var slots = getJudgeSlotsForDuel(duelIdx);
    if (slots.indexOf(slotKey) === -1) return null;
    var express = isDuelExpress(duelIdx);
    var cat = getSlotCategory(duelIdx, slotKey);
    var preferNovice = (cat === "hiring");
    var timesJudged = {};
    for (var id in people) timesJudged[id] = countTimesJudged(id);
    function rolePriority(p) {
        var play = countTimesPlayed(p.id), second = countTimesSeconded(p.id);
        if (play === 0 && second === 0) return 0;
        if (second > 0) return 1;
        if (play > 0) return 2;
        return 3;
    }
    function expRank(p) {
        if (p.experience === "org") return 3;
        if (preferNovice && p.experience === "novice") return 0;
        if (preferNovice && p.experience === "experienced") return 1;
        if (!preferNovice && p.experience === "experienced") return 0;
        if (!preferNovice && p.experience === "novice") return 1;
        return 2;
    }
    var candidates = [];
    for (var id in people) {
        if (people[id].isActive === false) continue;
        if (people[id].experience === "org") continue;
        if (busy[id]) continue;
        if (excluded[id]) continue;
        candidates.push(people[id]);
    }
    if (candidates.length === 0) return null;
    candidates.sort(function (a, b) {
        var ra = rolePriority(a), rb = rolePriority(b);
        if (ra !== rb) return ra - rb;
        var ta = timesJudged[a.id] || 0, tb = timesJudged[b.id] || 0;
        if (ta !== tb) return ta - tb;
        var ea = expRank(a), eb = expRank(b);
        if (ea !== eb) return ea - eb;
        return String(a.id).localeCompare(String(b.id));
    });
    return candidates[0].id;
}

function recalcFutureDuels(fromDuelIdx) {
    if (!duelsList || fromDuelIdx < 0) return;
    for (var d = fromDuelIdx; d < duelsList.length; d++) {
        if (isDuelPast(d)) continue;
        var slots = getJudgeSlotsForDuel(d);
        for (var i = 0; i < slots.length; i++) setAssignmentSlot(d, slots[i], null);
    }
    for (var d = fromDuelIdx; d < duelsList.length; d++) {
        if (isDuelPast(d)) continue;
        runJudgesAutofillForOneDuel(d);
    }
}

function runJudgesAutofill(debugMode) {
    if (!duelsList || !duelsList.length) return;
    for (var d = 0; d < duelsList.length; d++) {
        if (isDuelPast(d)) continue;
        var slots = getJudgeSlotsForDuel(d);
        for (var i = 0; i < slots.length; i++) setAssignmentSlot(d, slots[i], null);
    }
    var timesJudged = {};
    for (var id in people) timesJudged[id] = countTimesJudged(id);
    var assignedOnlyJudge = {};
    var assignedInPass2 = {};
    var assignedInPass3 = {};
    var numDuels = 0;
    for (var d = 0; d < duelsList.length; d++) if (!isDuelPast(d)) numDuels++;
    var limit1 = numDuels >= 5 ? 3 : 2;
    var limit2 = numDuels >= 5 ? 2 : 1;
    var limit3 = numDuels >= 5 ? 2 : 1;
    var currentLimit1 = limit1, currentLimit2 = limit2, currentLimit3 = limit3;
    function isOnlyJudge(id) {
        return countTimesPlayed(id) === 0 && countTimesSeconded(id) === 0;
    }
    var sharedPanelCount = {};
    var timesAssignedToCategory = {};
    function getAssignedInDuelPanel(d, cat) {
        var ids = [];
        var slots = getJudgeSlotsForDuel(d);
        for (var i = 0; i < slots.length; i++) {
            if (getSlotCategory(d, slots[i]) !== cat) continue;
            var pid = getAssignmentSlot(d, slots[i]);
            if (pid) ids.push(pid);
        }
        return ids;
    }
    function neighborCost(personId, d, slotKey) {
        var cat = getSlotCategory(d, slotKey);
        var inPanel = getAssignedInDuelPanel(d, cat);
        var cost = 0;
        for (var i = 0; i < inPanel.length; i++) {
            var q = inPanel[i];
            if (q === personId) continue;
            cost += (sharedPanelCount[personId] && sharedPanelCount[personId][q]) ? sharedPanelCount[personId][q] : 0;
        }
        return cost;
    }
    function updateSharedPanel(personId, d, slotKey) {
        var cat = getSlotCategory(d, slotKey);
        var inPanel = getAssignedInDuelPanel(d, cat);
        if (!sharedPanelCount[personId]) sharedPanelCount[personId] = {};
        for (var i = 0; i < inPanel.length; i++) {
            var q = inPanel[i];
            if (q === personId) continue;
            sharedPanelCount[personId][q] = (sharedPanelCount[personId][q] || 0) + 1;
            if (!sharedPanelCount[q]) sharedPanelCount[q] = {};
            sharedPanelCount[q][personId] = (sharedPanelCount[q][personId] || 0) + 1;
        }
    }
    function getFreeSlotsForPerson(personId, categoryFilter) {
        var list = [];
        for (var d = 0; d < duelsList.length; d++) {
            if (isDuelPast(d)) continue;
            var busy = getBusyInDuel(d);
            if (busy[personId]) continue;
            if (getExcludedFromDuel(d)[personId]) continue;
            var slots = getJudgeSlotsForDuel(d);
            for (var i = 0; i < slots.length; i++) {
                var slotKey = slots[i];
                if (getAssignmentSlot(d, slotKey)) continue;
                var cat = getSlotCategory(d, slotKey);
                if (categoryFilter === "hiring" && cat !== "hiring") continue;
                if (categoryFilter === "non-hiring" && cat === "hiring") continue;
                if (categoryFilter === "panel23" && cat !== "negotiators" && cat !== "owners") continue;
                list.push({ d: d, slotKey: slotKey });
            }
        }
        return list;
    }
    var autofillLog = [];
    var round = 1;

    function assignOne(personId, d, slotKey, passLabel, onAssign) {
        setAssignmentSlot(d, slotKey, personId);
        timesJudged[personId] = (timesJudged[personId] || 0) + 1;
        var cat = getSlotCategory(d, slotKey);
        if (!timesAssignedToCategory[personId]) timesAssignedToCategory[personId] = {};
        timesAssignedToCategory[personId][cat] = (timesAssignedToCategory[personId][cat] || 0) + 1;
        updateSharedPanel(personId, d, slotKey);
        if (onAssign) onAssign(personId);
        var p = people[personId];
        autofillLog.push({ round: round, pass: passLabel || "", duel: d + 1, slotKey: slotKey, name: (p && p.fullName) || personId, experience: (p && p.experience) || "—" });
    }
    function sortSlotsByDuelAndNeighbor(list, personId) {
        list.sort(function (a, b) {
            var ca = neighborCost(personId, a.d, a.slotKey), cb = neighborCost(personId, b.d, b.slotKey);
            if (ca !== cb) return ca - cb;
            if (a.d !== b.d) return a.d - b.d;
            var catA = getSlotCategory(a.d, a.slotKey), catB = getSlotCategory(b.d, b.slotKey);
            var cntA = (timesAssignedToCategory[personId] && timesAssignedToCategory[personId][catA]) || 0;
            var cntB = (timesAssignedToCategory[personId] && timesAssignedToCategory[personId][catB]) || 0;
            return cntA - cntB;
        });
    }

    function onePassStep1Round1() {
        var list = [];
        for (var id in people) {
            if (!people[id].isActive || people[id].experience === "org") continue;
            if (!isOnlyJudge(id) || (assignedOnlyJudge[id] || 0) >= limit1) continue;
            list.push(people[id]);
        }
        list.sort(function (a, b) { return (timesJudged[a.id] || 0) - (timesJudged[b.id] || 0) || String(a.id).localeCompare(String(b.id)); });
        var novices = list.filter(function (p) { return p.experience === "novice"; });
        var experienced = list.filter(function (p) { return p.experience === "experienced"; });
        var none = list.filter(function (p) { return p.experience !== "novice" && p.experience !== "experienced"; });
        var n = 0;
        novices.forEach(function (p) {
            var assignedDuels = {};
            var hired = 0;
            while (hired < 2) {
                var freeHiring = getFreeSlotsForPerson(p.id, "hiring").filter(function (x) { return !assignedDuels[x.d]; });
                if (freeHiring.length === 0) break;
                sortSlotsByDuelAndNeighbor(freeHiring, p.id);
                var pick = freeHiring[0];
                assignOne(p.id, pick.d, pick.slotKey, "1-только судьи", function (id) { assignedOnlyJudge[id] = (assignedOnlyJudge[id] || 0) + 1; });
                assignedDuels[pick.d] = true;
                hired++;
                n++;
            }
            if ((assignedOnlyJudge[p.id] || 0) < limit1 && limit1 >= 3) {
                var freeOther = getFreeSlotsForPerson(p.id, "panel23");
                if (freeOther.length === 0) freeOther = getFreeSlotsForPerson(p.id, "non-hiring");
                freeOther = freeOther.filter(function (x) { return !assignedDuels[x.d]; });
                if (freeOther.length > 0) {
                    sortSlotsByDuelAndNeighbor(freeOther, p.id);
                    var x = freeOther[0];
                    assignOne(p.id, x.d, x.slotKey, "1-только судьи", function (id) { assignedOnlyJudge[id] = (assignedOnlyJudge[id] || 0) + 1; });
                    n++;
                }
            }
        });
        experienced.forEach(function (p) {
            var assignedDuels = {};
            var need = limit1 - (assignedOnlyJudge[p.id] || 0);
            while (need > 0) {
                var free = getFreeSlotsForPerson(p.id, "panel23").filter(function (x) { return !assignedDuels[x.d]; });
                if (free.length === 0) break;
                sortSlotsByDuelAndNeighbor(free, p.id);
                var x = free[0];
                assignOne(p.id, x.d, x.slotKey, "1-только судьи", function (id) { assignedOnlyJudge[id] = (assignedOnlyJudge[id] || 0) + 1; });
                assignedDuels[x.d] = true;
                need--;
                n++;
            }
        });
        none.forEach(function (p) {
            var assignedDuels = {};
            var need = limit1 - (assignedOnlyJudge[p.id] || 0);
            while (need > 0) {
                var free = getFreeSlotsForPerson(p.id, null).filter(function (x) { return !assignedDuels[x.d]; });
                if (free.length === 0) break;
                sortSlotsByDuelAndNeighbor(free, p.id);
                var x = free[0];
                assignOne(p.id, x.d, x.slotKey, "1-только судьи", function (id) { assignedOnlyJudge[id] = (assignedOnlyJudge[id] || 0) + 1; });
                assignedDuels[x.d] = true;
                need--;
                n++;
            }
        });
        return n;
    }
    function onePassStepByPeopleRound1(filterFn, limit, assignedMap, passLabel, preferHiringForNovices) {
        var list = [];
        for (var id in people) {
            if (!people[id].isActive || people[id].experience === "org") continue;
            if (!filterFn(id) || (assignedMap[id] || 0) >= limit) continue;
            list.push(people[id]);
        }
        var byExp = function (a, b) { return (timesJudged[a.id] || 0) - (timesJudged[b.id] || 0) || String(a.id).localeCompare(String(b.id)); };
        var novices = list.filter(function (p) { return p.experience === "novice"; }).sort(byExp);
        var experienced = list.filter(function (p) { return p.experience === "experienced"; }).sort(byExp);
        var none = list.filter(function (p) { return p.experience !== "novice" && p.experience !== "experienced"; }).sort(byExp);
        var n = 0;
        novices.concat(experienced, none).forEach(function (p) {
            var assignedDuels = {};
            var need = limit - (assignedMap[p.id] || 0);
            if (preferHiringForNovices && p.experience === "novice" && need > 0) {
                var hiringCount = 0;
                while (hiringCount < 2 && hiringCount < need) {
                    var freeHiring = getFreeSlotsForPerson(p.id, "hiring").filter(function (x) { return !assignedDuels[x.d]; });
                    if (freeHiring.length === 0) break;
                    sortSlotsByDuelAndNeighbor(freeHiring, p.id);
                    var pick = freeHiring[0];
                    assignOne(p.id, pick.d, pick.slotKey, passLabel, function (id) { assignedMap[id] = (assignedMap[id] || 0) + 1; });
                    assignedDuels[pick.d] = true;
                    hiringCount++;
                    need--;
                    n++;
                }
            }
            while (need > 0) {
                var free = getFreeSlotsForPerson(p.id, null).filter(function (x) { return !assignedDuels[x.d]; });
                if (free.length === 0) break;
                sortSlotsByDuelAndNeighbor(free, p.id);
                var x = free[0];
                assignOne(p.id, x.d, x.slotKey, passLabel, function (id) { assignedMap[id] = (assignedMap[id] || 0) + 1; });
                assignedDuels[x.d] = true;
                need--;
                n++;
            }
        });
        return n;
    }
    function onePassSimple(filterFn, limit, assignedMap, onAssignKey, passLabel) {
        var slotOrder = [];
        for (var d = 0; d < duelsList.length; d++) {
            if (isDuelPast(d)) continue;
            var s = getJudgeSlotsForDuel(d);
            for (var i = 0; i < s.length; i++) if (slotOrder.indexOf(s[i]) === -1) slotOrder.push(s[i]);
        }
        var count = 0;
        for (var d = 0; d < duelsList.length; d++) {
            if (isDuelPast(d)) continue;
            var slots = getJudgeSlotsForDuel(d);
            for (var si = 0; si < slotOrder.length; si++) {
                var slotKey = slotOrder[si];
                if (slots.indexOf(slotKey) === -1) continue;
                if (getAssignmentSlot(d, slotKey)) continue;
                var busy = getBusyInDuel(d);
                var excluded = getExcludedFromDuel(d);
                var candidates = [];
                for (var id in people) {
                    if (!people[id].isActive || busy[id]) continue;
                    if (excluded[id]) continue;
                    if (!filterFn(id) || (assignedMap[id] || 0) >= limit) continue;
                    candidates.push(people[id]);
                }
                if (candidates.length === 0) continue;
                candidates.sort(function (a, b) {
                    var ta = timesJudged[a.id] || 0, tb = timesJudged[b.id] || 0;
                    return ta - tb || String(a.id).localeCompare(String(b.id));
                });
                var chosen = candidates[0];
                setAssignmentSlot(d, slotKey, chosen.id);
                timesJudged[chosen.id] = (timesJudged[chosen.id] || 0) + 1;
                if (onAssignKey === "onlyJudge") assignedOnlyJudge[chosen.id] = (assignedOnlyJudge[chosen.id] || 0) + 1;
                else if (onAssignKey === "pass2") assignedInPass2[chosen.id] = (assignedInPass2[chosen.id] || 0) + 1;
                else if (onAssignKey === "pass3") assignedInPass3[chosen.id] = (assignedInPass3[chosen.id] || 0) + 1;
                count++;
                var pe = people[chosen.id];
                autofillLog.push({ round: round, pass: passLabel || "", duel: d + 1, slotKey: slotKey, name: (pe && pe.fullName) || chosen.id, experience: (pe && pe.experience) || "—" });
            }
        }
        return count;
    }

    var n1 = onePassStep1Round1();
    var n2 = onePassStepByPeopleRound1(function (id) { return countTimesSeconded(id) > 0 && countTimesPlayed(id) === 0; }, limit2, assignedInPass2, "2-секунданты", true);
    var n3 = onePassStepByPeopleRound1(function (id) { return countTimesPlayed(id) > 0; }, limit3, assignedInPass3, "3-игроки", true);

    for (round = 2; ; round++) {
        currentLimit1 = limit1 + (round - 1);
        currentLimit2 = limit2 + (round - 1);
        currentLimit3 = limit3 + (round - 1);
        var n = 0;
        n += onePassSimple(function (id) { return isOnlyJudge(id) && people[id].experience !== "org"; }, currentLimit1, assignedOnlyJudge, "onlyJudge", "1-только судьи");
        n += onePassSimple(function (id) { return countTimesSeconded(id) > 0 && countTimesPlayed(id) === 0 && people[id].experience !== "org"; }, currentLimit2, assignedInPass2, "pass2", "2-секунданты");
        n += onePassSimple(function (id) { return countTimesPlayed(id) > 0 && people[id].experience !== "org"; }, currentLimit3, assignedInPass3, "pass3", "3-игроки");
        if (n === 0) break;
    }
    onePassSimple(function (id) { return people[id].experience === "org"; }, 999, {}, null, "орги");
    fillRemainingExpressJudgeSlots();
    if (debugMode) {
        var lines = ["Автоназначение судей — порядок назначений", "Дата: " + new Date().toLocaleString("ru-RU"), ""];
        autofillLog.forEach(function (entry, i) {
            lines.push((i + 1) + ". раунд " + entry.round + ", " + entry.pass + ", поединок " + entry.duel + ", " + entry.slotKey + " → " + entry.name + " (" + (entry.experience || "—") + ")");
        });
        var blob = new Blob([lines.join("\r\n")], { type: "text/plain;charset=utf-8" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "autofill-log-" + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").replace(" ", "-") + ".txt";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }
    renderJudgesLayoutTab();
}

function fillRemainingExpressJudgeSlots() {
    if (!duelsList) return;
    for (var d = 0; d < duelsList.length; d++) {
        if (!isDuelExpress(d) || isDuelPast(d)) continue;
        var slots = getJudgeSlotsForDuel(d);
        for (var i = 0; i < slots.length; i++) {
            var slotKey = slots[i];
            if (getAssignmentSlot(d, slotKey)) continue;
            var pid = findBestCandidateForSlot(d, slotKey);
            if (pid) setAssignmentSlot(d, slotKey, pid);
        }
    }
}

function showJudgesCellContextMenu(duelIdx, slotKey, x, y) {
    var menu = document.getElementById("judges-cell-context-menu");
    if (!menu) return;
    var personId = getAssignmentSlot(duelIdx, slotKey);
    var isJudgeSlot = slotKey && slotKey.indexOf("j") === 0;
    menu.innerHTML = "<a class=\"dropdown-item\" href=\"#\" data-action=\"clear\">Очистить</a><a class=\"dropdown-item\" href=\"#\" data-action=\"swap\">Поменять местами</a>" +
        (personId && isJudgeSlot ? "<a class=\"dropdown-item\" href=\"#\" data-action=\"exclude\">Не может на этот поединок</a><a class=\"dropdown-item\" href=\"#\" data-action=\"offline\">Отключился со встречи</a>" : "");
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.style.display = "block";
    menu._duelIdx = duelIdx;
    menu._slotKey = slotKey;
    menu.querySelector("[data-action=clear]").onclick = function (e) { e.preventDefault(); menu.style.display = "none"; setAssignmentSlot(duelIdx, slotKey, null); renderJudgesLayoutTab(); };
    menu.querySelector("[data-action=swap]").onclick = function (e) {
        e.preventDefault();
        menu.style.display = "none";
        window._judgesSwapMode = { duelIdx: duelIdx, slotKey: slotKey };
        window._judgesSwapEscape = function (ev) {
            if (ev.key === "Escape") {
                window._judgesSwapMode = null;
                document.removeEventListener("keydown", window._judgesSwapEscape);
                renderJudgesLayoutTab();
            }
        };
        document.addEventListener("keydown", window._judgesSwapEscape);
        renderJudgesLayoutTab();
    };
    if (personId && isJudgeSlot) {
        menu.querySelector("[data-action=exclude]").onclick = function (e) {
            e.preventDefault();
            menu.style.display = "none";
            setAssignmentSlot(duelIdx, slotKey, null);
            addExcludedFromDuel(duelIdx, personId);
            var replacement = findBestCandidateForSlot(duelIdx, slotKey);
            if (replacement) setAssignmentSlot(duelIdx, slotKey, replacement);
            renderJudgesLayoutTab();
        };
        menu.querySelector("[data-action=offline]").onclick = function (e) {
            e.preventDefault();
            menu.style.display = "none";
            if (people[personId]) people[personId].isActive = false;
            setAssignmentSlot(duelIdx, slotKey, null);
            var replacement = findBestCandidateForSlot(duelIdx, slotKey);
            if (replacement) setAssignmentSlot(duelIdx, slotKey, replacement);
            recalcFutureDuels(duelIdx);
            saveProtocolStateToLocalStorage();
            renderJudgesLayoutTab();
        };
    }
    window._judgesContextMenuClose = function () { menu.style.display = "none"; document.removeEventListener("click", window._judgesContextMenuClose); };
    setTimeout(function () { document.addEventListener("click", window._judgesContextMenuClose); }, 0);
}

function processDuelsJson(file) {
    const fileName = document.getElementById('file-name');

    fileName.innerHTML = file.name.split('.').slice(0, -1).join('');
    scheduleFileName = (file && file.name) ? file.name.replace(/\.(xlsx|json)$/i, '') : '';

    revealedSituationIndices = {};
    normalizeDuelsListHiddenFlags(duelsList);
    ensurePeopleFromSchedule();
    initDuelAssignmentsFromDuels();

    renderDuelChooser();
    sessionPhase = "idle";
    saveProtocolStateToLocalStorage();
    switchToFileDropdown();
    hideRestoreProtocolBanner();
    setImportStatusMenuItemEnabled(true);
}

function loadFile(event) {
    var file = document.getElementById("File_Loader").files[0];
    //var file = event.target.files[0];
    if (file) {
        var reader = new FileReader();
        duelsList = [];
        var fileExtension = file.name.split('.').pop();
        if (fileExtension === 'xlsx') {
            reader.onload = function handleFileLoad() {
                var errors = [], warnings = [];
                try {
                    var arrayBuffer = this.result,
                        array = new Uint8Array(arrayBuffer),
                        binaryString = String.fromCharCode.apply(null, array);
                    var workbook = XLSX.read(binaryString, { type: "binary" });
                    var first_sheet_name = workbook.SheetNames[0];
                    var worksheet = workbook.Sheets[first_sheet_name];
                    var headerToColumn = getHeaderToColumnMap(worksheet);
                    duelsList = XLSX.utils.sheet_to_json(worksheet, { raw: true });
                    for (var ni = 0; ni < duelsList.length; ni++) {
                        var d = duelsList[ni];
                        var s1 = (d["Second 1"] != null ? String(d["Second 1"]).trim() : "") || (d["Cornerman 1"] != null ? String(d["Cornerman 1"]).trim() : "") || (d["Секундант 1"] != null ? String(d["Секундант 1"]).trim() : "") || (d.Second1 != null ? String(d.Second1).trim() : "");
                        var s2 = (d["Second 2"] != null ? String(d["Second 2"]).trim() : "") || (d["Cornerman 2"] != null ? String(d["Cornerman 2"]).trim() : "") || (d["Секундант 2"] != null ? String(d["Секундант 2"]).trim() : "") || (d.Second2 != null ? String(d.Second2).trim() : "");
                        if (s1) d.Second1 = s1;
                        if (s2) d.Second2 = s2;
                    }
                    var validRows = [];
                    for (var i = 0; i < duelsList.length; i++) {
                        var duel = duelsList[i];
                        if (!duel.DuelNum && !duel.SituationNum && !duel.SituationRoles) continue;
                        if (duel.SituationRoles && typeof duel.SituationRoles === 'string') {
                            var rawRoles = duel.SituationRoles;
                            try {
                                duel.SituationRoles = JSON.parse(rawRoles.trim().replace(/^"(.*)"$/, '$1'));
                            } catch (parseErr) {
                                var cellAddr = getCellAddress(first_sheet_name, headerToColumn, 'SituationRoles', i);
                                var pos = getJsonErrorPosition(parseErr);
                                var duelNum = duel.DuelNum != null ? duel.DuelNum : (i + 1);
                                var situationPart = (duel.SituationName && duel.SituationName.toString().trim()) ? ' «' + String(duel.SituationName).trim() + '»' : (duel.SituationNum != null ? ' №' + duel.SituationNum : '');
                                var playersPart = (duel.Player1 || duel.Player2) ? (String(duel.Player1 || '').trim() + ' / ' + String(duel.Player2 || '').trim()) : '';
                                var msg = 'Поединок ' + duelNum + '. Ситуация:' + (situationPart || ' —') + (playersPart ? '. Игроки: ' + playersPart : '') + '. Роли в ячейке ' + cellAddr + ': невалидный JSON.';
                                if (pos != null) msg += ' Позиция в строке: ' + pos + '.';
                                msg += ' Фрагмент: «' + getSnippetAroundPosition(rawRoles, pos, 30) + '»';
                                errors.push(msg);
                                console.error('loadFile xlsx: ' + msg, parseErr);
                                continue;
                            }
                        }
                        normalizeDuelHiddenFlag(duel);
                        validRows.push(duel);
                    }
                    duelsList = validRows;
                    var summary = 'Загружено дуэлей: ' + duelsList.length + '.';
                    if (errors.length) summary += ' Ошибок: ' + errors.length + '.';
                    if (warnings.length) summary += ' Предупреждений: ' + warnings.length + '.';
                    showLoadDiagnostics(file.name, errors, warnings, summary);
                    if (errors.length) console.warn('Диагностика xlsx:', { errors: errors, warnings: warnings });
                    processDuelsJson(file);
                } catch (e) {
                    errors.push('Не удалось прочитать файл как xlsx: ' + (e.message || e));
                    showLoadDiagnostics(file.name, errors, warnings, null);
                    console.error('loadFile xlsx', e);
                }
            };
            reader.readAsArrayBuffer(file);
        }
        else if (fileExtension === 'json') {
            reader.onload = function handleFileLoad(evt) {
                var errors = [], warnings = [];
                try {
                    duelsList = JSON.parse(evt.target.result);
                    showLoadDiagnostics(file.name, [], [], 'Файл JSON загружен. Дуэлей: ' + (duelsList ? duelsList.length : 0) + '.');
                    processDuelsJson(file);
                } catch (e) {
                    var pos = getJsonErrorPosition(e);
                    var msg = 'Файл не является валидным JSON: ' + (e.message || e);
                    if (pos != null) msg += ' (позиция в файле: ' + pos + ')';
                    errors.push(msg);
                    showLoadDiagnostics(file.name, errors, warnings, null);
                    console.error('loadFile json', e);
                }
            };
            reader.readAsText(file, "UTF-8");
        }
        else {
            alert('Unsupported file format. Please select a .xlsx or .json file.');
        }

        reader.onerror = function (evt) {
            var msg = 'Не удалось прочитать файл с диска.';
            showLoadDiagnostics((file && file.name) || 'файл', [msg], [], null);
            console.error('loadFile reader error', evt);
        };
    }
}

function createOption(key,text, slctd)
{
    var opt = document.createElement('option');
    opt.value = key;
    opt.innerHTML = text;
    opt.selected = slctd;
    return opt;
}


function changeDuelType(type)
{
    duelType=type;
    if (type==="express")
     {
        document.getElementById("5min").disabled = true;
        document.getElementById("4min").disabled = true;
        document.getElementById("1min").checked = true;   
        setDuelTime(60); 
     }
    else
     {
        document.getElementById("5min").disabled = false;
        document.getElementById("4min").disabled = false;
        document.getElementById("5min").checked = true;
        setDuelTime(300);
     } 

}

function setupClassicLikeRolesUI(duel, select1, select2) {
    var RolesText = "<b>Роли и интересы:</b>";
    select1.appendChild(createOption("-1", "Выберите Роль...", true));
    select2.appendChild(createOption("-1", "Выберите Роль...", true));
    for (var i in duel.SituationRoles) {
        select1.appendChild(createOption(i, duel.SituationRoles[i].Role, false));
        select2.appendChild(createOption(i, duel.SituationRoles[i].Role, false));
        RolesText += "<br><b>" + duel.SituationRoles[i].Role + "</b> - " + duel.SituationRoles[i].Goals;
        select1.disabled = false;
        select2.disabled = false;
    }
    document.getElementById("Duel_Roles").innerHTML = RolesText;
    document.getElementById("Player1RoleGoallabel").innerHTML = "Интересы:";
    document.getElementById("Player2RoleGoallabel").innerHTML = "Интересы:";
    document.getElementById("Player1RoleGoal").innerHTML = "";
    document.getElementById("Player2RoleGoal").innerHTML = "";
}

function duelChoosed(currentDuelRef) {
    currentDuel = currentDuelRef;
    if (currentDuel != "-1") {
        var duelIdx = typeof currentDuelRef === "string" ? parseInt(currentDuelRef, 10) : currentDuelRef;
        if (!isNaN(duelIdx) && duelIdx >= 0) {
            revealedSituationIndices[duelIdx] = true;
            renderDuelChooser();
            renderJudgesLayoutTab();
        }
        const duel = duelsList[currentDuel]
        document.getElementById("players-name").innerHTML = `Ситуация №${duel.SituationNum} ${duel.SituationName}`;
        applyPlayerNameFieldsFromDuel(duel);
        document.getElementById("Player1Name").disabled = true;
        document.getElementById("Player2Name").disabled = true;  
        document.getElementById("Duel_Num").textContent = "Ситуация №" + duel.SituationNum +" (" +duel.Type +"). \"" + duel.SituationName + "\"";
        document.getElementById("Duel_Text").innerHTML = duel.SituationDescription;
        var select1 = document.getElementById('Player1Roles');
        var select2 = document.getElementById('Player2Roles');
        select1.innerHTML="";
        select2.innerHTML="";
        var mins = duel.DuelMinutesLength;
        if (mins === 5 || mins === 4 || mins === 1) {
            setDuelTime(mins * 60);
            var timeEl = document.getElementById(mins + "min");
            if (timeEl) timeEl.checked = true;
        } else {
            setDuelTime(game_time || 300);
        }
        refereeQty = duel.RefereeQty;
        if (refereeQty !== 9 && refereeQty !== 7 && refereeQty !== 5) {
            refereeQty = 9;
            duel.RefereeQty = refereeQty;
        }     
        document.getElementById("5min").disabled = true;
        document.getElementById("4min").disabled = true;
        document.getElementById("1min").disabled = true;
        var kind = normalizeDuelTypeStr(duel.Type);
        if (kind === "express") {
            select1.appendChild(createOption(0, duel.SituationRoles[0].Role, true));
            select2.appendChild(createOption(0, duel.SituationRoles[1].Role, true));
            select1.disabled = true;
            select2.disabled = true;
            document.getElementById("Player1RoleGoallabel").innerHTML = "Агрессивная фраза:";
            document.getElementById("Player2RoleGoallabel").innerHTML = "Агрессивная фраза:";
            document.getElementById("Player1RoleGoal").innerHTML = duel.SituationRoles[0].Phrase;
            document.getElementById("Player2RoleGoal").innerHTML = "";
            document.getElementById("Duel_Roles").innerHTML = "";
            duelType = "express";
        } else {
            duelType = kind;
            setupClassicLikeRolesUI(duel, select1, select2);
        }
        document.getElementById("classic").disabled = true;
        document.getElementById("express").disabled = true;
        var pairEl = document.getElementById("pair");
        if (pairEl) pairEl.disabled = true;
        var typeEl = document.getElementById(duelType);
        if (typeEl) typeEl.checked = true;
    }
    if (!isRestoringProtocol) saveProtocolStateToLocalStorage();
}
function roleChoosed(player) {
    var sel = document.getElementById("Player" + player + "Roles");
    var role = sel ? sel.value : "";
    var goals = "";
    var duel = duelsList[currentDuel];
    if (duel && duel.SituationRoles && role !== "" && duel.SituationRoles[role] != null) {
        goals = duel.SituationRoles[role].Goals || "";
    }
    var goalEl = document.getElementById("Player" + player + "RoleGoal");
    if (goalEl) goalEl.innerHTML = goals;
    othrPlayer = player % 2 + 1;
    var select = document.getElementById("Player" + othrPlayer + "Roles");
    if (select && select.options) {
        for (var i = 0; i < select.options.length; i++) {
            select.options[i].disabled = (select.options[i].value === role);
        }
    }
    if (isClassicLikeType(duelType) && sessionPhase === "round" && current_round >= 1) {
        var sel1 = document.getElementById("Player1Roles");
        var sel2 = document.getElementById("Player2Roles");
        var r1 = (sel1 && sel1.options[sel1.selectedIndex]) ? sel1.options[sel1.selectedIndex].text : "";
        var r2 = (sel2 && sel2.options[sel2.selectedIndex]) ? sel2.options[sel2.selectedIndex].text : "";
        var idx = current_round - 1;
        while (roundRoles.length <= idx) roundRoles.push({ player1Role: "", player2Role: "" });
        roundRoles[idx].player1Role = r1;
        roundRoles[idx].player2Role = r2;
    }
    saveProtocolStateToLocalStorage();
}


