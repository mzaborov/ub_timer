<?php
declare(strict_types=1);

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

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$db = mysqli_connect($mysql_host, $mysql_user, $mysql_password, $mysql_database);
$db->set_charset('utf8mb4');

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

const STREAM_CIRCLE = 'Стрим поединки я-ИТ-ы';
const ORG_ROLES = ['Организатор', 'Куратор'];
const COOKIE_ME = 'ub_me';

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

function set_person_cookie(int $id): void
{
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    setcookie(COOKIE_ME, (string)$id, [
        'expires' => time() + 86400 * 400,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function clear_person_cookie(): void
{
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    setcookie(COOKIE_ME, '', [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
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
