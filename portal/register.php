<?php
declare(strict_types=1);

require __DIR__ . '/inc/bootstrap.php';
require __DIR__ . '/inc/home_data.php';
require __DIR__ . '/inc/icons.php';
require __DIR__ . '/inc/nav.php';

$event = portal_event_by_id($db, (int)($_GET['event'] ?? 0));
$type = $event ? (string)$event['event_type'] : '';
$nye = $type === 'новогоднее';
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
    <link rel="icon" href="assets/favicon.png">
    <link rel="stylesheet" href="css/portal.css?v=62">
</head>
<body class="page-register">
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
<?php portal_menu_drawer($navItems, '', !current_person_id()); ?>
<main class="reg-wrap">
    <section class="card">
        <?php if (!$event) { ?>
        <h1>Регистрация</h1>
        <p class="muted">Мероприятие не найдено.</p>
        <?php } elseif ($nye) { ?>
        <h1>Регистрация на НГ</h1>
        <p class="next-title"><?php echo h($event['title']); ?></p>
        <p class="muted"><?php echo h(portal_event_dates($event)); ?></p>
        <p>Регистрация на НГ закрыта.</p>
        <?php } else { ?>
        <h1>Регистрация</h1>
        <p class="next-title"><?php echo h($event['title']); ?></p>
        <p class="muted"><?php echo h(portal_event_dates($event)); ?>
            <?php if ($type !== '') { ?> · <?php echo h($type); ?><?php } ?></p>
        <p>Форма заявки скоро.</p>
        <?php } ?>
        <p class="reg-back"><a href="./?p=events">← к ближайшим встречам</a></p>
    </section>
</main>
<script src="js/menu.js?v=3"></script>
</body>
</html>
