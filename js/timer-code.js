const game_time = 300;
var time = [game_time, game_time];
var current_player = 1;
var duel_is_active = false;
var clock_is_active = false;
var emergingTime = 30
var finishingTime = 10
var timerID = 0;
var activeTimerColor = "MediumBlue";
var inactiveTimerColor = "DarkGrey";
var emergingTimerColor = "OrangeRed";
var finishingTimerColor = "FireBrick";
var activePlayerColor = "MediumBlue";
var inactivePlayerColor = "DarkGrey";
var current_round = 0;
var shiftIsUsed = false;
var duelsList;

var donut1 = new Donutty(document.getElementById("donut1"), { min: 0, max: game_time, value: game_time, round: false, color: inactiveTimerColor });
var donut2 = new Donutty(document.getElementById("donut2"), { min: 0, max: game_time, value: game_time, round: false, color: inactiveTimerColor });
initTimers()


/*--------------------------Переход хода----------------------------*/

function changePlayer() {
    stop_timer();
    var newPlayer = (current_player % 2) + 1;
    if (time[newPlayer - 1] === 0) // однократный возврат обратно себе 
    {
        // визуализировать мигание бубликов
    }
    else {
        setPlayer(newPlayer);
    }
    current_round++;
    document.getElementById("current_round").textContent = "Раунд №" + current_round;


}

function setPlayer(playerNum) {
    current_player = playerNum;
    if (playerNum === 1) {
        donut1.setState({ color: activeTimerColor });
        donut2.setState({ color: inactiveTimerColor });
        document.getElementById("Player1Label").style.backgroundColor = activePlayerColor;
        document.getElementById("Player2Label").style.backgroundColor = inactivePlayerColor;
    }
    else {
        donut1.setState({ color: inactiveTimerColor });
        donut2.setState({ color: activeTimerColor });
        document.getElementById("Player1Label").style.backgroundColor = inactivePlayerColor;
        document.getElementById("Player2Label").style.backgroundColor = activePlayerColor;

    }
}

/*--------------------------Поединок----------------------------*/
function start_stop_duel() {
    if (duel_is_active) { stop_duel(); }
    else { start_duel(); }
}

function enable_disable_duel_options_conrols(visibility, disabled) {
    document.getElementById("start_stop_timer").style.visibility =visibility;
    document.getElementById("change_player").style.visibility = visibility;
    document.getElementById("protest").style.visibility = visibility;
    document.getElementById("pause").style.visibility = visibility;
    document.getElementById("Player1Name").disabled = disabled;
    document.getElementById("Player2Name").disabled = disabled;
    document.getElementById("JSON_File").disabled = disabled;
    document.getElementById("duel_chooser").disabled = disabled;
    document.getElementById("duel_time_picker").disabled = disabled;    
    document.getElementById("5min").disabled = disabled;
    document.getElementById("4min").disabled = disabled;
    document.getElementById("1min").disabled = disabled;    
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
    document.getElementById("current_round").textContent = "Раунд №" + current_round;
    duel_is_active = true;
}

function stop_duel() {
    enable_disable_duel_options_conrols("hidden", false);
    stop_timer();
      document.getElementById("current_round").textContent = '\xa0';
    document.getElementById("start_stop_duel").textContent = "Начать поединок";
    document.getElementById("start_stop_duel").classList.remove("btn-danger");
    document.getElementById("start_stop_duel").classList.add("btn-primary");       
    duel_is_active = false;
    initTimers()

}

/*---------------------часы---------------------------------*/

function formatTime(time_in_sec) {
    return String(Math.floor(time_in_sec / 60)).padStart(2, "0") + ":" + String(time_in_sec % 60).padStart(2, "0");
}

function initTimers() {
    time[0] = game_time;
    time[1] = game_time;
    donut1.setState({ value: time[0], color: inactiveTimerColor });
    donut2.setState({ value: time[1], color: inactiveTimerColor });
    document.getElementById("Player1Label").style.backgroundColor = inactivePlayerColor;
    document.getElementById("Player2Label").style.backgroundColor = inactivePlayerColor;
    document.getElementById("timer1").textContent = formatTime(time[0]);
    document.getElementById("timer2").textContent = formatTime(time[1]);
}

function start_stop_timer() {
    if (clock_is_active) { stop_timer(); }
    else { start_timer(); };
}

function start_timer() {
    timerID = setInterval(changeTime, 1000)
    document.getElementById("start_stop_timer").innerText = "Остановить часы";
    clock_is_active = true;
    document.getElementById("pause").classList.add("active");
    document.getElementById("pause").classList.remove("disabled");
    document.getElementById("protest").classList.add("active");
    document.getElementById("protest").classList.remove("disabled");
}

function stop_timer() {
    timerID = clearInterval(timerID)
    document.getElementById("start_stop_timer").innerText = "Запустить часы";
    clock_is_active = false;
    document.getElementById("pause").classList.add("disabled");
    document.getElementById("pause").classList.remove("active");
    document.getElementById("protest").classList.add("disabled");
    document.getElementById("protest").classList.remove("active");

}



function timeTicker(donaty) {
    time[current_player - 1]--;
    document.getElementById("timer" + current_player).textContent = formatTime(time[current_player - 1]);
    donaty.setState({ value: time[current_player - 1] });
    if (time[current_player - 1] === 0) {
        stop_timer();
        if (time[current_player % 2] === 0) stop_duel();
        else changePlayer();
    }
    if (time[current_player - 1] <= emergingTime) { donaty.setState({ color: emergingTimerColor }); }
    if (time[current_player - 1] <= finishingTime) { donaty.setState({ color: finishingTimerColor }); }
}


function changeTime() {
    if (current_player === 1) { timeTicker(donut1) } else { timeTicker(donut2) }
}

/*---------------------Загрузка JSON  и работа со списком поединков ---------------------------------*/

function loadJSON() {
    var file = document.getElementById("JSON_File").files[0];
    if (file) {
        var reader = new FileReader();
        reader.readAsText(file, "UTF-8");
        reader.onload = function (evt) {
            duelsList = JSON.parse(evt.target.result);
            var select = document.getElementById('duel_chooser');
            clearSelectOptions('duel_chooser');
            document.getElementById("Player1Name").value= "" ;          
            document.getElementById("Player2Name").value= "" ;      
            document.getElementById("duel_chooser").value= "-1" ;      
            for (var i in duelsList) {
                var duel = duelsList[i];
                var opt = document.createElement('option');
                opt.value = i;
                opt.innerHTML = "Поединок " + duel.DuelNum + ". Ситуация №" + duel.SituationNum + " \"" + duel.SituationName + " \". " + duel.Player1 + " - " + duel.Player2;
                select.appendChild(opt);
            };
        }
        reader.onerror = function (evt) {
            console.error(evt);
        }
    }
}

function duelChoosed() {
    var indx = document.getElementById('duel_chooser').value;
    if (indx!="-1") {
    document.getElementById("Player1Name").value = duelsList[indx].Player1;
    document.getElementById("Player2Name").value = duelsList[indx].Player2;
    }  

}

function clearSelectOptions(selectName) {
    var selectElement = document.getElementById(selectName);
    
    for (var i = selectElement.options.length - 1; i > 0; i--) {
        if (selectElement.options[i].value !== '-1') {
            selectElement.remove(i);
        }
    }
}

/*---------------------Кнопка тулбара ---------------------------------*/

function setDuelTime(time) {
    game_time=time;
    initTimers();
}