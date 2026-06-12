---
name: Банк ситуаций ub-timer
overview: "Два этапа: (1) просмотр банка в ub-timer из published CSV; (2) Google Apps Script — автогенерация SituationDescription и SituationRoles через LLM. **Выполнено 2026-06-12.**"
todos:
  - id: verify-csv
    content: "Проверено: published CSV доступен (141 строка), колонки и HTML/JSON поля зафиксированы"
    status: completed
  - id: situations-bank-js
    content: "js/situations-bank.js + situations-bank.html: fetch, parseCsv, cache, filter, карточка, свайп, «Поделиться»"
    status: completed
  - id: modal-ui
    content: "Отдельная страница situations-bank.html (mobile-first, AppSheet-стиль); ссылка в меню таймера вместо модалки"
    status: completed
  - id: styles
    content: "css/situations-bank.css; минимальные правки timer.css / timer-mobile.css"
    status: completed
  - id: apps-script-enrich
    content: "Apps Script enrich-situations.gs v1.2.5: OpenRouter/DashScope, промпты по типу, json_object, лог, «Исправить экспрессы»"
    status: completed
  - id: readme
    content: "README.md + scripts/google-apps-script/README.md"
    status: completed
isProject: false
status: archived
completedAt: 2026-06-12
---

# Банк ситуаций в ub-timer — архив плана

План выполнен. Итог в репозитории и на проде (v40+).

## Реализовано

### Этап 1 — просмотр

- URL: https://timer.zaborov.ru/situations-bank.html
- Файлы: `situations-bank.html`, `css/situations-bank.css`, `js/situations-bank.js`
- Данные: published CSV Google Sheets, кэш sessionStorage (v2, TTL 1 ч)
- UI: список Код/Тип → карточка; фильтр пустых и служебных строк; свайп; «Поделиться»
- Экспресс: блок «Роли и интересы» скрыт в карточке

### Этап 2 — автогенерация

- Шаблон: `scripts/google-apps-script/enrich-situations.gs` (в `.gitignore`, ключ локально)
- Инструкция: `scripts/google-apps-script/README.md`
- LLM: OpenRouter (по умолчанию) или DashScope (`LLM_PROVIDER=dashscope`)
- Меню в таблице: генерация пустых/выделенных, проверка API, **Исправить экспрессы** (без токенов)
- Экспресс JSON: `[{"Role":"...","Phrase":"..."},{"Role":"..."}]` — Phrase только у первой роли
- Лог: `_enrich_log` (в конце книги, колонка «Сырой ответ» при ERROR)

## Отложено (отдельная задача)

- Join банка с расписанием по `SituationNum` при загрузке `.xlsx`
- Импорт расписания из Google Doc

## Ссылки

- [README — раздел «Банк ситуаций»](../../README.md)
- [Apps Script README](../../scripts/google-apps-script/README.md)
