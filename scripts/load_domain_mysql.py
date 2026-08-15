# -*- coding: utf-8 -*-
"""Заливка JSON-слепка в MySQL Masterhost. С дома хост недоступен — SQL крутится PHP на timer.zaborov.ru."""
from __future__ import annotations

import ftplib
import io
import json
import secrets
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DUMP = REPO / "docs" / "планы" / "05_данные"
SCHEMA = REPO / "api" / "migrations" / "001_schema.sql"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (REPO / "secrets.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def php_str(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def ftp_connect(env: dict[str, str]) -> ftplib.FTP:
    ftp = ftplib.FTP()
    ftp.encoding = "latin-1"
    ftp.connect(env["FTP_HOST"], 21, timeout=60)
    ftp.login(env["FTP_USER"], env["FTP_PASSWORD"])
    ftp.set_pasv(True)
    return ftp


def ftp_makedirs(ftp: ftplib.FTP, path: str) -> None:
    parts = path.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            ftp.mkd(cur)
        except Exception:
            pass


def ftp_put(ftp: ftplib.FTP, remote: str, data: bytes) -> None:
    ftp.storbinary("STOR " + remote, io.BytesIO(data))
    print("STOR", remote, len(data))


def main() -> int:
    env = load_env()
    token = secrets.token_hex(16)
    dump_map = {
        "people.json": DUMP / "люди.json",
        "situations.json": DUMP / "ситуации.json",
        "events.json": DUMP / "мероприятия.json",
        "duels.json": DUMP / "поединки.json",
        "judges.json": DUMP / "судьи.json",
        "organizers.json": DUMP / "участияВОрганизации.json",
        "videos.json": DUMP / "видео.json",
        "circles.json": DUMP / "круги.json",
        "memberships.json": DUMP / "членстваВКруге.json",
        "observers.json": DUMP / "наблюдатели.json",
        "registrations.json": DUMP / "регистрации.json",
        "protocol_events.json": DUMP / "событияПротокола.json",
        "change_log.json": DUMP / "журналИзмененияПоединка.json",
    }
    for src in dump_map.values():
        if not src.is_file():
            print("нет файла", src)
            return 1

    org_pw = env.get("PORTAL_ORG_PASSWORD", "")
    db_inc = (
        "<?php\n"
        "$mysql_host = " + php_str(env["MYSQL_HOST"]) + ";\n"
        "$mysql_user = " + php_str(env["MYSQL_USER"]) + ";\n"
        "$mysql_password = " + php_str(env["MYSQL_PASSWORD"]) + ";\n"
        "$mysql_database = " + php_str(env["MYSQL_DATABASE"]) + ";\n"
        "$portal_org_password = " + php_str(org_pw) + ";\n"
    ).encode("utf-8")

    schema = SCHEMA.read_text(encoding="utf-8")
    php = _importer_php(token)

    ftp = ftp_connect(env)
    ftp_makedirs(ftp, "/timer.zaborov.ru/import")
    ftp_put(ftp, "/timer.zaborov.ru/db.inc.php", db_inc)
    ftp_put(ftp, "/ciocdo-org-skills.zaborov.ru/db.inc.php", db_inc)
    ftp_put(ftp, "/timer.zaborov.ru/import/001_schema.sql", schema.encode("utf-8"))
    for remote_name, src in dump_map.items():
        ftp_put(ftp, "/timer.zaborov.ru/import/" + remote_name, src.read_bytes())
    fname = "_tmp_load_" + token[:8] + ".php"
    ftp_put(ftp, "/timer.zaborov.ru/www/" + fname, php.encode("utf-8"))
    ftp.quit()

    url = "https://timer.zaborov.ru/" + fname + "?k=" + token
    print("GET", url.split("?")[0], "+token")
    body = ""
    try:
        with urllib.request.urlopen(url, timeout=120) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = (e.read() or b"").decode("utf-8", errors="replace")
        print("HTTP", e.code)
    except Exception as e:
        print(type(e).__name__, e)

    print(body[:3000])
    if len(body) > 3000:
        print("...\n")
        print(body[-2000:])

    ftp = ftp_connect(env)
    try:
        ftp.delete("/timer.zaborov.ru/www/" + fname)
        print("deleted", fname)
    except Exception as e:
        print("delete importer", e)
    ftp.quit()
    return 0 if "LOAD_OK" in body else 1


def _importer_php(token: str) -> str:
    return f"""<?php
error_reporting(E_ALL);
ini_set('display_errors', '1');
ini_set('memory_limit', '128M');
header('Content-Type: text/plain; charset=utf-8');
if (!isset($_GET['k']) || $_GET['k'] !== {php_str(token)}) {{
    header('HTTP/1.1 403 Forbidden');
    echo 'forbidden';
    exit;
}}
$cfg = dirname(__FILE__) . '/../db.inc.php';
if (!is_file($cfg)) {{
    echo "NO_CFG $cfg\\n";
    exit;
}}
require $cfg;
$link = mysql_connect($mysql_host, $mysql_user, $mysql_password);
if (!$link) {{
    echo 'CONNECT ' . mysql_error() . "\\n";
    exit;
}}
if (!mysql_select_db($mysql_database, $link)) {{
    echo 'SELECT_DB ' . mysql_error() . "\\n";
    exit;
}}
mysql_query("SET NAMES utf8mb4", $link);
mysql_query("SET FOREIGN_KEY_CHECKS=0", $link);

function q($sql) {{
    global $link;
    $r = mysql_query($sql, $link);
    if (!$r) {{
        echo 'SQL_ERR ' . mysql_error() . "\\n" . substr($sql, 0, 240) . "\\n";
        return false;
    }}
    return $r;
}}
function s($v) {{
    global $link;
    if ($v === null) return 'NULL';
    if (is_bool($v)) return $v ? '1' : '0';
    if (is_int($v) || is_float($v)) return (string)$v;
    if (is_array($v)) $v = json_encode($v);
    return "'" . mysql_real_escape_string((string)$v, $link) . "'";
}}
function loadj($name) {{
    $path = dirname(__FILE__) . '/../import/' . $name;
    $raw = file_get_contents($path);
    if ($raw === false) {{ echo "NO_FILE $name\\n"; return array(); }}
    $data = json_decode($raw, true);
    if (!is_array($data)) {{ echo "JSON_FAIL $name\\n"; return array(); }}
    return $data;
}}
function run_schema_file($path) {{
    $text = file_get_contents($path);
    if ($text === false) {{ echo "NO_SCHEMA $path\\n"; return false; }}
    $buf = '';
    $n = 0;
    foreach (explode("\\n", $text) as $line) {{
        $trim = trim($line);
        if ($trim === '' || strpos($trim, '--') === 0) continue;
        $buf .= $line . "\\n";
        if (substr($trim, -1) === ';') {{
            if (!q($buf)) return false;
            $n++;
            $buf = '';
        }}
    }}
    echo "schema_stmts=$n\\n";
    return true;
}}

if (!run_schema_file(dirname(__FILE__) . '/../import/001_schema.sql')) {{ echo "SCHEMA_FAIL\\n"; exit; }}
mysql_query("SET FOREIGN_KEY_CHECKS=0", $link);

$n = 0;
foreach (loadj('people.json') as $p) {{
    $ok = q("INSERT INTO people (id, full_name, email, telegram, is_active, notes) VALUES (" .
        s($p['id']) . "," . s($p['ФИО']) . "," . s($p['email']) . "," . s($p['telegram']) . "," .
        s(!empty($p['активен'])) . "," . s($p['заметки']) . ")");
    if ($ok) $n++;
}}
echo "people=$n\\n";

$n = 0;
foreach (loadj('circles.json') as $p) {{
    $ok = q("INSERT INTO circles (id, title) VALUES (" . s($p['id']) . "," . s($p['название']) . ")");
    if ($ok) $n++;
}}
echo "circles=$n\\n";

$n = 0;
foreach (loadj('memberships.json') as $p) {{
    $ok = q("INSERT INTO circle_memberships (id, circle_id, person_id, involvement) VALUES (" .
        s($p['id']) . "," . s($p['кругId']) . "," . s($p['idУчастника']) . "," . s($p['степеньВовлечения']) . ")");
    if ($ok) $n++;
}}
echo "memberships=$n\\n";

$n = 0;
foreach (loadj('situations.json') as $p) {{
    $ok = q("INSERT INTO situations (id, code, num, duel_type, description, roles_json, is_published) VALUES (" .
        s($p['id']) . "," . s($p['код']) . "," . s($p['номер']) . "," . s($p['тип']) . "," .
        s($p['описание']) . "," . s($p['роли']) . "," . s(!empty($p['опубликована'])) . ")");
    if ($ok) $n++;
}}
echo "situations=$n\\n";

$n = 0;
foreach (loadj('events.json') as $p) {{
    $slug = isset($p['ярлык']) && $p['ярлык'] !== '' ? $p['ярлык'] : null;
    $ok = q("INSERT INTO events (id, slug, title, event_type, starts_on, ends_on, starts_at, ends_at, status, zoom_url, referee_person_id) VALUES (" .
        s($p['id']) . "," . s($slug) . "," . s($p['название']) . "," . s($p['тип']) . "," .
        s($p['датаНачала']) . "," . s($p['датаОкончания']) . "," .
        s(isset($p['времяНачала']) ? $p['времяНачала'] : null) . "," .
        s(isset($p['времяОкончания']) ? $p['времяОкончания'] : null) . "," .
        s($p['статус']) . "," .
        s(isset($p['ссылкаZoom']) ? $p['ссылкаZoom'] : null) . "," . s($p['арбитрId']) . ")");
    if ($ok) $n++;
}}
echo "events=$n\\n";

$n = 0;
foreach (loadj('organizers.json') as $p) {{
    $ok = q("INSERT INTO event_organizers (id, event_id, person_id, role) VALUES (" .
        s($p['id']) . "," . s($p['мероприятиеId']) . "," . s($p['idУчастника']) . "," . s($p['роль']) . ")");
    if ($ok) $n++;
}}
echo "organizers=$n\\n";

$n = 0;
foreach (loadj('observers.json') as $p) {{
    $ok = q("INSERT INTO event_observers (id, event_id, person_id) VALUES (" .
        s($p['id']) . "," . s($p['мероприятиеId']) . "," . s($p['idУчастника']) . ")");
    if ($ok) $n++;
}}
echo "observers=$n\\n";

$n = 0;
foreach (loadj('registrations.json') as $p) {{
    $ok = q("INSERT INTO meeting_registrations (id, event_id, person_id, full_name, email, telegram, wants_play, wants_judge, wants_second, comment, source) VALUES (" .
        s($p['id']) . "," . s($p['мероприятиеId']) . "," . s($p['idУчастника']) . "," . s($p['участникФИО']) . "," .
        s($p['email']) . "," . s($p['telegram']) . "," . s(!empty($p['хочетИграть'])) . "," .
        s(!empty($p['хочетСудить'])) . "," . s(!empty($p['хочетБытьСекундантом'])) . "," .
        s($p['комментарий']) . "," . s($p['источник']) . ")");
    if ($ok) $n++;
}}
echo "registrations=$n\\n";

$n = 0;
foreach (loadj('duels.json') as $p) {{
    $ok = q("INSERT INTO duels (id, event_id, sort_order, duel_date, duel_type, prep_mode, round_minutes, situation_id, player1_id, second1_id, player2_id, second2_id, referee_qty, notes) VALUES (" .
        s($p['id']) . "," . s($p['мероприятиеId']) . "," . s($p['порядок']) . "," . s($p['дата']) . "," .
        s($p['тип']) . "," . s($p['режимПодготовки']) . "," . s($p['длительностьРаундаМин']) . "," .
        s($p['ситуацияId']) . "," . s($p['игрок1Id']) . "," . s($p['секундантИлиВторойИгрок1Id']) . "," .
        s($p['игрок2Id']) . "," . s($p['секундантИлиВторойИгрок2Id']) . "," . s($p['количествоСудей']) . "," .
        s($p['заметки']) . ")");
    if ($ok) $n++;
}}
echo "duels=$n\\n";

$n = 0;
foreach (loadj('judges.json') as $p) {{
    $ok = q("INSERT INTO duel_judges (id, duel_id, person_id, college, vote) VALUES (" .
        s($p['id']) . "," . s($p['поединокId']) . "," . s($p['idУчастника']) . "," .
        s($p['коллегия']) . "," . s($p['голос']) . ")");
    if ($ok) $n++;
}}
echo "judges=$n\\n";

$n = 0;
foreach (loadj('videos.json') as $p) {{
    $ok = q("INSERT INTO videos (id, event_id, duel_id, url, video_date, title, video_type) VALUES (" .
        s($p['id']) . "," . s($p['мероприятиеId']) . "," . s($p['поединокId']) . "," . s($p['ссылка']) . "," .
        s($p['дата']) . "," . s($p['название']) . "," . s($p['тип']) . ")");
    if ($ok) $n++;
}}
echo "videos=$n\\n";

$n = 0;
foreach (loadj('protocol_events.json') as $p) {{
    $ok = q("INSERT INTO protocol_events (id, duel_id, seq_num, moment_sec, event_type, payload_json) VALUES (" .
        s($p['id']) . "," . s($p['поединокId']) . "," . s($p['порядковыйНомер']) . "," . s($p['моментСек']) . "," .
        s($p['типСобытия']) . "," . s($p['данные']) . ")");
    if ($ok) $n++;
}}
echo "protocol_events=$n\\n";

$n = 0;
foreach (loadj('change_log.json') as $p) {{
    $ok = q("INSERT INTO duel_change_log (id, duel_id, changed_at, field_name, old_value, new_value, author_id) VALUES (" .
        s($p['id']) . "," . s($p['поединокId']) . "," . s($p['момент']) . "," . s($p['поле']) . "," .
        s($p['староеЗначение']) . "," . s($p['новоеЗначение']) . "," . s($p['авторId']) . ")");
    if ($ok) $n++;
}}
echo "change_log=$n\\n";

mysql_query("SET FOREIGN_KEY_CHECKS=1", $link);
$tables = array('people','situations','events','duels','duel_judges','event_organizers','videos','circles','circle_memberships','event_observers','meeting_registrations','protocol_events','duel_change_log');
echo "--- counts ---\\n";
foreach ($tables as $t) {{
    $r = mysql_query("SELECT COUNT(*) FROM `$t`", $link);
    $row = mysql_fetch_row($r);
    echo "$t=" . $row[0] . "\\n";
}}
echo "LOAD_OK\\n";
"""


if __name__ == "__main__":
    raise SystemExit(main())
