/*--------------------------Протокол онлайна----------------------------*/
function formatDurationSec(sec) {
    if (sec == null || sec === "" || isNaN(sec)) return "";
    var s = parseInt(sec, 10);
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
}

function parseDurationToSec(str) {
    if (str == null || str === "") return null;
    if (typeof str === "number" && !isNaN(str)) return str;
    var s = String(str).trim();
    var parts = s.split(":");
    if (parts.length >= 2) {
        var m = parseInt(parts[0], 10);
        var sec = parseInt(parts[1], 10);
        if (!isNaN(m) && !isNaN(sec)) return m * 60 + sec;
    }
    var n = parseInt(s, 10);
    return isNaN(n) ? null : n;
}

function buildProtocolAndDownload() {
    if (!duelsList || duelsList.length === 0) {
        alert("Сначала загрузите расписание поединков.");
        return;
    }
    var name = (scheduleFileName && scheduleFileName.trim()) ? scheduleFileName.trim() : "Протокол онлайна";
    var maxRef = 0;
    for (var d = 0; d < duelsList.length; d++) {
        var q = duelsList[d].RefereeQty;
        maxRef = Math.max(maxRef, normalizeRefereeQty(q));
    }
    if (maxRef === 0) maxRef = 9;
    var headers = [""];
    for (var c = 0; c < duelsList.length; c++) headers.push("Поединок " + (c + 1));
    var rows = [headers];
    var rowLabels = ["Игрок 1", "Игрок 2", "Секундант 1", "Секундант 2", "Тип поединка", "Победитель"];
    for (var j = 1; j <= maxRef; j++) rowLabels.push("Судья " + j);
    for (var j = 1; j <= maxRef; j++) rowLabels.push("Судья " + j + " Голос");
    for (var r = 0; r < rowLabels.length; r++) {
        var label = rowLabels[r];
        var arr = [label];
        for (var col = 0; col < duelsList.length; col++) {
            var duel = duelsList[col];
            var val = "";
            if (r === 0) val = duel.Player1 != null ? String(duel.Player1) : "";
            else if (r === 1) val = duel.Player2 != null ? String(duel.Player2) : "";
            else if (r === 2) val = duel.Second1 != null ? String(duel.Second1) : "";
            else if (r === 3) val = duel.Second2 != null ? String(duel.Second2) : "";
            else if (r === 4) val = (duel.Type != null ? String(duel.Type) : "").trim() || "Классика";
            else if (r === 5) val = duel.Winner != null ? String(duel.Winner) : "";
            else if (r >= 6 && r < 6 + maxRef) {
                var judgeIdx = r - 6;
                var a = duelAssignments[col];
                if (a && a.judges && a.judges[judgeIdx] && a.judges[judgeIdx].personId) val = getPersonName(a.judges[judgeIdx].personId);
            } else if (r >= 6 + maxRef && r < 6 + 2 * maxRef) {
                var voteIdx = r - 6 - maxRef;
                var votes = duel.JudgeVotes;
                if (votes && voteIdx < (duel.RefereeQty || 9)) { var v = votes[voteIdx]; if (v === 1 || v === 2) val = v; }
            }
            arr.push(val);
        }
        rows.push(arr);
    }
    var wb = XLSX.utils.book_new();
    var wsProtocol = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, wsProtocol, "Протокол");
    var roundsRows = [["Поединок", "Раунд", "Длительность", "Игрок 1 Роль", "Игрок 2 Роль", "Время паузы", "Протесты"]];
    for (var d = 0; d < duelsList.length; d++) {
        var duel = duelsList[d];
        var durations = duel.RoundDurations || [];
        var roles = duel.RoundRoles || [];
        var events = duel.PauseProtestEvents || [];
        var numRounds = Math.max(durations.length, roles.length, 1);
        for (var r = 0; r < numRounds; r++) {
            var roundNum = r + 1;
            var dur = formatDurationSec(durations[r]);
            var role1 = (roles[r] && roles[r].player1Role) ? roles[r].player1Role : "";
            var role2 = (roles[r] && roles[r].player2Role) ? roles[r].player2Role : "";
            var pauseStr = "";
            var protestStrs = [];
            for (var e = 0; e < events.length; e++) {
                if (events[e].round !== roundNum) continue;
                if (events[e].type === "pause") pauseStr = formatDurationSec(events[e].gameTimeLeft);
                else if (events[e].type === "protest") protestStrs.push(formatDurationSec(events[e].gameTimeLeft));
            }
            roundsRows.push([d + 1, roundNum, dur, role1, role2, pauseStr, protestStrs.join(", ")]);
        }
    }
    var wsRounds = XLSX.utils.aoa_to_sheet(roundsRows);
    XLSX.utils.book_append_sheet(wb, wsRounds, "Раунды");
    XLSX.writeFile(wb, "Протокол " + name + ".xlsx");
    try {
        localStorage.removeItem(PROTOCOL_STORAGE_KEY);
    } catch (e) {}
    hideRestoreProtocolBanner();
}

function buildSessionStatePayload() {
    var currentDuelNum = currentDuel === undefined || currentDuel === null ? 0 : (typeof currentDuel === "string" ? parseInt(currentDuel, 10) : currentDuel);
    if (isNaN(currentDuelNum) || currentDuelNum < 0) currentDuelNum = 0;
    var payload = { scheduleFileName: scheduleFileName || "", phase: sessionPhase, currentDuel: currentDuelNum };
    if (sessionPhase === "round" || sessionPhase === "judges") {
        payload.time0 = time[0]; payload.time1 = time[1];
        payload.roundStartRemaining0 = roundStartRemaining[0]; payload.roundStartRemaining1 = roundStartRemaining[1];
        payload.roundDurations = roundDurations.slice();
        payload.current_round = current_round; payload.current_player = current_player;
        payload.game_time = game_time; payload.duelType = duelType; payload.refereeQty = refereeQty;
        var p1El = document.getElementById("Player1Name"); var p2El = document.getElementById("Player2Name");
        payload.player1Name = (p1El && p1El.value) ? p1El.value.trim() : "";
        payload.player2Name = (p2El && p2El.value) ? p2El.value.trim() : "";
        payload.roundRoles = roundRoles.slice(); payload.pauseProtestEvents = pauseProtestEvents.slice();
        var sel1 = document.getElementById("Player1Roles"), sel2 = document.getElementById("Player2Roles");
        if (sel1 && sel2 && sel1.options.length && sel2.options.length) {
            var opt1 = sel1.selectedIndex >= 0 ? sel1.options[sel1.selectedIndex] : null;
            var opt2 = sel2.selectedIndex >= 0 ? sel2.options[sel2.selectedIndex] : null;
            payload.currentRoundRole1 = (opt1 && opt1.text) ? opt1.text.trim() : "";
            payload.currentRoundRole2 = (opt2 && opt2.text) ? opt2.text.trim() : "";
        }
    }
    if (sessionPhase === "judges" && refereeList) {
        payload.refereeVotes = refereeList.map(function (r) { return { vote: r.vote, visible: r.visible }; });
        payload.activeReferee = activeReferee;
    }
    if (sessionPhase === "idle") {
        var sel1 = document.getElementById("Player1Roles"), sel2 = document.getElementById("Player2Roles");
        if (sel1 && sel2 && sel1.options.length && sel2.options.length) {
            var opt1Idle = sel1.selectedIndex >= 0 ? sel1.options[sel1.selectedIndex] : null;
            var opt2Idle = sel2.selectedIndex >= 0 ? sel2.options[sel2.selectedIndex] : null;
            payload.currentRoundRole1 = (opt1Idle && opt1Idle.text) ? opt1Idle.text.trim() : "";
            payload.currentRoundRole2 = (opt2Idle && opt2Idle.text) ? opt2Idle.text.trim() : "";
        }
    }
    if (lastCompletedDuelIndex != null) payload.lastCompletedDuelIndex = lastCompletedDuelIndex;
    payload.people = people;
    var da = [];
    for (var i = 0; i < duelAssignments.length; i++) {
        var a = duelAssignments[i], b = {};
        for (var k in a) if (k !== "excludedPersonIds") b[k] = a[k];
        da.push(b);
    }
    payload.duelAssignments = da;
    payload.peopleNextId = peopleNextId;
    payload.revealedSituationIndices = getRevealedSituationIndicesForPayload();
    return payload;
}

function exportOnlineStatusToFile() {
    var listToExport = duelsList;
    var name = (scheduleFileName && scheduleFileName.trim()) ? scheduleFileName.trim() : "Статус онлайна";
    var sessionData = null;
    if (!listToExport || listToExport.length === 0) {
        try {
            var raw = localStorage.getItem(PROTOCOL_STORAGE_KEY);
            if (raw) {
                var data = JSON.parse(raw);
                if (data && data.duelsList && Array.isArray(data.duelsList) && data.duelsList.length > 0) {
                    listToExport = data.duelsList;
                    name = (data.scheduleFileName && String(data.scheduleFileName).trim()) ? String(data.scheduleFileName).trim() : "Статус онлайна";
                    sessionData = data;
                }
            }
        } catch (e) {}
    }
    if (!listToExport || listToExport.length === 0) {
        alert("Сначала загрузите расписание поединков или восстановите последний онлайн.");
        return;
    }
    var maxRef = 0;
    for (var d = 0; d < listToExport.length; d++) {
        var q = listToExport[d].RefereeQty;
        maxRef = Math.max(maxRef, normalizeRefereeQty(q));
    }
    if (maxRef === 0) maxRef = 9;
    var payloadExport = sessionData || buildSessionStatePayload();
    var currentDuelIdx = sessionData ? (sessionData.currentDuel != null ? sessionData.currentDuel : 0) : (currentDuel === undefined || currentDuel === null ? 0 : (typeof currentDuel === "string" ? parseInt(currentDuel, 10) : currentDuel));
    if (isNaN(currentDuelIdx) || currentDuelIdx < 0) currentDuelIdx = 0;
    var exportPhase = sessionData ? sessionData.phase : sessionPhase;
    var headers = [""];
    for (var c = 0; c < listToExport.length; c++) headers.push("Поединок " + (c + 1));
    var rows = [headers];
    var rowLabels = ["Игрок 1", "Игрок 2", "Секундант 1", "Секундант 2", "Тип поединка", "Победитель"];
    for (var j = 1; j <= maxRef; j++) rowLabels.push("Судья " + j);
    for (var j = 1; j <= maxRef; j++) rowLabels.push("Судья " + j + " Голос");
    for (var r = 0; r < rowLabels.length; r++) {
        var label = rowLabels[r];
        var arr = [label];
        for (var col = 0; col < listToExport.length; col++) {
            var duel = listToExport[col];
            var val = "";
            if (r === 0) val = duel.Player1 != null ? String(duel.Player1) : "";
            else if (r === 1) val = duel.Player2 != null ? String(duel.Player2) : "";
            else if (r === 2) val = duel.Second1 != null ? String(duel.Second1) : "";
            else if (r === 3) val = duel.Second2 != null ? String(duel.Second2) : "";
            else if (r === 4) val = (duel.Type != null ? String(duel.Type) : "").trim() || "Классика";
            else if (r === 5) val = duel.Winner != null ? String(duel.Winner) : "";
            else if (r >= 6 && r < 6 + maxRef) {
                var judgeIdx = r - 6;
                var a = duelAssignments[col];
                if (a && a.judges && a.judges[judgeIdx] && a.judges[judgeIdx].personId) val = getPersonName(a.judges[judgeIdx].personId);
            } else if (r >= 6 + maxRef && r < 6 + 2 * maxRef) {
                var voteIdx = r - 6 - maxRef;
                var votes = duel.JudgeVotes;
                if (col === currentDuelIdx && exportPhase === "judges" && payloadExport.refereeVotes && Array.isArray(payloadExport.refereeVotes)) {
                    if (voteIdx < payloadExport.refereeVotes.length) { var v = payloadExport.refereeVotes[voteIdx].vote; if (v === 1 || v === 2) val = v; }
                } else if (votes && voteIdx < (duel.RefereeQty || 9)) { var v = votes[voteIdx]; if (v === 1 || v === 2) val = v; }
            }
            arr.push(val);
        }
        rows.push(arr);
    }
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Протокол");
    var roundsRows = [["Поединок", "Раунд", "Длительность", "Игрок 1 Роль", "Игрок 2 Роль", "Время паузы", "Протесты"]];
    for (var d = 0; d < listToExport.length; d++) {
        var duel = listToExport[d];
        var durations = duel.RoundDurations || [];
        var roles = duel.RoundRoles || [];
        var events = duel.PauseProtestEvents || [];
        if (d === currentDuelIdx && (exportPhase === "round" || exportPhase === "judges")) {
            var sessDurations = sessionData ? (sessionData.roundDurations || []) : roundDurations;
            var sessRoles = sessionData ? (sessionData.roundRoles || []) : roundRoles;
            var sessEvents = sessionData ? (sessionData.pauseProtestEvents || []) : pauseProtestEvents;
            if (sessDurations.length || sessRoles.length || sessEvents.length) {
                durations = sessDurations.length ? sessDurations : durations;
                roles = sessRoles.length ? sessRoles : roles;
                events = sessEvents.length ? sessEvents : events;
            }
        }
        var exportCurrentRound = (d === currentDuelIdx && exportPhase === "round" && payloadExport.current_round) ? payloadExport.current_round : 0;
        var numRounds = Math.max(durations.length, roles.length, exportCurrentRound, 1);
        for (var r = 0; r < numRounds; r++) {
            var roundNum = r + 1;
            var dur = formatDurationSec(durations[r]);
            var role1 = (roles[r] && roles[r].player1Role) ? roles[r].player1Role : "";
            var role2 = (roles[r] && roles[r].player2Role) ? roles[r].player2Role : "";
            if (d === currentDuelIdx && exportPhase === "round" && roundNum === exportCurrentRound && (!role1 || !role2) && (payloadExport.currentRoundRole1 || payloadExport.currentRoundRole2)) {
                role1 = payloadExport.currentRoundRole1 || role1 || "";
                role2 = payloadExport.currentRoundRole2 || role2 || "";
            }
            if (d === currentDuelIdx && r === 0 && !role1 && !role2 && (payloadExport.currentRoundRole1 || payloadExport.currentRoundRole2)) {
                role1 = payloadExport.currentRoundRole1 || "";
                role2 = payloadExport.currentRoundRole2 || "";
            }
            var pauseStr = ""; var protestStrs = [];
            for (var e = 0; e < events.length; e++) {
                if (events[e].round !== roundNum) continue;
                if (events[e].type === "pause") pauseStr = formatDurationSec(events[e].gameTimeLeft);
                else if (events[e].type === "protest") protestStrs.push(formatDurationSec(events[e].gameTimeLeft));
            }
            roundsRows.push([d + 1, roundNum, dur, role1, role2, pauseStr, protestStrs.join(", ")]);
        }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(roundsRows), "Раунды");
    var payload = payloadExport;
    var sessionRows = [["Поле", "Значение"]];
    var keys = ["scheduleFileName", "phase", "currentDuel", "time0", "time1", "roundStartRemaining0", "roundStartRemaining1", "roundDurations", "current_round", "current_player", "game_time", "duelType", "refereeQty", "player1Name", "player2Name", "roundRoles", "pauseProtestEvents", "refereeVotes", "activeReferee", "currentRoundRole1", "currentRoundRole2", "lastCompletedDuelIndex", "people", "duelAssignments", "peopleNextId", "revealedSituationIndices"];
    for (var ki = 0; ki < keys.length; ki++) {
        var k = keys[ki];
        if (payload[k] === undefined) continue;
        var v = payload[k];
        if (typeof v === "object" && v !== null) v = JSON.stringify(v);
        sessionRows.push([k, v]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sessionRows), "Состояние сессии");
    XLSX.writeFile(wb, "Статус онлайна " + name + ".xlsx");
}

function setImportStatusMenuItemEnabled(enabled) {
    var ids = ["import-status-menu-item", "participants-judges-menu-item", "download-protocol-menu-item"];
    for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (!el) continue;
        if (enabled) {
            el.classList.remove("disabled");
            el.removeAttribute("aria-disabled");
            el.removeAttribute("title");
        } else {
            el.classList.add("disabled");
            el.setAttribute("aria-disabled", "true");
            el.setAttribute("title", "Сначала загрузите файл расписания");
        }
    }
}

function tryOpenParticipantsJudges(ev) {
    if (!duelsList || duelsList.length === 0) {
        if (ev) ev.preventDefault();
        alert("Сначала загрузите файл расписания.");
        return false;
    }
    openParticipantsJudgesModal();
    return false;
}

function tryBuildProtocolAndDownload(ev) {
    if (!duelsList || duelsList.length === 0) {
        if (ev) ev.preventDefault();
        alert("Сначала загрузите файл расписания.");
        return false;
    }
    buildProtocolAndDownload();
    return false;
}

function tryImportOnlineStatus(ev) {
    if (!duelsList || duelsList.length === 0) {
        if (ev) ev.preventDefault();
        alert("Сначала загрузите файл расписания.");
        return false;
    }
    document.getElementById("Import_Online_Status_File").click();
    return false;
}

function importOnlineStatusFromFile(ev) {
    var file = ev.target && ev.target.files[0];
    if (!file) return;
    ev.target.value = "";
    if (!duelsList || duelsList.length === 0) {
        alert("Сначала загрузите файл расписания.");
        return;
    }
    var reader = new FileReader();
    reader.onload = function () {
        try {
            var array = new Uint8Array(reader.result);
            var binary = String.fromCharCode.apply(null, array);
            var wb = XLSX.read(binary, { type: "binary" });
            if (!wb.SheetNames || wb.SheetNames.length === 0) { alert("В файле нет листов."); return; }
            var wsProtocol = wb.Sheets["Протокол"] || wb.Sheets[wb.SheetNames[0]];
            var aoa = XLSX.utils.sheet_to_json(wsProtocol, { header: 1 });
            if (!aoa || aoa.length < 2) { alert("Лист Протокол пуст или не найден."); return; }
            var firstRow = aoa[0];
            if (!firstRow || firstRow.length < 2) { alert("В протоколе нет колонок поединков."); return; }
            var numDuels = firstRow.length - 1;
            ensurePeopleFromSchedule();
            initDuelAssignmentsFromDuels();
            var hasNewProtocolFormat = false;
            for (var ri = 1; ri < aoa.length; ri++) {
                var row0 = aoa[ri];
                if (row0 && row0[0] && String(row0[0]).indexOf("Голос") !== -1) { hasNewProtocolFormat = true; break; }
            }
            for (var c = 1; c <= numDuels && (c - 1) < duelsList.length; c++) {
                var duel = duelsList[c - 1];
                var col = c - 1;
                if (!duel) continue;
                if (!duel.JudgeVotes) duel.JudgeVotes = [];
                for (var r = 1; r < aoa.length; r++) {
                    var row = aoa[r];
                    if (!row) continue;
                    var label = row[0] != null ? String(row[0]).trim() : "";
                    var val = row[c];
                    if (label === "Игрок 1") duel.Player1 = val != null ? String(val) : "";
                    else if (label === "Игрок 2") duel.Player2 = val != null ? String(val) : "";
                    else if (label === "Секундант 1") {
                        duel.Second1 = val != null ? String(val) : "";
                        if (duelAssignments[col]) duelAssignments[col].second1Id = (val != null && String(val).trim() !== "") ? getOrCreatePersonId(String(val).trim()) : null;
                    } else if (label === "Секундант 2") {
                        duel.Second2 = val != null ? String(val) : "";
                        if (duelAssignments[col]) duelAssignments[col].second2Id = (val != null && String(val).trim() !== "") ? getOrCreatePersonId(String(val).trim()) : null;
                    } else if (label === "Тип поединка") duel.Type = (val != null ? String(val) : "").trim() || "Классика";
                    else if (label === "Победитель") duel.Winner = val != null ? String(val) : "";
                    else if (label.indexOf("Судья") === 0) {
                        if (hasNewProtocolFormat && label.indexOf("Голос") !== -1) {
                            var jMatch = label.match(/Судья\s*(\d+)\s*Голос/);
                            if (jMatch) { var j = parseInt(jMatch[1], 10) - 1; if (j >= 0) { while (duel.JudgeVotes.length <= j) duel.JudgeVotes.push(0); duel.JudgeVotes[j] = (val === 1 || val === 2) ? val : 0; } }
                        } else if (hasNewProtocolFormat) {
                            var jMatch = label.match(/Судья\s*(\d+)/);
                            if (jMatch && val != null && String(val).trim() !== "" && val !== 1 && val !== 2) {
                                var j = parseInt(jMatch[1], 10) - 1;
                                var pid = getOrCreatePersonId(val);
                                if (duelAssignments[col] && duelAssignments[col].judges && duelAssignments[col].judges[j]) duelAssignments[col].judges[j].personId = pid;
                            }
                        } else {
                            duel.JudgeVotes.push((val === 1 || val === 2) ? val : 0);
                        }
                    }
                }
                duel.RefereeQty = normalizeRefereeQty(duel.JudgeVotes ? duel.JudgeVotes.length : 9);
            }
            var idxRounds = wb.SheetNames.indexOf("Раунды");
            if (idxRounds >= 0) {
                var wsRounds = wb.Sheets["Раунды"];
                var roundsAoa = XLSX.utils.sheet_to_json(wsRounds, { header: 1 });
                if (roundsAoa && Array.isArray(roundsAoa)) for (var ri = 1; ri < roundsAoa.length; ri++) {
                    var row = roundsAoa[ri];
                    if (!row || row.length < 3) continue;
                    var duelIdx = parseInt(row[0], 10) - 1;
                    if (isNaN(duelIdx) || duelIdx < 0 || duelIdx >= duelsList.length) continue;
                    var duel = duelsList[duelIdx];
                    var roundNum = parseInt(row[1], 10) || 1;
                    var durSec = parseDurationToSec(row[2]);
                    if (!duel.RoundDurations) duel.RoundDurations = [];
                    while (duel.RoundDurations.length < roundNum) duel.RoundDurations.push(null);
                    if (durSec != null) duel.RoundDurations[roundNum - 1] = durSec;
                    if (!duel.RoundRoles) duel.RoundRoles = [];
                    while (duel.RoundRoles.length < roundNum) duel.RoundRoles.push({ player1Role: "", player2Role: "" });
                    if (row[3] || row[4]) duel.RoundRoles[roundNum - 1] = { player1Role: (row[3] != null ? String(row[3]) : ""), player2Role: (row[4] != null ? String(row[4]) : "") };
                    if (!duel.PauseProtestEvents) duel.PauseProtestEvents = [];
                    var pauseSec = parseDurationToSec(row[5]);
                    if (pauseSec != null) duel.PauseProtestEvents.push({ type: "pause", round: roundNum, player: 1, gameTimeLeft: pauseSec });
                    var protestsStr = row[6] != null ? String(row[6]).trim() : "";
                    if (protestsStr) {
                        protestsStr.split(/[,;]/).forEach(function (s) {
                            var sec = parseDurationToSec(s.trim());
                            if (sec != null) duel.PauseProtestEvents.push({ type: "protest", round: roundNum, player: 1, gameTimeLeft: sec });
                        });
                    }
                }
            }
            scheduleFileName = (file.name || "").replace(/\.xlsx$/i, "").replace(/^Статус онлайна\s*/, "") || "Восстановлено";
            var data = { scheduleFileName: scheduleFileName, duelsList: duelsList, phase: "idle", currentDuel: 0 };
            var idxSession = wb.SheetNames.indexOf("Состояние сессии");
            if (idxSession >= 0) {
                var wsSession = wb.Sheets["Состояние сессии"];
                var sessionAoa = XLSX.utils.sheet_to_json(wsSession, { header: 1 });
                if (sessionAoa && Array.isArray(sessionAoa)) for (var si = 0; si < sessionAoa.length; si++) {
                    var r = sessionAoa[si];
                    if (!r || r.length < 2) continue;
                    var key = r[0] != null ? String(r[0]).trim() : "";
                    var val = r[1];
                    if (!key) continue;
                    if (key === "duelsList") continue;
                    if (key === "scheduleFileName") data.scheduleFileName = val != null ? String(val) : "";
                    else if (key === "phase") data.phase = val != null ? String(val) : "idle";
                    else if (key === "currentDuel") data.currentDuel = typeof val === "number" ? val : parseInt(val, 10);
                    else if (key === "time0") data.time0 = typeof val === "number" ? val : parseInt(val, 10);
                    else if (key === "time1") data.time1 = typeof val === "number" ? val : parseInt(val, 10);
                    else if (key === "roundStartRemaining0") data.roundStartRemaining0 = typeof val === "number" ? val : parseInt(val, 10);
                    else if (key === "roundStartRemaining1") data.roundStartRemaining1 = typeof val === "number" ? val : parseInt(val, 10);
                    else if (key === "current_round") data.current_round = typeof val === "number" ? val : parseInt(val, 10);
                    else if (key === "current_player") data.current_player = val === 1 || val === 2 ? val : 1;
                    else if (key === "game_time") data.game_time = typeof val === "number" ? val : parseInt(val, 10);
                    else if (key === "duelType") data.duelType = val != null ? String(val) : "classic";
                    else if (key === "refereeQty") data.refereeQty = normalizeRefereeQty(typeof val === "number" ? val : parseInt(val, 10));
                    else if (key === "player1Name") data.player1Name = val != null ? String(val) : "";
                    else if (key === "player2Name") data.player2Name = val != null ? String(val) : "";
                    else if (key === "roundDurations" || key === "roundRoles" || key === "pauseProtestEvents" || key === "refereeVotes") {
                        try { data[key] = typeof val === "string" ? JSON.parse(val) : val; } catch (e) {}
                    } else if (key === "activeReferee") data.activeReferee = typeof val === "number" ? val : parseInt(val, 10);
                    else if (key === "currentRoundRole1") data.currentRoundRole1 = val != null ? String(val) : "";
                    else if (key === "currentRoundRole2") data.currentRoundRole2 = val != null ? String(val) : "";
                    else if (key === "lastCompletedDuelIndex") data.lastCompletedDuelIndex = typeof val === "number" ? val : parseInt(val, 10);
                    else if (key === "people") { try { data.people = typeof val === "string" ? JSON.parse(val) : val; } catch (e) {} }
                    else if (key === "duelAssignments") { try { data.duelAssignments = typeof val === "string" ? JSON.parse(val) : val; } catch (e) {} }
                    else if (key === "peopleNextId") data.peopleNextId = typeof val === "number" ? val : parseInt(val, 10);
                    else if (key === "revealedSituationIndices") {
                        try { data.revealedSituationIndices = typeof val === "string" ? JSON.parse(val) : val; } catch (e) {}
                    }
                }
                if (data.people && typeof data.people === "object") { people = data.people; peopleNextId = (data.peopleNextId != null && !isNaN(data.peopleNextId)) ? data.peopleNextId : (function () { var max = 0; for (var k in people) { var n = parseInt(String(k).replace(/^p_/, ""), 10); if (!isNaN(n) && n > max) max = n; } return max + 1; })(); }
                if (data.duelAssignments && Array.isArray(data.duelAssignments)) {
                    duelAssignments = data.duelAssignments;
                    for (var ii = 0; ii < duelAssignments.length; ii++) if (duelAssignments[ii] && duelAssignments[ii].excludedPersonIds) delete duelAssignments[ii].excludedPersonIds;
                }
                if (data.scheduleFileName != null && data.scheduleFileName !== "") scheduleFileName = data.scheduleFileName;
            }
            normalizeDuelsListHiddenFlags(duelsList);
            restoreRevealedSituationIndicesFromPayload(data);
            var fileNameEl = document.getElementById("file-name");
            if (fileNameEl) fileNameEl.innerHTML = scheduleFileName;
            renderDuelChooser();
            switchToFileDropdown();
            if (data.currentDuel !== undefined && data.currentDuel !== null && !isNaN(data.currentDuel) && data.currentDuel >= 0 && data.currentDuel < duelsList.length) {
                duelChoosed(String(data.currentDuel));
            }
            applyRestoredSessionState(data);
            if (data.phase === "idle" && data.lastCompletedDuelIndex != null && !isNaN(data.lastCompletedDuelIndex) && data.lastCompletedDuelIndex >= 0 && data.lastCompletedDuelIndex < duelsList.length) {
                lastCompletedDuelIndex = data.lastCompletedDuelIndex;
                var reopenBtn = document.getElementById("reopen_judges_form_btn");
                if (reopenBtn) reopenBtn.style.display = "block";
            }
            saveProtocolStateToLocalStorage();
            hideRestoreProtocolBanner();
        } catch (e) {
            console.warn("importOnlineStatusFromFile", e);
            alert("Не удалось загрузить файл: " + (e.message || e));
        }
    };
    reader.readAsArrayBuffer(file);
}

function showRestoreProtocolBanner() {
    var el = document.getElementById("restore-protocol-banner");
    if (el) el.style.display = "";
}

function hideRestoreProtocolBanner() {
    var el = document.getElementById("restore-protocol-banner");
    if (el) el.style.display = "none";
}

function clearProtocolStateAndHideBanner() {
    try {
        localStorage.removeItem(PROTOCOL_STORAGE_KEY);
    } catch (e) {}
    hideRestoreProtocolBanner();
}

function hasProtocolRealData(duels) {
    if (!duels || !Array.isArray(duels)) return false;
    for (var i = 0; i < duels.length; i++) {
        var d = duels[i];
        if (d.Winner != null && String(d.Winner).trim() !== "") return true;
        if (d.RoundDurations && d.RoundDurations.length > 0) return true;
        if (d.JudgeVotes && Array.isArray(d.JudgeVotes)) {
            for (var j = 0; j < d.JudgeVotes.length; j++) {
                if (d.JudgeVotes[j] === 1 || d.JudgeVotes[j] === 2) return true;
            }
        }
    }
    return false;
}

function checkRestoreProtocolBanner(ignoreInMemoryList) {
    try {
        var raw = localStorage.getItem(PROTOCOL_STORAGE_KEY);
        if (!raw) return;
        var data = JSON.parse(raw);
        if (!data.duelsList || !Array.isArray(data.duelsList) || data.duelsList.length === 0) return;
        var hasRealData = hasProtocolRealData(data.duelsList);
        var hasActiveSession = data.phase === "round" || data.phase === "judges";
        var hasParticipants = data.people && typeof data.people === "object" && Object.keys(data.people).length > 0;
        if (!hasRealData && !hasActiveSession && !hasParticipants) return;
        if (!ignoreInMemoryList && duelsList && duelsList.length > 0) return;
        showRestoreProtocolBanner();
    } catch (e) {}
}

function attachJudgesModalReopenListeners() {
    var finishModalEl = document.getElementById("finishDuelModal");
    if (!finishModalEl || finishModalEl._judgesModalListenersAttached) return;
    finishModalEl._judgesModalListenersAttached = true;
    finishModalEl.addEventListener("hidden.bs.modal", function () {
        if (sessionPhase === "judges" || (sessionPhase === "idle" && lastCompletedDuelIndex != null)) {
            var btn = document.getElementById("reopen_judges_form_btn");
            if (btn) btn.style.display = "block";
        }
    });
}

(function checkRestoreProtocolOnLoad() {
    checkRestoreProtocolBanner(false);
    function updateImportStatusMenu() { setImportStatusMenuItemEnabled(!!(duelsList && duelsList.length > 0)); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", updateImportStatusMenu);
    else updateImportStatusMenu();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachJudgesModalReopenListeners);
    else attachJudgesModalReopenListeners();
})();

window.addEventListener("pageshow", function (e) {
    if (e.persisted) checkRestoreProtocolBanner(true);
});
