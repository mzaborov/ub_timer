from __future__ import annotations

from typing import Any

import requests


class PortalError(RuntimeError):
    pass


class AuthError(PortalError):
    pass


class PortalClient:
    def __init__(self, base_url: str, token: str, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token.strip()
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"Accept": "application/json"})
        if self.token:
            self.session.headers.update({
                "Authorization": f"Bearer {self.token}",
                "X-Api-Token": self.token,
            })

    @property
    def api_url(self) -> str:
        base = self.base_url.rstrip("/")
        if base.endswith(".php"):
            return base
        if base.endswith("/portal"):
            return base + "/api/videocut.php"
        return base + "/portal/api/videocut.php"

    def _get(self, params: dict[str, Any]) -> dict[str, Any]:
        try:
            resp = self.session.get(self.api_url, params=params, timeout=self.timeout)
        except requests.RequestException as exc:
            raise PortalError(f"Нет связи с порталом: {exc}") from exc
        if resp.status_code == 401:
            raise AuthError("Портал отклонил токен доступа")
        if resp.status_code >= 400:
            raise PortalError(f"Портал вернул HTTP {resp.status_code}")
        try:
            payload = resp.json()
        except ValueError as exc:
            raise PortalError("Портал вернул не JSON") from exc
        if not payload.get("ok"):
            raise PortalError(str(payload.get("error") or "Ошибка портала"))
        return payload.get("data") or {}

    def health(self) -> dict[str, Any]:
        return self._get({"action": "health"})

    def events(self) -> list[dict[str, Any]]:
        return list(self._get({"action": "events"}).get("events") or [])

    def event(self, event_id: int) -> dict[str, Any]:
        return self._get({"action": "event", "id": int(event_id)})

    def close(self) -> None:
        self.session.close()
