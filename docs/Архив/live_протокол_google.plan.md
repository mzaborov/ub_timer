---
name: Live-протокол Google
overview: "Выполнено (прод ~v68): меню Протокол, save/restore Google, Live по 4 событиям в сетку состава."
todos:
  - id: design-four-events
    content: "4 события → payload → строки сетки; GAS doPost"
    status: completed
  - id: clarify-mapping
    content: "Маппинг строк, якорь Команда1/2, голоса каждый клик"
    status: completed
  - id: implement-phase-a
    content: "Меню Протокол + save/restore + toggle live"
    status: completed
  - id: implement-live-hooks
    content: "Хуки событий 1–4 при включённом live"
    status: completed
isProject: false
---

# План 3 — Live-протокол в Google

**Статус: выполнен (2026-08-05…06), сдан в архив. Прод ~v68.**

Клиент: [`js/live-protocol.js`](../../js/live-protocol.js). GAS Web App ~1.5.0 — см. [`scripts/google-apps-script/LIVE_PROTOCOL_SOURCE.md`](../../scripts/google-apps-script/LIVE_PROTOCOL_SOURCE.md) (файл `.gs` может ещё не быть в git).

## Цель

Обновлять сетку «состав онлайна» в Google вручную и в реальном времени.

## Меню «Протокол»

1. **Сохранить в Google** — снимок встречи (только после загрузки расписания из Google)
2. **Сохранить в файл** — Excel
3. **Очистить Google** — откат к слепку на момент загрузки
4. **Live-запись: вкл|выкл** — по умолчанию вкл при загрузке из Google

## Четыре события (Live вкл)

| # | Событие | Ячейки | Триггер |
|---|---------|--------|---------|
| 1 | Состав | судьи; при смене также игроки/секунданты | `duelAssignments` |
| 2 | Случайная ситуация | Ситуация | резолв `00`/`00Э` |
| 3 | Жребий хода | Начинал | `finishDice` |
| 4 | Голос судьи | Судья N Голос | каждый `refereeVote` |

Лист состава `gid=1172864695`. Победитель/счёт — формулы таблицы, не пишем.
