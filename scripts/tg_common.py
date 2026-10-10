# -*- coding: utf-8 -*-
"""Общее для Telegram-инструментов: env, список прокси, DPAPI-сессия, создание клиента.

Безопасность:
  - api_id/api_hash и прокси читаются из tg_api.env / tg_proxies.txt (локально, вне git);
  - сессия хранится ЗАШИФРОВАННОЙ через Windows DPAPI (привязка к профилю пользователя):
    файл .session бесполезен на другой машине/профиле; открытого текста на диске нет;
  - каталог сессии получает ACL «только текущий пользователь» (best-effort);
  - ничего не пишем в репозиторий.
"""
from __future__ import annotations

import base64
import ctypes
import ctypes.wintypes as wt
import os
import re
import socket
import subprocess
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ENV_FILE = REPO / "tg_api.env"
PROXIES_FILE = REPO / "tg_proxies.txt"
SESSION_DIR = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".config" / "kilo" / "tg"
SESSION_FILE = SESSION_DIR / "tg.session"

# Локальный Xray (VLESS/Reality -> локальный SOCKS5)
XRAY_DIR = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".config" / "kilo" / "tools" / "xray"
XRAY_EXE = XRAY_DIR / "xray.exe"
XRAY_CONF = XRAY_DIR / "config.json"
XRAY_PID = XRAY_DIR / "xray.pid"

XRAY_STARTED_BY_US = False

PROXY_RE = re.compile(r"server=([^&]+)&port=(\d+)&secret=([^&\s]+)")


# ---------- env / proxies ----------

def load_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def get_api_creds() -> tuple[int, str]:
    env = load_env_file(ENV_FILE)
    api_id = (env.get("TG_API_ID") or os.environ.get("TG_API_ID") or "").strip()
    api_hash = (env.get("TG_API_HASH") or os.environ.get("TG_API_HASH") or "").strip()
    if not api_id.isdigit() or not api_hash:
        raise RuntimeError(
            f"Нет api_id/api_hash. Заполните {ENV_FILE} (TG_API_ID, TG_API_HASH)."
        )
    return int(api_id), api_hash


def norm_secret(secret: str) -> str:
    """Telegram принимает secret в hex. Если пришёл base64url — переводим в hex."""
    s = secret.strip()
    if re.fullmatch(r"[0-9a-fA-F]+", s) and len(s) % 2 == 0:
        return s.lower()
    raw = base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
    return raw.hex()


def parse_secret(secret: str) -> tuple[str, str]:
    """Вернуть (key16_hex, codec) для Telethon.

    Форматы:
      16 байт                        -> intermediate
      dd/ee + 16 байт (+ домен)       -> randomized (fake-TLS)
      >16 байт без префикса           -> randomized
    """
    b = bytes.fromhex(norm_secret(secret))
    if len(b) >= 17 and b[0] in (0xDD, 0xEE):
        return b[1:17].hex(), "randomized"
    if len(b) == 16:
        return b.hex(), "intermediate"
    if len(b) > 16:
        return b[:16].hex(), "randomized"
    raise ValueError("Некорректный MTProxy secret")


def load_proxies() -> list[dict]:
    """Список прокси из tg_proxies.txt, по порядку. Клиент берёт первый рабочий.

    Поддерживаемые строки (по одной на строку, # — комментарий):
      https://t.me/proxy?server=HOST&port=PORT&secret=SECRET   -> MTProto
      HOST:PORT:SECRET                                          -> MTProto
      socks5://[user:pass@]HOST:PORT                            -> SOCKS5
      socks4://[user:pass@]HOST:PORT                            -> SOCKS4
      http://[user:pass@]HOST:PORT   (или https://)             -> HTTP(S)
      HOST:PORT                                                 -> SOCKS5
    """
    out: list[dict] = []
    if not PROXIES_FILE.exists():
        return out
    for line in PROXIES_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = PROXY_RE.search(line)
        if m:
            key, codec = parse_secret(m.group(3))
            out.append({"type": "mtproto", "host": m.group(1), "port": int(m.group(2)), "key": key, "codec": codec})
            continue
        m = re.match(r"^(socks5|socks4|http|https)://(?:(?P<u>[^:@/]+)(?::(?P<p>[^@/]*))?@)?(?P<h>[^:/]+):(?P<port>\d+)$", line, re.I)
        if m:
            sch = m.group(1).lower()
            ptype = "socks5" if sch in ("socks5", "socks4") else "http"
            out.append(
                {
                    "type": ptype,
                    "host": m.group("h"),
                    "port": int(m.group("port")),
                    "username": m.group("u") or "",
                    "password": m.group("p") or "",
                }
            )
            continue
        parts = line.split(":")
        if len(parts) == 3 and parts[1].strip().isdigit():
            key, codec = parse_secret(parts[2].strip())
            out.append({"type": "mtproto", "host": parts[0].strip(), "port": int(parts[1]), "key": key, "codec": codec})
        elif len(parts) == 2 and parts[1].strip().isdigit():
            out.append({"type": "socks5", "host": parts[0].strip(), "port": int(parts[1]), "username": "", "password": ""})
    return out


# ---------- DPAPI ----------

class _BLOB(ctypes.Structure):
    _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _to_blob(data: bytes) -> tuple[_BLOB, ctypes.Array]:
    buf = ctypes.create_string_buffer(data, len(data))
    return _BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf


def dpapi_encrypt(data: bytes) -> bytes:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    bin_blob, _keep = _to_blob(data)
    out = _BLOB()
    ok = crypt32.CryptProtectData(ctypes.byref(bin_blob), None, None, None, None, 0, ctypes.byref(out))
    if not ok:
        raise OSError("CryptProtectData failed")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


def dpapi_decrypt(data: bytes) -> bytes:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    bin_blob, _keep = _to_blob(data)
    out = _BLOB()
    ok = crypt32.CryptUnprotectData(ctypes.byref(bin_blob), None, None, None, None, 0, ctypes.byref(out))
    if not ok:
        raise OSError("CryptUnprotectData failed")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


# ---------- session storage ----------

def _harden_dir() -> None:
    try:
        SESSION_DIR.mkdir(parents=True, exist_ok=True)
        dom = os.environ.get("USERDOMAIN") or ""
        user = os.environ.get("USERNAME") or ""
        who = f"{dom}\\{user}" if dom else user
        if who:
            flags = 0x08000000  # CREATE_NO_WINDOW
            subprocess.run(["icacls", str(SESSION_DIR), "/inheritance:r"],
                           capture_output=True, creationflags=flags, check=False)
            subprocess.run(["icacls", str(SESSION_DIR), "/grant:r", f"{who}:(OI)(CI)F"],
                           capture_output=True, creationflags=flags, check=False)
    except Exception:
        pass


def save_session_string(session_string: str) -> None:
    _harden_dir()
    SESSION_FILE.write_bytes(dpapi_encrypt(session_string.encode("utf-8")))


def load_session_string() -> str | None:
    if not SESSION_FILE.exists():
        return None
    try:
        return dpapi_decrypt(SESSION_FILE.read_bytes()).decode("utf-8")
    except Exception:
        return None


def has_session() -> bool:
    return SESSION_FILE.exists()


# ---------- client ----------

def build_client(session_string: str = "", proxy: dict | None = None):
    from telethon import TelegramClient, connection
    from telethon.sessions import StringSession

    api_id, api_hash = get_api_creds()
    if proxy is None:
        proxies = load_proxies()
        proxy = proxies[0] if proxies else None
    kwargs: dict = {}
    if proxy:
        if proxy["type"] == "mtproto":
            conn = (
                connection.ConnectionTcpMTProxyRandomizedIntermediate
                if proxy.get("codec") == "randomized"
                else connection.ConnectionTcpMTProxyIntermediate
            )
            kwargs["connection"] = conn
            kwargs["proxy"] = (proxy["host"], proxy["port"], proxy["key"])
        else:
            from python_socks import ProxyType

            ptype = ProxyType.SOCKS5 if proxy["type"] == "socks5" else ProxyType.HTTP
            kwargs["proxy"] = (
                ptype,
                proxy["host"],
                proxy["port"],
                True,  # rdns
                proxy.get("username") or None,
                proxy.get("password") or None,
            )
    return TelegramClient(StringSession(session_string), api_id, api_hash, **kwargs)


def _port_open(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _pid_is_xray(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=10,
        ).stdout
        return "xray.exe" in out.lower()
    except Exception:
        return False


def stop_local_socks() -> bool:
    """Погасить Xray, если он был поднят нами (по pid-файлу). Возвращает True, если погасили."""
    if not XRAY_PID.exists():
        return False
    try:
        pid = int(XRAY_PID.read_text(encoding="utf-8").strip() or "0")
    except Exception:
        pid = 0
    killed = False
    if _pid_is_xray(pid):
        flags = 0x08000000  # CREATE_NO_WINDOW
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                       capture_output=True, creationflags=flags)
        killed = True
    try:
        XRAY_PID.unlink()
    except OSError:
        pass
    return killed


def ensure_local_socks() -> tuple[str | None, bool]:
    """Если в списке есть локальный socks5 (127.0.0.1), а порт закрыт — поднять Xray.

    Возвращает (статус_строка|None, started_by_us). Порт локальный (loopback) — гасится
    отдельно (stop_local_socks / idle-watchdog в MCP).
    """
    global XRAY_STARTED_BY_US
    for p in load_proxies():
        if p["type"] == "socks5" and p["host"] in ("127.0.0.1", "localhost"):
            if _port_open(p["host"], p["port"]):
                return None, False
            if not XRAY_EXE.exists():
                return f"локальный socks5 {p['host']}:{p['port']} закрыт, xray не найден ({XRAY_EXE})", False
            flags = 0x00000008 | 0x08000000  # DETACHED_PROCESS | CREATE_NO_WINDOW
            proc = subprocess.Popen(
                [str(XRAY_EXE), "run", "-c", str(XRAY_CONF)],
                cwd=str(XRAY_DIR),
                creationflags=flags,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                XRAY_PID.write_text(str(proc.pid), encoding="utf-8")
            except OSError:
                pass
            XRAY_STARTED_BY_US = True
            for _ in range(20):
                if _port_open(p["host"], p["port"]):
                    return f"Xray поднят (pid={proc.pid}, {p['host']}:{p['port']})", True
                time.sleep(0.5)
            return f"Xray не поднялся ({p['host']}:{p['port']})", True
    return None, False


async def connect_best(session_string: str = "", interactive: bool = False):
    """Подключиться, перебирая прокси из tg_proxies.txt по порядку. Возвращает клиент."""
    ensure_local_socks()
    candidates: list[dict | None] = list(load_proxies()) or [None]
    last_err: Exception | None = None
    for pr in candidates:
        client = build_client(session_string, pr)
        try:
            await client.connect()
            if interactive or await client.is_user_authorized():
                return client
            await client.disconnect()
        except Exception as e:  # noqa: BLE001
            last_err = e
            try:
                await client.disconnect()
            except Exception:
                pass
    raise RuntimeError(f"Не удалось подключиться ни через один прокси: {last_err!r}")

