# Live-протокол: исходник GAS

Клиент: `js/live-protocol.js` (прод ~v68).

Сервер Live Web App сейчас задеплоен в Apps Script как **ub-timer-live-protocol ~1.5.0**, но файл `live-protocol.gs` **ещё не в git** (выкладывался API с другой машины).

## Что сделать

1. Apps Script → проект Ub-timer → скопировать код Live (`doGet`/`doPost` и хелперы) в `scripts/google-apps-script/live-protocol.gs`.
2. Либо при наличии OAuth: `python scripts/deploy_gas.py` / clasp pull и закоммитить полученный `.gs`.
3. В `secrets.env`: `GAS_SCRIPT_ID`, `GAS_WEBAPP_DEPLOYMENT_ID` (id из URL `…/macros/s/<id>/exec`).

Манифест `appsscript.json` уже содержит блок `webapp` (ANYONE_ANONYMOUS / USER_DEPLOYING) — без него `deployments.update` сбрасывает entryPoints → HTTP 404.
