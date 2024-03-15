const game_time = 50;
var time = [game_time,game_time];
var current_player = 1;
var duel_is_active = false;
var clock_is_active = false;
var emergingTime  = 30
var finishingTime  = 10
var timerID =0;
var activeTimerColor = "MediumBlue";
var inactiveTimerColor = "DarkGrey";
var emergingTimerColor = "OrangeRed";
var finishingTimerColor = "FireBrick";

document.getElementById("timer1").textContent = formatTime(time[0]);
document.getElementById("timer2").textContent = formatTime(time[1]);

var donut1 = new Donutty(document.getElementById("donut1"), {min:0, max:game_time, value:game_time , round :false,color: inactiveTimerColor});
var donut2 = new Donutty(document.getElementById("donut2"), {min:0, max:game_time, value:game_time, round:false, color: inactiveTimerColor});

function formatTime(time_in_sec)
{
  return String(Math.floor(time_in_sec/60)).padStart(2,"0") + ":" + String(time_in_sec%60).padStart(2,"0");
}

function timeTicker(donaty) {
    time[current_player-1]--;
    document.getElementById("timer"+current_player).textContent = formatTime(time[current_player-1]);
        donaty.setState({value:time[current_player-1]});		
    if (time[current_player-1] === 0) {
        clearInterval(timerID);
        clock_is_active = false;
        changePlayer(); 
    }
    if (time[current_player-1] <= emergingTime )  {  donaty.setState({color: emergingTimerColor});}      
    if (time[current_player-1] <= finishingTime )  {  donaty.setState({color: finishingTimerColor});}      
}


function changeTime() {
    if (current_player === 1) {timeTicker(donut1)} else {timeTicker(donut2)}       
}

function initTimers()
{
    time1 = game_time;
    time2 = game_time;
    donut1.setState({value:time1,color: inactiveTimerColor});
    donut2.setState({value:time2, color: inactiveTimerColor});

}

function changePlayer() {    
    setPlayer((current_player % 2) + 1);
}

function setPlayer(playerNum) {
   current_player=playerNum;
   if (playerNum ===1 )   {
        donut1.setState({color: activeTimerColor});
        donut2.setState({color: inactiveTimerColor});
     }
    else
    {
        donut1.setState({color: inactiveTimerColor});
        donut2.setState({color: activeTimerColor});
    } 
   document.getElementById("current_player").textContent = "Игрок №"+ current_player;
}



function start_duel() {
    document.getElementById("start_stop_timer").style.visibility='visible'
    document.getElementById("button_swich_user").style.visibility='visible';
    document.getElementById("protest").style.visibility='visible';
    document.getElementById("stop_duel").style.visibility='visible';
    document.getElementById("protest").style.visibility='visible';
    document.getElementById("start_duel").style.visibility='hidden';
    initTimers();
    setPlayer (1);    
    start_timer();
    duel_is_active =true;
}

function stop_duel() {
    
    stop_timer();
    document.getElementById("start_stop_timer").style.visibility='hidden'
    document.getElementById("button_swich_user").style.visibility='hidden';
    document.getElementById("stop_duel").style.visibility='hidden';
    document.getElementById("protest").style.visibility='hidden';
    document.getElementById("start_duel").style.visibility='visible';    
    document.getElementById("current_player").textContent = "";       
    duel_is_active =false;
    initTimers()
    
}

function start_stop_timer() {
    if (clock_is_active) {stop_timer(); } 
    else { start_timer();};
}

function start_timer() {
    timerID= setInterval(changeTime, 1000)
    document.getElementById("start_stop_timer").innerText = "Пауза";     
    clock_is_active =true;
}

function stop_timer() {
    timerID= clearInterval(timerID)
    document.getElementById("start_stop_timer").innerText = "Возобновить";     
    clock_is_active =false;
}
