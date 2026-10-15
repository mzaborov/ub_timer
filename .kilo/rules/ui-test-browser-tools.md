---
description: UI/браузерные тесты агент выполняет сам через MCP-браузер; запрещена отговорка «нет браузерного доступа»
alwaysApply: true
---

# UI-тесты: агент гоняет браузер сам

## Запрещено

- Отказываться от UI/браузерной проверки формулировкой **«у меня нет браузерного доступа»**, «не могу открыть стенд/прод», «прогон — на вашей стороне».
- Перекладывать на пользователя прогон happy path и снятие скриншотов, если блокирует только «нужно открыть страницу».

## У агента есть браузер (MCP `yandex-browser`)

- `browser_navigate` — переход по **любому** URL, включая удалённый стенд/прод.
- `browser_snapshot`, `browser_find`, `browser_evaluate` — разбор страницы и состояние.
- `browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option`, `browser_press_key` — действия.
- `browser_take_screenshot` — скриншоты для отчёта.
- `browser_console_messages`, `browser_network_requests` — ошибки и запросы (в т.ч. к `db.php`).
- `browser_open` — **только для localhost/127.0.0.1**; для стенда используй `browser_navigate`.

## Обязанность

- Сквозной UI-тест (happy path) и скриншоты ключевых экранов делает **агент сам** через MCP-браузер.
- Образец отчёта — [MAI bridge-game-test-report](../../../MAI/docs/bridge-game-test-report-2026-09-12.md); отчёт по ub-timer — в `ub-timer/docs/`.
- Если проверка реально заблокирована, назови **конкретную** причину (нет выкладки на стенд, нет тестового мероприятия/данных, нет доступа к БД, нужен вход) и запроси **конкретное действие**. Общая отговорка про браузер — запрещена.

## Связанное

- Правило правил/планов: `C:\Projects\.kilo\rules\*`.
- Тест happy path — группа 9 в `ub-timer/openspec/changes/timer-on-portal-db/tasks.md`.
