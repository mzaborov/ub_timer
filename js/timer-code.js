// deploy-version: 17
const activeTimerColor = "blue";
const inactiveTimerColor = "DarkGray";
const emergingTimerColor = "OrangeRed";
const finishingTimerColor = "FireBrick";
const secondaryTimerColor = "red";
const activePlayerColor = "blue";
const inactivePlayerColor = "#f8f9fa";
const donuttyTrackColor = "rgba(70, 130, 180, 0.15)";  

game_time = 300;
var time = [game_time, game_time];
var current_player = 1;
var duel_is_active = false;
var clock_is_active = false;
var emergingTime = 30
var finishingTime = 10
var timerID = 0;
var current_round = 0;
var duelsList;
var currentDuel;
var lastShiftIsUsed =  false;
var duelType ="classic"; 

//  пауза и протест
var pauseTimerID = 0;
var pauseTime =60;
var protest_is_active=false;

//  для формы судей  
const PlayerVoteStyle= ["dark","primary","success"];
var refereeTimerID = 0;
var refereeTime =60;
var activeReferee =0; 
var refereeQty =9; 
var refereeList ;

// протокол онлайна: длительность раундов по игровому времени (бублики), без пауз
var scheduleFileName = "";
var roundStartRemaining = [0, 0]; // остаток времени игрока 1 и 2 на старте текущего сегмента
var roundDurations = [];
var roundRoles = []; // для классики: [{ player1Role, player2Role }, ...] по раундам
var pauseProtestEvents = []; // [{ type: 'pause'|'protest', round, player, gameTimeLeft }, ...]
var PROTOCOL_STORAGE_KEY = "ub-timer-online-state";
var sessionPhase = "idle"; // "idle" | "round" | "judges"
var isRestoringProtocol = false;
var lastCompletedDuelIndex = null; // индекс поединка, только что завершённого (для кнопки «Вернуть голосование» в idle)

// Участники и раскладка судей (план форма судей)
var people = {}; // id -> { id, fullName, isActive, experience, notes? }; experience: "novice" | "experienced" | "org" | "none"
var duelAssignments = []; // по duelIndex: { player1Id, player2Id, second1Id?, second2Id?, judges: [ { personId, category }, ... ] (max 9), confirmed: {} (slotKey -> true для зелёного) }
var peopleNextId = 1;


/*--------------------------инициализирующий код----------------------------*/
var donut1 = new Donutty(document.getElementById("donut1"), { min: 0, max: game_time, value: game_time, round: false, color: inactiveTimerColor, bg:donuttyTrackColor });
var donut2 = new Donutty(document.getElementById("donut2"), { min: 0, max: game_time, value: game_time, round: false, color: inactiveTimerColor, bg:donuttyTrackColor });
var pause_donut = new Donutty(document.getElementById("pause_donut"), { min: 0, max: 60, value: 60, round: false, color: secondaryTimerColor, bg:donuttyTrackColor });
var referee_donut = new Donutty(document.getElementById("referee_donut"), { min: 0, max: 60, value: 60, round: false, color: secondaryTimerColor, bg:donuttyTrackColor });
initTimers();

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
document.getElementById("plr1radiolabel").classList.add("btn-outline-"+PlayerVoteStyle[1]);
document.getElementById("plr2radiolabel").classList.add("btn-outline-"+PlayerVoteStyle[2]);
document.getElementById("Player1Score").classList.add("text-bg-"+PlayerVoteStyle[1]);
document.getElementById("Player2Score").classList.add("text-bg-"+PlayerVoteStyle[2]);

var soundsEnabled = true;
var audioGong = new Audio("assets\\Sound\\Gong.mp3");
var audioGudok= new Audio("assets\\Sound\\Gudok.mp3");
var audioTicking= new Audio("assets\\Sound\\clock_ticking.mp3");
var audioDrumRoll = new Audio("assets/Sound/Drum_roll.mp3");
var audioApplause = new Audio("assets/Sound/applause.mp3");

// Жребий с интро: список треков из встроенного в HTML script#intro-tracks-json (при деплое подставляется из list.json)
var introTracksList = [];
var selectedIntroTrack = "";
var introBlinkTimeoutId = null;
var introFinishTimeoutId = null;
var introCountdownIntervalId = null;
var introTimeupdateHandler = null;
var audioIntro = null;

(function() {
    var el = document.getElementById("intro-tracks-json");
    if (el && el.textContent) {
        try {
            var arr = JSON.parse(el.textContent.trim());
            if (Array.isArray(arr) && arr.length > 0) introTracksList = arr;
        } catch (e) {}
    }
    if (introTracksList.length === 0) {
        introTracksList = ["Bad_To_The_Bone.mp3","Baba_O_Riley.mp3","Cant_Stop.mp3","Deutschland.mp3","Eye_Of_The_Tiger.mp3","Jamming.mp3","Masha_i_medvedi.mp3","Misirlou.mp3","Peremen.mp3","Stop_the_Rock.mp3","Sweet_Home_Alabama.mp3","Tatarskaya_plyasovaya.mp3"];
    }
})();
var introTracksListFallback = introTracksList.slice();

/*--------------------------Оценки судей ----------------------------*/

function changeRefereeTime() {
    refereeTime--;
    referee_donut.setState({ value: refereeTime});
    document.getElementById("referee_timer").textContent = formatTime(refereeTime);
    if (refereeTime <= finishingTime) { 
        referee_donut.setState({ color: finishingTimerColor }); 
        document.getElementById("referee_donut_bg").style.visibility="visible";
        document.getElementById('referee_donut_bg').classList.add('pulsing');
        if (soundsEnabled) {audioTicking.play(); }
    }
}

function refereeTimer(regime)
{
    switch(regime) {
        case   "start" : 
                refereeTime=60; 
                referee_donut.setState({ value: refereeTime,  color: secondaryTimerColor});
                document.getElementById("referee_donut_bg").style.visibility="hidden";
                document.getElementById('referee_donut_bg').classList.remove('pulsing');
                document.getElementById("referee_timer").textContent = formatTime(refereeTime);
                stopAudio(audioTicking);            
                break;
        case   "start_timer" : 
                 refereeTimerID = setInterval(changeRefereeTime, 1000)
                 document.getElementById("finish_duel_timer_start_button").disabled = true;
                 break;              
        
        case   "stop_timer" : 
                clearInterval(refereeTimerID);
                document.getElementById("finish_duel_timer_start_button").disabled = false;
                refereeTime=60; 
                document.getElementById("referee_donut_bg").style.visibility="hidden";
                document.getElementById('referee_donut_bg').classList.remove('pulsing');
                referee_donut.setState({ value: refereeTime,  color: secondaryTimerColor});
                document.getElementById("referee_timer").textContent = formatTime(refereeTime);              
                stopAudio(audioTicking);
                break;                              
      }
}

function shortNameForPerson(fullName) {
    if (!fullName || typeof fullName !== "string") return "";
    var parts = fullName.trim().split(/\s+/);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0].length > 12 ? parts[0].slice(0, 10) + "…" : parts[0];
    var last = parts[parts.length - 1];
    var initials = parts.slice(0, -1).map(function (p) { return (p.charAt(0) || "").toUpperCase() + "."; }).join(" ");
    return (initials + " " + last).trim();
}

function applyJudgesNamesFromAssignments() {
    var cd = (currentDuel != null && currentDuel !== "-1") ? (typeof currentDuel === "string" ? parseInt(currentDuel, 10) : currentDuel) : 0;
    if (isNaN(cd) || cd < 0 || !duelAssignments[cd] || !duelAssignments[cd].judges) return;
    var judges = duelAssignments[cd].judges;
    var vis = [];
    for (var i = 0; i < 11; i++) if (refereeList[i].visible) vis.push(i);
    for (var k = 0; k < vis.length && k < judges.length; k++) {
        var pid = judges[k].personId;
        var full = pid && people[pid] ? people[pid].fullName : "";
        refereeList[vis[k]].Caption = full ? full.trim() : ("Судья " + (k + 1));
        refereeList[vis[k]]._fullName = full;
    }
}

function initRefereeStructure(refQty)
{
 if (duelType === 'express')
 {
    refereeQty=5;
    refereeList = [
        {"Сaption": ""           ,"college":"job" ,"vote":0, "visible":false },
        {"Сaption": ""           ,"college":"job" ,"vote":0, "visible":false },
        {"Сaption": ""           ,"college":"job" ,"vote":0, "visible":false },
        {"Сaption": "Судья&nbsp1","college":"deal","vote":0, "visible":true  },
        {"Сaption": "Судья&nbsp2","college":"deal" ,"vote":0,"visible":true  },
        {"Сaption": "Судья&nbsp3","college":"deal" ,"vote":0,"visible":true  },
        {"Сaption": "Судья&nbsp4","college":"deal" ,"vote":0,"visible":true  },
        {"Сaption": "Судья&nbsp5","college":"deal" ,"vote":0,"visible":true  },
        {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },
        {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },
        {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },];
    setReferee(3);
 }
 else {
    if (refQty!=-1) {refereeQty=refQty;};
    if (currentDuel != null && currentDuel !== undefined && duelsList && duelsList[currentDuel]) {
        duelsList[currentDuel].RefereeQty = refereeQty;
    }
    switch(refereeQty) {
        case   9 : 
                refereeList = [
                    {"Сaption": "Судья&nbsp1","college":"job" ,"vote":0, "visible":true },
                    {"Сaption": "Судья&nbsp2","college":"job" ,"vote":0, "visible":true },
                    {"Сaption": "Судья&nbsp3","college":"job" ,"vote":0, "visible":true },
                    {"Сaption": "           ","college":"deal","vote":0, "visible":false},
                    {"Сaption": "Судья&nbsp4","college":"deal" ,"vote":0,"visible":true },
                    {"Сaption": "Судья&nbsp5","college":"deal" ,"vote":0,"visible":true },
                    {"Сaption": "Судья&nbsp6","college":"deal" ,"vote":0,"visible":true },
                    {"Сaption": ""           ,"college":"deal" ,"vote":0,"visible":false},
                    {"Сaption": "Судья&nbsp7","college":"own"  ,"vote":0,"visible":true },
                    {"Сaption": "Судья&nbsp8","college":"own"  ,"vote":0,"visible":true },
                    {"Сaption": "Судья&nbsp9","college":"own"  ,"vote":0,"visible":true },]                    
                setReferee(0);
                break;
        case   7 : 
                refereeList = [
                    {"Сaption": ""           ,"college":"job" ,"vote":0, "visible":false },
                    {"Сaption": "Судья&nbsp1","college":"job" ,"vote":0, "visible":true  },
                    {"Сaption": "Судья&nbsp2","college":"job" ,"vote":0, "visible":true  },
                    {"Сaption": ""           ,"college":"deal","vote":0, "visible":false },
                    {"Сaption": "Судья&nbsp3","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": "Судья&nbsp4","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": "Судья&nbsp5","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": ""           ,"college":"deal" ,"vote":0,"visible":false },
                    {"Сaption": "Судья&nbsp6","college":"own"  ,"vote":0,"visible":true  },
                    {"Сaption": "Судья&nbsp7","college":"own"  ,"vote":0,"visible":true  },
                    {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },];
                setReferee(1);
                break; 
        case   5 : 
                refereeList = [
                    {"Сaption": ""           ,"college":"job"  ,"vote":0, "visible":false},
                    {"Сaption": ""           ,"college":"job"  ,"vote":0, "visible":false},
                    {"Сaption": "Судья&nbsp1","college":"job"  ,"vote":0, "visible":true },
                    {"Сaption": ""           ,"college":"deal" ,"vote":0, "visible":false},
                    {"Сaption": "Судья&nbsp2","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": "Судья&nbsp3","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": "Судья&nbsp4","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": ""           ,"college":"deal" ,"vote":0,"visible":false },
                    {"Сaption": "Судья&nbsp5","college":"own"  ,"vote":0,"visible":true  },
                    {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },
                    {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },];
                setReferee(2);
                break; 
    }          

 }
 applyJudgesNamesFromAssignments();
 highlightReferee ();
}

function setReferee(ref)
{
    activeReferee=ref;
    highlightReferee();
    if (activeReferee===-1)
    {
        document.getElementById("plr1radio").checked=false;
        document.getElementById("plr2radio").checked=false;
        document.getElementById("plr1radio").disabled=true;
        document.getElementById("plr2radio").disabled=true;
        document.getElementById("finish_duel_next_referee_button").disabled=true;        
    }
    else
    {
        switch (refereeList[activeReferee].vote) 
        {
        case  0:
                    document.getElementById("plr1radio").checked=false;
                    document.getElementById("plr2radio").checked=false;
                    break;
        case  1:
                    document.getElementById("plr1radio").checked=true;                
                    break;
        case  2: 
                    document.getElementById("plr2radio").checked=true;                
                    break;
        }
        document.getElementById("plr1radio").disabled=false;
        document.getElementById("plr2radio").disabled=false;    
        document.getElementById("finish_duel_next_referee_button").disabled=false;        
        
        switch (refereeList[activeReferee].college) 
        {
        case  "job":
                    document.getElementById("college_hint").textContent=  "я бы нанялся на работу к";
                    document.getElementById("plr1radiolabel").textContent= (document.getElementById("Player1Name").value.trim()) ? "Игроку №1 (" +document.getElementById("Player1Name").value+")" :"Игроку №1";
                    document.getElementById("plr2radiolabel").textContent= (document.getElementById("Player2Name").value.trim()) ? "Игроку №2 (" +document.getElementById("Player2Name").value+")" :"Игроку №2";
                    document.getElementById("referee_hint").innerHTML = " <p> Судьи <b>Нанимающиеся на работу</b> оценивают способность к установлению и поддержанию положительных человеческих контактов, когда на первый план                     выступает выполнение обещаний, уважение человеческого достоинства делового партнера или подчиненного и другие морально-этические соображения, а также способность руководителя обеспечить материальное и моральное благополучие своих подчиненных. Их не волнует, как понравится участник зрителям. Их волнует, у кого из них им будет лучше работать:<ul class=\"font-size-sm line-height-sm\"> <li>не обманет ли их руководитель, пообещав вначале золотые горы насколько комфортную атмосферу установит в коллективе, будет ли заботиться о них, о достойном заработке, об условиях труда, об их перспективе роста,позволит ли проявлять инициативу, не развалит ли фирму, лишив их тем самым заработка</li>  <li>не будет ли идти на поводу у своих подчиненных во вред процветанию фирмы и тем самым этих подчиненных</li> <li> не даст ли водить себя за нос нечестным людям</li>  <li> не будет ли вечно колебаться и мяться, тянуть с принятием неотложных решений </li> <li> даст ли повод им гордиться или стыдиться</li> <li> не будет ли пытаться их втянуть в аморальные поступки или образ жизни</li> <li> будет ли им защитой и опорой и т. д</li> </ul></p>"  
                    break;
        case  "deal":
                    document.getElementById("college_hint").textContent=  "я бы отправил вместо себя на переговоры";
                    document.getElementById("plr1radiolabel").textContent= (document.getElementById("Player1Name").value.trim()) ? "Игроку №1 (" +document.getElementById("Player1Name").value+")" :"Игрока №1";
                    document.getElementById("plr2radiolabel").textContent= (document.getElementById("Player2Name").value.trim()) ? "Игрока №2 (" +document.getElementById("Player2Name").value+")" :"Игрока №2";
                    document.getElementById("referee_hint").innerHTML = " <p>  Судьи <b>Отправляющие на переговоры </b> cмотрят на происходящее с точки зрения человека, которому необходимо доверить провести переговоры одному из коллег. Они оценивают способность к перехвату и удержанию управления, когда на первый план выступает умение продвинуть вперед защищаемые интересы, не вступив при этом в серьезный конфликт с другой стороной переговоров. Их волнует, насколько участники сильны как переговорщики, готовы ли они к ведению переговоров в жесткой и конфликтной ситуации:<ul class=\"font-size-sm line-height-sm\"> <li>умеет ли руководитель строить адекватную картину мира, эффективно воздействовать на картину мира партнера</li><li>достаточно ли этически совершенен</li><li>умеет ли вести позиционную борьбу и располагаться на выгодной местности </li><li>умеет ли различать пустое и твердое , находить уязвимые места в позиции другого</li><li>способен ли вести деловую борьбу «здесь и сейчас» с достаточной психологической силой, скоростью, точностью</li><li>способен ли обходить ловушки, не поддаваться страстям и разглядывать победу</li><li>можно ли ему доверить ведение переговоров в жестких условиях</li><li>умеет ли держать свою цель и т. д.</li></ul></p>"     
                    break;
        case  "own": 
                    document.getElementById("college_hint").textContent=  "я бы доверил свою собственность";
                    document.getElementById("plr1radiolabel").textContent= (document.getElementById("Player1Name").value.trim()) ? "Игроку №1 (" +document.getElementById("Player1Name").value+")" :"Игроку №1";
                    document.getElementById("plr2radiolabel").textContent= (document.getElementById("Player2Name").value.trim()) ? "Игроку №2 (" +document.getElementById("Player2Name").value+")" :"Игроку №2";
                    document.getElementById("referee_hint").innerHTML = " <p> Судьи <b>Доверяющие собственость</b> смотрят на происходящее с точки зрения человека, которому необходимо доверить свою собственность (денежные средства, др. ресурсы) одному из участников. Они оценивают способность к сохранению и приумножению капитала и иной собственности, когда на первый план выступает умение получить в итоге, «в сухом остатке», положительный для дела результат. Их волнует, что произойдет, если они инвестируют свои средства в подразделение этого руководителя или доверят управление своей собственностью именно ему:<ul class=\"font-size-sm line-height-sm\"><li>будет ли приумножаться собственность</li><li>будет ли она приумножаться энергично или фактически лишь на уровне инфляции</li><li>не даст ли ее растащить</li><li>не пустится ли в авантюры</li><li>не украдет ли сам</li><li>не уподобится ли «собаке на сене» или Плюшкину, отчего собственность придет в упадок</li><li>не восстановит ли против себя сотрудников, клиентов или общественность до такой степени, что собственность будет просто уничтожена</li><li>не войдет ли в конфликт с законом или государственными органами и т. д.</li></ul></p>"     
                    break;
        }
        
    }
    refereeTimer("stop_timer");
}



function nextReferee()
{
 var ar=-1;
 var i=activeReferee+1;
 while (ar===-1 && i<11)
 {
    if (refereeList[i].visible && refereeList[i].vote===0){ar=i};
    i++;
 }
 i=0;
 while (ar===-1 && i<activeReferee)
 {
    if (refereeList[i].visible && refereeList[i].vote===0)  {ar=i};
    i++;
 }
 setReferee(ar);
 highlightReferee();
 saveProtocolStateToLocalStorage();
}

function refereeVote(vt)
{
    if (refereeList[activeReferee].vote === vt) {
        refereeList[activeReferee].vote = 0;
    } else {
        refereeList[activeReferee].vote = vt;
    }
    highlightReferee();
    saveProtocolStateToLocalStorage();
}

function calcAndShowScore()
{
  var score = [0, 0, 0];
  var unvotedCount = 0;
    for (let i = 0; i < 11; i++) {
       if (refereeList[i].visible) {
           if (refereeList[i].vote === 1 || refereeList[i].vote === 2) score[refereeList[i].vote]++;
           else unvotedCount++;
        }
    }
    document.getElementById("Player1Score").innerHTML = "&nbsp"+score[1]+"&nbsp";
    document.getElementById("Player2Score").innerHTML = "&nbsp"+score[2]+"&nbsp";
    var drumBtn = document.getElementById("finish_duel_drum_btn");
    if (drumBtn) {
        var equalScore = (score[1] === score[2]);
        var waitingLastJudge = equalScore && (unvotedCount === 1);
        drumBtn.classList.remove("btn-outline-secondary", "btn-warning");
        drumBtn.classList.add(waitingLastJudge ? "btn-warning" : "btn-outline-secondary");
    }
}

function highlightReferee ()
{
    for (let i=0; i<11;i++)
    {
       if (refereeList[i].visible)
        {
         var but = document.getElementById("refBut"+i);
         but.style.visibility = "visible";
         but.innerHTML = refereeList[i].Caption || refereeList[i].Сaption || "";
         but.title = refereeList[i]._fullName || refereeList[i].Caption || refereeList[i].Сaption || "";
         but.style.fontSize = (refereeList[i]._fullName ? "0.85em" : "");
        }
      else
       {
        document.getElementById("refBut"+i).style.visibility = "hidden";        
       }  

       document.getElementById("refBut"+i).classList.remove("btn-dark", 
                                                            "btn-"+PlayerVoteStyle[0], "btn-"+PlayerVoteStyle[1], "btn-"+PlayerVoteStyle[2],
                                                            "btn-outline-"+PlayerVoteStyle[0], "btn-outline-"+PlayerVoteStyle[1], "btn-outline-"+PlayerVoteStyle[2]);
       var bstyle;                                                     
       if(activeReferee===i){
        bstyle= "btn-outline-"+ PlayerVoteStyle[refereeList[i].vote]} 
        else {
            bstyle= "btn-"+ PlayerVoteStyle[refereeList[i].vote]
        } ;                                                   
       document.getElementById("refBut"+i).classList.add(bstyle);
    }
    calcAndShowScore();
}

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
    var a = document.getElementById("Player1Name").value;
    var b = document.getElementById("Player2Name").value;
    document.getElementById("Player1Name").value = b;
    document.getElementById("Player2Name").value = a;
    if (duelsList && duelsList[currentDuel]) {
        duelsList[currentDuel].Player1 = b;
        duelsList[currentDuel].Player2 = a;
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
    if (duelType==="classic")
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
    if (duelType === "classic") {
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
    saveProtocolStateToLocalStorage();
}

function stop_duel() {
    enable_disable_duel_options_conrols("hidden", false);
    stop_timer();
    // Сохраняем длительность последнего сегмента при завершении поединка
    var durationSec = roundStartRemaining[current_player - 1] - time[current_player - 1];
    if (durationSec > 0) roundDurations.push(durationSec);
    if (duelType === "classic") {
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
    saveProtocolStateToLocalStorage();
    initTimers();
    if (duelType==="express" && duelsList && duelsList[currentDuel]) { 

          document.getElementById('Player1Roles').options[0].innerHTML = duelsList[currentDuel].SituationRoles[0].Role;
          document.getElementById('Player2Roles').options[0].innerHTML = duelsList[currentDuel].SituationRoles[1].Role;
          document.getElementById("Player1RoleGoal").innerHTML =duelsList[currentDuel].SituationRoles[0].Phrase;       
          document.getElementById("Player2RoleGoal").innerHTML ="";
    }
    // - форма оценок судей 
    initRefereeStructure(-1);
    if (duelsList && duelsList[currentDuel]) {
        var q = duelsList[currentDuel].RefereeQty || refereeQty || 9;
        refereeQty = (q === 9 || q === 7 || q === 5) ? q : 9;
    }
    var openJudgesFormBtn = document.getElementById("open_judges_form_btn");
    if (openJudgesFormBtn) openJudgesFormBtn.style.visibility = (duelType === "classic" ? "visible" : "hidden");
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
                document.getElementById("pauseModalLabel").textContent = "Секундант Игрока №"+current_player+" взял паузу";
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
    if (duelType==="classic"){
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
    if (current_player === 1) { timeTicker(donut1) } else { timeTicker(donut2) }
}


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
    if (duelType === "classic") {
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
        var duelChooser = document.getElementById("duel-chooser");
        if (duelChooser) {
            duelChooser.innerHTML = "";
            duelsList.forEach(function (duel, index) {
                var figure = document.createElement("figure");
                figure.innerHTML = "<a class=\"icon-link\" href=\"#\" onclick='duelChoosed(\"" + index + "\")'>" +
                    "<blockquote class=\"blockquote\"><p>№" + (duel.DuelNum || (index + 1)) + " :: " + (duel.SituationName || "") + "</p></blockquote></a>" +
                    "<figcaption class=\"blockquote-footer\">" + (duel.Player1 || "") + " VS " + (duel.Player2 || "") + "</figcaption>";
                duelChooser.appendChild(figure);
            });
        }
        switchToFileDropdown();
        hideRestoreProtocolBanner();
        var currentDuelNum = data.currentDuel;
        if (currentDuelNum !== undefined && currentDuelNum !== null && !isNaN(currentDuelNum) && currentDuelNum >= 0 && currentDuelNum < duelsList.length) {
            duelChoosed(String(currentDuelNum));
        }
        if (data.phase === "idle" && (data.currentRoundRole1 || data.currentRoundRole2) && duelType === "classic") {
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
    var express = (duel.Type || "").toString().toLowerCase().indexOf("экспресс") !== -1;
    var q = duel.RefereeQty;
    if (q !== 9 && q !== 7 && q !== 5) q = 9;
    if (express) return ["j3", "j4", "j5", "j6", "j7"];
    if (q === 9) return ["j0", "j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8"];
    if (q === 7) return ["j0", "j1", "j2", "j3", "j4", "j5", "j6"];
    return ["j0", "j1", "j2", "j3", "j4"];
}

function getJudgesLayoutRows() {
    var base = JUDGES_LAYOUT_BASE_ROWS.slice();
    if (!duelsList || !duelsList.length) return base;
    var allExpress = true, allClassic = true;
    var maxQty = 0;
    for (var i = 0; i < duelsList.length; i++) {
        var t = (duelsList[i].Type || "").toString().toLowerCase();
        if (t.indexOf("экспресс") !== -1) allClassic = false; else allExpress = false;
        var q = duelsList[i].RefereeQty;
        if (q === 9 || q === 7 || q === 5) maxQty = Math.max(maxQty, q); else maxQty = Math.max(maxQty, 9);
    }
    if (maxQty === 0) maxQty = 9;
    if (allExpress) {
        for (var k = 1; k <= 5; k++) base.push({ key: "j" + (2 + k), label: "Отправляющие " + k });
        return base;
    }
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
    return (duelsList[duelIdx].Type || "").toString().toLowerCase().indexOf("экспресс") !== -1;
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
        var situationName = (duel && duel.SituationName && String(duel.SituationName).trim()) ? String(duel.SituationName).trim() : "";
        var title = "Поединок " + (c + 1) + (situationName ? "<br>" + situationName : "");
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
    if (layoutRows.some(function (r) { return r.key === "j8"; })) { thickBottomKeys.j2 = true; thickBottomKeys.j5 = true; thickBottomKeys.j8 = true; }
    else if (layoutRows.some(function (r) { return r.key === "j6"; })) { thickBottomKeys.j1 = true; thickBottomKeys.j4 = true; thickBottomKeys.j6 = true; }
    else if (layoutRows.some(function (r) { return r.key === "j4"; })) { thickBottomKeys.j0 = true; thickBottomKeys.j3 = true; thickBottomKeys.j4 = true; }
    else if (layoutRows.some(function (r) { return r.key === "j7"; })) { thickBottomKeys.j7 = true; }
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
        if (thickBottomKeys[row.key]) tr.style.borderBottom = "3px solid #000";
        tr.innerHTML = "<td class=\"text-nowrap\"" + cellTitle + ">" + row.label + "</td>";
        for (var col = 0; col < duels.length; col++) {
            var isPast = isDuelPast(col);
            var isCur = (col === cd);
            var isExpressCol = isDuelExpress(col);
            var judgeRow = row.key.indexOf("j") === 0;
            var judgeNum = judgeRow ? parseInt(row.key.slice(1), 10) : -1;
            var hideInExpress = isExpressCol && judgeRow && (row.label.indexOf("Нанимающиеся") === 0 || row.label.indexOf("Доверяющие") === 0);
            var personId = getAssignmentSlot(col, row.key);
            var name = getPersonName(personId);
            var confirmed = getConfirmedSlot(col, row.key);
            var td = document.createElement("td");
            td.setAttribute("data-duel-idx", col);
            td.setAttribute("data-slot-key", row.key);
            if (isPast) td.classList.add("table-secondary");
            else if (isCur && judgeRow) td.classList.add("table-primary");
            if (hideInExpress) td.classList.add("table-secondary");
            if (confirmed) td.style.backgroundColor = "rgba(200,255,200,0.5)";
            else if (isPlayerOnly(row.key)) td.style.backgroundColor = "rgba(173, 216, 230, 0.5)";
            if (swapMode && judgeRow && !hideInExpress) {
                var swapState = isSwapAvailable(col, row.key);
                if (swapState === "source") td.classList.add("judges-swap-source");
                else if (swapState === "available") td.classList.add("judges-swap-available");
                else if (swapState === "unavailable" && !isPast) td.classList.add("judges-swap-unavailable");
            }
            td.textContent = name || "—";
            td.style.minWidth = "100px";
            td.style.cursor = isPast ? "default" : "pointer";
            if (!isPast && !hideInExpress) {
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
                    if (isDuelPast(d) || hideInExpress) return;
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
    const duelChooser = document.getElementById('duel-chooser');

    fileName.innerHTML = file.name.split('.').slice(0, -1).join('');
    scheduleFileName = (file && file.name) ? file.name.replace(/\.(xlsx|json)$/i, '') : '';

    ensurePeopleFromSchedule();
    initDuelAssignmentsFromDuels();

    duelChooser.innerHTML = ''
    duelsList.forEach((duel, index) => {
        var figure = document.createElement('figure');
        figure.innerHTML = `
            <a class="icon-link" href="#" onclick='duelChoosed("${index}")'>
                <blockquote class="blockquote">
                    <p>№${duel.DuelNum} :: ${duel.SituationName}</p>
                </blockquote>
            </a>

            <figcaption class="blockquote-footer">
                ${duel.Player1} VS ${duel.Player2}
            </figcaption>
        `
        duelChooser.appendChild(figure);
    });
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

function duelChoosed(currentDuelRef) {
    currentDuel = currentDuelRef;
    if (currentDuel != "-1") {
        const duel = duelsList[currentDuel]
        document.getElementById("players-name").innerHTML = `Ситуация №${duel.SituationNum} ${duel.SituationName}`;
        document.getElementById("Player1Name").value = duel.Player1;
        document.getElementById("Player2Name").value = duel.Player2;
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
        if (duel.Type=== "Классика") { 
            duelType="classic"; 
            var RolesText = "<b>Роли и интересы:</b>";
            select1.appendChild(createOption("-1", "Выберите Роль...",true));
            select2.appendChild(createOption("-1", "Выберите Роль...",true));
            for (var i in duel.SituationRoles) {
                select1.appendChild(createOption(i, duel.SituationRoles[i].Role, false));
                select2.appendChild(createOption(i, duel.SituationRoles[i].Role, false));
                RolesText += "<br><b>" + duel.SituationRoles[i].Role + "</b> - " + duel.SituationRoles[i].Goals;
                select1.disabled=false;
                select2.disabled=false;
            };
            document.getElementById("Duel_Roles").innerHTML = RolesText;            
            document.getElementById("Player1RoleGoallabel").innerHTML="Интересы:";
            document.getElementById("Player2RoleGoallabel").innerHTML="Интересы:";
            document.getElementById("Player1RoleGoal").innerHTML ="";
            document.getElementById("Player2RoleGoal").innerHTML ="";
         }  else  { 
            select1.appendChild(createOption(0, duel.SituationRoles[0].Role,true));
            select2.appendChild(createOption(0, duel.SituationRoles[1].Role,true));
            select1.disabled=true;
            select2.disabled=true;
            document.getElementById("Player1RoleGoallabel").innerHTML="Агрессивная фраза:";
            document.getElementById("Player2RoleGoallabel").innerHTML="Агрессивная фраза:";
            document.getElementById("Player1RoleGoal").innerHTML =duel.SituationRoles[0].Phrase;
            document.getElementById("Player2RoleGoal").innerHTML ="";
            document.getElementById("Duel_Roles").innerHTML = "";            
            duelType="express";
        };        
        document.getElementById("classic").disabled = true;
        document.getElementById("express").disabled = true;
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
    if (duelType === "classic" && sessionPhase === "round" && current_round >= 1) {
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
    }
    var reopenBtn = document.getElementById("reopen_judges_form_btn");
    if (reopenBtn) reopenBtn.style.display = "block";
}

function reopenJudgesForm() {
    if (sessionPhase === "idle" && lastCompletedDuelIndex != null && duelsList && duelsList[lastCompletedDuelIndex]) {
        var prevDuel = duelsList[lastCompletedDuelIndex];
        currentDuel = lastCompletedDuelIndex;
        duelChoosed(String(lastCompletedDuelIndex));
        var q = prevDuel.RefereeQty;
        if (q !== 9 && q !== 7 && q !== 5) q = 9;
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
        maxRef = Math.max(maxRef, q === 9 || q === 7 || q === 5 ? q : 9);
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
        maxRef = Math.max(maxRef, q === 9 || q === 7 || q === 5 ? q : 9);
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
    var keys = ["scheduleFileName", "phase", "currentDuel", "time0", "time1", "roundStartRemaining0", "roundStartRemaining1", "roundDurations", "current_round", "current_player", "game_time", "duelType", "refereeQty", "player1Name", "player2Name", "roundRoles", "pauseProtestEvents", "refereeVotes", "activeReferee", "currentRoundRole1", "currentRoundRole2", "lastCompletedDuelIndex", "people", "duelAssignments", "peopleNextId"];
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
                duel.RefereeQty = duel.JudgeVotes ? duel.JudgeVotes.length : 9;
                if (duel.RefereeQty !== 9 && duel.RefereeQty !== 7 && duel.RefereeQty !== 5) duel.RefereeQty = 9;
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
                    else if (key === "refereeQty") data.refereeQty = typeof val === "number" ? val : parseInt(val, 10);
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
                }
                if (data.people && typeof data.people === "object") { people = data.people; peopleNextId = (data.peopleNextId != null && !isNaN(data.peopleNextId)) ? data.peopleNextId : (function () { var max = 0; for (var k in people) { var n = parseInt(String(k).replace(/^p_/, ""), 10); if (!isNaN(n) && n > max) max = n; } return max + 1; })(); }
                if (data.duelAssignments && Array.isArray(data.duelAssignments)) {
                    duelAssignments = data.duelAssignments;
                    for (var ii = 0; ii < duelAssignments.length; ii++) if (duelAssignments[ii] && duelAssignments[ii].excludedPersonIds) delete duelAssignments[ii].excludedPersonIds;
                }
                if (data.scheduleFileName != null && data.scheduleFileName !== "") scheduleFileName = data.scheduleFileName;
            }
            var fileNameEl = document.getElementById("file-name");
            if (fileNameEl) fileNameEl.innerHTML = scheduleFileName;
            var duelChooser = document.getElementById("duel-chooser");
            if (duelChooser) {
                duelChooser.innerHTML = "";
                duelsList.forEach(function (duel, index) {
                    var figure = document.createElement("figure");
                    figure.innerHTML = "<a class=\"icon-link\" href=\"#\" onclick='duelChoosed(\"" + index + "\")'>" +
                        "<blockquote class=\"blockquote\"><p>№" + (duel.DuelNum || (index + 1)) + " :: " + (duel.SituationName || "") + "</p></blockquote></a>" +
                        "<figcaption class=\"blockquote-footer\">" + (duel.Player1 || "") + " VS " + (duel.Player2 || "") + "</figcaption>";
                    duelChooser.appendChild(figure);
                });
            }
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