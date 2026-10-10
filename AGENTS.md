# ub-timer

Web-приложение «Управленческие поединки — Часы»: таймеры, судьи, протокол, интеграция с Google.

Описание и запуск: [README.md](README.md).

Правило для агента: не изменяй код проекта без явного запроса пользователя.

## Структура проекта

- `portal/` — PHP-фронт портала (таймер, рейтинг, регистрация).
- `api/`, `inc/` — PHP-скрипты API и общие includes.
- `js/`, `css/`, `assets/`, `fontawesome/` — клиентская часть.
- `scripts/`, `google-apps-script/` — серверные/админ-скрипты и интеграция с Google.
- `docs/`, `data/`, `library/` — документация, данные и библиотеки.
- `openspec/`, `plans/` — изменения и планы.
- Основной стек: PHP, JavaScript, CSS, Google Apps Script, Python (вспомогательно).

## Правила

- Читать проектные правила из [.kilo/rules/*.md](.kilo/rules/).
- Читать глобальные правила workspace: `C:\Projects\.kilo\rules\*.md`.
- Не изменять исходный код, данные поединков, Google-интеграции, секреты и конфигурации без явного запроса пользователя.

## Ключевые документы

- [README.md](README.md)
- [docs/protocol-import-format.md](docs/protocol-import-format.md)
- [docs/выжимка_History_и_статистика_проекта.md](docs/выжимка_History_и_статистика_проекта.md)
- [History.log](History.log)
