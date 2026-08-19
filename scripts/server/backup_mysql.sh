#!/bin/bash
# Утренний дамп u10190_ubtimer. Во вторник сначала копирует понедельничный в weekly.
# Ставит setup_backup_cron.py → crontab 07:00 MSK.

set -eu
HOME_DIR="${HOME:-/home/u10190}"
CRON_DIR="$HOME_DIR/ubtimer-cron"
BACK_DIR="$HOME_DIR/timer.zaborov.ru/backups"
INC="$HOME_DIR/timer.zaborov.ru/db.inc.php"
LOG="$CRON_DIR/backup.log"
PHP="${PHP:-/usr/local/bin/php}"
DUMP="${MYSQLDUMP:-/usr/bin/mysqldump}"
DAILY="$BACK_DIR/ubtimer-daily.sql.gz"
WEEKLY="$BACK_DIR/ubtimer-weekly.sql.gz"

mkdir -p "$CRON_DIR" "$BACK_DIR"
chmod 700 "$BACK_DIR" 2>/dev/null || true

if [ ! -f "$INC" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') NO_CFG $INC" >>"$LOG"
  exit 1
fi

# Вторник: утренний ещё понедельничный — в weekly, потом снимем вторник.
if [ "$(date +%u)" = "2" ] && [ -f "$DAILY" ]; then
  cp -f "$DAILY" "$WEEKLY"
  echo "$(date '+%Y-%m-%d %H:%M:%S') promote daily -> weekly ($(wc -c <"$WEEKLY") bytes)" >>"$LOG"
fi

CNF=$(mktemp "$CRON_DIR/mysql.XXXXXX.cnf")
chmod 600 "$CNF"
"$PHP" -r '
$inc = $argv[1];
$cnf = $argv[2];
require $inc;
if (!isset($mysql_host, $mysql_user, $mysql_password, $mysql_database)) {
    fwrite(STDERR, "bad db.inc.php\n");
    exit(1);
}
$pass = str_replace(array("\\", "\""), array("\\\\", "\\\""), $mysql_password);
file_put_contents($cnf, "[client]\nhost={$mysql_host}\nuser={$mysql_user}\npassword=\"{$pass}\"\n");
echo $mysql_database;
' -- "$INC" "$CNF" >"$CRON_DIR/db.name"
DB=$(cat "$CRON_DIR/db.name")
rm -f "$CRON_DIR/db.name"

TMP="$DAILY.tmp"
set +e
set -o pipefail
"$DUMP" --defaults-extra-file="$CNF" --single-transaction --quick --routines --triggers \
  --default-character-set=utf8mb4 "$DB" | gzip -c >"$TMP"
code=$?
set +o pipefail
set -e
rm -f "$CNF"

if [ "$code" != "0" ] || [ ! -s "$TMP" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') FAIL dump exit=$code" >>"$LOG"
  rm -f "$TMP"
  exit 1
fi
mv -f "$TMP" "$DAILY"
echo "$(date '+%Y-%m-%d %H:%M:%S') daily ok $(wc -c <"$DAILY") bytes" >>"$LOG"
exit 0
