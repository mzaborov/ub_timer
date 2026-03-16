// deploy-version: 16
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
    refereeList[activeReferee].vote= vt;
    highlightReferee();
    saveProtocolStateToLocalStorage();
}

function calcAndShowScore()
{
  var score=[0,0,0];
  var unvotedCount = 0;
    for (let i=0; i<11;i++)
    {
       if (refereeList[i].visible)
        {
           score[refereeList[i].vote]++;
           if (refereeList[i].vote === 0) unvotedCount++;
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
         document.getElementById("refBut"+i).style.visibility = "visible";
         document.getElementById("refBut"+i).innerHTML  = refereeList[i].Сaption;        
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
        q = (q === 9 || q === 7 || q === 5) ? q : 9;
        document.getElementById(q + "ref").checked = true;
    }
    document.getElementById("ref_qty_picker").style.visibility = (duelType === "classic" ? "visible" : "hidden");
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
        var refQtyEl = document.getElementById(refereeQty + "ref");
        if (refQtyEl) refQtyEl.checked = true;
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

function processDuelsJson(file) {
    const fileName = document.getElementById('file-name');
    const duelChooser = document.getElementById('duel-chooser');

    fileName.innerHTML = file.name.split('.').slice(0, -1).join('');
    scheduleFileName = (file && file.name) ? file.name.replace(/\.(xlsx|json)$/i, '') : '';

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
        var refQtyEl = document.getElementById(refereeQty + "ref");
        if (refQtyEl) refQtyEl.checked = true;
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
    var rowLabels = ["Игрок 1", "Игрок 2", "Победитель"];
    for (var j = 1; j <= maxRef; j++) rowLabels.push("Судья " + j);
    for (var r = 0; r < rowLabels.length; r++) {
        var label = rowLabels[r];
        var arr = [label];
        for (var col = 0; col < duelsList.length; col++) {
            var duel = duelsList[col];
            var val = "";
            if (r === 0) val = duel.Player1 != null ? String(duel.Player1) : "";
            else if (r === 1) val = duel.Player2 != null ? String(duel.Player2) : "";
            else if (r === 2) val = duel.Winner != null ? String(duel.Winner) : "";
            else if (r >= 3 && r < 3 + maxRef) {
                var voteIdx = r - 3;
                var votes = duel.JudgeVotes;
                if (votes && voteIdx < (duel.RefereeQty || 9)) {
                    var v = votes[voteIdx];
                    if (v === 1 || v === 2) val = v;
                }
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
    var rowLabels = ["Игрок 1", "Игрок 2", "Победитель"];
    for (var j = 1; j <= maxRef; j++) rowLabels.push("Судья " + j);
    for (var r = 0; r < rowLabels.length; r++) {
        var label = rowLabels[r];
        var arr = [label];
        for (var col = 0; col < listToExport.length; col++) {
            var duel = listToExport[col];
            var val = "";
            if (r === 0) val = duel.Player1 != null ? String(duel.Player1) : "";
            else if (r === 1) val = duel.Player2 != null ? String(duel.Player2) : "";
            else if (r === 2) val = duel.Winner != null ? String(duel.Winner) : "";
            else if (r >= 3 && r < 3 + maxRef) {
                var voteIdx = r - 3;
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
    var keys = ["scheduleFileName", "phase", "currentDuel", "time0", "time1", "roundStartRemaining0", "roundStartRemaining1", "roundDurations", "current_round", "current_player", "game_time", "duelType", "refereeQty", "player1Name", "player2Name", "roundRoles", "pauseProtestEvents", "refereeVotes", "activeReferee", "currentRoundRole1", "currentRoundRole2", "lastCompletedDuelIndex"];
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
    var el = document.getElementById("import-status-menu-item");
    if (!el) return;
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
            for (var c = 1; c <= numDuels && (c - 1) < duelsList.length; c++) {
                var duel = duelsList[c - 1];
                if (!duel) continue;
                for (var r = 1; r < aoa.length; r++) {
                    var row = aoa[r];
                    if (!row) continue;
                    var label = row[0] != null ? String(row[0]).trim() : "";
                    var val = row[c];
                    if (label === "Игрок 1") duel.Player1 = val != null ? String(val) : "";
                    else if (label === "Игрок 2") duel.Player2 = val != null ? String(val) : "";
                    else if (label === "Победитель") duel.Winner = val != null ? String(val) : "";
                    else if (label.indexOf("Судья") === 0) {
                        if (!duel.JudgeVotes) duel.JudgeVotes = [];
                        duel.JudgeVotes.push((val === 1 || val === 2) ? val : 0);
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
        if (!hasRealData && !hasActiveSession) return;
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