---
name: "razbienie-timer-code "
overview: "Разбить монолитный js/timer-code.js на несколько файлов с сохранением порядка загрузки и без поломки функциональности. "
todos:
  - id: extract-state
    content: "Вынести константы и глобальные переменные в js/state.js. "
    status: completed
  - id: update-html-scripts
    content: "Подключить state.js перед timer-code.js в index.html. "
    status: completed
  - id: verify-no-regressions
    content: "Проверить: загрузка расписания, поединок, судьи, участники, протокол, восстановление. "
    status: completed
  - id: phase2-extract-core
    content: "Фаза 2: выделить core.js (часы, поединок, переход хода, Dice, IIFE таймера). "
    status: completed
  - id: phase2-extract-referees
    content: "Фаза 2: выделить referees.js (оценки судей). "
    status: completed
  - id: phase2-extract-schedule
    content: "Фаза 2: выделить schedule.js (загрузка JSON, участники, раскладка судей). "
    status: completed
  - id: phase2-extract-toolbar-sound
    content: "Фаза 2: выделить toolbar-sound.js (кнопки тулбара, звук). "
    status: completed
  - id: phase2-extract-protocol
    content: "Фаза 2: выделить protocol.js (протокол онлайна, баннер, экспорт/импорт). "
    status: completed
  - id: phase2-extract-init
    content: "Фаза 2: создать init.js (донаты, initTimers(), стили, звук/интро). "
    status: completed
isProject: false
---

## Цель

Уменьшить монолитность `js/timer-code.js` (~2900 строк) за счёт выноса **состояния** в отдельный файл. Логика и порядок работы приложения не меняются; риск поломки минимален.

## Ограничения

- Сборки нет: только несколько `<script>` в нужном порядке.
- Все скрипты работают в одном глобальном контексте (нет ES-модулей).
- Зависимости только в одну сторону: код использует состояние; состояние не вызывает код из другого файла.

## Выбранный вариант: вынос состояния (минимальный безопасный шаг)

1. **js/state.js** — только константы и объявления глобальных переменных (без функций). Сюда входят:
  - константы цветов таймеров и стилей;
  - переменные таймера поединка (`game_time`, `time`, `current_player`, `duel_is_active`, `clock_is_active`, `emergingTime`, `finishingTime`, `timerID`, `current_round`, `duelsList`, `currentDuel`, `lastShiftIsUsed`, `duelType`);
  - пауза/протест (`pauseTimerID`, `pauseTime`, `protest_is_active`);
  - форма судей/голосование (`PlayerVoteStyle`, `refereeTimerID`, `refereeTime`, `activeReferee`, `refereeQty`, `refereeList`);
  - протокол онлайна (`scheduleFileName`, `roundStartRemaining`, `roundDurations`, `roundRoles`, `pauseProtestEvents`, `PROTOCOL_STORAGE_KEY`, `sessionPhase`, `isRestoringProtocol`, `lastCompletedDuelIndex`);
  - участники и раскладка судей (`people`, `duelAssignments`, `peopleNextId`);
  - объявления для донатов: `var donut1, donut2, pause_donut, referee_donut;` (присвоение `new Donutty(...)` выполняется в timer-code.js при инициализации, т.к. нужен DOM).
2. **js/timer-code.js** — присвоение донатов и вызов `initTimers()`, все функции, IIFE, обработчики. В начале файла: комментарий `// deploy-version: N`, затем создание донатов и `initTimers()`, далее весь остальной код. Повторно объявлять переменные из state не нужно.
3. **index.html** — порядок скриптов:
  - `donutty.js`
  - `xlsx`
  - `bootstrap`
  - **state.js** (новый)
  - **timer-code.js**

Важно: донаты (`new Donutty(...)`) создаются в timer-code.js при первом выполнении, потому что нужен `document.getElementById(...)`. В state.js можно не объявлять `donut1`, `donut2` и т.д., если они объявлены в timer-code.js до первого использования (сейчас они создаются в начале файла). Тогда в state выносим только данные (константы + var без Donutty). Проверка: в timer-code.js в начале идёт создание донатов и `initTimers()`. Значит в state.js объявляем только те переменные, которые не требуют DOM (все перечисленные выше). `donut1`, `donut2`, `pause_donut`, `referee_donut` остаются объявленными в timer-code.js, иначе пришлось бы в state как-то инициализировать их позже — проще оставить как есть.

## Шаги реализации

### Шаг 1. Создать js/state.js

- Скопировать из timer-code.js строки с константами и объявлениями переменных (примерно строки 1–55).
- Добавить объявления для донатов: `var donut1, donut2, pause_donut, referee_donut;`.
- Убрать из этого файла создание донатов и вызов `initTimers()` — они остаются в timer-code.js.
- В начале файла оставить комментарий с версией деплоя (или перенести версию только в timer-code.js — как принято в проекте).

### Шаг 2. Отредактировать js/timer-code.js

- Удалить из начала файла всё, что перенесено в state.js (константы и var до блока с донатами включительно — но сами донаты и initTimers() оставить).
- Убедиться, что нигде в timer-code.js не объявляются заново переменные из state (не должно быть повторных `var duelsList` и т.п.). Если были — удалить объявления, оставить только использование.

### Шаг 3. Подключить state.js в index.html

- Перед строкой с `timer-code.js` добавить:  
`<script type="text/javascript" src="js/state.js?v=16"></script>`
- Версию `v=16` держать общей с timer-code.js или поднять после изменений (по правилам проекта).

### Шаг 4. Проверка

- Открыть приложение, загрузить расписание.
- Пройти сценарий: выбор поединка, старт/стоп, смена игрока, пауза/протест, завершение поединка, голосование судей.
- Открыть «Участники и судьи», добавить участника, автоназначение судей, сохранение/восстановление из localStorage, скачать протокол, сохранить/загрузить статус онлайна.
- Убедиться, что баннер восстановления и кнопки меню работают как раньше.

## Детализация разбиения на независимые модули (фаза 2)

После выполнения фазы 1 (вынос состояния в state.js) можно разнести логику по файлам без сборки: несколько `<script>` в одном глобальном контексте, порядок загрузки задаёт зависимости.

### Зависимости между блоками (кто кого использует)

- **Core (таймер, поединок, часы)** — основа: `formatTime`, `initTimers`, `setPlayer`, `highlightPlayer`, `changePlayer`, `start_duel`, `stop_duel`, `pause`, `protest`, `start_timer`, `stop_timer`, `timeTicker`, `changeTime`. Вызываются из HTML и из других блоков.
- **Судьи** — используют: `formatTime`, `referee_donut`, состояние судей, `applyJudgesNamesFromAssignments` → нужны `getPersonName`, `duelAssignments` (участники).
- **Расписание и участники** — загрузка JSON, `loadFile`, `duelChoosed`, `roleChoosed`, `people`, `duelAssignments`, `getPersonName`, `initDuelAssignmentsFromDuels`, `renderParticipantsTab`, `renderJudgesLayoutTab`, автоназначение судей. Вызывают core (`start_duel`, `initTimers` при смене поединка) и обращаются к протоколу (`saveProtocolStateToLocalStorage`).
- **Протокол онлайна** — восстановление/сохранение сессии, экспорт/импорт xlsx, баннер. Использует: `duelsList`, `duelAssignments`, `people`, `getPersonName`, `applyRestoredSessionState`, `saveProtocolStateToLocalStorage`, `hideRestoreProtocolBanner`.
- **Тулбар и звук** — кнопки времени, полноэкран ситуации, звуки, `finishDuelAndClose`, `reopenJudgesForm`. Зависят от core и судей.

Итог: загрузка в порядке **state → core → судьи → расписание/участники → протокол → инициализация (донаты + initTimers)**. Тулбар/звук можно оставить в core или вынести в последний маленький файл после протокола.

### Предлагаемые файлы и границы


| Файл                                               | Содержимое (по текущим комментариям в timer-code.js)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Строки (ориентир)                                | Зависит от                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **state.js**                                       | Константы и глобальные переменные (без донатов)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 1–54                                             | —                                                                                                  |
| **core.js**                                        | Часы, подсветка игроков, переход хода, поединок (старт/стоп, пауза, протест), Dice, IIFE двойного клика по таймеру. Функции: `formatTime`, `setPlayer`, `highlightPlayer`, `initTimers`, `changePlayer`, `start_stop_duel`, `start_duel`, `stop_duel`, `protest`, `pause`, `changePauseTime`, `start_stop_timer`, `start_timer`, `stop_timer`, `timeTicker`, `changeTime`, `finishDice`, `setDiceBlinkHighlight`, `blinkingIntroStep`, `dice`, + IIFE `setupTimerDblclickEdit`. Без создания донатов и без вызова `initTimers()` в конце. | ~465–1054 + 62–178 (IIFE и стили)                | state, Donutty, DOM                                                                                |
| **referees.js**                                    | Оценки судей: `changeRefereeTime`, `refereeTimer`, `shortNameForPerson`, `applyJudgesNamesFromAssignments`, `initRefereeStructure`, `setReferee`, `nextReferee`, `refereeVote`, `calcAndShowScore`, `highlightReferee`.                                                                                                                                                                                                                                                                                                                   | ~179–464                                         | state, core (formatTime), DOM                                                                      |
| **schedule.js**                                    | Загрузка JSON и список поединков, участники и раскладка судей: от `triggerClick` / `getHeaderToColumnMap` до `roleChoosed` включительно (все утилиты загрузки, `loadFile`, `processDuelsJson`, `duelChoosed`, `ensurePeopleFromSchedule`, `initDuelAssignmentsFromDuels`, вкладки участников и раскладки, автонаполнение судей, контекстное меню).                                                                                                                                                                                        | ~1055–2207                                       | state, core, XLSX, DOM                                                                             |
| **toolbar-sound.js**                               | Кнопки тулбара и звук: `setDuelTime`, `ShowHideSituationInfo`, `openSituationFullscreen`, `closeSituationFullscreen`, `stopAudio`, `playDrumRoll`, `playApplause`, `finishDuelAndClose`, `reopenJudgesForm`, `toggeSound`.                                                                                                                                                                                                                                                                                                                | ~2208–2379                                       | state, core, referees (для голосов/модалки)                                                        |
| **protocol.js**                                    | Протокол онлайна: `formatDurationSec`, `parseDurationToSec`, `buildProtocolAndDownload`, `buildSessionStatePayload`, `exportOnlineStatusToFile`, `importOnlineStatusFromFile`, `showRestoreProtocolBanner`, `hideRestoreProtocolBanner`, `clearProtocolStateAndHideBanner`, `hasProtocolRealData`, `checkRestoreProtocolBanner`, `attachJudgesModalReopenListeners`, IIFE `checkRestoreProtocolOnLoad`, обработчик `pageshow`.                                                                                                            | ~2380–2931                                       | state, schedule (getPersonName, applyRestoredSessionState, duelChoosed, switchToFileDropdown), DOM |
| **init.js** (или оставить в index как один скрипт) | Создание донатов (`donut1`, `donut2`, `pause_donut`, `referee_donut`), вызов `initTimers()`, применение стилей к кнопкам голосов (PlayerVoteStyle), инициализация звука и списка треков интро. Всё, что должно выполниться один раз после загрузки DOM и всех модулей.                                                                                                                                                                                                                                                                    | эквивалент текущих ~55–61 + 143–177 + звук/интро | state, core, Donutty, DOM                                                                          |


Важно: в **core.js** не должно быть вызова `initTimers()` и создания донатов — только объявления функций. Инициализация — в последнем скрипте (init.js или конце одного из файлов, загружаемого последним).

### Порядок скриптов в index.html (после фазы 2)

```html
<script src="js/donutty.js?v=..."></script>
<script src=".../xlsx..."></script>
<script src=".../bootstrap..."></script>
<script src="js/state.js?v=..."></script>
<script src="js/core.js?v=..."></script>
<script src="js/referees.js?v=..."></script>
<script src="js/schedule.js?v=..."></script>
<script src="js/toolbar-sound.js?v=..."></script>
<script src="js/protocol.js?v=..."></script>
<script src="js/init.js?v=..."></script>
```

Если не вводить отдельный init.js, то инициализацию (донаты + `initTimers()` + стили + звук/интро) можно оставить в **init.js** как единственный «хвост» от текущего timer-code.js, либо включить в конец **core.js** (тогда timer-core загружается последним среди логики, но тогда протокол не может вызывать ничего из core при загрузке — что и так выполняется по событию).

Уточнение: в текущем коде вызов `initTimers()` и создание донатов идут в начале файла сразу после объявления переменных. После разбиения донаты и `initTimers()` должны выполняться после полной загрузки DOM и всех модулей, поэтому их место — в отдельном маленьком скрипте **init.js**, подключаемом последним.

### Пошаговая реализация фазы 2

1. **Фаза 1 уже сделана**: state.js создан, в timer-code.js удалены константы и объявления состояния.
2. **Выделить core.js**: скопировать в новый файл блоки «Подсветка игроков», «Часы», «Переход хода», «Поединок», «Dice», IIFE двойного клика; не включать донаты и `initTimers()` в конец. Из начала оставшегося timer-code.js удалить эти блоки. В index.html вставить core.js после state.js. Проверить: таймер, смена хода, пауза/протест, кости (без загрузки расписания и судей).
3. **Выделить referees.js**: перенести блок «Оценки судей» в новый файл, подключить после core.js. Удалить блок из timer-code.js. Проверить: форма судей, таймер судей, голосование.
4. **Выделить schedule.js**: перенести блок от «Загрузка JSON и работа со списком поединков» до конца «roleChoosed». Подключить после referees.js. Проверить: загрузка xlsx, выбор поединка, участники, раскладка судей, автоназначение.
5. **Выделить toolbar-sound.js**: перенести «Кнопки тулбара» и «звук». Подключить после schedule.js. Проверить: кнопки времени, полноэкран, звуки, завершение поединка и повторное открытие формы судей.
6. **Выделить protocol.js**: перенести блок «Протокол онлайна» целиком. Подключить после toolbar-sound.js. Проверить: сохранение/восстановление сессии, баннер, экспорт/импорт протокола.
7. **Создать init.js**: оставить в нём только создание донатов, вызов `initTimers()`, применение стилей к кнопкам голосов (PlayerVoteStyle), инициализацию звука и списка треков интро (переменные звука и интро остаются в state или в init — см. ниже). Подключить последним. Удалить из timer-code.js всё перенесённое; если в timer-code.js ничего не осталось, подключить init.js вместо timer-code.js и при необходимости переименовать/оставить один «хвост» в timer-code.js только как init.js.

Переменные звука и интро (`soundsEnabled`, `audioGong`, `audioTicking`, …): их объявления можно оставить в **state.js** (без присвоения `new Audio(...)`), а создание `new Audio(...)` и заполнение `introTracksList` — в **init.js**, чтобы не зависеть от DOM в state. Либо оставить всё в init.js, если не хочется трогать state.

### Риски фазы 2


| Риск                                                      | Митигация                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Функция вызывается до загрузки модуля, где она определена | Строгий порядок скриптов; не вызывать из одного модуля функцию из следующего по порядку при загрузке (только по событию). |
| Циклическая зависимость                                   | Модули только в одну сторону: state ← core ← referees ← schedule ← toolbar-sound ← protocol ← init.                       |
| Забыть перенести вызов или объявление                     | Перед вырезкой блока — grep по имени функции/переменной; тесты после каждого выделения.                                   |
| Разные версии кэша у файлов                               | Общий `?v=N` для всех js при деплое или поднимать версию разом.                                                           |


### Альтернатива без физического разбиения

Если физическое разбиение на 6–7 файлов пока не нужно, можно ограничиться **крупными комментариями-блоками** внутри одного timer-code.js (как сейчас) и зафиксировать в плане границы «логических модулей» для будущего рефакторинга.

---

## Возможное расширение плана (позже)

- После фазы 2 при необходимости вынести в state объявления переменных звука/интро, а создание `new Audio` оставить в init.js.
- Либо ограничиться секциями внутри одного файла (крупные комментарии-блоки) без физического разбиения.

## Риски и митигация


| Риск                                                 | Митигация                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Забыть вынести переменную, на которую ссылается code | Перед удалением из code проверить grep по имени переменной; в state объявить все, что используются в code. |
| Ошибиться порядком скриптов                          | В index.html state всегда перед timer-code.js.                                                             |
| Версия кэша                                          | Использовать тот же query `?v=...` для state и code при деплое или поднять версию разом.                   |

