(function setupTimerDblclickEdit() {
    /** Парсит ввод времени: "M:SS", "MM:SS" или число секунд. Возвращает секунды или null. */
    function parseTimeInput(str) {
        if (str == null || (str = String(str).trim()) === "") return null;
        if (str.indexOf(":") !== -1) {
            var parts = str.split(":");
            if (parts.length === 2) {
                var m = parseInt(parts[0], 10);
                var s = parseInt(parts[1], 10);
                if (!isNaN(m) && !isNaN(s) && m >= 0 && s >= 0 && s < 60) return m * 60 + s;
            }
            return null;
        }
        var num = parseInt(str, 10);
        return (!isNaN(num) && num >= 0) ? num : null;
    }
    function colorForDonut(playerIndex, value) {
        var isActive = (current_player === playerIndex + 1);
        if (!isActive) return inactiveTimerColor;
        if (value <= finishingTime) return finishingTimerColor;
        if (value <= emergingTime) return emergingTimerColor;
        return activeTimerColor;
    }
    function applyTimerValue(playerIndex, seconds) {
        var idx = playerIndex;
        time[idx] = Math.max(1, Math.min(game_time, seconds));
        var donut = (idx === 0) ? donut1 : donut2;
        var color = colorForDonut(idx, time[idx]);
        donut.setState({ value: time[idx], color: color });
        document.getElementById("timer" + (idx + 1)).textContent = formatTime(time[idx]);
        if (duel_is_active) saveProtocolStateToLocalStorage();
    }
    function startEdit(timerId) {
        if (clock_is_active || !duel_is_active) return;
        var playerIndex = (timerId === "timer1") ? 0 : 1;
        if (timerId !== "timer1" && timerId !== "timer2") return;
        var el = document.getElementById(timerId);
        if (!el || el.querySelector("input.timer-edit-input")) return;
        var parent = el.parentNode;
        var input = document.createElement("input");
        input.type = "text";
        input.className = "timer-edit-input";
        input.value = formatTime(time[playerIndex]);
        input.setAttribute("aria-label", "Время в формате М:СС или секунды");
        var style = window.getComputedStyle(el);
        input.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;text-align:center;font-size:inherit;font-family:inherit;border:1px solid #0d6efd;border-radius:4px;box-sizing:border-box;padding:0;background:rgba(255,255,255,0.95);";
        input.style.fontSize = style.fontSize;
        input.style.lineHeight = el.style.lineHeight || "200px";
        el.style.visibility = "hidden";
        parent.appendChild(input);
        input.focus();
        input.select();
        var done = false;
        function finishEdit() {
            if (done) return;
            done = true;
            var val = parseTimeInput(input.value);
            if (val !== null) applyTimerValue(playerIndex, val);
            if (input.parentNode) parent.removeChild(input);
            el.style.visibility = "";
        }
        function cancelEdit() {
            if (done) return;
            done = true;
            if (input.parentNode) parent.removeChild(input);
            el.style.visibility = "";
        }
        input.addEventListener("blur", finishEdit);
        input.addEventListener("keydown", function(e) {
            if (e.key === "Enter") { e.preventDefault(); finishEdit(); }
            if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
        });
    }
    function onDblclick(e) {
        var id = e.currentTarget.id;
        if (id === "timer1" || id === "timer2") startEdit(id);
    }
    var t1 = document.getElementById("timer1");
    var t2 = document.getElementById("timer2");
    if (t1) { t1.addEventListener("dblclick", onDblclick); t1.title = "Двойной клик — ввести время (при остановленных часах). Формат: М:СС или секунды"; }
    if (t2) { t2.addEventListener("dblclick", onDblclick); t2.title = "Двойной клик — ввести время (при остановленных часах). Формат: М:СС или секунды"; }
})();

/*--------------------------Подсветка игроков----------------------------*/

function setPlayer(playerNum) {
    current_player = playerNum;
    if (playerNum === 1) {
        donut1.setState({ color: activeTimerColor });
        donut2.setState({ color: inactiveTimerColor });
        document.getElementById("Player1Label").style.backgroundColor = activePlayerColor;
        document.getElementById("Player1Label").style.color = "white";
        document.getElementById("Player2Label").style.backgroundColor = inactivePlayerColor;
        document.getElementById("Player2Label").style.color = "black";
    }
    else {
        donut1.setState({ color: inactiveTimerColor });
        donut2.setState({ color: activeTimerColor });
        document.getElementById("Player1Label").style.backgroundColor = inactivePlayerColor;
        document.getElementById("Player1Label").style.color = "black";
        document.getElementById("Player2Label").style.backgroundColor = activePlayerColor;
        document.getElementById("Player2Label").style.color = "white";    
    }
}

function highlightPlayer()
{
    if (current_player ===1) { 
        donut1.setState({ bg: activePlayerColor, color: activePlayerColor}); 
        donut2.setState({ bg:donuttyTrackColor, color: inactiveTimerColor });
       } 
    else {
        donut2.setState({ bg: activePlayerColor, color: activePlayerColor });
        donut1.setState({ bg:donuttyTrackColor, color: inactiveTimerColor });        
    };  
}


function initTimers() {
    time[0] = game_time;
    time[1] = game_time;
    donut1.setState({ max: game_time, value: time[0], color: inactiveTimerColor , bg: donuttyTrackColor });
    donut2.setState({ max: game_time, value: time[1], color: inactiveTimerColor, bg: donuttyTrackColor });
    document.getElementById("Player1Label").style.backgroundColor = inactivePlayerColor;
    document.getElementById("Player2Label").style.backgroundColor = inactivePlayerColor;
    document.getElementById("timer1").textContent = formatTime(time[0]);
    document.getElementById("timer2").textContent = formatTime(time[1]);
    document.getElementById("Player1Label").style.color = "black";
    document.getElementById("Player2Label").style.color = "black";    
}

/*---------------------Dice ---------------------------------*/

function finishDice() {
    var countdownEl = document.getElementById("dice_countdown");
    if (countdownEl) countdownEl.style.display = "none";
    if (introBlinkTimeoutId !== null) {
        clearTimeout(introBlinkTimeoutId);
        introBlinkTimeoutId = null;
    }
    if (introFinishTimeoutId !== null) {
        clearTimeout(introFinishTimeoutId);
        introFinishTimeoutId = null;
    }
    if (introCountdownIntervalId !== null) {
        clearInterval(introCountdownIntervalId);
        introCountdownIntervalId = null;
    }
    if (audioIntro) {
        if (introTimeupdateHandler) {
            audioIntro.removeEventListener("timeupdate", introTimeupdateHandler);
            introTimeupdateHandler = null;
        }
        stopAudio(audioIntro);
        audioIntro = null;
    }
    initTimers();
    var whoStarts;
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        var u = new Uint32Array(1);
        crypto.getRandomValues(u);
        whoStarts = (u[0] % 2 === 0) ? 1 : 2;
    } else {
        whoStarts = Math.random() < 0.5 ? 1 : 2;
    }
    setPlayer(whoStarts);
    highlightPlayer();
    donut1.$donut.style.transition = donut1.options.transition || "";
    donut1.$bg.style.transition = donut1.options.transition || "";
    donut2.$donut.style.transition = donut2.options.transition || "";
    donut2.$bg.style.transition = donut2.options.transition || "";
    document.body.classList.remove("dice-blink-active");
    document.getElementById("dice_button").classList.remove("dice-busy");
    document.getElementById("dice_button").disabled = duel_is_active;
    if (typeof updateRandomSituationDiceButton === "function") updateRandomSituationDiceButton();
}

function setDiceBlinkHighlight(playerNum) {
    current_player = playerNum;
    if (playerNum === 1) {
        donut1.state.color = activeTimerColor;
        donut1.state.bg = activePlayerColor;
        donut2.state.color = inactiveTimerColor;
        donut2.state.bg = donuttyTrackColor;
        donut1.$donut.setAttribute("stroke", activeTimerColor);
        donut1.$bg.setAttribute("stroke", activePlayerColor);
        donut2.$donut.setAttribute("stroke", inactiveTimerColor);
        donut2.$bg.setAttribute("stroke", donuttyTrackColor);
        document.getElementById("Player1Label").style.backgroundColor = activePlayerColor;
        document.getElementById("Player1Label").style.color = "white";
        document.getElementById("Player2Label").style.backgroundColor = inactivePlayerColor;
        document.getElementById("Player2Label").style.color = "black";
    } else {
        donut1.state.color = inactiveTimerColor;
        donut1.state.bg = donuttyTrackColor;
        donut2.state.color = activeTimerColor;
        donut2.state.bg = activePlayerColor;
        donut1.$donut.setAttribute("stroke", inactiveTimerColor);
        donut1.$bg.setAttribute("stroke", donuttyTrackColor);
        donut2.$donut.setAttribute("stroke", activeTimerColor);
        donut2.$bg.setAttribute("stroke", activePlayerColor);
        document.getElementById("Player1Label").style.backgroundColor = inactivePlayerColor;
        document.getElementById("Player1Label").style.color = "black";
        document.getElementById("Player2Label").style.backgroundColor = activePlayerColor;
        document.getElementById("Player2Label").style.color = "white";
    }
}

function blinkingIntroStep(qty) {
    if (duelsList && duelsList[currentDuel]) {
        var duel = duelsList[currentDuel];
        var tp = duel.Player1, tsp = duel.Player2, ts1 = duel.Second1, ts2 = duel.Second2;
        duel.Player1 = tsp;
        duel.Player2 = tp;
        duel.Second1 = ts2;
        duel.Second2 = ts1;
        applyPlayerNameFieldsFromDuel(duel);
    } else {
        var a = document.getElementById("Player1Name").value;
        var b = document.getElementById("Player2Name").value;
        document.getElementById("Player1Name").value = b;
        document.getElementById("Player2Name").value = a;
    }
    var newPlayer = (qty % 2) + 1;
    setDiceBlinkHighlight(newPlayer);
    introBlinkTimeoutId = setTimeout(function() { blinkingIntroStep(qty + 1); }, 200);
}

function dice() {
    if (introBlinkTimeoutId !== null || (audioIntro && !audioIntro.paused)) {
        finishDice();
        return;
    }
    document.getElementById("dice_button").classList.add("dice-busy");
    document.body.classList.add("dice-blink-active");
    if (typeof updateRandomSituationDiceButton === "function") updateRandomSituationDiceButton();
    donut1.$donut.style.transition = "none";
    donut1.$bg.style.transition = "none";
    donut2.$donut.style.transition = "none";
    donut2.$bg.style.transition = "none";
    var list = introTracksList.length > 0 ? introTracksList : introTracksListFallback;
    var trackFile = (!selectedIntroTrack || selectedIntroTrack === "random") && list.length > 0
        ? list[Math.floor(Math.random() * list.length)]
        : selectedIntroTrack;
    var countdownEl = document.getElementById("dice_countdown");
    if (countdownEl) countdownEl.style.display = "block";
    if (soundsEnabled && trackFile) {
        var path = "assets/Sound/intro/" + trackFile;
        audioIntro = new Audio(path);
        countdownEl.textContent = "--:--";
        introTimeupdateHandler = function() {
            if (!audioIntro) return;
            var d = audioIntro.duration;
            var c = audioIntro.currentTime;
            if (isFinite(d) && d > 0) {
                countdownEl.textContent = formatTime(Math.ceil(d - c));
            }
        };
        audioIntro.addEventListener("timeupdate", introTimeupdateHandler);
        audioIntro.addEventListener("ended", function onEnded() {
            audioIntro.removeEventListener("ended", onEnded);
            finishDice();
        });
        audioIntro.play().catch(function() { finishDice(); });
        blinkingIntroStep(1);
    } else {
        var durationMs = 1600 + Math.ceil(Math.random() * 1000);
        var remainingSec = durationMs / 1000;
        countdownEl.textContent = formatTime(Math.ceil(remainingSec));
        introCountdownIntervalId = setInterval(function() {
            remainingSec -= 0.2;
            if (remainingSec <= 0) {
                countdownEl.textContent = "0:00";
            } else {
                countdownEl.textContent = formatTime(Math.ceil(remainingSec));
            }
        }, 200);
        blinkingIntroStep(1);
        introFinishTimeoutId = setTimeout(finishDice, durationMs);
    }
}

document.getElementById("dice_button").addEventListener("contextmenu", function(ev) {
    ev.preventDefault();
    var menu = document.getElementById("dice_intro_menu");
    menu.innerHTML = "";
    var list = introTracksList.length > 0 ? introTracksList : introTracksListFallback;
    var li0 = document.createElement("li");
    var a0 = document.createElement("a");
    a0.className = "dropdown-item";
    a0.href = "#";
    a0.textContent = "Случайный";
    a0.dataset.track = "random";
    li0.appendChild(a0);
    menu.appendChild(li0);
    for (var i = 0; i < list.length; i++) {
        var f = list[i];
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.className = "dropdown-item";
        a.href = "#";
        a.textContent = f.replace(/\.mp3$/i, "");
        a.dataset.track = f;
        li.appendChild(a);
        menu.appendChild(li);
    }
    menu.style.left = "0";
    menu.style.top = "100%";
    menu.classList.add("show");
    function chooseTrack(track) {
        selectedIntroTrack = track;
        menu.classList.remove("show");
        document.removeEventListener("click", closeMenu);
    }
    function closeMenu() {
        menu.classList.remove("show");
        document.removeEventListener("click", closeMenu);
    }
    menu.querySelectorAll(".dropdown-item").forEach(function(el) {
        el.addEventListener("click", function(e) {
            e.preventDefault();
            chooseTrack(el.dataset.track);
        });
    });
    setTimeout(function() { document.addEventListener("click", closeMenu); }, 0);
});



/*--------------------------Переход хода----------------------------*/


function changePlayer() {
    stop_timer();
    var previousPlayer = current_player;
    var newPlayer = (current_player % 2) + 1;
    if (time[newPlayer - 1] === 0) // однократный возврат обратно себе 
    {
        // визуализировать мигание бубликов
        var cur = current_player;
        setPlayer(newPlayer);
        highlightPlayer();
        setTimeout(() => {setPlayer(cur); 
                            if (cur === 1) { 
                                donut2.setState({ bg: donuttyTrackColor, color: inactiveTimerColor});
                                donut1.setState({ bg: donuttyTrackColor, color: activeTimerColor });
                            } 
                            else {
                                donut1.setState({ bg: donuttyTrackColor, color: inactiveTimerColor });
                                donut2.setState({ bg: donuttyTrackColor, color: activeTimerColor });     
                            };           
                        }, 1200);
        lastShiftIsUsed =  true;        
    }
    else {
        setPlayer(newPlayer);
    }
    // Длительность считаем по игроку, чей ход завершился (previousPlayer), т.к. setPlayer уже сменил current_player
    var durationSec = roundStartRemaining[previousPlayer - 1] - time[previousPlayer - 1];
    if (durationSec > 0) roundDurations.push(durationSec);
    roundStartRemaining[previousPlayer - 1] = time[previousPlayer - 1];
    roundStartRemaining[newPlayer - 1] = time[newPlayer - 1];
    current_round++;
    document.getElementById("current_round").textContent = "Раунд №" + current_round;
    document.getElementById("change_player").disabled = true;
    if (isClassicLikeType(duelType))
     {
      // Сохраняем роли завершённого раунда для протокола (читаем до сброса селектов)
      var sel1 = document.getElementById('Player1Roles');
      var sel2 = document.getElementById('Player2Roles');
      var r1 = (sel1 && sel1.options[sel1.selectedIndex]) ? sel1.options[sel1.selectedIndex].text : "";
      var r2 = (sel2 && sel2.options[sel2.selectedIndex]) ? sel2.options[sel2.selectedIndex].text : "";
      if (r1 || r2) roundRoles.push({ player1Role: r1, player2Role: r2 });
      saveProtocolStateToLocalStorage();
      // Очищаем Роли
      document.getElementById('Player1Roles').value = -1;
      document.getElementById('Player2Roles').value=-1;
      document.getElementById("Player1RoleGoal").innerHTML ="";
      document.getElementById("Player2RoleGoal").innerHTML ="";
      for (var i=1;i<3;i++)
       {var select = document.getElementById("Player"+i+"Roles");
        for (var j = 0; j < select.options.length; j++) { 
             select.options[j].disabled = false;
            }
       }
     }
     else
     {
        if (duelsList && duelsList[currentDuel]) { 

           document.getElementById('Player1Roles').options[0].innerHTML = duelsList[currentDuel].SituationRoles[1].Role;
           document.getElementById('Player2Roles').options[0].innerHTML = duelsList[currentDuel].SituationRoles[0].Role;
           document.getElementById("Player1RoleGoal").innerHTML ="";
           document.getElementById("Player2RoleGoal").innerHTML =duelsList[currentDuel].SituationRoles[0].Phrase;
        }
     }


}



/*--------------------------Поединок----------------------------*/
function start_stop_duel() {
    if (duel_is_active) { stop_duel(); }
    else { start_duel(); }
}

function enable_disable_duel_options_conrols(visibility, disabled) {
    document.getElementById("start_stop_timer").style.visibility = visibility;
    document.getElementById("change_player").style.visibility = visibility;
    document.getElementById("protest").style.visibility = visibility;
    document.getElementById("pause").style.visibility = visibility;
    var btnFile = document.getElementById("Choose_File_Button");
    if (btnFile) btnFile.disabled = disabled;
    var btnFileDrop = document.getElementById("Choose_File_Button_Dropdown");
    if (btnFileDrop) btnFileDrop.disabled = disabled;
    document.getElementById("Choose_Duel_Button").disabled = disabled;
    document.getElementById("dice_button").disabled = disabled;
    if (!(duelsList && duelsList[currentDuel]))
      {
       document.getElementById("Player1Name").disabled = disabled;
       document.getElementById("Player2Name").disabled = disabled; 
       document.getElementById("classic").disabled = disabled;
       document.getElementById("express").disabled = disabled;
       var pairEl = document.getElementById("pair");
       if (pairEl) pairEl.disabled = disabled;
       document.getElementById("duel_time_picker").disabled = disabled;
       document.getElementById("5min").disabled = disabled;
       document.getElementById("4min").disabled = disabled;
       document.getElementById("1min").disabled = disabled;
      }
    


}

function start_duel() {
    enable_disable_duel_options_conrols("visible", true);
    document.getElementById("start_stop_duel").textContent = "Завершить поединок";
    document.getElementById("start_stop_duel").classList.remove("btn-primary");
    document.getElementById("start_stop_duel").classList.add("btn-danger");
    initTimers();
    setPlayer(1);
    start_timer();
    current_round = 1;
    roundStartRemaining[0] = time[0];
    roundStartRemaining[1] = time[1];
    roundDurations = [];
    roundRoles = [];
    pauseProtestEvents = [];
    if (isClassicLikeType(duelType)) {
        var sel1 = document.getElementById('Player1Roles');
        var sel2 = document.getElementById('Player2Roles');
        var r1 = (sel1 && sel1.options[sel1.selectedIndex]) ? sel1.options[sel1.selectedIndex].text : "";
        var r2 = (sel2 && sel2.options[sel2.selectedIndex]) ? sel2.options[sel2.selectedIndex].text : "";
        var placeholder = "Выберите Роль...";
        if ((r1 && r1 !== placeholder) || (r2 && r2 !== placeholder)) {
            roundRoles.push({ player1Role: r1 || "", player2Role: r2 || "" });
        }
    }
    document.getElementById("current_round").textContent = "Раунд №" + current_round;
    duel_is_active = true;
    sessionPhase = "round";
    lastCompletedDuelIndex = null;
   lastShiftIsUsed =  false;
    var reopenBtn = document.getElementById("reopen_judges_form_btn");
    if (reopenBtn) reopenBtn.style.display = "none";
    if (typeof updateRandomSituationDiceButton === "function") updateRandomSituationDiceButton();
    saveProtocolStateToLocalStorage();
}

function stop_duel() {
    enable_disable_duel_options_conrols("hidden", false);
    stop_timer();
    // Сохраняем длительность последнего сегмента при завершении поединка
    var durationSec = roundStartRemaining[current_player - 1] - time[current_player - 1];
    if (durationSec > 0) roundDurations.push(durationSec);
    if (isClassicLikeType(duelType)) {
        var sel1 = document.getElementById('Player1Roles');
        var sel2 = document.getElementById('Player2Roles');
        var r1 = (sel1 && sel1.options[sel1.selectedIndex]) ? sel1.options[sel1.selectedIndex].text : "";
        var r2 = (sel2 && sel2.options[sel2.selectedIndex]) ? sel2.options[sel2.selectedIndex].text : "";
        if (r1 || r2) roundRoles.push({ player1Role: r1, player2Role: r2 });
    }
    document.getElementById("current_round").textContent = '\xa0';
    document.getElementById("start_stop_duel").textContent = "Начать поединок";
    document.getElementById("start_stop_duel").classList.remove("btn-danger");
    document.getElementById("start_stop_duel").classList.add("btn-primary");
    duel_is_active = false;
    sessionPhase = "judges";
    if (typeof updateRandomSituationDiceButton === "function") updateRandomSituationDiceButton();
    saveProtocolStateToLocalStorage();
    initTimers();
    if (duelType==="express" && duelsList && duelsList[currentDuel]) { 

          document.getElementById('Player1Roles').options[0].innerHTML = duelsList[currentDuel].SituationRoles[0].Role;
          document.getElementById('Player2Roles').options[0].innerHTML = duelsList[currentDuel].SituationRoles[1].Role;
          document.getElementById("Player1RoleGoal").innerHTML =duelsList[currentDuel].SituationRoles[0].Phrase;       
          document.getElementById("Player2RoleGoal").innerHTML ="";
    }
    // - форма оценок судей
    var q = normalizeRefereeQty(refereeQty || 9);
    if (duelsList && duelsList[currentDuel]) {
        q = normalizeRefereeQty(duelsList[currentDuel].RefereeQty != null ? duelsList[currentDuel].RefereeQty : q);
        duelsList[currentDuel].RefereeQty = q;
    }
    refereeQty = q;
    initRefereeStructure(refereeQty);
    var openJudgesFormBtn = document.getElementById("open_judges_form_btn");
    if (openJudgesFormBtn) openJudgesFormBtn.style.visibility = (isClassicLikeType(duelType) ? "visible" : "hidden");
    refereeTimer("start");
    var myModal = bootstrap.Modal.getOrCreateInstance(document.getElementById("finishDuelModal"));
    var reopenBtn = document.getElementById("reopen_judges_form_btn");
    if (reopenBtn) reopenBtn.style.display = "none";
    myModal.show();
}

function protest(regime)
{

    switch(regime) {
      case   "start" : 
              stop_timer();
              break;
      case   "stop" : 
              start_timer();
              break;     
     case   "start-stop" : 
             if (protest_is_active) 
               {
                 start_timer();   
                 document.getElementById("protest").innerText ="Протест (Секундант)";   
                 document.getElementById("protest").classList.add("btn-light");
                 document.getElementById("protest").classList.remove("btn-danger");     
               }
              else
               {
                stop_timer();
                pauseProtestEvents.push({ type: "protest", round: current_round, player: current_player, gameTimeLeft: time[current_player - 1] });
                 document.getElementById("protest").innerText ="Протест обработан";      
                 document.getElementById("protest").classList.add("btn-danger"); 
                 document.getElementById("protest").classList.remove("btn-light");     
                 document.getElementById("protest").disabled = false; 
                 document.getElementById("protest").classList.add("active");
                 document.getElementById("protest").classList.remove("disabled");     
               } 
               protest_is_active =!protest_is_active;
               document.getElementById("change_player").disabled = protest_is_active;
               document.getElementById("start_stop_timer").disabled = protest_is_active; 
               document.getElementById("pause").disabled = protest_is_active;
               document.getElementById("start_stop_duel").disabled = protest_is_active;
             break;     
                       
    }
}

function pause(regime)
{
    switch(regime) {
        case   "start" : 
                stop_timer();
                pauseProtestEvents.push({ type: "pause", round: current_round, player: current_player, gameTimeLeft: time[current_player - 1] });
                if (typeof applyPauseModalLabel === "function") applyPauseModalLabel(current_player);
                else document.getElementById("pauseModalLabel").textContent = "Секундант Игрока №" + current_player + " взял паузу";
                pauseTime=60; 
                pause_donut.setState({ value: pauseTime, color: secondaryTimerColor});
                document.getElementById("pause_timer").textContent = formatTime(pauseTime);                
                stopAudio(audioTicking);
                break;
        case   "start_timer" : 
                 pauseTimerID = setInterval(changePauseTime, 1000)
                 document.getElementById("pause_timer_start_button").classList.add("btn-secondary");
                 document.getElementById("pause_timer_start_button").classList.remove("btn-primary");
                 document.getElementById("pause_timer_start_button").style.visibility = "hidden";
                 document.getElementById("pause_timer_start_button").disabled = true;
                 document.getElementById("pause_continue_duel_button").classList.add("btn-primary");
                 document.getElementById("pause_continue_duel_button").classList.remove("btn-secondary");
                 break;              
        
        case   "stop" : 
                clearInterval(pauseTimerID);
                document.getElementById("pause_timer_start_button").disabled = false;
                document.getElementById("pause_timer_start_button").classList.remove("btn-secondary");
                document.getElementById("pause_timer_start_button").classList.add("btn-primary");
                document.getElementById("pause_timer_start_button").style.visibility = "visible";
                document.getElementById("pause_continue_duel_button").classList.remove("btn-primary");
                document.getElementById("pause_continue_duel_button").classList.add("btn-secondary");
                stopAudio(audioTicking);
                break;              
      }
}

function changePauseTime() {
    pauseTime--;
    pause_donut.setState({ value: pauseTime});
    document.getElementById("pause_timer").textContent = formatTime(pauseTime);
    if (pauseTime <= finishingTime) {
          pause_donut.setState({ color: finishingTimerColor }); 
          if (soundsEnabled) {audioTicking.play(); }          
        }
    if (pauseTime===0) {
        if (soundsEnabled) {audioGong.play();}
    }
}

/*---------------------часы---------------------------------*/

function formatTime(time_in_sec) {
    if (time_in_sec>=0)
          return String(Math.floor(time_in_sec / 60)).padStart(2, "0") + ":" + String(time_in_sec % 60).padStart(2, "0");
       else 
         return "-"+String(Math.floor(Math.abs(time_in_sec) / 60)).padStart(2, "0") + ":" + String(Math.abs(time_in_sec) % 60).padStart(2, "0");

}



function start_stop_timer() {
    if (clock_is_active) { stop_timer(); }
    else { start_timer(); };
}

function start_timer() {
    timerID = setInterval(changeTime, 1000)
    document.getElementById("start_stop_timer").innerText = "Остановить часы";
    clock_is_active = true;
    if (isClassicLikeType(duelType)){
        document.getElementById("pause").classList.add("active");
        document.getElementById("pause").classList.remove("disabled");
        document.getElementById("protest").classList.add("active");
        document.getElementById("protest").classList.remove("disabled");
        document.getElementById("start_stop_timer").disabled = false;
        if((!lastShiftIsUsed) ){ document.getElementById("change_player").disabled = false;} }
    else {
       document.getElementById("pause").classList.add("disabled");
      document.getElementById("pause").classList.remove("active");
      document.getElementById("protest").classList.add("disabled");
      document.getElementById("protest").classList.remove("active"); 
      document.getElementById("start_stop_timer").disabled = true;     
      document.getElementById("change_player").disabled = (current_player===2);
    }
}    

function stop_timer() {
    stopAudio(audioTicking);
    clearInterval(timerID);
    document.getElementById("start_stop_timer").innerText = "Запустить часы";
    clock_is_active = false;
    document.getElementById("pause").classList.add("disabled");
    document.getElementById("pause").classList.remove("active");
    document.getElementById("protest").classList.add("disabled");
    document.getElementById("protest").classList.remove("active");
    document.getElementById("start_stop_timer").disabled = false;
}



function timeTicker(donaty) {
    time[current_player - 1]--;
    document.getElementById("timer" + current_player).textContent = formatTime(time[current_player - 1]);
    donaty.setState({ value: time[current_player - 1] });
    if (time[current_player - 1] === 0) {
        stop_timer();
        if (time[current_player % 2] === 0) { 
           if (soundsEnabled) {audioGudok.play(); }
           stop_duel();
        } else {
            if (soundsEnabled) {audioGong.play(); }
            changePlayer();
        }
    }
    if (time[current_player - 1] <= emergingTime) { 
        donaty.setState({ color: emergingTimerColor }); 
        }
    if (time[current_player - 1] <= finishingTime) { 
        donaty.setState({ color: finishingTimerColor }); 
    //    if (soundsEnabled) {audioTicking.play(); }  
    }
    if (duel_is_active) saveProtocolStateToLocalStorage();
}


function changeTime() {
    if (current_player === 1) { timeTicker(donut1); } else { timeTicker(donut2); }
}
