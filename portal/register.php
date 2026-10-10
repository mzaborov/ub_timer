<?php
declare(strict_types=1);

require __DIR__ . '/inc/bootstrap.php';
require __DIR__ . '/inc/home_data.php';
require __DIR__ . '/inc/icons.php';
require __DIR__ . '/inc/nav.php';

function register_norm_duel_type_pref(string $raw): ?string
{
    $raw = mb_strtolower(trim($raw));
    $types = ['классика', 'экспресс', 'парный'];
    foreach ($types as $t) {
        if ($raw === mb_strtolower($t)) {
            return $t;
        }
    }
    return null;
}

function register_duel_type_options(?string $selected): string
{
    $options = [
        '' => 'любой',
        'классика' => 'классика',
        'экспресс' => 'экспресс',
        'парный' => 'парный',
    ];
    $html = '';
    foreach ($options as $value => $label) {
        $s = ($selected !== null && $selected === $value) || ($selected === null && $value === '') ? ' selected' : '';
        $html .= '<option value="' . h($value) . '"' . $s . '>' . h($label) . '</option>';
    }
    return $html;
}

$eventId = (int)($_POST['event'] ?? $_GET['event'] ?? 0);
$event = portal_event_by_id($db, $eventId);
$regSelf = $event ? portal_register_url($event) : '';
$loginNext = $regSelf !== '' ? $regSelf : ($eventId > 0 ? 'register.php?event=' . $eventId : '');

$meId = current_person_id();
$me = $meId ? load_person($db, $meId) : null;
if ($meId && !$me) {
    unset($_SESSION['person_id']);
    clear_org_mode();
    clear_person_cookie();
    $meId = 0;
    $me = null;
}
if ($me) {
    set_person_cookie($meId);
}
$people = $me ? [] : portal_people_list($db);

    $type = $event ? portal_event_type($event) : '';
    $nye = $event ? portal_event_is_nye($event) : false;
    $isTraining = $type === 'обучение';
    $canSignup = $event ? portal_event_allows_signup($event) : false;
$isCancelled = $event && ($event['status'] ?? '') === 'Отменено';
$mine = $event ? portal_find_registration($db, (int)$event['id'], $meId) : null;
$flash = '';
$error = '';

if ($me && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = (string)($_POST['action'] ?? '');
    if (!portal_csrf_ok((string)($_POST['csrf'] ?? ''))) {
        $error = 'Сессия устарела, обновите страницу.';
    } elseif (!$event) {
        $error = 'Мероприятие не найдено.';
    } elseif ($isCancelled) {
        $error = 'Мероприятие отменено.';
        } elseif ($action === 'register') {
        if ($nye) {
            $error = 'Регистрация на НГ ещё не открыта.';
        } elseif (!$canSignup) {
            $error = 'Регистрация на это мероприятие закрыта.';
        } elseif ($mine) {
            $flash = 'Вы уже записаны.';
        } else {
            $play = !empty($_POST['wants_play']) ? 1 : 0;
            $judge = !empty($_POST['wants_judge']) ? 1 : 0;
            $second = !empty($_POST['wants_second']) ? 1 : 0;
            $duelTypePref = register_norm_duel_type_pref((string)($_POST['duel_type_pref'] ?? ''));
            $comment = trim((string)($_POST['comment'] ?? ''));
            if (mb_strlen($comment) > 2000) {
                $comment = mb_substr($comment, 0, 2000);
            }
            $name = (string)$me['full_name'];
            $email = trim((string)($me['email'] ?? ''));
            $telegram = trim((string)($me['telegram'] ?? ''));
            $source = 'portal';
            try {
                $st = $db->prepare(
                    'INSERT INTO meeting_registrations
                     (event_id, person_id, full_name, email, telegram,
                      wants_play, wants_judge, wants_second, duel_type_pref, comment, source)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $eid = (int)$event['id'];
                $st->bind_param(
                    'iisssiiisss',
                    $eid,
                    $meId,
                    $name,
                    $email,
                    $telegram,
                    $play,
                    $judge,
                    $second,
                    $duelTypePref,
                    $comment,
                    $source
                );
                $st->execute();
                $st->close();
                $mine = portal_find_registration($db, $eid, $meId);
                $flash = 'Вы записаны.';
            } catch (Throwable $e) {
                $error = 'Не удалось сохранить заявку.';
            }
        }
    } elseif ($action === 'update') {
        if ($nye || !$canSignup) {
            $error = 'Редактирование заявки закрыто.';
        } elseif (!$mine) {
            $flash = 'Записи нет.';
        } else {
            $play = !empty($_POST['wants_play']) ? 1 : 0;
            $judge = !empty($_POST['wants_judge']) ? 1 : 0;
            $second = !empty($_POST['wants_second']) ? 1 : 0;
            $duelTypePref = register_norm_duel_type_pref((string)($_POST['duel_type_pref'] ?? ''));
            $comment = trim((string)($_POST['comment'] ?? ''));
            if (mb_strlen($comment) > 2000) {
                $comment = mb_substr($comment, 0, 2000);
            }
            try {
                $rid = (int)$mine['id'];
                $st = $db->prepare(
                    'UPDATE meeting_registrations
                     SET wants_play=?, wants_judge=?, wants_second=?, duel_type_pref=?, comment=?
                     WHERE id = ? AND person_id = ?'
                );
                $st->bind_param('iiissii', $play, $judge, $second, $duelTypePref, $comment, $rid, $meId);
                $st->execute();
                $st->close();
                $mine = portal_find_registration($db, (int)$event['id'], $meId);
                $flash = 'Заявка обновлена.';
            } catch (Throwable $e) {
                $error = 'Не удалось обновить заявку.';
            }
        }
    } elseif ($action === 'cancel') {
        if ($nye || !$canSignup) {
            $error = 'Отменить запись нельзя.';
        } elseif (!$mine) {
            $flash = 'Записи нет.';
        } else {
            try {
                $rid = (int)$mine['id'];
                $st = $db->prepare('DELETE FROM meeting_registrations WHERE id = ? AND person_id = ?');
                $st->bind_param('ii', $rid, $meId);
                $st->execute();
                $st->close();
                $mine = null;
                $flash = 'Запись отменена.';
            } catch (Throwable $e) {
                $error = 'Не удалось отменить запись.';
            }
        }
    }
    if ($error === '' && $eventId > 0) {
        if ($action === 'register') {
            $to = ((string)($_POST['back'] ?? '') === 'events')
                ? './?p=events&ok=registered'
                : './?ok=registered';
            header('Location: ' . $to);
            exit;
        }
        $_SESSION['reg_flash'] = $flash;
        if ((string)($_POST['back'] ?? '') === 'events') {
            header('Location: ./?p=events');
        } else {
            header('Location: register.php?event=' . $eventId);
        }
        exit;
    }
}

if ($flash === '' && !empty($_SESSION['reg_flash'])) {
    $flash = (string)$_SESSION['reg_flash'];
    unset($_SESSION['reg_flash']);
}

$timerUrl = 'https://timer.zaborov.ru/';
$bankUrl = 'https://timer.zaborov.ru/situations-bank.html?from=portal';
$navItems = portal_nav_items($bankUrl, $timerUrl);
?>
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?php echo $nye ? 'Регистрация на НГ' : 'Регистрация'; ?></title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="icon" href="assets/favicon.png">
    <link rel="stylesheet" href="css/portal.css?v=85">
</head>
<body class="page-register<?php echo $me ? '' : ' is-guest'; ?>">
<?php portal_icon_sprite(); ?>
<header class="top">
    <div class="top-bar">
    <a class="brand" href="./" title="портал стрима развития управленческих навыков">
        <img src="assets/ciocdo_logo.png?v=2" alt="я-ИТ-ы" class="brand-logo">
        <span class="brand-title brand-title--long">портал стрима развития управленческих навыков</span>
        <span class="brand-title brand-title--short">Стрим навыков</span>
        <span class="brand-home"><?php echo portal_icon('home'); ?> На главную</span>
    </a>
    <nav class="top-links">
        <a class="to-timer" href="./">
            <?php echo portal_icon('next'); ?>
            <span>На главную</span>
        </a>
    </nav>
    <?php portal_menu_button(); ?>
    </div>
</header>
<?php portal_menu_drawer($navItems, '', false); ?>
<main class="reg-wrap">
    <section class="card">
        <?php if (!$me) { ?>
        <h1>Регистрация</h1>
        <?php if ($event) { ?>
        <p class="next-title"><?php echo h($event['title']); ?></p>
        <p class="muted"><?php echo h(portal_event_dates($event)); ?></p>
        <?php } ?>
        <p>Чтобы записаться, укажите кто вы — или зарегистрируйтесь, если вас ещё нет в списке.</p>
        <p><button type="button" class="who-open-btn" data-who-open>Кто вы?</button>
        <button type="button" class="who-open-btn who-open-btn--ghost" data-who-signup>Меня нет в списке</button></p>
        <?php } elseif (!$event) { ?>
        <h1>Регистрация</h1>
        <p class="muted">Мероприятие не найдено.</p>
        <?php } else { ?>
        <h1><?php echo $nye ? 'Регистрация на НГ' : 'Регистрация'; ?></h1>
        <p class="next-title"><?php echo h($event['title']); ?></p>
        <p class="muted"><?php echo h(portal_event_dates($event)); ?>
            <?php if ($type !== '' && $type !== 'новогоднее') { ?> · <?php echo h($type); ?><?php } ?></p>
        <?php
            $showIcs = $mine && portal_ics_url($event) !== '';
            $showJoin = $mine && portal_zoom_join_open($event);
            if ($showJoin || $showIcs) {
        ?>
        <p class="reg-ics"><?php if ($showJoin) { portal_echo_zoom_link($event, 'join-btn join-btn--next'); } ?> <?php if ($showIcs) { portal_echo_ics_link($event); } ?></p>
        <?php } ?>
        <p class="reg-who">Вы: <strong><?php echo h($me['full_name']); ?></strong></p>
        <?php if ($error !== '') { ?>
        <p class="reg-error"><?php echo h($error); ?></p>
        <?php } ?>
        <?php if ($flash !== '' && !$mine) { ?>
        <p class="reg-flash"><?php echo h($flash); ?></p>
        <?php } ?>

        <?php if ($isCancelled) { ?>
        <p class="reg-error">Мероприятие отменено.</p>
        <?php } elseif ($nye) { ?>
        <p>Регистрация на НГ ещё не открыта.</p>
        <?php } elseif (!$canSignup) { ?>
        <p class="muted">Регистрация на это мероприятие закрыта.</p>
        <?php } elseif ($mine) { ?>
        <p class="reg-ok">Вы уже записаны.</p>
        <?php if ($flash !== '') { ?>
        <p class="reg-flash"><?php echo h($flash); ?></p>
        <?php } ?>
        <form method="post" class="reg-form reg-form--edit">
            <?php portal_csrf_field(); ?>
            <input type="hidden" name="event" value="<?php echo (int)$event['id']; ?>">
            <input type="hidden" name="action" value="update">
            <?php if (!$isTraining) { ?>
            <fieldset class="reg-roles">
                <legend>Хочу</legend>
                <label><input type="checkbox" name="wants_play" value="1" id="reg-wants-play"<?php echo !empty($mine['wants_play']) ? ' checked' : ''; ?>> играть</label>
                <label class="reg-type-pref" id="reg-type-pref-wrap"<?php echo empty($mine['wants_play']) ? ' hidden' : ''; ?>>тип поединка
                    <select name="duel_type_pref"><?php echo register_duel_type_options($mine['duel_type_pref'] ?? null); ?></select>
                </label>
                <label><input type="checkbox" name="wants_judge" value="1"<?php echo !empty($mine['wants_judge']) ? ' checked' : ''; ?>> судить</label>
                <label><input type="checkbox" name="wants_second" value="1"<?php echo !empty($mine['wants_second']) ? ' checked' : ''; ?>> быть секундантом</label>
            </fieldset>
            <?php } ?>
            <label class="reg-comment">Комментарий
                <textarea name="comment" rows="3" maxlength="2000" placeholder="необязательно"><?php echo h((string)($mine['comment'] ?? '')); ?></textarea>
            </label>
            <button type="submit">Сохранить</button>
        </form>
        <form method="post" class="reg-cancel" onsubmit="return confirm('Отменить запись?');">
            <?php portal_csrf_field(); ?>
            <input type="hidden" name="event" value="<?php echo (int)$event['id']; ?>">
            <input type="hidden" name="action" value="cancel">
            <button type="submit">Отменить регистрацию</button>
        </form>
        <?php } else { ?>
        <form method="post" class="reg-form">
            <?php portal_csrf_field(); ?>
            <input type="hidden" name="event" value="<?php echo (int)$event['id']; ?>">
            <input type="hidden" name="action" value="register">
            <?php if (!$isTraining) { ?>
            <fieldset class="reg-roles">
                <legend>Хочу</legend>
                <label><input type="checkbox" name="wants_play" value="1" id="reg-wants-play"> играть</label>
                <label class="reg-type-pref" id="reg-type-pref-wrap" hidden>тип поединка
                    <select name="duel_type_pref"><?php echo register_duel_type_options(null); ?></select>
                </label>
                <label><input type="checkbox" name="wants_judge" value="1"> судить</label>
                <label><input type="checkbox" name="wants_second" value="1"> быть секундантом</label>
            </fieldset>
            <?php } ?>
            <label class="reg-comment">Комментарий
                <textarea name="comment" rows="3" maxlength="2000" placeholder="необязательно"></textarea>
            </label>
            <button type="submit">Записаться</button>
        </form>
        <?php } ?>
        <?php } ?>
        <p class="reg-back"><a href="./?p=events">← к ближайшим встречам</a></p>
    </section>
</main>
<?php if (!$me) {
    portal_who_form('', $loginNext);
    portal_who_modal($loginNext, true);
} ?>
<?php if (!$me) { ?>
<script type="application/json" id="people-json"><?php echo json_encode($people, JSON_UNESCAPED_UNICODE); ?></script>
<?php } ?>
<script src="js/menu.js?v=3"></script>
<?php if (!$me) { ?>
<script src="js/home.js?v=42"></script>
<?php } ?>
<script>
(function () {
  var play = document.getElementById('reg-wants-play');
  var wrap = document.getElementById('reg-type-pref-wrap');
  if (!play || !wrap) {
    return;
  }
  function toggle() {
    wrap.hidden = !play.checked;
    var sel = wrap.querySelector('select');
    if (sel) {
      sel.disabled = !play.checked;
      if (!play.checked) {
        sel.value = '';
      }
    }
  }
  play.addEventListener('change', toggle);
  toggle();
})();
</script>
</body>
</html>
