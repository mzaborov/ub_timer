# -*- coding: utf-8 -*-
"""Поставить утренний бэкап MySQL в crontab Masterhost (SSH).

Не затирает чужие строки crontab — только блок # ubtimer-backup.
Секреты: SSH_* в secrets.env (тот же аккаунт, что «Поступи в МАИ»).
"""
from __future__ import annotations

import stat
import sys
from pathlib import Path

import paramiko

REPO = Path(__file__).resolve().parents[1]
MAI = Path(r"C:\Projects\Поступи в МАИ")
SH_LOCAL = REPO / "scripts" / "server" / "backup_mysql.sh"
MARKER = "# ubtimer-backup"
CRON_LINE = "0 7 * * * /bin/bash $HOME/ubtimer-cron/backup_mysql.sh\n"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def ssh_env() -> dict[str, str]:
    env = load_env(REPO / "secrets.env")
    if env.get("SSH_USER") and env.get("SSH_PASSWORD"):
        return env
    extra = load_env(MAI / "secrets.env")
    for k in ("SSH_HOST", "SSH_USER", "SSH_PASSWORD", "SSH_PORT"):
        if extra.get(k) and not env.get(k):
            env[k] = extra[k]
    return env


def merge_crontab(existing: str) -> str:
    lines = existing.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    skip = False
    for line in lines:
        if line.strip() == MARKER:
            skip = True
            continue
        if skip:
            if line.strip().startswith("#") and "ubtimer" not in line:
                skip = False
            elif line.strip() == "" or "ubtimer-cron" in line or "backup_mysql" in line:
                continue
            else:
                skip = False
        if not skip:
            out.append(line)
    while out and out[-1] == "":
        out.pop()
    block = MARKER + "\n" + CRON_LINE
    text = "\n".join(out).rstrip() + "\n\n" + block
    if not text.endswith("\n"):
        text += "\n"
    return text


def main() -> int:
    env = ssh_env()
    if not env.get("SSH_USER") or not env.get("SSH_PASSWORD"):
        print("Нет SSH_USER / SSH_PASSWORD в secrets.env")
        return 1
    if not SH_LOCAL.is_file():
        print("нет", SH_LOCAL)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        env.get("SSH_HOST", "u10190.ssh.masterhost.ru"),
        port=int(env.get("SSH_PORT", "22")),
        username=env["SSH_USER"],
        password=env["SSH_PASSWORD"],
        timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )
    print("SSH OK")

    def run(cmd: str, timeout: int = 60) -> tuple[int, str, str]:
        _i, o, e = client.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        return o.channel.recv_exit_status(), out, err

    sftp = client.open_sftp()
    try:
        sftp.mkdir("ubtimer-cron")
    except OSError:
        pass
    remote_sh = "ubtimer-cron/backup_mysql.sh"
    with sftp.file(remote_sh, "w") as f:
        f.write(SH_LOCAL.read_text(encoding="utf-8"))
    sftp.chmod(remote_sh, stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)

    code, old, err = run("crontab -l 2>/dev/null || true")
    merged = merge_crontab(old)
    tmp = "/tmp/ubtimer_crontab.txt"
    with sftp.file(tmp, "w") as f:
        f.write(merged)
    sftp.close()

    code, out, err = run(f"crontab {tmp} && rm -f {tmp} && echo INSTALLED && crontab -l")
    print(out)
    if err.strip() and "no crontab" not in err.lower():
        print("ERR:", err[:400])
    if code != 0:
        print("fail", code)
        client.close()
        return 1
    client.close()
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
