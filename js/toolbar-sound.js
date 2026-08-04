/*---------------------Кнопки тулбара ---------------------------------*/

function setDuelTime(time) {
    game_time = time;
    initTimers();
}

function ShowHideSituationInfo() {

    if (!document.getElementById("hide_text").checked) {
        document.getElementById("PlayersInterests").style.visibility = 'hidden';
        document.getElementById("SituationText").style.visibility = 'hidden';
    }
    else {
        document.getElementById("PlayersInterests").style.visibility = 'visible';
        document.getElementById("SituationText").style.visibility = 'visible';
    }

    // Мобилка: по чекбоксу газеты прятать/показывать кнопку «Показать ситуацию»
    var bar = document.getElementById("situation-toggle-bar");
    if (bar && window.matchMedia("(max-width: 992px)").matches) {
        bar.classList.toggle("situation-toggle-bar-hidden", !document.getElementById("hide_text").checked);
    }
}

/** Открыть текст ситуации на весь экран (мобильная вёрстка). «Показать ситуацию» вызывает это. */
function openSituationFullscreen() {
    document.body.classList.add('situation-fullscreen');
}

/** Закрыть полноэкранный режим текста ситуации (мобильная вёрстка). */
function closeSituationFullscreen() {
    document.body.classList.remove('situation-fullscreen');
}

/*---------------------звук ---------------------------------*/

function stopAudio(a)
{
    a.pause();
    a.currentTime = 0;
}

function playDrumRoll() {
    if (soundsEnabled) {
        stopAudio(audioApplause);
        audioDrumRoll.play();
    }
}

function playApplause() {
    if (soundsEnabled) {
        stopAudio(audioDrumRoll);
        audioApplause.play();
    }
}

function finishDuelAndClose(ev) {
    refereeTimer("stop_timer");
    if (!ev.shiftKey && soundsEnabled) {
        stopAudio(audioDrumRoll);
        audioApplause.play();
    }
    var score = [0, 0, 0];
    var judgeVotes = [];
    if (refereeList) {
        for (var i = 0; i < refereeList.length; i++) {
            if (refereeList[i].visible) {
                score[refereeList[i].vote]++;
                judgeVotes.push(refereeList[i].vote);
            }
        }
    }
    var p1Name = document.getElementById("Player1Name") && document.getElementById("Player1Name").value ? document.getElementById("Player1Name").value.trim() : "";
    var p2Name = document.getElementById("Player2Name") && document.getElementById("Player2Name").value ? document.getElementById("Player2Name").value.trim() : "";
    var winner = "";
    if (score[1] > score[2]) winner = p1Name;
    else if (score[2] > score[1]) winner = p2Name;
    if (duelsList && currentDuel !== undefined && currentDuel !== null && duelsList[currentDuel]) {
        duelsList[currentDuel].Winner = winner;
        duelsList[currentDuel].JudgeVotes = judgeVotes.slice();
        duelsList[currentDuel].RoundDurations = roundDurations.slice();
        duelsList[currentDuel].RefereeQty = refereeQty;
        duelsList[currentDuel].RoundRoles = roundRoles.slice();
        duelsList[currentDuel].PauseProtestEvents = pauseProtestEvents.slice();
    }
    var justCompletedDuel = currentDuel;
    sessionPhase = "idle";
    duel_is_active = false;
    lastCompletedDuelIndex = justCompletedDuel;
    document.getElementById("current_round").textContent = "\xa0";
    document.getElementById("start_stop_duel").textContent = "Начать поединок";
    document.getElementById("start_stop_duel").classList.remove("btn-danger");
    document.getElementById("start_stop_duel").classList.add("btn-primary");
    enable_disable_duel_options_conrols("hidden", false);
    initTimers();
    saveProtocolStateToLocalStorage();
    var modalEl = document.getElementById("finishDuelModal");
    var modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    var allVoted = true;
    if (refereeList) {
        for (var vi = 0; vi < refereeList.length; vi++) {
            if (refereeList[vi].visible && (refereeList[vi].vote !== 1 && refereeList[vi].vote !== 2)) { allVoted = false; break; }
        }
    }
    var currentDuelNum = currentDuel === undefined || currentDuel === null ? 0 : (typeof currentDuel === "string" ? parseInt(currentDuel, 10) : currentDuel);
    if (allVoted && duelsList && !isNaN(currentDuelNum) && currentDuelNum >= 0 && currentDuelNum < duelsList.length - 1) {
        duelChoosed(String(currentDuelNum + 1));
    } else if (typeof updateRandomSituationDiceButton === "function") {
        updateRandomSituationDiceButton();
    }
    var reopenBtn = document.getElementById("reopen_judges_form_btn");
    if (reopenBtn) reopenBtn.style.display = "block";
}

function reopenJudgesForm() {
    if (sessionPhase === "idle" && lastCompletedDuelIndex != null && duelsList && duelsList[lastCompletedDuelIndex]) {
        var prevDuel = duelsList[lastCompletedDuelIndex];
        currentDuel = lastCompletedDuelIndex;
        duelChoosed(String(lastCompletedDuelIndex));
        var q = normalizeRefereeQty(prevDuel.RefereeQty);
        prevDuel.RefereeQty = q;
        refereeQty = q;
        initRefereeStructure(refereeQty);
        var votes = prevDuel.JudgeVotes;
        if (refereeList && votes && Array.isArray(votes)) {
            var voteIdx = 0;
            for (var i = 0; i < refereeList.length; i++) {
                if (refereeList[i].visible) {
                    refereeList[i].vote = (voteIdx < votes.length && (votes[voteIdx] === 1 || votes[voteIdx] === 2)) ? votes[voteIdx] : 0;
                    voteIdx++;
                }
            }
        }
        activeReferee = 0;
        sessionPhase = "judges";
        highlightReferee();
        var modalEl = document.getElementById("finishDuelModal");
        var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
        var btn = document.getElementById("reopen_judges_form_btn");
        if (btn) btn.style.display = "none";
        return;
    }
    if (sessionPhase === "judges") {
        var modalEl = document.getElementById("finishDuelModal");
        var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        highlightReferee();
        modal.show();
    }
}

function toggeSound()
{
    if (document.getElementById("sound").checked) {
        document.getElementById("sound_icon").classList.add("fa-volume-high");
        document.getElementById("sound_icon").classList.remove("fa-volume-xmark");
        soundsEnabled=true;
    }
    else
    {
        document.getElementById("sound_icon").classList.add("fa-volume-xmark");
        document.getElementById("sound_icon").classList.remove("fa-volume-high");
        soundsEnabled=false;
        stopAudio(audioTicking);
        stopAudio(audioGong);
        stopAudio(audioGudok);
        stopAudio(audioDrumRoll);
        stopAudio(audioApplause);
        if (audioIntro) { stopAudio(audioIntro); }
    }
}

