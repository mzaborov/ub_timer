# Google Apps Script для таблицы «я-ИТ-ы Управленческие поединки»

Локальные файлы в этой папке → проект Apps Script таблицы:

| Файл | Назначение |
|------|------------|
| `Menu.gs` | `onOpen` — оба меню |
| `enrich-situations.gs` | Банк ситуаций (LLM) |
| `import-protocols.gs` | Импорт `protocols-batch` v1 |
| `appsscript.json` | Манифест |

Документация протоколов: [`docs/protocol/`](../../docs/protocol/).

---

## Деплой (Python, рекомендуется)

Node.js **не нужен**. Скрипт [`scripts/deploy_gas.py`](../deploy_gas.py) заливает все `.gs` через **Google Apps Script API**.

### Один раз

1. **Google Cloud Console** → создать/выбрать проект → включить **Google Apps Script API**.
2. **APIs & Services → Credentials** → **Create OAuth client ID** → тип **Desktop app** → скачать JSON.
3. Сохранить как `scripts/google-apps-script/gas-oauth-client.json` (в `.gitignore`).
4. В `secrets.env` (корень репо):
   ```
   GAS_SCRIPT_ID=идентификатор_из_Apps_Script_Настройки_проекта
   ```
5. Зависимости:
   ```powershell
   pip install -r scripts/requirements-gas.txt
   ```
6. Первый деплой откроет браузер для входа в Google; токен сохранится в `.gas-token.json`.

### Каждое обновление

```powershell
.\scripts\deploy-gas.ps1
```

или

```powershell
python scripts/deploy_gas.py
```

Проверка без загрузки: `python scripts/deploy_gas.py --dry-run`

Обновите страницу таблицы — меню «Банк ситуаций» и «Протоколы игр».

> **Важно:** `updateContent` **заменяет все файлы** проекта. В репозитории должны быть все нужные `.gs` (сейчас три + манифест).

### Ручной деплой (без Python)

**Расширения → Apps Script** — вставить содержимое трёх `.gs` и `appsscript.json`. `onOpen` только в `Menu.gs`.

### Альтернатива: clasp (Node.js)

Если уже есть Node: `npm install -g @google/clasp`, `.clasp.json` из `.clasp.json.example`. Не обязателен при наличии `deploy_gas.py`.

---

# Банк ситуаций (LLM)

**SituationDescription** / **SituationRoles**. Заполненные ячейки не перезаписываются.

Версия — в заголовке `enrich-situations.gs`.

## Script Properties (в Google, не в Git)

Ключи LLM — в `secrets.env` локально, в таблице: **Проект → Свойства скрипта**.

| Свойство | Назначение |
|----------|------------|
| `QWEN_API_KEY` | OpenRouter или DashScope |
| `LLM_PROVIDER` | `openrouter` / `dashscope` |
| `SITUATIONS_SHEET_NAME` | по умолчанию `Ситуации` |
| `PROTOCOLS_SHEET_NAME` | по умолчанию `протоколы игр` |

Меню: сгенерировать / исправить экспрессы / проверить API. Лог: `_enrich_log`.

---

# Импорт протоколов

Версия — `PROTO_IMPORT_VERSION` в `import-protocols.gs`.

Меню «Протоколы игр»: `_protocol_import` → предпросмотр → импорт. Лог: `_protocol_import_log`.

Workflow: [`data/protocols/kupala-2026.json`](../../data/protocols/kupala-2026.json) → A1 → импорт.  
Подробнее: [`docs/protocol/import.md`](../../docs/protocol/import.md).
