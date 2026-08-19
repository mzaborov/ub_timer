# -*- coding: utf-8 -*-
"""Заливка JSON-слепка в MySQL Masterhost. С дома хост недоступен — SQL крутится PHP на timer.zaborov.ru.

Режимы:
  (по умолчанию) upsert — INSERT новых строк, UPDATE существующих по PRIMARY KEY.
    DROP / TRUNCATE таблиц нет. Пустой JSON не затирает живые строки.
    meeting_registrations никогда не удаляется и не обнуляется.
  Первая установка (таблиц нет) — сам прогоняет 001_schema.sql, флаг не нужен.
  --fresh — опасная пересборка: 001_schema.sql (DROP+CREATE), затем заливка.
    Заявки портала перед DROP копируются и возвращаются (если нет --wipe-registrations).
  --fresh --wipe-registrations — полный снос, включая meeting_registrations.
  --probe — только чтение: таблицы и счётчики, без записи.
  --export-registrations — выгрузить живые заявки в docs/планы/05_данные/регистрации.json.
  --only people,circles,memberships,videos,duels — upsert только этих таблиц.
    --fresh с --only запрещён. --memberships-min-id N — членства только с id >= N (не трогает старые строки).

Схема: 001_schema.sql только для пустой БД / --fresh. На живой БД — аддитивные ALTER
(добавить недостающую колонку), не drop-and-recreate.
"""
from __future__ import annotations

import argparse
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
REGISTRATIONS_JSON = DUMP / "регистрации.json"


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


def _php_preamble(token: str) -> str:
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
function table_exists($name) {{
    $r = q("SHOW TABLES LIKE " . s($name));
    return $r && mysql_num_rows($r) > 0;
}}
"""


def run_remote_php(env: dict[str, str], php: str, token: str, extra_puts: list[tuple[str, bytes]] | None = None) -> str:
    ftp = ftp_connect(env)
    ftp_makedirs(ftp, "/timer.zaborov.ru/import")
    if extra_puts:
        for remote, data in extra_puts:
            ftp_put(ftp, remote, data)
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
    return body


def dump_map() -> dict[str, Path]:
    return {
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


MATERIAL_DOCS_DDL = """CREATE TABLE material_docs (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(191) NOT NULL,
  body_md MEDIUMTEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mat_slug (slug),
  KEY idx_mat_sort (sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"""


def write_db_inc(env: dict[str, str]) -> bytes:
    org_pw = env.get("PORTAL_ORG_PASSWORD", "")
    llm_key = env.get("QWEN_API_KEY", "")
    llm_prov = env.get("LLM_PROVIDER", "") or "openrouter"
    llm_model = env.get("QWEN_MODEL", "") or "qwen/qwen-plus"
    return (
        "<?php\n"
        "$mysql_host = " + php_str(env["MYSQL_HOST"]) + ";\n"
        "$mysql_user = " + php_str(env["MYSQL_USER"]) + ";\n"
        "$mysql_password = " + php_str(env["MYSQL_PASSWORD"]) + ";\n"
        "$mysql_database = " + php_str(env["MYSQL_DATABASE"]) + ";\n"
        "$portal_org_password = " + php_str(org_pw) + ";\n"
        "$qwen_api_key = " + php_str(llm_key) + ";\n"
        "$llm_provider = " + php_str(llm_prov) + ";\n"
        "$qwen_model = " + php_str(llm_model) + ";\n"
    ).encode("utf-8")


def run_schema_only(env: dict[str, str]) -> int:
    """Аддитивная схема + обновить db.inc.php. Без upsert данных и без DROP."""
    token = secrets.token_hex(16)
    db_inc = write_db_inc(env)
    extra = [
        ("/timer.zaborov.ru/db.inc.php", db_inc),
        ("/ciocdo-org-skills.zaborov.ru/db.inc.php", db_inc),
    ]
    php = _php_preamble(token) + f"""
function col_exists($table, $col) {{
    $r = q("SHOW COLUMNS FROM `$table` LIKE " . s($col));
    return $r && mysql_num_rows($r) > 0;
}}
function ensure_col($table, $col, $ddl) {{
    if (!table_exists($table)) {{
        echo "ALTER_SKIP no_table $table\\n";
        return false;
    }}
    if (col_exists($table, $col)) return true;
    if (q("ALTER TABLE `$table` ADD COLUMN $ddl")) {{
        echo "ALTER $table ADD $col\\n";
        return true;
    }}
    return false;
}}
function ensure_table($name, $sql) {{
    if (table_exists($name)) {{
        echo "TABLE_OK $name\\n";
        return true;
    }}
    if (q($sql)) {{
        echo "CREATE TABLE $name\\n";
        return true;
    }}
    return false;
}}
ensure_table('material_docs', {php_str(MATERIAL_DOCS_DDL)});
echo "SCHEMA_OK\\n";
"""
    body = run_remote_php(env, php, token, extra_puts=extra)
    return 0 if "SCHEMA_OK" in body else 1


def run_probe(env: dict[str, str]) -> int:
    token = secrets.token_hex(16)
    php = _php_preamble(token) + """
$tables = array('people','situations','events','duels','duel_judges','event_organizers','videos','circles','circle_memberships','event_observers','meeting_registrations','protocol_events','duel_change_log','material_docs');
echo "mode=probe\\n";
echo "--- tables ---\\n";
foreach ($tables as $t) {
    if (!table_exists($t)) { echo "$t=MISSING\\n"; continue; }
    $r = mysql_query("SELECT COUNT(*) FROM `$t`", $link);
    $row = mysql_fetch_row($r);
    echo "$t=" . $row[0] . "\\n";
}
if (table_exists('meeting_registrations')) {
    echo "--- registrations ---\\n";
    $r = mysql_query("SELECT id, event_id, person_id, full_name FROM meeting_registrations ORDER BY id", $link);
    while ($row = mysql_fetch_assoc($r)) {
        echo $row['id'] . "\\tevent=" . $row['event_id'] . "\\tperson=" . $row['person_id'] . "\\t" . $row['full_name'] . "\\n";
    }
}
echo "--- max_id ---\\n";
foreach (array('people','circles','circle_memberships') as $t) {
    if (!table_exists($t)) { echo "$t" . "_max=MISSING\\n"; continue; }
    $r = mysql_query("SELECT IFNULL(MAX(id),0) FROM `$t`", $link);
    $row = mysql_fetch_row($r);
    echo $t . "_max=" . $row[0] . "\\n";
}
echo "PROBE_OK\\n";
"""
    body = run_remote_php(env, php, token)
    return 0 if "PROBE_OK" in body else 1


def export_registrations_from_mysql(env: dict[str, str]) -> list | None:
    """Живые meeting_registrations → список канона. None, если прочитать не удалось."""
    token = secrets.token_hex(16)
    php = _php_preamble(token) + """
if (!table_exists('meeting_registrations')) {
    echo "NO_TABLE meeting_registrations\\n";
    exit;
}
$r = mysql_query("SELECT id, event_id, person_id, full_name, email, telegram, wants_play, wants_judge, wants_second, comment, source FROM meeting_registrations ORDER BY id", $link);
if (!$r) {
    echo "SQL_ERR " . mysql_error() . "\\n";
    exit;
}
$out = array();
while ($row = mysql_fetch_assoc($r)) {
    $out[] = array(
        'id' => (int)$row['id'],
        'мероприятиеId' => (int)$row['event_id'],
        'idУчастника' => ($row['person_id'] === null || $row['person_id'] === '') ? null : (int)$row['person_id'],
        'участникФИО' => $row['full_name'],
        'email' => $row['email'],
        'telegram' => $row['telegram'],
        'хочетИграть' => !empty($row['wants_play']),
        'хочетСудить' => !empty($row['wants_judge']),
        'хочетБытьСекундантом' => !empty($row['wants_second']),
        'комментарий' => $row['comment'],
        'источник' => $row['source'],
    );
}
echo "EXPORT_OK\\n";
echo json_encode($out);
"""
    body = run_remote_php(env, php, token)
    marker = "EXPORT_OK\n"
    idx = body.find(marker)
    if idx < 0:
        return None
    raw = body[idx + len(marker) :].strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        print("export JSON_FAIL")
        return None
    if not isinstance(data, list):
        return None
    return data


def write_registrations_json(rows: list) -> None:
    REGISTRATIONS_JSON.parent.mkdir(parents=True, exist_ok=True)
    REGISTRATIONS_JSON.write_text(
        json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("wrote", REGISTRATIONS_JSON, "n=", len(rows))


ONLY_ALIASES = {
    "people": "people.json",
    "circles": "circles.json",
    "memberships": "memberships.json",
    "videos": "videos.json",
    "duels": "duels.json",
}


def parse_only(raw: str | None) -> set[str] | None:
    if not raw:
        return None
    out: set[str] = set()
    for part in raw.split(","):
        name = part.strip().lower()
        if not name:
            continue
        if name not in ONLY_ALIASES:
            raise ValueError(
                "неизвестный --only %s (можно: %s)" % (name, ",".join(sorted(ONLY_ALIASES)))
            )
        out.add(name)
    return out or None


def run_load(
    env: dict[str, str],
    *,
    fresh: bool,
    wipe_registrations: bool,
    only: set[str] | None = None,
    memberships_min_id: int = 0,
) -> int:
    token = secrets.token_hex(16)
    files = dump_map()
    if only:
        files = {ONLY_ALIASES[name]: files[ONLY_ALIASES[name]] for name in sorted(only)}
    for src in files.values():
        if not src.is_file():
            print("нет файла", src)
            return 1

    db_inc = write_db_inc(env)
    extra = [("/timer.zaborov.ru/db.inc.php", db_inc)]
    if only:
        php = _importer_php_only(token, only=only, memberships_min_id=memberships_min_id)
    else:
        schema = SCHEMA.read_text(encoding="utf-8")
        php = _importer_php(token, fresh=fresh, wipe_registrations=wipe_registrations)
        extra.extend(
            [
                ("/ciocdo-org-skills.zaborov.ru/db.inc.php", db_inc),
                ("/timer.zaborov.ru/import/001_schema.sql", schema.encode("utf-8")),
            ]
        )
    for remote_name, src in files.items():
        extra.append(("/timer.zaborov.ru/import/" + remote_name, src.read_bytes()))

    body = run_remote_php(env, php, token, extra_puts=extra)
    return 0 if "LOAD_OK" in body else 1


def _importer_php_only(token: str, *, only: set[str], memberships_min_id: int) -> str:
    """Upsert выбранных таблиц. Без DROP."""
    want_people = "true" if "people" in only else "false"
    want_circles = "true" if "circles" in only else "false"
    want_mems = "true" if "memberships" in only else "false"
    want_videos = "true" if "videos" in only else "false"
    want_duels = "true" if "duels" in only else "false"
    return _php_preamble(token) + f"""
$want_people = {want_people};
$want_circles = {want_circles};
$want_mems = {want_mems};
$want_videos = {want_videos};
$want_duels = {want_duels};
$memberships_min_id = {int(memberships_min_id)};

function loadj($name) {{
    $path = dirname(__FILE__) . '/../import/' . $name;
    $raw = file_get_contents($path);
    if ($raw === false) {{ echo "NO_FILE $name\\n"; return array(); }}
    $data = json_decode($raw, true);
    if (!is_array($data)) {{ echo "JSON_FAIL $name\\n"; return array(); }}
    return $data;
}}
function upsert($table, $cols, $vals) {{
    $set = array();
    foreach ($cols as $c) {{
        if ($c === 'id') continue;
        $set[] = "`$c`=VALUES(`$c`)";
    }}
    $sql = "INSERT INTO `$table` (`" . implode("`,`", $cols) . "`) VALUES (" . implode(",", $vals) . ")";
    if ($set) $sql .= " ON DUPLICATE KEY UPDATE " . implode(",", $set);
    return q($sql);
}}
function bump_ai($table) {{
    if (!table_exists($table)) return;
    $r = mysql_query("SELECT IFNULL(MAX(id),0)+1 FROM `$table`", $GLOBALS['link']);
    if (!$r) return;
    $row = mysql_fetch_row($r);
    $n = (int)$row[0];
    if ($n < 1) $n = 1;
    q("ALTER TABLE `$table` AUTO_INCREMENT=" . $n);
}}

echo "mode=upsert_only\\n";
mysql_query("SET FOREIGN_KEY_CHECKS=0", $link);

if ($want_people) {{
    $n = 0;
    foreach (loadj('people.json') as $p) {{
        $ok = upsert('people', array('id','full_name','email','telegram','is_active','notes'), array(
            s($p['id']), s($p['ФИО']), s($p['email']), s($p['telegram']),
            s(!empty($p['активен'])), s($p['заметки'])));
        if ($ok) $n++;
    }}
    echo "people=$n\\n";
    bump_ai('people');
}}
if ($want_circles) {{
    $n = 0;
    foreach (loadj('circles.json') as $p) {{
        $ok = upsert('circles', array('id','title'), array(s($p['id']), s($p['название'])));
        if ($ok) $n++;
    }}
    echo "circles=$n\\n";
    bump_ai('circles');
}}
if ($want_mems) {{
    $n = 0;
    $skipped = 0;
    foreach (loadj('memberships.json') as $p) {{
        $id = (int)$p['id'];
        if ($id < $memberships_min_id) {{ $skipped++; continue; }}
        $ok = upsert('circle_memberships', array('id','circle_id','person_id','involvement'), array(
            s($p['id']), s($p['кругId']), s($p['idУчастника']), s($p['степеньВовлечения'])));
        if ($ok) $n++;
    }}
    echo "memberships=$n\\n";
    echo "memberships_skipped_old=$skipped\\n";
    bump_ai('circle_memberships');
}}
if ($want_videos) {{
    $n = 0;
    foreach (loadj('videos.json') as $p) {{
        $ok = upsert('videos', array('id','event_id','duel_id','situation_id','url','video_date','title','video_type'), array(
            s($p['id']),
            s(isset($p['мероприятиеId']) ? $p['мероприятиеId'] : null),
            s(isset($p['поединокId']) ? $p['поединокId'] : null),
            s(isset($p['ситуацияId']) ? $p['ситуацияId'] : null), s($p['ссылка']),
            s(isset($p['дата']) ? $p['дата'] : null), s(isset($p['название']) ? $p['название'] : null),
            s($p['тип'])));
        if ($ok) $n++;
    }}
    echo "videos=$n\\n";
    bump_ai('videos');
}}
if ($want_duels) {{
    $n = 0;
    foreach (loadj('duels.json') as $p) {{
        $ok = upsert('duels', array('id','event_id','sort_order','duel_date','duel_type','prep_mode','round_minutes','situation_id','player1_id','second1_id','player2_id','second2_id','referee_qty','notes'), array(
            s($p['id']), s($p['мероприятиеId']), s($p['порядок']), s($p['дата']),
            s($p['тип']), s($p['режимПодготовки']), s($p['длительностьРаундаМин']),
            s($p['ситуацияId']), s($p['игрок1Id']), s($p['секундантИлиВторойИгрок1Id']),
            s($p['игрок2Id']), s($p['секундантИлиВторойИгрок2Id']), s($p['количествоСудей']),
            s($p['заметки'])));
        if ($ok) $n++;
    }}
    echo "duels=$n\\n";
    bump_ai('duels');
}}

mysql_query("SET FOREIGN_KEY_CHECKS=1", $link);
$tables = array('people','circles','circle_memberships','videos','duels');
echo "--- counts ---\\n";
foreach ($tables as $t) {{
    $r = mysql_query("SELECT COUNT(*) FROM `$t`", $link);
    $row = mysql_fetch_row($r);
    echo "$t=" . $row[0] . "\\n";
}}
echo "LOAD_OK\\n";
"""


def _importer_php(token: str, *, fresh: bool, wipe_registrations: bool) -> str:
    fresh_php = "true" if fresh else "false"
    wipe_php = "true" if wipe_registrations else "false"
    return _php_preamble(token) + f"""
$fresh = {fresh_php};
$wipe_registrations = {wipe_php};

function loadj($name) {{
    $path = dirname(__FILE__) . '/../import/' . $name;
    $raw = file_get_contents($path);
    if ($raw === false) {{ echo "NO_FILE $name\\n"; return array(); }}
    $data = json_decode($raw, true);
    if (!is_array($data)) {{ echo "JSON_FAIL $name\\n"; return array(); }}
    return $data;
}}
function col_exists($table, $col) {{
    $r = q("SHOW COLUMNS FROM `$table` LIKE " . s($col));
    return $r && mysql_num_rows($r) > 0;
}}
function ensure_col($table, $col, $ddl) {{
    if (!table_exists($table)) {{
        echo "ALTER_SKIP no_table $table\\n";
        return false;
    }}
    if (col_exists($table, $col)) return true;
    if (q("ALTER TABLE `$table` ADD COLUMN $ddl")) {{
        echo "ALTER $table ADD $col\\n";
        return true;
    }}
    return false;
}}
function ensure_table($name, $sql) {{
    if (table_exists($name)) return true;
    if (q($sql)) {{
        echo "CREATE TABLE $name\\n";
        return true;
    }}
    return false;
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
function upsert($table, $cols, $vals) {{
    $set = array();
    foreach ($cols as $c) {{
        if ($c === 'id') continue;
        $set[] = "`$c`=VALUES(`$c`)";
    }}
    $sql = "INSERT INTO `$table` (`" . implode("`,`", $cols) . "`) VALUES (" . implode(",", $vals) . ")";
    if ($set) $sql .= " ON DUPLICATE KEY UPDATE " . implode(",", $set);
    return q($sql);
}}
function bump_ai($table) {{
    if (!table_exists($table)) return;
    $r = mysql_query("SELECT IFNULL(MAX(id),0)+1 FROM `$table`", $GLOBALS['link']);
    if (!$r) return;
    $row = mysql_fetch_row($r);
    $n = (int)$row[0];
    if ($n < 1) $n = 1;
    q("ALTER TABLE `$table` AUTO_INCREMENT=" . $n);
}}
function fetch_registrations() {{
    $saved = array();
    if (!table_exists('meeting_registrations')) return $saved;
    $r = mysql_query("SELECT id, event_id, person_id, full_name, email, telegram, wants_play, wants_judge, wants_second, comment, source FROM meeting_registrations ORDER BY id", $GLOBALS['link']);
    if (!$r) return $saved;
    while ($row = mysql_fetch_assoc($r)) $saved[] = $row;
    return $saved;
}}
function upsert_reg_row($p, $from_sql) {{
    if ($from_sql) {{
        $vals = array(
            s(isset($p['id']) ? (int)$p['id'] : null),
            s(isset($p['event_id']) ? (int)$p['event_id'] : null),
            s(isset($p['person_id']) && $p['person_id'] !== '' ? $p['person_id'] : null),
            s($p['full_name']),
            s($p['email']),
            s($p['telegram']),
            s(!empty($p['wants_play'])),
            s(!empty($p['wants_judge'])),
            s(!empty($p['wants_second'])),
            s($p['comment']),
            s($p['source']),
        );
    }} else {{
        $vals = array(
            s($p['id']),
            s($p['мероприятиеId']),
            s($p['idУчастника']),
            s($p['участникФИО']),
            s($p['email']),
            s($p['telegram']),
            s(!empty($p['хочетИграть'])),
            s(!empty($p['хочетСудить'])),
            s(!empty($p['хочетБытьСекундантом'])),
            s($p['комментарий']),
            s($p['источник']),
        );
    }}
    $cols = array('id','event_id','person_id','full_name','email','telegram','wants_play','wants_judge','wants_second','comment','source');
    return upsert('meeting_registrations', $cols, $vals);
}}
function run_additive_schema() {{
    $cols = array(
        array('people', 'email', 'email VARCHAR(191) NULL'),
        array('people', 'telegram', 'telegram VARCHAR(64) NULL'),
        array('people', 'is_active', 'is_active TINYINT(1) NOT NULL DEFAULT 1'),
        array('people', 'notes', 'notes TEXT NULL'),
        array('situations', 'num', 'num INT NULL'),
        array('situations', 'description', 'description MEDIUMTEXT NULL'),
        array('situations', 'roles_json', 'roles_json MEDIUMTEXT NULL'),
        array('situations', 'is_published', 'is_published TINYINT(1) NOT NULL DEFAULT 1'),
        array('events', 'slug', 'slug VARCHAR(64) NULL'),
        array('events', 'starts_on', 'starts_on DATE NULL'),
        array('events', 'ends_on', 'ends_on DATE NULL'),
        array('events', 'starts_at', 'starts_at TIME NULL'),
        array('events', 'ends_at', 'ends_at TIME NULL'),
        array('events', 'zoom_url', 'zoom_url VARCHAR(1024) NULL'),
        array('events', 'referee_person_id', 'referee_person_id INT NULL'),
        array('videos', 'event_id', 'event_id INT NULL'),
        array('videos', 'duel_id', 'duel_id INT NULL'),
        array('videos', 'situation_id', 'situation_id INT NULL'),
        array('videos', 'video_date', 'video_date DATE NULL'),
        array('videos', 'title', 'title VARCHAR(255) NULL'),
        array('videos', 'video_type', 'video_type VARCHAR(32) NULL'),
        array('meeting_registrations', 'person_id', 'person_id INT NULL'),
        array('meeting_registrations', 'email', 'email VARCHAR(191) NULL'),
        array('meeting_registrations', 'telegram', 'telegram VARCHAR(64) NULL'),
        array('meeting_registrations', 'wants_play', 'wants_play TINYINT(1) NOT NULL DEFAULT 0'),
        array('meeting_registrations', 'wants_judge', 'wants_judge TINYINT(1) NOT NULL DEFAULT 0'),
        array('meeting_registrations', 'wants_second', 'wants_second TINYINT(1) NOT NULL DEFAULT 0'),
        array('meeting_registrations', 'comment', 'comment TEXT NULL'),
        array('meeting_registrations', 'source', 'source VARCHAR(64) NULL'),
        array('duels', 'duel_date', 'duel_date DATE NULL'),
        array('duels', 'situation_id', 'situation_id INT NULL'),
        array('duels', 'player1_id', 'player1_id INT NULL'),
        array('duels', 'second1_id', 'second1_id INT NULL'),
        array('duels', 'player2_id', 'player2_id INT NULL'),
        array('duels', 'second2_id', 'second2_id INT NULL'),
        array('duels', 'referee_qty', 'referee_qty INT NULL'),
        array('duels', 'notes', 'notes TEXT NULL'),
        array('duel_judges', 'person_id', 'person_id INT NULL'),
        array('duel_judges', 'college', 'college VARCHAR(64) NULL'),
        array('duel_judges', 'vote', 'vote VARCHAR(64) NULL'),
    );
    foreach ($cols as $c) ensure_col($c[0], $c[1], $c[2]);
    ensure_table('material_docs', {php_str(MATERIAL_DOCS_DDL)});
    echo "additive_schema=ok\\n";
}}

mysql_query("SET FOREIGN_KEY_CHECKS=0", $link);

$people_exists = table_exists('people');
$saved_regs = array();
if (!$people_exists) {{
    echo "mode=first_install\\n";
    if (!run_schema_file(dirname(__FILE__) . '/../import/001_schema.sql')) {{ echo "SCHEMA_FAIL\\n"; exit; }}
}} elseif ($fresh) {{
    echo "mode=fresh\\n";
    if (!$wipe_registrations) {{
        $saved_regs = fetch_registrations();
        echo "saved_registrations=" . count($saved_regs) . "\\n";
    }} else {{
        echo "wipe_registrations=1\\n";
    }}
    if (!run_schema_file(dirname(__FILE__) . '/../import/001_schema.sql')) {{ echo "SCHEMA_FAIL\\n"; exit; }}
}} else {{
    echo "mode=upsert\\n";
    run_additive_schema();
}}
mysql_query("SET FOREIGN_KEY_CHECKS=0", $link);

$n = 0;
foreach (loadj('people.json') as $p) {{
    $ok = upsert('people', array('id','full_name','email','telegram','is_active','notes'), array(
        s($p['id']), s($p['ФИО']), s($p['email']), s($p['telegram']),
        s(!empty($p['активен'])), s($p['заметки'])));
    if ($ok) $n++;
}}
echo "people=$n\\n";
bump_ai('people');

$n = 0;
foreach (loadj('circles.json') as $p) {{
    $ok = upsert('circles', array('id','title'), array(s($p['id']), s($p['название'])));
    if ($ok) $n++;
}}
echo "circles=$n\\n";
bump_ai('circles');

$n = 0;
foreach (loadj('memberships.json') as $p) {{
    $ok = upsert('circle_memberships', array('id','circle_id','person_id','involvement'), array(
        s($p['id']), s($p['кругId']), s($p['idУчастника']), s($p['степеньВовлечения'])));
    if ($ok) $n++;
}}
echo "memberships=$n\\n";
bump_ai('circle_memberships');

$n = 0;
foreach (loadj('situations.json') as $p) {{
    $ok = upsert('situations', array('id','code','num','duel_type','description','roles_json','is_published'), array(
        s($p['id']), s($p['код']), s($p['номер']), s($p['тип']),
        s($p['описание']), s($p['роли']), s(!empty($p['опубликована']))));
    if ($ok) $n++;
}}
echo "situations=$n\\n";
bump_ai('situations');

$n = 0;
foreach (loadj('events.json') as $p) {{
    $slug = isset($p['ярлык']) && $p['ярлык'] !== '' ? $p['ярлык'] : null;
    $ok = upsert('events', array('id','slug','title','event_type','starts_on','ends_on','starts_at','ends_at','status','zoom_url','referee_person_id'), array(
        s($p['id']), s($slug), s($p['название']), s($p['тип']),
        s($p['датаНачала']), s($p['датаОкончания']),
        s(isset($p['времяНачала']) ? $p['времяНачала'] : null),
        s(isset($p['времяОкончания']) ? $p['времяОкончания'] : null),
        s($p['статус']),
        s(isset($p['ссылкаZoom']) ? $p['ссылкаZoom'] : null), s($p['арбитрId'])));
    if ($ok) $n++;
}}
echo "events=$n\\n";
bump_ai('events');

$n = 0;
foreach (loadj('organizers.json') as $p) {{
    $ok = upsert('event_organizers', array('id','event_id','person_id','role'), array(
        s($p['id']), s($p['мероприятиеId']), s($p['idУчастника']), s($p['роль'])));
    if ($ok) $n++;
}}
echo "organizers=$n\\n";
bump_ai('event_organizers');

$n = 0;
foreach (loadj('observers.json') as $p) {{
    $ok = upsert('event_observers', array('id','event_id','person_id'), array(
        s($p['id']), s($p['мероприятиеId']), s($p['idУчастника'])));
    if ($ok) $n++;
}}
echo "observers=$n\\n";
bump_ai('event_observers');

$reg_dump = loadj('registrations.json');
$n = 0;
foreach ($reg_dump as $p) {{
    if (upsert_reg_row($p, false)) $n++;
}}
echo "registrations_dump=$n\\n";
$nrest = 0;
foreach ($saved_regs as $p) {{
    if (upsert_reg_row($p, true)) $nrest++;
}}
if ($saved_regs) echo "registrations_restored=$nrest\\n";
echo "registrations_note=no_delete\\n";
bump_ai('meeting_registrations');

$n = 0;
foreach (loadj('duels.json') as $p) {{
    $ok = upsert('duels', array('id','event_id','sort_order','duel_date','duel_type','prep_mode','round_minutes','situation_id','player1_id','second1_id','player2_id','second2_id','referee_qty','notes'), array(
        s($p['id']), s($p['мероприятиеId']), s($p['порядок']), s($p['дата']),
        s($p['тип']), s($p['режимПодготовки']), s($p['длительностьРаундаМин']),
        s($p['ситуацияId']), s($p['игрок1Id']), s($p['секундантИлиВторойИгрок1Id']),
        s($p['игрок2Id']), s($p['секундантИлиВторойИгрок2Id']), s($p['количествоСудей']),
        s($p['заметки'])));
    if ($ok) $n++;
}}
echo "duels=$n\\n";
bump_ai('duels');

$n = 0;
foreach (loadj('judges.json') as $p) {{
    $ok = upsert('duel_judges', array('id','duel_id','person_id','college','vote'), array(
        s($p['id']), s($p['поединокId']), s($p['idУчастника']),
        s($p['коллегия']), s($p['голос'])));
    if ($ok) $n++;
}}
echo "judges=$n\\n";
bump_ai('duel_judges');

$n = 0;
foreach (loadj('videos.json') as $p) {{
    $ok = upsert('videos', array('id','event_id','duel_id','situation_id','url','video_date','title','video_type'), array(
        s($p['id']),
        s(isset($p['мероприятиеId']) ? $p['мероприятиеId'] : null),
        s(isset($p['поединокId']) ? $p['поединокId'] : null),
        s(isset($p['ситуацияId']) ? $p['ситуацияId'] : null), s($p['ссылка']),
        s(isset($p['дата']) ? $p['дата'] : null), s(isset($p['название']) ? $p['название'] : null),
        s($p['тип'])));
    if ($ok) $n++;
}}
echo "videos=$n\\n";
bump_ai('videos');

$n = 0;
foreach (loadj('protocol_events.json') as $p) {{
    $ok = upsert('protocol_events', array('id','duel_id','seq_num','moment_sec','event_type','payload_json'), array(
        s($p['id']), s($p['поединокId']), s($p['порядковыйНомер']), s($p['моментСек']),
        s($p['типСобытия']), s($p['данные'])));
    if ($ok) $n++;
}}
echo "protocol_events=$n\\n";
bump_ai('protocol_events');

$n = 0;
foreach (loadj('change_log.json') as $p) {{
    $ok = upsert('duel_change_log', array('id','duel_id','changed_at','field_name','old_value','new_value','author_id'), array(
        s($p['id']), s($p['поединокId']), s($p['момент']), s($p['поле']),
        s($p['староеЗначение']), s($p['новоеЗначение']), s($p['авторId'])));
    if ($ok) $n++;
}}
echo "change_log=$n\\n";
bump_ai('duel_change_log');

mysql_query("SET FOREIGN_KEY_CHECKS=1", $link);
$tables = array('people','situations','events','duels','duel_judges','event_organizers','videos','circles','circle_memberships','event_observers','meeting_registrations','protocol_events','duel_change_log','material_docs');
echo "--- counts ---\\n";
foreach ($tables as $t) {{
    $r = mysql_query("SELECT COUNT(*) FROM `$t`", $link);
    $row = mysql_fetch_row($r);
    echo "$t=" . $row[0] . "\\n";
}}
echo "LOAD_OK\\n";
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Заливка доменного слепка в MySQL: по умолчанию upsert, без DROP."
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="DROP+CREATE из 001_schema.sql, затем заливка. Заявки портала сохраняются, если нет --wipe-registrations.",
    )
    parser.add_argument(
        "--wipe-registrations",
        action="store_true",
        help="Только с --fresh: дропнуть и meeting_registrations.",
    )
    parser.add_argument(
        "--probe",
        action="store_true",
        help="Только чтение: наличие таблиц и счётчики, без записи.",
    )
    parser.add_argument(
        "--export-registrations",
        action="store_true",
        help="Выгрузить живые meeting_registrations в регистрации.json.",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="Только эти таблицы через запятую: people,circles,memberships. Без --fresh.",
    )
    parser.add_argument(
        "--memberships-min-id",
        type=int,
        default=0,
        help="С --only: upsert членств только с id >= N, старые строки в MySQL не трогает.",
    )
    parser.add_argument(
        "--schema",
        action="store_true",
        help="Только аддитивная схема (CREATE TABLE IF NOT EXISTS material_docs) и обновить db.inc.php. Без upsert.",
    )
    args = parser.parse_args()
    env = load_env()

    if args.wipe_registrations and not args.fresh:
        print("--wipe-registrations только вместе с --fresh")
        return 2
    try:
        only = parse_only(args.only)
    except ValueError as e:
        print(e)
        return 2
    if only and args.fresh:
        print("--only нельзя вместе с --fresh")
        return 2
    if args.probe:
        return run_probe(env)
    if args.schema:
        print("mode=schema (без DROP, без upsert)")
        return run_schema_only(env)
    if args.export_registrations:
        rows = export_registrations_from_mysql(env)
        if rows is None:
            print("не удалось прочитать meeting_registrations")
            return 1
        write_registrations_json(rows)
        return 0
    if args.fresh:
        print("WARN: --fresh прогоняет 001_schema.sql (DROP TABLE). Заявки портала будут сохранены и возвращены."
              if not args.wipe_registrations
              else "WARN: --fresh --wipe-registrations УДАЛИТ заявки портала.")
    elif only:
        print("mode=upsert_only", ",".join(sorted(only)), "memberships_min_id=%s" % args.memberships_min_id)
    else:
        print("mode=upsert (без DROP/TRUNCATE)")
    return run_load(
        env,
        fresh=args.fresh,
        wipe_registrations=args.wipe_registrations,
        only=only,
        memberships_min_id=args.memberships_min_id,
    )


if __name__ == "__main__":
    raise SystemExit(main())
