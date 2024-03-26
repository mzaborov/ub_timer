game_time = 300;
var time = [game_time, game_time];
var current_player = 1;
var duel_is_active = false;
var clock_is_active = false;
var emergingTime = 30
var finishingTime = 10
var timerID = 0;
var pauseTimerID = 0;
var pauseTime =60;
var refereeTimerID = 0;
var refereeTime =60;

const activeTimerColor = "blue";
const inactiveTimerColor = "DarkGray";
const emergingTimerColor = "OrangeRed";
const finishingTimerColor = "FireBrick";
const activePlayerColor = "blue";
const inactivePlayerColor = "#f8f9fa";
const donuttyTrackColor = "rgba(70, 130, 180, 0.15)";
var current_round = 0;
var duelsList;
var currentDuel;
var lastShiftIsUsed =  false;

var donut1 = new Donutty(document.getElementById("donut1"), { min: 0, max: game_time, value: game_time, round: false, color: inactiveTimerColor, bg:donuttyTrackColor });
var donut2 = new Donutty(document.getElementById("donut2"), { min: 0, max: game_time, value: game_time, round: false, color: inactiveTimerColor, bg:donuttyTrackColor });
var pause_donut = new Donutty(document.getElementById("pause_donut"), { min: 0, max: 60, value: 60, round: false, color: "red", bg:donuttyTrackColor });
var referee_donut = new Donutty(document.getElementById("referee_donut"), { min: 0, max: 60, value: 60, round: false, color: "red", bg:donuttyTrackColor });
initTimers();

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

function dice() {
    var qty=1;
    blinking(1600 + Math.ceil(Math.random() * 1000), 200,qty)
}

function blinking(count, step,qty) {
    const a = document.getElementById("Player1Name").value;
    const b = document.getElementById("Player2Name").value;

    document.getElementById("Player1Name").value = b;
    document.getElementById("Player2Name").value = a ;
    if (duelsList)
     {
      duelsList[currentDuel].Player1 = b;
      duelsList[currentDuel].Player2 = a;
     } 
    var newPlayer= qty % 2 +1;
    setPlayer (newPlayer);
    highlightPlayer();
    count = count - step; 
        qty++;
        if (count > 0) {
        setTimeout(() => {blinking(count, step,qty)}, step);
        }
        else { initTimers();  }
}



/*--------------------------Переход хода----------------------------*/


function changePlayer() {
    stop_timer();
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
    current_round++;
    document.getElementById("current_round").textContent = "Раунд №" + current_round;
    document.getElementById("change_player").disabled = true;
    document.getElementById('Player1Roles').value=-1;
    document.getElementById('Player2Roles').value=-1;


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
    document.getElementById("Player1Name").disabled = disabled;
    document.getElementById("Player2Name").disabled = disabled;
    document.getElementById("Choose_File_Button").disabled = disabled;
    document.getElementById("Choose_Duel_Button").disabled = disabled;
    document.getElementById("duel_time_picker").disabled = disabled;
    document.getElementById("5min").disabled = disabled;
    document.getElementById("4min").disabled = disabled;
    document.getElementById("1min").disabled = disabled;
    document.getElementById("dice_button").disabled = disabled;


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
   lastShiftIsUsed =  false;
}

function stop_duel() {
    enable_disable_duel_options_conrols("hidden", false);
    stop_timer();
    document.getElementById("current_round").textContent = '\xa0';
    document.getElementById("start_stop_duel").textContent = "Начать поединок";
    document.getElementById("start_stop_duel").classList.remove("btn-danger");
    document.getElementById("start_stop_duel").classList.add("btn-primary");
    duel_is_active = false;
    initTimers();
    refereeTime=60; 
    referee_donut.setState({ value: refereeTime});
    document.getElementById("referee_timer").textContent = formatTime(refereeTime);
    const myModal = new bootstrap.Modal(document.getElementById('finishDuelModal'), {});                
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
    }
}
function pause(regime)
{
    switch(regime) {
        case   "start" : 
                stop_timer();
                document.getElementById("pauseModalLabel").textContent = "Секундант Игрока №"+current_player+" взял паузу";
                pauseTime=60; 
                pause_donut.setState({ value: pauseTime});
                document.getElementById("pause_timer").textContent = formatTime(pauseTime);                
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
                start_timer();
                document.getElementById("pause_timer_start_button").disabled = false;
                document.getElementById("pause_timer_start_button").classList.remove("btn-secondary");
                document.getElementById("pause_timer_start_button").classList.add("btn-primary");
                document.getElementById("pause_timer_start_button").style.visibility = "visible";
                document.getElementById("pause_continue_duel_button").classList.remove("btn-primary");
                document.getElementById("pause_continue_duel_button").classList.add("btn-secondary");

                 break;              
      }
}

function changePauseTime() {
    pauseTime--;
    pause_donut.setState({ value: pauseTime});
    document.getElementById("pause_timer").textContent = formatTime(pauseTime);
}

/*---------------------часы---------------------------------*/

function formatTime(time_in_sec) {
    return String(Math.floor(time_in_sec / 60)).padStart(2, "0") + ":" + String(time_in_sec % 60).padStart(2, "0");
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
    if(!lastShiftIsUsed){ document.getElementById("change_player").disabled = false;}
}

function stop_timer() {
    clearInterval(timerID);
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
function triggerClick() {
    const JSON_File = document.getElementById("File_Loader")
    JSON_File.click()
}

function processDuelsJson(file) {
    const fileName = document.getElementById('file-name');
    const duelChooser = document.getElementById('duel-chooser');

    fileName.innerHTML = file.name.split('.').slice(0, -1).join('')

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
    })
}

function loadFile(event) {
    var file = document.getElementById("File_Loader").files[0];
    //var file = event.target.files[0];
    if (file) {
        var reader = new FileReader();
        duelsList = {};
        var fileExtension = file.name.split('.').pop();
        if (fileExtension === 'xlsx') {
            reader.onload = function handleFileLoad() {
                var arrayBuffer = this.result,
                    array = new Uint8Array(arrayBuffer),
                    binaryString = String.fromCharCode.apply(null, array);
                /* Call XLSX */
                var workbook = XLSX.read(binaryString, { type: "binary" });
                /* DO SOMETHING WITH workbook HERE */
                var first_sheet_name = workbook.SheetNames[0];
                /* Get worksheet */
                var worksheet = workbook.Sheets[first_sheet_name];
                duelsList = XLSX.utils.sheet_to_json(worksheet, { raw: true });
                for (var i in duelsList) {
                    var duel = duelsList[i];
                    duel.SituationRoles = JSON.parse(duel.SituationRoles.trim().replace(/^"(.*)"$/, '$1'));
                };
                processDuelsJson(file);
            };
            reader.readAsArrayBuffer(file);
        }
        else if (fileExtension === 'json') {
            reader.onload = function handleFileLoad(evt) {
                duelsList = JSON.parse(evt.target.result);
                processDuelsJson(file);
            }
            reader.readAsText(file, "UTF-8");
        }
        else {
            alert('Unsupported file format. Please select a .xlsx or .json file.');
        }

        reader.onerror = function (evt) { console.error(evt); }
    }
}

function duelChoosed(currentDuelRef) {
    currentDuel = currentDuelRef;
    if (currentDuel != "-1") {
        const duel = duelsList[currentDuel]
        document.getElementById("players-name").innerHTML = `Ситуация №${duel.SituationNum} ${duel.SituationName}`;
        document.getElementById("Player1Name").value = duel.Player1;
        document.getElementById("Player2Name").value = duel.Player2;
        document.getElementById("Duel_Num").textContent = "Ситуация №" + duel.SituationNum +" (" +duel.Type +"). \"" + duel.SituationName + "\"";
        document.getElementById("Duel_Text").innerHTML = duel.SituationDescription;
        var select1 = document.getElementById('Player1Roles');
        var select2 = document.getElementById('Player2Roles');
        clearSelectOptions('Player1Roles');
        clearSelectOptions('Player2Roles');
        setDuelTime(duel.DuelMinutesLength*60);
        document.getElementById(duel.DuelMinutesLength+"min").checked = true;
        var RolesText = "<b>Роли и интересы:</b>";
        for (var i in duel.SituationRoles) {
            var sitRoles = duel.SituationRoles[i];
            var opt1 = document.createElement('option');
            var opt2 = document.createElement('option');
            opt1.value = i;
            opt2.value = i;
            opt1.innerHTML = sitRoles.Role;
            opt2.innerHTML = sitRoles.Role;
            select1.appendChild(opt1);
            select2.appendChild(opt2);
            RolesText += "<br><b>" + duel.SituationRoles[i].Role + "</b> - " + duel.SituationRoles[i].Goals;
        };
        document.getElementById("Duel_Roles").innerHTML = RolesText;

    }

}
function roleChoosed(player) {
    var role = document.getElementById("Player" + player + "Roles").value;
    document.getElementById("Player" + player + "RoleGoal").innerHTML = duelsList[currentDuel].SituationRoles[role].Goals;
}


function clearSelectOptions(selectName) {
    var selectElement = document.getElementById(selectName);

    for (var i = selectElement.options.length - 1; i > 0; i--) {
        if (selectElement.options[i].value !== '-1') {
            selectElement.remove(i);
        }
    }
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

}

function toggeSound()
{
    if (document.getElementById("sound").checked) {
        document.getElementById("sound_icon").classList.add("fa-volume-high");
        document.getElementById("sound_icon").classList.remove("fa-volume-xmark");
    }
    else
    {
        document.getElementById("sound_icon").classList.add("fa-volume-xmark");
        document.getElementById("sound_icon").classList.remove("fa-volume-high");
        
    }
}