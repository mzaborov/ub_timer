<?php
declare(strict_types=1);

function portal_people_list(mysqli $db): array
{
    $out = [];
    $r = $db->query('SELECT id, full_name FROM people WHERE is_active = 1 ORDER BY full_name');
    while ($row = $r->fetch_assoc()) {
        $out[] = ['id' => (int)$row['id'], 'name' => $row['full_name']];
    }
    return $out;
}

/** Ярлыки шаблонного «Онлайн 10» Google на 2024–2028; живой online_10 (2023) не входит. */
function portal_template_online10_slugs(): array
{
    return ['online_10_20', 'online_10_21', 'online_10_22', 'online_10_23', 'online_10_24'];
}

function portal_not_template_slug_sql(): string
{
    $quoted = [];
    foreach (portal_template_online10_slugs() as $slug) {
        $quoted[] = "'" . str_replace("'", "''", $slug) . "'";
    }
    return '(slug IS NULL OR slug NOT IN (' . implode(',', $quoted) . '))';
}

function portal_event_sql_cols(): string
{
    return 'id, slug, title, event_type, starts_on, ends_on, starts_at, ends_at, status, zoom_url';
}

function portal_dated_events(mysqli $db): array
{
    $notTpl = portal_not_template_slug_sql();
    $cols = portal_event_sql_cols();
    $r = $db->query(
        "SELECT $cols
         FROM events
         WHERE starts_on IS NOT NULL
           AND starts_on <> '0000-00-00'
           AND $notTpl
         ORDER BY starts_on, id"
    );
    $out = [];
    while ($row = $r->fetch_assoc()) {
        $row = portal_hydrate_event_times($row);
        $out[] = [
            'id' => (int)$row['id'],
            'slug' => $row['slug'],
            'title' => $row['title'],
            'type' => $row['event_type'],
            'start' => $row['starts_on'],
            'end' => $row['ends_on'],
            'start_time' => $row['starts_at'] ?? null,
            'end_time' => $row['ends_at'] ?? null,
            'status' => $row['status'],
            'zoom_url' => $row['zoom_url'] ?? null,
        ];
    }
    return $out;
}

function portal_next_events(mysqli $db, int $limit = 3): array
{
    $today = date('Y-m-d');
    $limit = max(1, $limit);
    $notTpl = portal_not_template_slug_sql();
    $cols = portal_event_sql_cols();
    $st = $db->prepare(
        "SELECT $cols
         FROM events
         WHERE status IN ('Запланировано', 'Подготовка')
           AND status <> 'Отменено'
           AND starts_on IS NOT NULL
           AND starts_on <> '0000-00-00'
           AND starts_on >= ?
           AND $notTpl
         ORDER BY starts_on, id
         LIMIT $limit"
    );
    $st->bind_param('s', $today);
    $st->execute();
    $res = $st->get_result();
    $out = [];
    while ($row = $res->fetch_assoc()) {
        $out[] = portal_hydrate_event_times($row);
    }
    $st->close();
    return $out;
}

function portal_event_by_id(mysqli $db, int $id): ?array
{
    if ($id <= 0) {
        return null;
    }
    $cols = portal_event_sql_cols();
    $st = $db->prepare(
        "SELECT $cols FROM events WHERE id = ?"
    );
    $st->bind_param('i', $id);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    return $row ? portal_hydrate_event_times($row) : null;
}

function portal_event_type(array $event): string
{
    return (string)($event['event_type'] ?? $event['type'] ?? '');
}

function portal_event_is_nye(array $event): bool
{
    return portal_event_type($event) === 'новогоднее';
}

function portal_event_is_template(?array $event): bool
{
    if (!$event) {
        return false;
    }
    $slug = (string)($event['slug'] ?? '');
    return $slug !== '' && in_array($slug, portal_template_online10_slugs(), true);
}

function portal_today_iso(): string
{
    return date('Y-m-d');
}

function portal_event_is_open_status($status): bool
{
    return in_array((string)$status, ['Запланировано', 'Подготовка'], true);
}

function portal_event_date_start(array $event): string
{
    $d = substr((string)($event['starts_on'] ?? $event['start'] ?? ''), 0, 10);
    return ($d !== '' && $d !== '0000-00-00') ? $d : '';
}

function portal_event_date_end(array $event): string
{
    $d = substr((string)($event['ends_on'] ?? $event['end'] ?? ''), 0, 10);
    if ($d === '' || $d === '0000-00-00') {
        return portal_event_date_start($event);
    }
    return $d;
}

function portal_norm_clock(?string $raw): string
{
    $raw = trim((string)$raw);
    if ($raw === '' || $raw === '00:00:00') {
        return '';
    }
    if (preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/', $raw, $m)) {
        return sprintf('%02d:%02d', (int)$m[1], (int)$m[2]);
    }
    return '';
}

/** Время МСК: из полей или дефолт 11:00–13:30 у онлайна с датой. */
function portal_event_clock(array $event, string $which): string
{
    $keys = $which === 'end'
        ? ['ends_at', 'end_time']
        : ['starts_at', 'start_time'];
    foreach ($keys as $key) {
        $t = portal_norm_clock($event[$key] ?? null);
        if ($t !== '') {
            return $t;
        }
    }
    if (portal_event_type($event) === 'онлайн' && portal_event_date_start($event) !== '') {
        return $which === 'end' ? '13:30' : '11:00';
    }
    return '';
}

function portal_event_time_range(array $event): string
{
    $start = portal_event_clock($event, 'start');
    $end = portal_event_clock($event, 'end');
    if ($start !== '' && $end !== '') {
        return $start . '–' . $end;
    }
    return $start !== '' ? $start : $end;
}

function portal_hydrate_event_times(array $event): array
{
    $start = portal_event_clock($event, 'start');
    $end = portal_event_clock($event, 'end');
    if ($start !== '') {
        $event['starts_at'] = $start;
        $event['start_time'] = $start;
    }
    if ($end !== '') {
        $event['ends_at'] = $end;
        $event['end_time'] = $end;
    }
    return $event;
}

function portal_event_title_with_time(array $event): string
{
    $title = trim((string)($event['title'] ?? ''));
    $times = portal_event_time_range($event);
    if ($times === '') {
        return $title;
    }
    return $title !== '' ? $title . ', ' . $times : $times;
}

function portal_event_covers_date(array $event, string $iso): bool
{
    $start = portal_event_date_start($event);
    if ($start === '' || $iso === '') {
        return false;
    }
    $end = portal_event_date_end($event);
    return $start <= $iso && $iso <= $end;
}

/** Не завершено и не отменено, календарный день (Europe/Moscow) — сегодня. */
function portal_event_is_live(array $event, ?string $today = null): bool
{
    $today = $today ?? portal_today_iso();
    if (!portal_event_is_open_status($event['status'] ?? '')) {
        return false;
    }
    return portal_event_covers_date($event, $today);
}

function portal_event_is_upcoming(array $event): bool
{
    if (!portal_event_is_open_status($event['status'] ?? '')) {
        return false;
    }
    $start = portal_event_date_start($event);
    if ($start === '') {
        return false;
    }
    return $start >= portal_today_iso();
}

/** Можно подать новую заявку (не НГ, не прошлое, не шаблон Online 10). */
function portal_event_allows_signup(array $event): bool
{
    if (portal_event_is_template($event) || portal_event_is_nye($event)) {
        return false;
    }
    $type = portal_event_type($event);
    if (!in_array($type, ['онлайн', 'купала'], true)) {
        return false;
    }
    return portal_event_is_upcoming($event);
}

/** Ссылка на нашу форму заявки (онлайн / купала / новогоднее). */
function portal_register_url(?array $event): string
{
    if (!$event || portal_event_is_template($event)) {
        return '';
    }
    $type = portal_event_type($event);
    if (!in_array($type, ['онлайн', 'купала', 'новогоднее'], true)) {
        return '';
    }
    return 'register.php?event=' . (int)$event['id'];
}

/** @return array<int, int> event_id => registration id */
function portal_my_registrations(mysqli $db, int $personId, array $eventIds): array
{
    $eventIds = array_values(array_unique(array_filter(array_map('intval', $eventIds))));
    if ($personId <= 0 || !$eventIds) {
        return [];
    }
    $in = implode(',', $eventIds);
    $out = [];
    try {
        $st = $db->prepare(
            "SELECT id, event_id FROM meeting_registrations
             WHERE person_id = ? AND event_id IN ($in)"
        );
        $st->bind_param('i', $personId);
        $st->execute();
        $res = $st->get_result();
        while ($row = $res->fetch_assoc()) {
            $out[(int)$row['event_id']] = (int)$row['id'];
        }
        $st->close();
    } catch (Throwable $e) {
        return [];
    }
    return $out;
}

function portal_find_registration(mysqli $db, int $eventId, int $personId): ?array
{
    if ($eventId <= 0 || $personId <= 0) {
        return null;
    }
    try {
        $st = $db->prepare(
            'SELECT id, event_id, person_id, full_name, wants_play, wants_judge, wants_second, comment
             FROM meeting_registrations
             WHERE event_id = ? AND person_id = ?
             LIMIT 1'
        );
        $st->bind_param('ii', $eventId, $personId);
        $st->execute();
        $row = $st->get_result()->fetch_assoc();
        $st->close();
        return $row ?: null;
    } catch (Throwable $e) {
        return null;
    }
}

function portal_event_start_iso(array $event): string
{
    $d = (string)($event['starts_on'] ?? $event['start'] ?? '');
    return ($d !== '' && $d !== '0000-00-00') ? $d : '';
}

function portal_event_end_iso(array $event): string
{
    $d = (string)($event['ends_on'] ?? $event['end'] ?? '');
    return ($d !== '' && $d !== '0000-00-00') ? $d : '';
}

function portal_ics_url(?array $event): string
{
    if (!$event || portal_event_is_template($event) || portal_event_start_iso($event) === '') {
        return '';
    }
    return 'calendar.php?event=' . (int)$event['id'];
}

function portal_public_base(): string
{
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $host = (string)($_SERVER['HTTP_HOST'] ?? 'ciocdo-org-skills.zaborov.ru');
    $script = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? '/'));
    $dir = rtrim(dirname($script), '/');
    if ($dir === '/' || $dir === '.' || $dir === '\\') {
        $dir = '';
    }
    return ($https ? 'https' : 'http') . '://' . $host . $dir;
}

function portal_event_abs_url(array $event): string
{
    $reg = portal_register_url($event);
    $path = $reg !== '' ? $reg : '?p=events';
    return rtrim(portal_public_base(), '/') . '/' . ltrim($path, '/');
}

function portal_event_has_zoom(array $event): bool
{
    if (trim((string)($event['join'] ?? '')) !== '') {
        return true;
    }
    return trim((string)($event['zoom_url'] ?? '')) !== '';
}

/** Короткий редирект на портале; сырой Zoom в ICS/ссылках не светим. */
function portal_zoom_short_url(?array $event): string
{
    if (!$event) {
        return '';
    }
    $join = trim((string)($event['join'] ?? ''));
    if ($join !== '') {
        return $join;
    }
    if (trim((string)($event['zoom_url'] ?? '')) === '') {
        return '';
    }
    return rtrim(portal_public_base(), '/') . '/z/' . (int)$event['id'];
}

function portal_join_button_html(?array $event, string $class = 'join-btn'): string
{
    $href = portal_zoom_short_url($event);
    if ($href === '') {
        return '';
    }
    return '<a class="' . h($class) . '" href="' . h($href) . '">Присоединиться</a>';
}

function portal_echo_zoom_link(?array $event, string $class = 'zoom-link'): void
{
    echo portal_join_button_html($event, $class);
}

function portal_ics_escape(string $s): string
{
    return str_replace(
        ["\\", ";", ",", "\r\n", "\n", "\r"],
        ["\\\\", "\\;", "\\,", "\\n", "\\n", "\\n"],
        $s
    );
}

function portal_ics_fold(string $line): string
{
    if (strlen($line) <= 75) {
        return $line . "\r\n";
    }
    $out = '';
    $rest = $line;
    $first = true;
    while ($rest !== '') {
        $limit = $first ? 75 : 74;
        $first = false;
        if (strlen($rest) <= $limit) {
            $out .= $rest . "\r\n";
            break;
        }
        $chunk = substr($rest, 0, $limit);
        while ($chunk !== '' && (ord($chunk[strlen($chunk) - 1]) & 0xC0) === 0x80) {
            $chunk = substr($chunk, 0, -1);
        }
        if ($chunk === '') {
            $chunk = substr($rest, 0, $limit);
        }
        $out .= $chunk . "\r\n";
        $rest = substr($rest, strlen($chunk));
        if ($rest !== '') {
            $rest = ' ' . $rest;
        }
    }
    return $out;
}

function portal_ics_local(string $dateIso, string $hm): string
{
    $d = substr($dateIso, 0, 10);
    $parts = explode(':', $hm);
    $h = str_pad((string)(int)($parts[0] ?? '0'), 2, '0', STR_PAD_LEFT);
    $m = str_pad((string)(int)($parts[1] ?? '0'), 2, '0', STR_PAD_LEFT);
    $s = str_pad((string)(int)($parts[2] ?? '0'), 2, '0', STR_PAD_LEFT);
    return str_replace('-', '', $d) . 'T' . $h . $m . $s;
}

function portal_ics_vtimezone_msk(): string
{
    $ics = "BEGIN:VTIMEZONE\r\n";
    $ics .= "TZID:Europe/Moscow\r\n";
    $ics .= "BEGIN:STANDARD\r\n";
    $ics .= "TZOFFSETFROM:+0300\r\n";
    $ics .= "TZOFFSETTO:+0300\r\n";
    $ics .= "TZNAME:MSK\r\n";
    $ics .= "DTSTART:19700101T000000\r\n";
    $ics .= "END:STANDARD\r\n";
    $ics .= "END:VTIMEZONE\r\n";
    return $ics;
}

/** Онлайн с временем — timed VEVENT (МСК). Купала/НГ без часов — весь день, DTEND исключительный. */
function portal_build_ics(array $event): string
{
    $start = portal_event_start_iso($event);
    $end = portal_event_end_iso($event);
    if ($end === '' || $end < $start) {
        $end = $start;
    }
    $clockStart = portal_event_clock($event, 'start');
    $clockEnd = portal_event_clock($event, 'end');
    $timed = $clockStart !== '';
    if ($timed && $clockEnd === '') {
        $clockEnd = $clockStart;
    }
    $title = trim((string)($event['title'] ?? 'Встреча'));
    if ($title === '') {
        $title = 'Встреча';
    }
    $type = portal_event_type($event);
    $dates = portal_event_dates($event);
    $zoomShort = portal_zoom_short_url($event);
    $url = $zoomShort !== '' ? $zoomShort : portal_event_abs_url($event);
    $desc = trim(($type !== '' ? $type . '. ' : '') . ($dates !== '' ? $dates . '. ' : ''));
    if ($zoomShort !== '') {
        $desc = trim($desc . ' Подключение: ' . $zoomShort);
    } else {
        $desc = trim($desc . ' ' . $url);
    }
    $uid = 'ub-event-' . (int)$event['id'] . '@ciocdo-org-skills.zaborov.ru';
    $ics = "BEGIN:VCALENDAR\r\n";
    $ics .= "VERSION:2.0\r\n";
    $ics .= "PRODID:-//ub-timer//portal//RU\r\n";
    $ics .= "CALSCALE:GREGORIAN\r\n";
    $ics .= "METHOD:PUBLISH\r\n";
    $ics .= "X-WR-TIMEZONE:Europe/Moscow\r\n";
    if ($timed) {
        $ics .= portal_ics_vtimezone_msk();
    }
    $ics .= "BEGIN:VEVENT\r\n";
    $ics .= portal_ics_fold('UID:' . $uid);
    $ics .= 'DTSTAMP:' . gmdate('Ymd\THis\Z') . "\r\n";
    if ($timed) {
        $ics .= 'DTSTART;TZID=Europe/Moscow:' . portal_ics_local($start, $clockStart) . "\r\n";
        $ics .= 'DTEND;TZID=Europe/Moscow:' . portal_ics_local($end, $clockEnd) . "\r\n";
    } else {
        $dtStart = date('Ymd', strtotime($start));
        $dtEnd = date('Ymd', strtotime($end . ' +1 day'));
        $ics .= 'DTSTART;VALUE=DATE:' . $dtStart . "\r\n";
        $ics .= 'DTEND;VALUE=DATE:' . $dtEnd . "\r\n";
    }
    $ics .= portal_ics_fold('SUMMARY:' . portal_ics_escape($title));
    $ics .= portal_ics_fold('DESCRIPTION:' . portal_ics_escape($desc));
    $ics .= portal_ics_fold('URL:' . $url);
    if ($zoomShort !== '') {
        $ics .= portal_ics_fold('LOCATION:' . portal_ics_escape($zoomShort));
    }
    $ics .= "END:VEVENT\r\n";
    $ics .= "END:VCALENDAR\r\n";
    return $ics;
}

function portal_ics_filename(array $event): string
{
    $slug = (string)($event['slug'] ?? '');
    if (preg_match('/^[a-zA-Z0-9_-]+$/', $slug)) {
        return $slug . '.ics';
    }
    return 'event-' . (int)$event['id'] . '.ics';
}

function portal_echo_ics_link(?array $event, string $class = 'ics-link', string $label = 'Добавить в календарь'): void
{
    $href = portal_ics_url($event);
    if ($href === '') {
        return;
    }
    echo '<a class="' . h($class) . '" href="' . h($href) . '">' . h($label) . '</a>';
}

/** Кнопки в «Ближайшее»: запись / уже записаны / НГ ещё не открыта; ICS и Join — только у записанных. */
function portal_echo_next_actions(array $ev, bool $loggedIn, array $myRegs): void
{
    $nye = portal_event_is_nye($ev);
    $reg = portal_register_url($ev);
    $eid = (int)$ev['id'];
    $isReg = isset($myRegs[$eid]);
    echo '<div class="next-actions">';
    if ($nye) {
        echo '<span class="next-reg next-reg--closed">Регистрация на НГ ещё не открыта</span>';
    } elseif ($reg !== '') {
        if ($isReg) {
            echo '<span class="next-done">Записаны</span>';
            echo '<form method="post" action="register.php?event=' . $eid . '" class="next-cancel"';
            echo ' onsubmit="return confirm(\'Отменить запись?\');">';
            portal_csrf_field();
            echo '<input type="hidden" name="event" value="' . $eid . '">';
            echo '<input type="hidden" name="action" value="cancel">';
            echo '<input type="hidden" name="back" value="events">';
            echo '<button type="submit">Отменить</button>';
            echo '</form>';
        } elseif ($loggedIn) {
            echo '<a class="next-reg" href="' . h($reg) . '">зарегистрироваться</a>';
        } else {
            echo '<a class="next-reg" href="' . h($reg) . '" data-need-login="1">зарегистрироваться</a>';
        }
    }
    if ($isReg && portal_event_is_live($ev) && portal_event_has_zoom($ev)) {
        portal_echo_zoom_link($ev, 'join-btn join-btn--next');
    }
    if ($isReg) {
        portal_echo_ics_link($ev, 'ics-link', 'В календарь');
    }
    echo '</div>';
}

function portal_event_dates(array $ev): string
{
    $start = portal_fmt_date($ev['starts_on'] ?? $ev['start'] ?? null);
    $end = portal_fmt_date($ev['ends_on'] ?? $ev['end'] ?? null);
    $dates = '';
    if ($start !== '' && $end !== '' && $start !== $end) {
        $dates = $start . '–' . $end;
    } else {
        $dates = $start !== '' ? $start : $end;
    }
    $times = portal_event_time_range($ev);
    if ($dates !== '' && $times !== '') {
        return $dates . ', ' . $times;
    }
    return $dates !== '' ? $dates : $times;
}

function portal_title_has_dates(string $title, array $ev): bool
{
    $iso = (string)($ev['starts_on'] ?? '');
    if ($iso === '') {
        return false;
    }
    $t = strtotime($iso);
    if ($t === false) {
        return false;
    }
    foreach ([date('d.m.Y', $t), date('d.m.y', $t)] as $fmt) {
        if (strpos($title, $fmt) !== false) {
            return true;
        }
    }
    return false;
}

function portal_title_has_type(string $title, string $type): bool
{
    $type = trim($type);
    if ($type === '') {
        return true;
    }
    if (preg_match('/' . preg_quote($type, '/') . '/ui', $title)) {
        return true;
    }
    if ($type === 'новогоднее' && preg_match('/(?<!\p{L})нг(?!\p{L})/ui', $title)) {
        return true;
    }
    return false;
}

/** Диапазон без года: 05.12–06.12; один день — ДД.ММ.ГГГГ. */
function portal_event_dates_compact(array $ev): string
{
    $startIso = (string)($ev['starts_on'] ?? '');
    $endIso = (string)($ev['ends_on'] ?? '');
    $st = $startIso !== '' ? strtotime($startIso) : false;
    $en = $endIso !== '' ? strtotime($endIso) : false;
    if ($st && $en && date('Y-m-d', $st) !== date('Y-m-d', $en)) {
        if (date('Y', $st) === date('Y', $en)) {
            return date('d.m', $st) . '–' . date('d.m', $en);
        }
        return date('d.m.Y', $st) . '–' . date('d.m.Y', $en);
    }
    if ($st) {
        return date('d.m.Y', $st);
    }
    if ($en) {
        return date('d.m.Y', $en);
    }
    return '';
}

/** Серая строка «Ближайшее»: только то, чего нет в названии. */
function portal_next_meta(array $ev): string
{
    $title = (string)($ev['title'] ?? '');
    $parts = [];
    if (!portal_title_has_dates($title, $ev)) {
        $dates = portal_event_dates_compact($ev);
        if ($dates !== '') {
            $parts[] = $dates;
        }
    }
    $type = trim((string)($ev['event_type'] ?? ''));
    if ($type !== '' && !portal_title_has_type($title, $type)) {
        $parts[] = $type;
    }
    return implode(' · ', $parts);
}

function portal_name_or_empty(?string $name): string
{
    $name = trim((string)$name);
    return $name !== '' ? $name : '';
}

/** Подпись ситуации как в сетке Google: код, иначе номер, иначе 00/00Э. */
function portal_sit_label(?string $code, $num, string $prep, string $type): string
{
    $code = trim((string)$code);
    if ($code !== '') {
        return $code;
    }
    if ($num !== null && $num !== '') {
        return (string)$num;
    }
    if ($prep === 'случайный') {
        return $type === 'экспресс' ? '00Э' : '00';
    }
    return '—';
}

function portal_short_fio(string $name): string
{
    $name = trim($name);
    if ($name === '') {
        return '';
    }
    $parts = preg_split('/\s+/u', $name);
    return $parts[0] !== false && $parts[0] !== null ? $parts[0] : $name;
}

function portal_sit_is_random_label(string $label): bool
{
    return $label === '00' || $label === '00Э' || $label === '—';
}

function portal_sit_bank_url(?string $code, string $label): string
{
    if (portal_sit_is_random_label($label)) {
        return '';
    }
    $code = trim((string)$code);
    if ($code === '' || preg_match('/^00([ЭE]|[-–]|$)/u', $code)) {
        return '';
    }
    return 'https://timer.zaborov.ru/situations-bank.html?from=portal&code=' . rawurlencode($code);
}

function portal_video_url(?string $url): string
{
    $url = trim((string)$url);
    if ($url === '' || !preg_match('#^https?://#i', $url)) {
        return '';
    }
    return $url;
}

function portal_video_link_html(?string $url, string $extraClass = '', string $label = 'видео'): string
{
    $url = portal_video_url($url);
    if ($url === '') {
        return '';
    }
    $cls = 'video-link vid-pill';
    if ($extraClass !== '') {
        $cls .= ' ' . $extraClass;
    }
    $text = $label !== '' ? $label : 'видео';
    return '<a class="' . $cls . '" href="' . h($url) . '" target="_blank" rel="noopener">'
        . '<svg class="ico" aria-hidden="true"><use href="#i-video"></use></svg> ' . h($text) . '</a>';
}

/** URL дня целиком, если он не совпадает ни с одним клипом поединка. */
function portal_event_day_video_url(array $ev): string
{
    $url = portal_video_url($ev['video'] ?? null);
    if ($url === '') {
        return '';
    }
    foreach ($ev['duels'] ?? [] as $d) {
        if (portal_video_url($d['video'] ?? null) === $url) {
            return '';
        }
    }
    return $url;
}

/**
 * Первое валидное видео дня (дуэль null) и первое видео каждого поединка.
 *
 * @param list<int> $eventIds
 * @return array{events: array<int, string>, duels: array<int, string>}
 */
function portal_videos_for_events(mysqli $db, array $eventIds): array
{
    $eventIds = array_values(array_unique(array_filter(array_map('intval', $eventIds))));
    $eventUrls = [];
    $duelUrls = [];
    if (!$eventIds) {
        return ['events' => $eventUrls, 'duels' => $duelUrls];
    }
    $in = implode(',', $eventIds);
    try {
        $r = $db->query(
            "SELECT event_id, duel_id, url, video_type
             FROM videos
             WHERE event_id IN ($in)
             ORDER BY id"
        );
    } catch (Throwable $e) {
        return ['events' => $eventUrls, 'duels' => $duelUrls];
    }
    while ($row = $r->fetch_assoc()) {
        $url = portal_video_url($row['url'] ?? null);
        if ($url === '') {
            continue;
        }
        $did = isset($row['duel_id']) && $row['duel_id'] !== null && $row['duel_id'] !== ''
            ? (int)$row['duel_id'] : 0;
        $type = (string)($row['video_type'] ?? '');
        if ($did > 0) {
            if (!isset($duelUrls[$did])) {
                $duelUrls[$did] = $url;
            }
        } elseif ($type !== 'Поединок') {
            $eid = (int)$row['event_id'];
            if (!isset($eventUrls[$eid])) {
                $eventUrls[$eid] = $url;
            }
        }
    }
    return ['events' => $eventUrls, 'duels' => $duelUrls];
}

function portal_sit_td(array $d, bool $withVideo = false): string
{
    $label = (string)$d['sit'];
    $url = (string)($d['sit_url'] ?? '');
    $html = '<td class="sit"><span class="with-vid">';
    if ($url !== '') {
        $html .= '<a href="' . h($url) . '" target="_blank" rel="noopener">' . h($label) . '</a>';
    } else {
        $html .= h($label);
    }
    if ($withVideo) {
        $html .= portal_video_link_html($d['video'] ?? null);
    }
    $html .= '</span></td>';
    return $html;
}

function portal_you_mark(): string
{
    return '<span class="you" title="это вы">вы</span>';
}

function portal_side_td(
    string $player,
    string $second,
    int $winner,
    int $side,
    int $meId = 0,
    int $playerId = 0,
    int $secondId = 0,
    bool $paired = false
): string {
    $cls = 'side';
    if ($winner === $side) {
        $cls .= ' win';
    } elseif ($winner === 0) {
        $cls .= ' draw';
    }
    if ($meId > 0 && ($meId === $playerId || $meId === $secondId)) {
        $cls .= ' is-me';
    }
    $html = '<td class="' . $cls . '">';
    $html .= h($player !== '' ? $player : '—');
    if ($meId > 0 && $meId === $playerId) {
        $html .= portal_you_mark();
    }
    if ($second !== '') {
        $span = $paired ? 'pair' : 'second';
        $html .= '<span class="' . $span . '">' . h($second);
        if ($meId > 0 && $meId === $secondId) {
            $html .= portal_you_mark();
        }
        $html .= '</span>';
    }
    $html .= '</td>';
    return $html;
}

function portal_meeting_heading(array $ev, bool $plan = false, bool $live = false): string
{
    $title = trim((string)($ev['title'] ?? ''));
    $start = portal_fmt_date($ev['starts_on'] ?? $ev['start'] ?? null);
    $end = portal_fmt_date($ev['ends_on'] ?? $ev['end'] ?? null);
    $date = '';
    if ($start && $end && $start !== $end) {
        $date = $start . '–' . $end;
    } else {
        $date = $start !== '' ? $start : $end;
    }
    if ($date !== '' && $title !== '') {
        $title = trim(preg_replace('/\s+' . preg_quote($date, '/') . '\s*$/u', '', $title));
    }
    $times = portal_event_time_range($ev);
    if ($live) {
        $head = 'Сейчас';
    } elseif ($plan) {
        $head = 'План';
    } else {
        $head = 'Результаты';
    }
    if ($title !== '') {
        $head .= ': ' . $title;
    }
    if ($date !== '') {
        $head .= ' · ' . $date;
        if ($times !== '') {
            $head .= ', ' . $times;
        }
    } elseif ($times !== '') {
        $head .= ' · ' . $times;
    }
    return $head;
}

function portal_last_heading(array $last): string
{
    return portal_meeting_heading($last, false, portal_event_is_live($last));
}

/** Записавшиеся на встречу (без контактов) — для таблицы текущего онлайна. */
function portal_registrations_by_event(mysqli $db, array $eventIds): array
{
    $eventIds = array_values(array_unique(array_filter(array_map('intval', $eventIds))));
    if (!$eventIds) {
        return [];
    }
    $in = implode(',', $eventIds);
    $out = [];
    try {
        $r = $db->query(
            "SELECT event_id, person_id, full_name, wants_play, wants_judge, wants_second
             FROM meeting_registrations
             WHERE event_id IN ($in)
             ORDER BY full_name, id"
        );
    } catch (Throwable $e) {
        return [];
    }
    while ($row = $r->fetch_assoc()) {
        $eid = (int)$row['event_id'];
        $out[$eid][] = [
            'id' => (int)($row['person_id'] ?? 0),
            'name' => (string)($row['full_name'] ?? ''),
            'play' => (int)($row['wants_play'] ?? 0) === 1,
            'judge' => (int)($row['wants_judge'] ?? 0) === 1,
            'second' => (int)($row['wants_second'] ?? 0) === 1,
        ];
    }
    return $out;
}

function portal_regs_html(array $regs): string
{
    $items = [];
    foreach ($regs as $r) {
        $name = trim((string)($r['name'] ?? ''));
        if ($name === '') {
            continue;
        }
        $roles = [];
        if (!empty($r['play'])) {
            $roles[] = 'игра';
        }
        if (!empty($r['judge'])) {
            $roles[] = 'судья';
        }
        if (!empty($r['second'])) {
            $roles[] = 'секундант';
        }
        $s = h($name);
        if ($roles) {
            $s .= ' <span class="reg-roles-mini">(' . h(implode(', ', $roles)) . ')</span>';
        }
        $items[] = $s;
    }
    if (!$items) {
        return '';
    }
    return '<p class="live-regs"><span class="live-regs-lab">Записались:</span> '
        . implode(', ', $items) . '</p>';
}

function portal_score_td(array $d): string
{
    $w = (int)$d['winner'];
    $html = '<td class="result' . ($w === 0 ? ' draw' : '') . '">';
    $html .= '<span class="score">' . (int)$d['v1'] . ':' . (int)$d['v2'] . '</span>';
    if ($w === 0) {
        $html .= '<span class="outcome">ничья</span>';
    } else {
        $name = portal_short_fio($w === 1 ? (string)$d['p1'] : (string)$d['p2']);
        $paired = (($d['type'] ?? '') === 'парный');
        if ($paired) {
            $other = portal_short_fio($w === 1 ? (string)($d['s1'] ?? '') : (string)($d['s2'] ?? ''));
            if ($name !== '' && $other !== '') {
                $name = $name . ', ' . $other;
            } elseif ($other !== '') {
                $name = $other;
            }
        }
        if ($name !== '') {
            $html .= '<span class="outcome win">' . h($name) . '</span>';
        }
    }
    $html .= '</td>';
    return $html;
}

/** Порядок коллегий как в каноне; пустые не показываем. */
function portal_college_short(string $college): string
{
    switch ($college) {
        case 'нанимающиесяНаРаботу':
            return 'Нанимающиеся';
        case 'отправляющиеНаПереговоры':
            return 'Отправляющие';
        case 'доверяющиеСобственность':
            return 'Доверяющие';
        case 'неизвестна':
            return 'Неизвестна';
        default:
            return $college !== '' ? $college : 'Неизвестна';
    }
}

/**
 * Судьи по коллегиям: короткие ФИО, без голоса.
 * Экспресс (канон express-only-sending): один список, без трёх подписей коллегий.
 *
 * @param list<array{id: int, name: string, college: string}> $judges
 * @return list<array{label: string, people: list<array{id: int, name: string}>}>
 */
function portal_judge_groups(array $judges, $duelType = '')
{
    if ($duelType === 'экспресс') {
        $people = [];
        foreach ($judges as $j) {
            $id = (int)($j['id'] ?? 0);
            $name = portal_short_fio((string)($j['name'] ?? ''));
            if ($id <= 0 || $name === '') {
                continue;
            }
            $people[] = ['id' => $id, 'name' => $name];
        }
        return $people ? [['label' => '', 'people' => $people]] : [];
    }
    $order = [
        'нанимающиесяНаРаботу',
        'отправляющиеНаПереговоры',
        'доверяющиеСобственность',
        'неизвестна',
    ];
    $buckets = [];
    foreach ($order as $c) {
        $buckets[$c] = [];
    }
    $extra = [];
    foreach ($judges as $j) {
        $id = (int)($j['id'] ?? 0);
        $name = portal_short_fio((string)($j['name'] ?? ''));
        if ($id <= 0 || $name === '') {
            continue;
        }
        $c = trim((string)($j['college'] ?? ''));
        if ($c === '') {
            $c = 'неизвестна';
        }
        $row = ['id' => $id, 'name' => $name];
        if (isset($buckets[$c])) {
            $buckets[$c][] = $row;
        } else {
            $extra[$c][] = $row;
        }
    }
    $out = [];
    foreach ($buckets as $c => $people) {
        if ($people) {
            $out[] = ['label' => portal_college_short($c), 'people' => $people];
        }
    }
    foreach ($extra as $c => $people) {
        if ($people) {
            $out[] = ['label' => portal_college_short($c), 'people' => $people];
        }
    }
    return $out;
}

function portal_judge_names_html(array $people, int $meId = 0): string
{
    $parts = [];
    foreach ($people as $p) {
        $s = h((string)($p['name'] ?? ''));
        if ($meId > 0 && $meId === (int)($p['id'] ?? 0)) {
            $s .= portal_you_mark();
        }
        $parts[] = $s;
    }
    return implode(', ', $parts);
}

function portal_judges_td(array $d, int $meId = 0): string
{
    $groups = $d['judge_groups'] ?? [];
    $meHere = false;
    foreach ($groups as $g) {
        foreach ($g['people'] ?? [] as $p) {
            if ($meId > 0 && $meId === (int)($p['id'] ?? 0)) {
                $meHere = true;
                break 2;
            }
        }
    }
    $cls = 'judges';
    if ($meHere) {
        $cls .= ' is-me';
    }
    $html = '<td class="' . $cls . '">';
    $flat = (($d['type'] ?? '') === 'экспресс') || (count($groups) === 1);
    if (!$groups) {
        $html .= '—';
    } elseif ($flat) {
        $all = [];
        foreach ($groups as $g) {
            foreach ($g['people'] ?? [] as $p) {
                $all[] = $p;
            }
        }
        $html .= portal_judge_names_html($all, $meId);
    } else {
        foreach ($groups as $g) {
            $html .= '<div class="jcol"><strong class="jlab">' . h((string)($g['label'] ?? '')) . '</strong> ';
            $html .= portal_judge_names_html($g['people'] ?? [], $meId);
            $html .= '</div>';
        }
    }
    $html .= '</td>';
    return $html;
}

function portal_fmt_date(?string $iso): string
{
    if ($iso === null || $iso === '') {
        return '';
    }
    $t = strtotime($iso);
    return $t ? date('d.m.Y', $t) : $iso;
}

/**
 * Поединки по списку мероприятий: состав, ситуации, голоса.
 *
 * @param list<int> $eventIds
 * @return array<int, list<array<string, mixed>>>
 */
function portal_duels_by_event(mysqli $db, array $eventIds): array
{
    $eventIds = array_values(array_unique(array_filter(array_map('intval', $eventIds))));
    if (!$eventIds) {
        return [];
    }
    $in = implode(',', $eventIds);
    $r = $db->query(
        "SELECT d.id, d.event_id, d.sort_order, d.duel_date, d.duel_type, d.prep_mode,
                d.player1_id, d.second1_id, d.player2_id, d.second2_id,
                s.code AS sit_code, s.num AS sit_num,
                p1.full_name AS p1_name, s1.full_name AS s1_name,
                p2.full_name AS p2_name, s2.full_name AS s2_name
         FROM duels d
         LEFT JOIN situations s ON s.id = d.situation_id
         LEFT JOIN people p1 ON p1.id = d.player1_id
         LEFT JOIN people s1 ON s1.id = d.second1_id
         LEFT JOIN people p2 ON p2.id = d.player2_id
         LEFT JOIN people s2 ON s2.id = d.second2_id
         WHERE d.event_id IN ($in)
         ORDER BY d.event_id, d.sort_order, d.id"
    );
    $byDid = [];
    $eventOf = [];
    while ($row = $r->fetch_assoc()) {
        $did = (int)$row['id'];
        $type = (string)$row['duel_type'];
        $express = $type === 'экспресс';
        $sit = portal_sit_label($row['sit_code'] ?? null, $row['sit_num'] ?? null, (string)$row['prep_mode'], $type);
        $dd = (string)($row['duel_date'] ?? '');
        if ($dd === '0000-00-00') {
            $dd = '';
        }
        $byDid[$did] = [
            'id' => $did,
            'order' => (int)$row['sort_order'],
            'date' => $dd !== '' ? $dd : null,
            'type' => $type,
            'sit' => $sit,
            'sit_url' => portal_sit_bank_url($row['sit_code'] ?? null, $sit),
            'p1' => portal_name_or_empty($row['p1_name'] ?? null),
            's1' => $express ? '' : portal_name_or_empty($row['s1_name'] ?? null),
            'p1_id' => (int)($row['player1_id'] ?? 0),
            's1_id' => $express ? 0 : (int)($row['second1_id'] ?? 0),
            'p2' => portal_name_or_empty($row['p2_name'] ?? null),
            's2' => $express ? '' : portal_name_or_empty($row['s2_name'] ?? null),
            'p2_id' => (int)($row['player2_id'] ?? 0),
            's2_id' => $express ? 0 : (int)($row['second2_id'] ?? 0),
            'v1' => 0,
            'v2' => 0,
            'winner' => 0,
            'judges' => [],
            'judge_groups' => [],
        ];
        $eventOf[$did] = (int)$row['event_id'];
    }

    if ($byDid) {
        $inDuels = implode(',', array_map('intval', array_keys($byDid)));
        $vr = $db->query(
            "SELECT dj.duel_id, dj.person_id, dj.college, dj.vote, p.full_name
             FROM duel_judges dj
             LEFT JOIN people p ON p.id = dj.person_id
             WHERE dj.duel_id IN ($inDuels)
             ORDER BY dj.id"
        );
        while ($row = $vr->fetch_assoc()) {
            $did = (int)$row['duel_id'];
            if (!isset($byDid[$did])) {
                continue;
            }
            $v = trim((string)$row['vote']);
            if ($v === '1') {
                $byDid[$did]['v1']++;
            } elseif ($v === '2') {
                $byDid[$did]['v2']++;
            }
            $pid = (int)($row['person_id'] ?? 0);
            $name = portal_name_or_empty($row['full_name'] ?? null);
            if ($pid > 0 && $name !== '') {
                $byDid[$did]['judges'][] = [
                    'id' => $pid,
                    'name' => $name,
                    'college' => (string)($row['college'] ?? ''),
                ];
            }
        }
        foreach ($byDid as &$d) {
            if ($d['v1'] > $d['v2']) {
                $d['winner'] = 1;
            } elseif ($d['v2'] > $d['v1']) {
                $d['winner'] = 2;
            } else {
                $d['winner'] = 0;
            }
            $d['judge_groups'] = portal_judge_groups($d['judges'] ?? [], $d['type'] ?? '');
            unset($d['judges']);
        }
        unset($d);
    }

    $out = [];
    foreach ($byDid as $did => $d) {
        $out[$eventOf[$did]][] = $d;
    }
    return $out;
}

/** Датированные мероприятия с поединками — календарь и таблица на главной. */
function portal_events_for_calendar(mysqli $db): array
{
    $events = portal_dated_events($db);
    $ids = array_column($events, 'id');
    $byEv = portal_duels_by_event($db, $ids);
    $vids = portal_videos_for_events($db, $ids);
    $openIds = [];
    foreach ($events as $ev) {
        if (portal_event_is_open_status($ev['status'] ?? '')) {
            $openIds[] = (int)$ev['id'];
        }
    }
    $regsByEv = portal_registrations_by_event($db, $openIds);
    foreach ($events as &$ev) {
        $eid = (int)$ev['id'];
        $duels = $byEv[$eid] ?? [];
        foreach ($duels as &$d) {
            $did = (int)$d['id'];
            if (!empty($vids['duels'][$did])) {
                $d['video'] = $vids['duels'][$did];
            }
        }
        unset($d);
        $ev['duels'] = $duels;
        if (!empty($vids['events'][$eid])) {
            $ev['video'] = $vids['events'][$eid];
        }
        $ev['join'] = portal_zoom_short_url($ev);
        if (portal_event_is_open_status($ev['status'] ?? '')) {
            $ev['regs'] = $regsByEv[$eid] ?? [];
        }
        unset($ev['zoom_url']);
    }
    unset($ev);
    return $events;
}

/** Сегодняшнее незавершённое (не отменённое) — для блока «Сейчас». */
function portal_live_meeting(array $events, ?string $today = null): ?array
{
    $today = $today ?? portal_today_iso();
    $best = null;
    foreach ($events as $ev) {
        if (!portal_event_is_live($ev, $today)) {
            continue;
        }
        $online = (($ev['type'] ?? '') === 'онлайн');
        if ($best === null) {
            $best = $ev;
            continue;
        }
        $bestOnline = (($best['type'] ?? '') === 'онлайн');
        if ($online && !$bestOnline) {
            $best = $ev;
        } elseif ($online === $bestOnline && (int)$ev['id'] > (int)$best['id']) {
            $best = $ev;
        }
    }
    return $best;
}

/** Последний прошедший онлайн (тип онлайн, Проведено, дата ≤ сегодня). */
function portal_last_completed_online(array $events): ?array
{
    $today = portal_today_iso();
    $best = null;
    $bestDate = '';
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'онлайн') {
            continue;
        }
        if (($ev['status'] ?? '') !== 'Проведено') {
            continue;
        }
        $d = substr((string)($ev['start'] ?? ''), 0, 10);
        if ($d === '') {
            $d = substr((string)($ev['end'] ?? ''), 0, 10);
        }
        if ($d === '' || $d > $today) {
            continue;
        }
        if ($best === null || $d > $bestDate || ($d === $bestDate && (int)$ev['id'] > (int)$best['id'])) {
            $best = $ev;
            $bestDate = $d;
        }
    }
    return $best;
}

function portal_default_meeting(array $events): ?array
{
    return portal_live_meeting($events) ?? portal_last_completed_online($events);
}

function portal_last_meeting(mysqli $db): ?array
{
    return portal_default_meeting(portal_events_for_calendar($db));
}

/** Название встречи без хвостовой даты: «Онлайн 24 07.02.2026» → «Онлайн 24». */
function portal_event_title_short(?string $title): string
{
    $title = trim((string)$title);
    if ($title === '') {
        return '';
    }
    $stripped = preg_replace('/\s+\d{2}\.\d{2}\.\d{2,4}\s*$/u', '', $title);
    return trim((string)$stripped);
}

function portal_stats_join_line(string $date, string $event, string $sit): string
{
    $parts = [];
    if ($date !== '') {
        $parts[] = $date;
    }
    if ($event !== '') {
        $parts[] = $event;
    }
    if ($sit !== '') {
        $parts[] = $sit;
    }
    return implode(' · ', $parts);
}

/** @return array{iso: string, date: string} */
function portal_stats_when(?string $duelDate, ?string $startsOn): array
{
    $dd = (string)$duelDate;
    if ($dd === '0000-00-00') {
        $dd = '';
    }
    $evStart = (string)$startsOn;
    if ($evStart === '0000-00-00') {
        $evStart = '';
    }
    $iso = $dd !== '' ? substr($dd, 0, 10) : substr($evStart, 0, 10);
    return [
        'iso' => $iso,
        'date' => portal_fmt_date($iso !== '' ? $iso : null),
    ];
}

function portal_stats_pair_label(?string $n1, ?string $n2): string
{
    $a = portal_name_or_empty($n1);
    $b = portal_name_or_empty($n2);
    if ($a !== '' && $b !== '') {
        return $a . ' — ' . $b;
    }
    return $a !== '' ? $a : $b;
}

function portal_stats_times_label(int $n): string
{
    $n10 = $n % 10;
    $n100 = $n % 100;
    if ($n100 >= 11 && $n100 <= 14) {
        return $n . ' раз';
    }
    if ($n10 === 1) {
        return $n . ' раз';
    }
    if ($n10 >= 2 && $n10 <= 4) {
        return $n . ' раза';
    }
    return $n . ' раз';
}

/** @param list<array{iso: string, id: int, line: string}> $items */
function portal_stats_sort_lines(array $items): array
{
    usort($items, static function ($a, $b) {
        $c = strcmp((string)($b['iso'] ?? ''), (string)($a['iso'] ?? ''));
        if ($c !== 0) {
            return $c;
        }
        return ((int)($b['id'] ?? 0) <=> (int)($a['id'] ?? 0));
    });
    $out = [];
    foreach ($items as $it) {
        $line = trim((string)($it['line'] ?? ''));
        if ($line !== '') {
            $out[] = $line;
        }
    }
    return $out;
}

/** @param list<string> $lines */
function portal_stats_tip_html(array $lines): string
{
    if (!$lines) {
        return '<p class="tip-empty">Нет</p>';
    }
    $html = '<ul class="tip-list">';
    foreach ($lines as $line) {
        $html .= '<li>' . h($line) . '</li>';
    }
    $html .= '</ul>';
    return $html;
}

function portal_stats_tips_json(array $tips): string
{
    $json = json_encode($tips, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG);
    if (!$json) {
        $json = '{}';
    }
    return str_replace('</', '<\/', $json);
}

/**
 * Статистика залогиненного: игры (игрок1/2), секундант/2-й игрок,
 * судейство, победы/поражения по голосам 1/2 (ничья не считается),
 * уникальные соперники с числом встреч,
 * число турниров (event_type=турнир, УБ Лидер) как игрок/секундант/судья.
 * tips — HTML разбивок для тултипов (играл / секундант / судил: онлайны+сколько раз / турниры / выиграл / проиграл / соперники).
 *
 * @return array{
 *   played: int, seconded: int, judged: int, tournaments: int,
 *   won: int, lost: int,
 *   rivals: list<array{id: int, name: string, n: int, tone: string}>,
 *   tips: array{played: string, seconded: string, judged: string, tournaments: string, won: string, lost: string, rivals: array<string, string>}
 * }|null
 */
function portal_person_stats(mysqli $db, int $personId): ?array
{
    if ($personId <= 0) {
        return null;
    }

    $played = 0;
    $seconded = 0;
    $won = 0;
    $lost = 0;
    $asPlayer = [];
    $secondedItems = [];

    $st = $db->prepare(
        'SELECT d.id, d.player1_id, d.second1_id, d.player2_id, d.second2_id,
                d.duel_date, d.prep_mode, d.duel_type,
                e.title AS event_title, e.starts_on,
                s.code AS sit_code, s.num AS sit_num,
                p1.full_name AS p1_name, p2.full_name AS p2_name
         FROM duels d
         LEFT JOIN events e ON e.id = d.event_id
         LEFT JOIN situations s ON s.id = d.situation_id
         LEFT JOIN people p1 ON p1.id = d.player1_id
         LEFT JOIN people p2 ON p2.id = d.player2_id
         WHERE d.player1_id = ? OR d.player2_id = ? OR d.second1_id = ? OR d.second2_id = ?'
    );
    $st->bind_param('iiii', $personId, $personId, $personId, $personId);
    $st->execute();
    $res = $st->get_result();
    while ($d = $res->fetch_assoc()) {
        $did = (int)$d['id'];
        $p1 = (int)$d['player1_id'];
        $p2 = (int)$d['player2_id'];
        $s1 = (int)$d['second1_id'];
        $s2 = (int)$d['second2_id'];
        $when = portal_stats_when($d['duel_date'] ?? null, $d['starts_on'] ?? null);
        $iso = $when['iso'];
        $date = $when['date'];
        $event = portal_event_title_short($d['event_title'] ?? '');
        if ($p1 === $personId || $p2 === $personId) {
            $played++;
            $side = $p1 === $personId ? 1 : 2;
            $oppId = $side === 1 ? $p2 : $p1;
            $oppName = $side === 1
                ? portal_name_or_empty($d['p2_name'] ?? null)
                : portal_name_or_empty($d['p1_name'] ?? null);
            $sit = portal_sit_label(
                $d['sit_code'] ?? null,
                $d['sit_num'] ?? null,
                (string)($d['prep_mode'] ?? ''),
                (string)($d['duel_type'] ?? '')
            );
            $asPlayer[$did] = [
                'side' => $side,
                'opp_id' => $oppId,
                'opp' => $oppName !== '' ? $oppName : ($oppId > 0 ? '#' . $oppId : ''),
                'iso' => $iso,
                'date' => $date,
                'event' => $event,
                'sit' => $sit,
            ];
        }
        if ($s1 === $personId || $s2 === $personId) {
            $seconded++;
            $whomId = $s1 === $personId ? $p1 : $p2;
            $whomName = $s1 === $personId
                ? portal_name_or_empty($d['p1_name'] ?? null)
                : portal_name_or_empty($d['p2_name'] ?? null);
            $whom = $whomName !== '' ? $whomName : ($whomId > 0 ? '#' . $whomId : '');
            $line = portal_stats_join_line($date, $event, $whom);
            if ($line === '') {
                $line = 'секундант';
            }
            $secondedItems[] = ['iso' => $iso, 'id' => $did, 'line' => $line];
        }
    }
    $st->close();

    $playedItems = [];
    $wonItems = [];
    $lostItems = [];
    $rivalIds = [];
    $rivalWins = [];
    $rivalLosses = [];
    $rivalItems = [];
    $rivalNames = [];

    foreach ($asPlayer as $did => $meta) {
        $meet = portal_stats_join_line($meta['date'], $meta['event'], $meta['sit']);
        if ($meet === '') {
            $meet = 'поединок';
        }
        $playedItems[] = ['iso' => $meta['iso'], 'id' => $did, 'line' => $meet];
        $oppId = (int)$meta['opp_id'];
        if ($oppId > 0) {
            if (!isset($rivalIds[$oppId])) {
                $rivalIds[$oppId] = 0;
                $rivalWins[$oppId] = 0;
                $rivalLosses[$oppId] = 0;
                $rivalItems[$oppId] = [];
            }
            $rivalIds[$oppId]++;
            $rivalItems[$oppId][] = ['iso' => $meta['iso'], 'id' => $did, 'line' => $meet];
            if ($meta['opp'] !== '') {
                $rivalNames[$oppId] = $meta['opp'];
            }
        }
    }

    if ($asPlayer) {
        $in = implode(',', array_map('intval', array_keys($asPlayer)));
        $votes = [];
        $r = $db->query("SELECT duel_id, vote FROM duel_judges WHERE duel_id IN ($in)");
        while ($row = $r->fetch_assoc()) {
            $did = (int)$row['duel_id'];
            if (!isset($votes[$did])) {
                $votes[$did] = ['1' => 0, '2' => 0];
            }
            $v = trim((string)$row['vote']);
            if ($v === '1' || $v === '2') {
                $votes[$did][$v]++;
            }
        }
        foreach ($asPlayer as $did => $meta) {
            $vv = $votes[$did] ?? ['1' => 0, '2' => 0];
            if ($vv['1'] === $vv['2']) {
                continue;
            }
            $winner = $vv['1'] > $vv['2'] ? 1 : 2;
            $oppId = (int)$meta['opp_id'];
            $oppLabel = $meta['opp'] !== '' ? $meta['opp'] : 'соперник';
            $wl = $oppLabel;
            if ($meta['date'] !== '') {
                $wl .= ' · ' . $meta['date'];
            }
            if ($winner === $meta['side']) {
                $won++;
                $wonItems[] = ['iso' => $meta['iso'], 'id' => $did, 'line' => $wl];
                if ($oppId > 0) {
                    $rivalWins[$oppId] = ($rivalWins[$oppId] ?? 0) + 1;
                }
                $asPlayer[$did]['outcome'] = 'выиграл';
            } else {
                $lost++;
                $lostItems[] = ['iso' => $meta['iso'], 'id' => $did, 'line' => $wl];
                if ($oppId > 0) {
                    $rivalLosses[$oppId] = ($rivalLosses[$oppId] ?? 0) + 1;
                }
                $asPlayer[$did]['outcome'] = 'проиграл';
            }
        }
    }

    foreach ($playedItems as &$it) {
        $outc = $asPlayer[(int)$it['id']]['outcome'] ?? '';
        if ($outc !== '') {
            $it['line'] .= ' · ' . $outc;
        }
    }
    unset($it);
    foreach ($rivalItems as &$items) {
        foreach ($items as &$it) {
            $outc = $asPlayer[(int)$it['id']]['outcome'] ?? '';
            if ($outc !== '') {
                $it['line'] .= ' · ' . $outc;
            }
        }
        unset($it);
    }
    unset($items);

    $judged = 0;
    $judgedByEvent = [];
    $st = $db->prepare(
        'SELECT d.id, d.event_id, d.duel_date, e.title AS event_title, e.starts_on
         FROM duel_judges dj
         INNER JOIN duels d ON d.id = dj.duel_id
         LEFT JOIN events e ON e.id = d.event_id
         WHERE dj.person_id = ?'
    );
    $st->bind_param('i', $personId);
    $st->execute();
    $jres = $st->get_result();
    while ($d = $jres->fetch_assoc()) {
        $judged++;
        $eid = (int)($d['event_id'] ?? 0);
        $when = portal_stats_when($d['duel_date'] ?? null, $d['starts_on'] ?? null);
        $event = portal_event_title_short($d['event_title'] ?? '');
        $key = $eid > 0 ? 'e' . $eid : 'none';
        if (!isset($judgedByEvent[$key])) {
            $judgedByEvent[$key] = [
                'iso' => $when['iso'],
                'id' => $eid > 0 ? $eid : 0,
                'n' => 0,
                'date' => $when['date'],
                'event' => $event !== '' ? $event : 'онлайн',
            ];
        }
        $judgedByEvent[$key]['n']++;
    }
    $st->close();
    $judgedItems = [];
    foreach ($judgedByEvent as $it) {
        $line = portal_stats_join_line(
            (string)$it['date'],
            (string)$it['event'],
            portal_stats_times_label((int)$it['n'])
        );
        if ($line === '') {
            $line = portal_stats_times_label((int)$it['n']);
        }
        $judgedItems[] = ['iso' => (string)$it['iso'], 'id' => (int)$it['id'], 'line' => $line];
    }

    $tournamentItems = [];
    $st = $db->prepare(
        "SELECT DISTINCT e.id, e.title, e.starts_on
         FROM events e
         WHERE e.event_type = 'турнир'
           AND (
             EXISTS (
               SELECT 1 FROM duels d
               WHERE d.event_id = e.id
                 AND (d.player1_id = ? OR d.player2_id = ?
                      OR d.second1_id = ? OR d.second2_id = ?)
             )
             OR EXISTS (
               SELECT 1 FROM duels d
               INNER JOIN duel_judges dj ON dj.duel_id = d.id
               WHERE d.event_id = e.id AND dj.person_id = ?
             )
           )"
    );
    $st->bind_param('iiiii', $personId, $personId, $personId, $personId, $personId);
    $st->execute();
    $tres = $st->get_result();
    while ($row = $tres->fetch_assoc()) {
        $when = portal_stats_when(null, $row['starts_on'] ?? null);
        $event = portal_event_title_short($row['title'] ?? '');
        $line = portal_stats_join_line($when['date'], $event, '');
        if ($line === '') {
            $line = 'турнир';
        }
        $tournamentItems[] = ['iso' => $when['iso'], 'id' => (int)$row['id'], 'line' => $line];
    }
    $st->close();
    $tournaments = count($tournamentItems);

    $missing = [];
    foreach ($rivalIds as $oid => $n) {
        if (!isset($rivalNames[$oid])) {
            $missing[] = (int)$oid;
        }
    }
    if ($missing) {
        $in = implode(',', $missing);
        $r = $db->query("SELECT id, full_name FROM people WHERE id IN ($in)");
        while ($row = $r->fetch_assoc()) {
            $rivalNames[(int)$row['id']] = $row['full_name'];
        }
    }

    $rivals = [];
    $rivalTips = [];
    foreach ($rivalIds as $oid => $n) {
        $w = (int)($rivalWins[$oid] ?? 0);
        $l = (int)($rivalLosses[$oid] ?? 0);
        if ($w > $l) {
            $tone = 'win';
        } elseif ($l > $w) {
            $tone = 'lose';
        } else {
            $tone = 'even';
        }
        $rivalTips[(string)$oid] = portal_stats_tip_html(portal_stats_sort_lines($rivalItems[$oid] ?? []));
        $rivals[] = [
            'id' => (int)$oid,
            'name' => $rivalNames[$oid] ?? ('#' . $oid),
            'n' => (int)$n,
            'tone' => $tone,
        ];
    }
    usort($rivals, static function ($a, $b) {
        if ($a['n'] === $b['n']) {
            return strcasecmp($a['name'], $b['name']);
        }
        return ($a['n'] < $b['n']) ? 1 : -1;
    });

    return [
        'played' => $played,
        'seconded' => $seconded,
        'judged' => $judged,
        'tournaments' => $tournaments,
        'won' => $won,
        'lost' => $lost,
        'rivals' => $rivals,
        'tips' => [
            'played' => portal_stats_tip_html(portal_stats_sort_lines($playedItems)),
            'seconded' => portal_stats_tip_html(portal_stats_sort_lines($secondedItems)),
            'judged' => portal_stats_tip_html(portal_stats_sort_lines($judgedItems)),
            'tournaments' => portal_stats_tip_html(portal_stats_sort_lines($tournamentItems)),
            'won' => portal_stats_tip_html(portal_stats_sort_lines($wonItems)),
            'lost' => portal_stats_tip_html(portal_stats_sort_lines($lostItems)),
            'rivals' => $rivalTips,
        ],
    ];
}
