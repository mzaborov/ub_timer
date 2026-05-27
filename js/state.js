// Состояние приложения (константы и глобальные переменные). Загружается перед core.js и остальными модулями.
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
var emergingTime = 30;
var finishingTime = 10;
var timerID = 0;
var current_round = 0;
var duelsList;
var currentDuel;
var lastShiftIsUsed = false;
var duelType = "classic";

//  пауза и протест
var pauseTimerID = 0;
var pauseTime = 60;
var protest_is_active = false;

//  для формы судей
const PlayerVoteStyle = ["dark", "primary", "success"];
var refereeTimerID = 0;
var refereeTime = 60;
var activeReferee = 0;
var refereeQty = 9;
var refereeList;

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

/** Индексы поединков, название ситуации которых уже раскрыли кликом в выпадашке (колонка Hidden). */
var revealedSituationIndices = {};

var donut1, donut2, pause_donut, referee_donut;
