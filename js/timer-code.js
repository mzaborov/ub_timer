game_time = 300;
var time = [game_time, game_time];
var current_player = 1;
var duel_is_active = false;
var clock_is_active = false;
var emergingTime = 30
var finishingTime = 10
var timerID = 0;
var activeTimerColor = "blue";
var inactiveTimerColor = "DarkGray";
var emergingTimerColor = "OrangeRed";
var finishingTimerColor = "FireBrick";
var activePlayerColor = "#f8f9fa";
var inactivePlayerColor = "#f8f9fa";
var current_round = 0;
var duelsList;
var currentDuel;

var donut1 = new Donutty(document.getElementById("donut1"), { min: 0, max: game_time, value: game_time, round: false, color: inactiveTimerColor });
var donut2 = new Donutty(document.getElementById("donut2"), { min: 0, max: game_time, value: game_time, round: false, color: inactiveTimerColor });
initTimers()


/*--------------------------Переход хода----------------------------*/

function changePlayer() {
    console.log('asd');
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
    setPlayer(current_player);
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
    donut1.setState({ max: game_time, value: time[0], color: inactiveTimerColor });
    donut2.setState({ max: game_time, value: time[1], color: inactiveTimerColor });
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
function triggerClick() {
    const JSON_File = document.getElementById("File_Loader")
    JSON_File.click()
}

function processDuelsJson(file)
{
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
        duelsList={};
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
    currentDuel = currentDuelRef
    if (currentDuel != "-1") {
        const duel = duelsList[currentDuel]
        document.getElementById("players-name").innerHTML = `Ситуация №${duel.SituationNum} ${duel.SituationName}`;
        document.getElementById("Player1Name").value =duel.Player1;
        document.getElementById("Player2Name").value = duel.Player2;
        document.getElementById("Duel_Num").textContent = "Ситуация №" + duel.SituationNum + ". \"" + duel.SituationName + "\"";
        document.getElementById("Duel_Text").innerHTML = duel.SituationDescription;        
        var select1 = document.getElementById('Player1Roles');
        var select2 = document.getElementById('Player2Roles');
        clearSelectOptions('Player1Roles');
        clearSelectOptions('Player2Roles');
        var RolesText="<b>Роли и интересы:</b>";
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
            RolesText+= "<br><b>"+ duel.SituationRoles[i].Role+ "</b> - "+ duel.SituationRoles[i].Goals;
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

function ShowHideSituationInfo()
{
    
    if (!document.getElementById("hide_text").checked)
    {      
        document.getElementById("PlayersInterests").style.visibility = 'hidden';
        document.getElementById("SituationText").style.visibility = 'hidden';
    }
    else
    {
        document.getElementById("PlayersInterests").style.visibility = 'visible';
        document.getElementById("SituationText").style.visibility = 'visible';
    }
    
}
/*---------------------dice ---------------------------------*/


function dice() {
    const dice0 = document.getElementById("dice0")
    dice0.style.transform = 'rotate(1080deg)'
    setTimeout(() => {
        dice0.style.transform = 'rotate(0deg)'
        if (Math.random() >= 0.5) {
            document.getElementById("Player1Name").value = duelsList[currentDuel].Player2;
            document.getElementById("Player2Name").value = duelsList[currentDuel].Player1;    
        }
        document.getElementById("Player1Label").style.backgroundColor = inactivePlayerColor;
        document.getElementById("Player2Label").style.backgroundColor = inactivePlayerColor;    
    }, 1000)
}