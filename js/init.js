// deploy-version: 26
/*--------------------------инициализирующий код----------------------------*/
donut1 = new Donutty(document.getElementById("donut1"), { min: 0, max: game_time, value: game_time, round: false, color: inactiveTimerColor, bg: donuttyTrackColor });
donut2 = new Donutty(document.getElementById("donut2"), { min: 0, max: game_time, value: game_time, round: false, color: inactiveTimerColor, bg: donuttyTrackColor });
pause_donut = new Donutty(document.getElementById("pause_donut"), { min: 0, max: 60, value: 60, round: false, color: secondaryTimerColor, bg: donuttyTrackColor });
referee_donut = new Donutty(document.getElementById("referee_donut"), { min: 0, max: 60, value: 60, round: false, color: secondaryTimerColor, bg: donuttyTrackColor });
initTimers();

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
