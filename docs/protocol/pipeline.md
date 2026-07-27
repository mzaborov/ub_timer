# Pipeline: бумажные протоколы → Google-таблица

Два этапа: **подготовка JSON** и **импорт через Apps Script**.

```
PDF / ub-timer / ручная правка
        ↓
  protocols-batch v1 JSON     ← docs/protocol/batch-format.md
        ↓
  enrich-protocol-names.py    ← опционально, однословные фамилии
        ↓
  лист _protocol_import!A1
        ↓
  import-protocols.gs         ← enrich-situations.gs (секция протоколов)
        ↓
  лист «протоколы игр»
```

## Документация

| Документ | О чём |
|----------|--------|
| [`batch-format.md`](batch-format.md) | Схема JSON: поля, имена, примеры |
| [`import.md`](import.md) | Маппинг в таблицу: команды, Начинал, строки, матчинг |
| [`../../scripts/google-apps-script/README.md`](../../scripts/google-apps-script/README.md) | Установка GAS (один файл), меню, логи |

## Данные

| Путь | Назначение |
|------|------------|
| [`data/protocols/kupala-2026.json`](../../data/protocols/kupala-2026.json) | Купала 2026, 7 поединков |
| `data/protocols/<tournament>.json` | Другие турниры |

## Скрипты

| Скрипт | Когда |
|--------|--------|
| [`scripts/enrich-protocol-names.py`](../../scripts/enrich-protocol-names.py) | После OCR/PDF: дополнить фамилии без имени |
| [`scripts/google-apps-script/enrich-situations.gs`](../../scripts/google-apps-script/enrich-situations.gs) | Банк ситуаций (LLM) |
| [`scripts/google-apps-script/import-protocols.gs`](../../scripts/google-apps-script/import-protocols.gs) | Импорт protocols-batch |
| [`scripts/deploy_gas.py`](../../scripts/deploy_gas.py) | Деплой GAS через Apps Script API (Python) |
