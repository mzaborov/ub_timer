<?php
declare(strict_types=1);

if (!headers_sent()) {
    header('X-Robots-Tag: noindex, nofollow');
}

error_reporting(E_ALL);
ini_set('display_errors', '0');
date_default_timezone_set('Europe/Moscow');

$cfg = dirname(__DIR__) . '/../db.inc.php';
if (!is_file($cfg)) {
    header('HTTP/1.1 500 Internal Server Error');
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Нет конфига БД.';
    exit;
}
require $cfg;

if (!isset($portal_org_password)) {
    $portal_org_password = '';
}

if (!isset($portal_default_zoom)) {
    $portal_default_zoom = '';
}

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$db = mysqli_connect($mysql_host, $mysql_user, $mysql_password, $mysql_database);
$db->set_charset('utf8mb4');

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

const STREAM_CIRCLE = 'Стрим поединки я-ИТ-ы';
const FUB_CIRCLE = 'ФУБ';
const PARTNERS_CIRCLE = 'Партнеры';
const COMMUNITY_CIRCLE = 'я-ИТ-ы';
const COMMUNITY_A_CIRCLE = 'A (Ядро)';
const UNSORTED_CIRCLE = 'Несортированные';
const UNSORTED_INVOLVEMENT = 'новый';
const ORG_ROLES = ['Организатор', 'Куратор'];
const COOKIE_ME = 'ub_me';
const COOKIE_ORG = 'ub_org';
const COOKIE_TTL = 86400 * 400;

function h(?string $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function current_person_id(): int
{
    if (!empty($_SESSION['person_id'])) {
        return (int)$_SESSION['person_id'];
    }
    if (!empty($_COOKIE[COOKIE_ME])) {
        return (int)$_COOKIE[COOKIE_ME];
    }
    return 0;
}

/** Домен cookie ub_me: общий для портала и timer.zaborov.ru/points.php. */
function portal_cookie_domain(): string
{
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    $colon = strpos($host, ':');
    if ($colon !== false) {
        $host = substr($host, 0, $colon);
    }
    if ($host === 'zaborov.ru' || substr($host, -11) === '.zaborov.ru') {
        return '.zaborov.ru';
    }
    return '';
}

function portal_cookie_opts(int $expires, bool $shareDomain = false): array
{
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $opts = [
        'expires' => $expires,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ];
    if ($shareDomain) {
        $domain = portal_cookie_domain();
        if ($domain !== '') {
            $opts['domain'] = $domain;
        }
    }
    return $opts;
}

function set_person_cookie(int $id): void
{
    $opts = portal_cookie_opts(time() + COOKIE_TTL, true);
    if (!empty($opts['domain'])) {
        $hostOnly = $opts;
        unset($hostOnly['domain']);
        $hostOnly['expires'] = time() - 3600;
        setcookie(COOKIE_ME, '', $hostOnly);
    }
    setcookie(COOKIE_ME, (string)$id, $opts);
}

function clear_person_cookie(): void
{
    $past = portal_cookie_opts(time() - 3600, true);
    setcookie(COOKIE_ME, '', $past);
    if (!empty($past['domain'])) {
        $hostOnly = $past;
        unset($hostOnly['domain']);
        setcookie(COOKIE_ME, '', $hostOnly);
    }
}

function set_org_cookie(): void
{
    setcookie(COOKIE_ORG, '1', portal_cookie_opts(time() + COOKIE_TTL));
}

function clear_org_cookie(): void
{
    setcookie(COOKIE_ORG, '', portal_cookie_opts(time() - 3600));
}

function clear_org_mode(): void
{
    unset($_SESSION['org']);
    clear_org_cookie();
}

/** Восстановить режим орга из сессии или cookie. Без роли — стереть. */
function restore_org_session(bool $canOrg): bool
{
    if (!$canOrg) {
        if (!empty($_SESSION['org']) || !empty($_COOKIE[COOKIE_ORG])) {
            clear_org_mode();
        }
        return false;
    }
    if (!empty($_SESSION['org'])) {
        if (empty($_COOKIE[COOKIE_ORG])) {
            set_org_cookie();
        }
        return true;
    }
    if (!empty($_COOKIE[COOKIE_ORG]) && (string)$_COOKIE[COOKIE_ORG] === '1') {
        $_SESSION['org'] = 1;
        return true;
    }
    return false;
}

function load_person(mysqli $db, int $id): ?array
{
    if ($id <= 0) {
        return null;
    }
    $st = $db->prepare('SELECT id, full_name, email, telegram, is_active FROM people WHERE id = ?');
    $st->bind_param('i', $id);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    return $row ?: null;
}

/** Обрезка строки для people / membership (как у оргов). */
function portal_field_norm(string $s, int $max = 191): string
{
    $s = trim($s);
    if ($s === '') {
        return '';
    }
    if (function_exists('mb_substr')) {
        return mb_substr($s, 0, $max);
    }
    return substr($s, 0, $max);
}

function portal_circle_id_by_title(mysqli $db, string $title): int
{
    $st = $db->prepare('SELECT id FROM circles WHERE title = ? LIMIT 1');
    $st->bind_param('s', $title);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    $st->close();
    return $row ? (int)$row['id'] : 0;
}

/** Создаёт круг, если его ещё нет. */
function portal_ensure_circle(mysqli $db, string $title): int
{
    $id = portal_circle_id_by_title($db, $title);
    if ($id > 0) {
        return $id;
    }
    $st = $db->prepare('INSERT INTO circles (title) VALUES (?)');
    $st->bind_param('s', $title);
    $st->execute();
    $id = (int)$db->insert_id;
    $st->close();
    return $id;
}

/**
 * Саморегистрация: people + членство в «Несортированные» / «новый».
 * @return array{ok?:true,person_id?:int,error?:string}
 */
function portal_signup_person(mysqli $db, string $fullName, string $email, string $telegram): array
{
    $name = portal_field_norm($fullName);
    $email = portal_field_norm($email);
    $telegram = portal_field_norm($telegram, 64);
    if ($name === '') {
        return ['error' => 'Укажите ФИО'];
    }
    $st = $db->prepare('SELECT id FROM people WHERE full_name = ? LIMIT 1');
    $st->bind_param('s', $name);
    $st->execute();
    $exists = $st->get_result()->fetch_assoc();
    $st->close();
    if ($exists) {
        return ['error' => 'Вы уже в списке — выберите себя выше'];
    }
    $active = 1;
    $st = $db->prepare(
        'INSERT INTO people (full_name, email, telegram, is_active) VALUES (?, ?, ?, ?)'
    );
    $st->bind_param('sssi', $name, $email, $telegram, $active);
    $st->execute();
    $pid = (int)$db->insert_id;
    $st->close();
    if ($pid < 1) {
        return ['error' => 'Не удалось создать карточку'];
    }
    $cid = portal_ensure_circle($db, UNSORTED_CIRCLE);
    $inv = UNSORTED_INVOLVEMENT;
    $st = $db->prepare(
        'INSERT INTO circle_memberships (circle_id, person_id, involvement) VALUES (?, ?, ?)'
    );
    $st->bind_param('iis', $cid, $pid, $inv);
    $st->execute();
    $st->close();
    return ['ok' => true, 'person_id' => $pid];
}

function portal_csrf_token(): string
{
    if (empty($_SESSION['csrf']) || !is_string($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return $_SESSION['csrf'];
}

function portal_csrf_ok(?string $token): bool
{
    $token = (string)$token;
    return $token !== '' && hash_equals(portal_csrf_token(), $token);
}

function portal_csrf_field(): void
{
    echo '<input type="hidden" name="csrf" value="' . h(portal_csrf_token()) . '">';
}

function stream_roles(mysqli $db, int $personId): array
{
    $sql = 'SELECT cm.involvement FROM circle_memberships cm
            JOIN circles c ON c.id = cm.circle_id
            WHERE cm.person_id = ? AND c.title = ?';
    $st = $db->prepare($sql);
    $title = STREAM_CIRCLE;
    $st->bind_param('is', $personId, $title);
    $st->execute();
    $roles = [];
    $res = $st->get_result();
    while ($row = $res->fetch_assoc()) {
        $roles[] = $row['involvement'];
    }
    $st->close();
    return $roles;
}

function can_enter_org(array $roles): bool
{
    foreach ($roles as $r) {
        if (in_array($r, ORG_ROLES, true)) {
            return true;
        }
    }
    return false;
}

function org_role_label(array $roles): string
{
    if (in_array('Организатор', $roles, true)) {
        return 'Организатор';
    }
    if (in_array('Куратор', $roles, true)) {
        return 'Куратор';
    }
    return '';
}
