# Протоколы поединков

Документация pipeline: бумажный протокол → JSON → Google-таблица «протоколы игр».

| Документ | О чём |
|----------|--------|
| [`pipeline.md`](pipeline.md) | Обзор этапов и ссылки |
| [`batch-format.md`](batch-format.md) | Схема JSON `protocols-batch` v1 |
| [`import.md`](import.md) | Логика импорта в таблицу (GAS) |

Данные: [`data/protocols/`](../../data/protocols/).  
GAS: [`scripts/google-apps-script/`](../../scripts/google-apps-script/); деплой `python scripts/deploy_gas.py`.
