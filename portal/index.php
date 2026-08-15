<?php
declare(strict_types=1);

require __DIR__ . '/inc/bootstrap.php';
require __DIR__ . '/inc/rating.php';
require __DIR__ . '/inc/home_data.php';
require __DIR__ . '/inc/icons.php';
require __DIR__ . '/inc/nav.php';

$orgError = '';
$page = portal_norm_page((string)($_POST['p'] ?? $_GET['p'] ?? ''));
$loginNext = portal_safe_next((string)($_GET['next'] ?? $_POST['next'] ?? ''));

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = (string)($_POST['action'] ?? '');
    if ($action === 'identify') {
        $pid = (int)($_POST['person_id'] ?? 0);
        $p = load_person($db, $pid);
        if ($p) {
            $_SESSION['person_id'] = $pid;
            unset($_SESSION['org']);
            set_person_cookie($pid);
        }
        $next = portal_safe_next((string)($_POST['next'] ?? ''));
        header('Location: ' . ($next !== '' ? $next : portal_page_url($page)));
        exit;
    }
    if ($action === 'reset_me') {
        unset($_SESSION['person_id'], $_SESSION['org']);
        clear_person_cookie();
        header('Location: ' . portal_page_url($page));
        exit;
    }
    if ($action === 'org_login') {
        $pid = current_person_id();
        $roles = $pid ? stream_roles($db, $pid) : [];
        $pw = (string)($_POST['password'] ?? '');
        if ($pid && can_enter_org($roles) && $portal_org_password !== ''
            && hash_equals($portal_org_password, $pw)) {
            $_SESSION['org'] = 1;
            header('Location: ./');
            exit;
        }
        $orgError = 'Неверный пароль';
    }
    if ($action === 'org_logout') {
        unset($_SESSION['org']);
        header('Location: ./');
        exit;
    }
}

$meId = current_person_id();
$me = $meId ? load_person($db, $meId) : null;
if ($meId && !$me) {
    unset($_SESSION['person_id'], $_SESSION['org']);
    clear_person_cookie();
    $meId = 0;
}
if (!$me && $page === 'stats') {
    header('Location: ' . portal_page_url('profile'));
    exit;
}

$roles = $meId ? stream_roles($db, $meId) : [];
$canOrg = $me && can_enter_org($roles);
$orgOn = $canOrg && !empty($_SESSION['org']);
$roleLabel = org_role_label($roles);

$year = (int)date('Y');
$people = portal_people_list($db);
$events = portal_events_for_calendar($db);
$upcoming = portal_next_events($db);
$myRegs = $meId ? portal_my_registrations($db, $meId, array_column($upcoming, 'id')) : [];
$last = portal_default_meeting($events);
$lastLive = $last ? portal_event_is_live($last) : false;
$ratingRows = portal_rating_rows($db);
$widget = portal_rating_widget($ratingRows, $meId);
$widgetItems = $widget['items'];
$widgetFill = $widget['fill'];
$ratingTips = portal_rating_tips($ratingRows, []);
$ratingTips['_formula'] = portal_rating_formula_html();
$myStats = $meId ? portal_person_stats($db, $meId) : null;

$timerUrl = 'https://timer.zaborov.ru/';
$bankUrl = 'https://timer.zaborov.ru/situations-bank.html?from=portal';
$ratingUrl = 'https://timer.zaborov.ru/rating.php';
$navItems = portal_nav_items($bankUrl, $timerUrl);
$bodyPage = $page === '' ? 'hub' : $page;
?>
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Стрим управленческих навыков</title>
    <link rel="icon" href="assets/favicon.png">
    <link rel="stylesheet" href="css/portal.css?v=73">
</head>
<body class="page-<?php echo h($bodyPage); ?><?php echo $me ? '' : ' is-guest'; ?>">
<?php portal_icon_sprite(); ?>
<header class="top<?php echo $me ? '' : ' top--guest'; ?>">
    <div class="top-bar">
    <a class="brand" href="./" title="портал стрима развития управленческих навыков">
        <img src="assets/ciocdo_logo.png?v=2" alt="я-ИТ-ы" class="brand-logo">
        <span class="brand-title brand-title--long">портал стрима развития управленческих навыков</span>
        <span class="brand-title brand-title--short">Стрим навыков</span>
        <span class="brand-home"><?php echo portal_icon('home'); ?> На главную</span>
    </a>
    <nav class="top-links">
        <a class="to-timer" href="<?php echo h($bankUrl); ?>">
            <?php echo portal_icon('book'); ?>
            <span>Банк ситуаций</span>
        </a>
        <a class="to-timer" href="<?php echo h($timerUrl); ?>">
            <?php echo portal_icon('clock'); ?>
            <span>Часы для поединков</span>
        </a>
    </nav>
    <?php portal_menu_button(); ?>
    </div>
    <?php if (!$me) { ?>
    <div class="who who--guest">
        <label for="who-input"><?php echo portal_icon('user'); ?> Кто вы?</label>
        <p class="who-cta"><?php echo $loginNext !== '' ? 'Войдите, чтобы записаться на встречу' : 'Войдите, чтобы увидеть свою статистику и рейтинг'; ?></p>
        <div class="combo" data-combo>
            <input id="who-input" type="text" autocomplete="off" placeholder="начните вводить фамилию">
            <input type="hidden" name="person_id" id="who-id">
            <ul class="combo-list" hidden></ul>
        </div>
        <?php portal_who_form($page, $loginNext); ?>
    </div>
    <?php } else { ?>
    <div class="who who--me">
        <div class="who-info">
            <?php echo portal_icon('user'); ?>
            <strong><?php echo h($me['full_name']); ?></strong>
            <?php if ($roleLabel) { ?>
            <span class="who-role"><?php echo h($roleLabel); ?></span>
            <?php } ?>
        </div>
        <div class="who-actions">
            <?php if ($canOrg && !$orgOn) { ?>
            <form method="post" class="org-form org-only" id="org-login-form">
                <input type="hidden" name="action" value="org_login">
                <input type="hidden" name="password" value="">
                <button type="submit"><?php echo portal_icon('lock'); ?> Режим организатора</button>
            </form>
            <?php if ($orgError) { ?><span class="who-err org-only"><?php echo h($orgError); ?></span><?php } ?>
            <?php } elseif ($orgOn) { ?>
            <form method="post" class="org-only">
                <input type="hidden" name="action" value="org_logout">
                <button type="submit">Выйти из режима организатора</button>
            </form>
            <?php } ?>
            <form method="post">
                <input type="hidden" name="action" value="reset_me">
                <input type="hidden" name="p" value="<?php echo h($page); ?>">
                <button type="submit" class="btn-ghost">Это не я</button>
            </form>
        </div>
    </div>
    <?php } ?>
</header>
<?php portal_menu_drawer($navItems, $page, !$me); ?>

<main>
  <?php portal_hub($navItems, !$me); ?>
  <div class="grid-main">
    <div class="home-left">
    <section class="card mat-card">
        <h1><?php echo portal_icon('book'); ?> Материалы</h1>
        <ul class="mat-list">
            <li>
                <div class="mat-group">О поединках</div>
                <ul>
                    <li><a href="<?php echo h('https://docs.google.com/document/d/1xLDZo9Ttmv9ElGNWQ2tAzYSDHE523KGwsCwofaGJ-30/edit?usp=drive_link'); ?>" target="_blank" rel="noopener">Правила проведения поединков (М.Заборов)</a></li>
                    <li><a href="<?php echo h('https://docs.google.com/presentation/d/1IUxWNVIlX8bzUW97SHdpAXtuNtXQuCxa/edit?usp=sharing&ouid=109144507660418421539&rtpof=true&sd=true'); ?>" target="_blank" rel="noopener">Презентация о поединках для клуба</a></li>
                    <li><a href="<?php echo h('https://disk.yandex.ru/d/sBeLRYROyVRgTg'); ?>" target="_blank" rel="noopener">Инструктаж по Экспрессам от Ирины Окуловой</a></li>
                </ul>
            </li>
            <li>
                <div class="mat-group">Как судить</div>
                <ul>
                    <li><a href="<?php echo h('https://docs.google.com/presentation/d/1_tV0hz5QkF1T9_LkwOuoJxRpvLZ2EIfezVTP0sbRo2I/edit?usp=sharing'); ?>" target="_blank" rel="noopener">Памятка для судей</a></li>
                    <li><a href="<?php echo h('https://disk.yandex.ru/i/AGhh7Y-l8v2FNQ'); ?>" target="_blank" rel="noopener">Чек лист - как судить</a></li>
                    <li><a href="<?php echo h('https://youtu.be/gRL5WQvjlMo'); ?>" target="_blank" rel="noopener">Инструктаж для судей (М. Иващенко)</a></li>
                    <li><a href="<?php echo h('https://disk.yandex.ru/i/jJICOWt-l8DMlA'); ?>" target="_blank" rel="noopener">критерии судейства экспрессов</a></li>
                </ul>
            </li>
            <li>
                <div class="mat-group">Как готовиться</div>
                <ul>
                    <li><a href="<?php echo h('https://docs.google.com/presentation/d/14QaLgR-DRHu7o2h5bRwPpY-RFbcp9jT85ONv-hwCvGU/edit?usp=sharing'); ?>" target="_blank" rel="noopener">Алгоритм подготовки от Уральской школы переговоров</a></li>
                    <li><a href="<?php echo h('https://drive.google.com/file/d/1-Je9sn_TMglFO8iXp-Jfp-iJ4-vjIklT/view?usp=drive_link'); ?>" target="_blank" rel="noopener">Таблица слоев подготовки к поединку</a></li>
                    <li><a href="<?php echo h('https://docs.google.com/document/d/1kXCrfJjjwQhcLXGvIR-ZCyJ09oOQtNK9H0WfwpfPy1g/edit?usp=drive_link'); ?>" target="_blank" rel="noopener">Как готовиться (Заборов М.) - черновик</a></li>
                    <li>
                        <div class="mat-sub">Примеры подготовки</div>
                        <ul>
                            <li><a href="<?php echo h('https://xmind.ai/share/pYr01Fyo'); ?>" target="_blank" rel="noopener">Заборов М.(Xmind)</a></li>
                            <li><a href="<?php echo h('https://docs.google.com/spreadsheets/d/1IkCRZnhrOSqZyhg1ycZxYEyjcsUmx4QH/edit?usp=sharing&ouid=107060050572514905027&rtpof=true&sd=true'); ?>" target="_blank" rel="noopener">Рашевский Ярослав (Excel)</a></li>
                        </ul>
                    </li>
                </ul>
            </li>
        </ul>
    </section>
    <section class="card next-card">
        <h1><?php echo portal_icon('next'); ?> Ближайшее</h1>
        <?php if ($upcoming) { ?>
        <ul class="next-list">
            <?php foreach ($upcoming as $ev) {
                $meta = portal_next_meta($ev);
                $isReg = isset($myRegs[(int)$ev['id']]);
            ?>
            <li<?php echo $isReg ? ' class="next-item--reg"' : ''; ?>>
                <div class="next-row">
                    <div class="next-info">
                        <p class="next-title"><?php echo h(portal_event_title_with_time($ev)); ?></p>
                        <?php if ($meta !== '') { ?>
                        <p class="muted next-meta"><?php echo h($meta); ?></p>
                        <?php } ?>
                    </div>
                    <?php portal_echo_next_actions($ev, (bool)$me, $myRegs); ?>
                </div>
            </li>
            <?php } ?>
        </ul>
        <?php } else { ?>
        <p class="muted">Ближайших мероприятий пока нет.</p>
        <?php } ?>
    </section>
    <section class="card stats-card">
        <h1><?php echo portal_icon('stats'); ?> Моя статистика</h1>
        <?php if (!$me || !$myStats) { ?>
        <p class="hint">Выберите себя вверху</p>
        <?php } else { ?>
        <div class="stats-body">
            <ul class="stats-kpis">
                <li><span>Играл<?php echo portal_tip_ico('played'); ?></span><b><?php echo (int)$myStats['played']; ?></b></li>
                <li><span>Секундировал<?php echo portal_tip_ico('seconded'); ?></span><b><?php echo (int)$myStats['seconded']; ?></b></li>
                <li><span>Судил<?php echo portal_tip_ico('judged'); ?></span><b><?php echo (int)$myStats['judged']; ?></b></li>
                <li><span>Участие в турнирах<?php echo portal_tip_ico('tournaments'); ?></span><b><?php echo (int)$myStats['tournaments']; ?></b></li>
                <li><span>Выиграл<?php echo portal_tip_ico('won'); ?></span><b><?php echo (int)$myStats['won']; ?></b></li>
                <li><span>Проиграл<?php echo portal_tip_ico('lost'); ?></span><b><?php echo (int)$myStats['lost']; ?></b></li>
            </ul>
            <div class="stats-rivals-col">
                <h2>С кем играл</h2>
                <?php if (empty($myStats['rivals'])) { ?>
                <p class="muted">Пока нет поединков игроком.</p>
                <?php } else {
                    $rivalParts = [];
                    foreach ($myStats['rivals'] as $rv) {
                        $tone = (string)($rv['tone'] ?? 'even');
                        if ($tone !== 'win' && $tone !== 'lose') {
                            $tone = 'even';
                        }
                        $s = '<span class="rival rival--' . $tone . '">' . h($rv['name']);
                        if ($meId && (int)$rv['id'] === $meId) {
                            $s .= portal_you_mark();
                        }
                        $s .= portal_tip_ico('rival', ['data-rid' => (string)(int)$rv['id']]);
                        $n = (int)$rv['n'];
                        if ($n > 0) {
                            $s .= ' <span class="n">(' . $n . ')</span>';
                        }
                        $s .= '</span>';
                        $rivalParts[] = $s;
                    }
                ?>
                <p class="stats-rivals"><?php echo implode(', ', $rivalParts); ?></p>
                <?php } ?>
            </div>
        </div>
        <?php } ?>
    </section>
    </div>
    <div class="home-right">
    <div class="grid-top">
    <section class="card cal-card">
        <div class="cal-head">
            <button type="button" id="cal-prev" aria-label="Предыдущий год">‹</button>
            <h1><?php echo portal_icon('calendar'); ?> Календарь <span id="cal-year"><?php echo $year; ?></span></h1>
            <button type="button" id="cal-next" aria-label="Следующий год">›</button>
        </div>
        <div class="cal-mobile-bar" id="cal-mobile-bar">
            <div class="cal-years" id="cal-years" role="tablist" aria-label="Год"></div>
            <div class="cal-month-nav">
                <button type="button" id="cal-month-prev" aria-label="Предыдущий месяц">‹</button>
                <div class="cal-month-title" id="cal-month-title"></div>
                <button type="button" id="cal-month-next" aria-label="Следующий месяц">›</button>
            </div>
            <div class="cal-month-strip" id="cal-month-strip" role="tablist" aria-label="Месяц"></div>
        </div>
        <div id="year-cal" class="year-cal"></div>
    </section>
    <section class="card rating-card">
        <h1 class="rating-title-widget"><a class="h-link" href="<?php echo h($ratingUrl); ?>"><?php echo portal_icon('star'); ?> Количество баллов</a><?php echo portal_tip_ico('formula'); ?></h1>
        <h1 class="rating-title-full"><a class="h-link" href="<?php echo h($ratingUrl); ?>"><?php echo portal_icon('star'); ?> Полный рейтинг</a><?php echo portal_tip_ico('formula'); ?></h1>
        <?php if (!$me) { ?>
        <p class="hint">Выберите себя сверху — подсветим ваше место.</p>
        <?php } ?>
        <ol class="rating-list rating-list-widget">
            <?php portal_rating_echo_items($widgetItems, $meId); ?>
        </ol>
        <ol class="rating-list rating-list-full">
            <?php portal_rating_echo_items($ratingRows, $meId); ?>
        </ol>
    </section>
    </div>
    <section class="card last-card" id="last-card" data-me-id="<?php echo (int)$meId; ?>" data-today="<?php echo h(portal_today_iso()); ?>">
        <h1 class="last-head" id="last-head"<?php if ($last) { ?> title="<?php echo h(portal_last_heading($last)); ?>"<?php } ?>><?php echo portal_icon('flag'); ?> <span class="last-head-line"><span id="last-head-text"><?php echo $last ? h(portal_last_heading($last)) : 'Результаты последней встречи'; ?></span><span id="last-head-video"><?php echo $last ? portal_video_link_html(portal_event_day_video_url($last)) : ''; ?></span></span></h1>
        <div id="last-join" class="last-join"><?php echo $lastLive ? portal_join_button_html($last) : ''; ?></div>
        <div id="last-body">
        <?php if (!$last) { ?>
        <p class="muted">Пока нет прошедших встреч.</p>
        <?php } elseif (empty($last['duels'])) { ?>
        <?php if ($lastLive) { ?>
        <p class="muted">планирование ещё не начато</p>
        <?php echo portal_regs_html($last['regs'] ?? []); ?>
        <?php } else { ?>
        <p class="muted">Нет протоколов.</p>
        <?php } ?>
        <?php } else { ?>
        <div class="last-grid-wrap">
            <table class="last-grid">
                <thead>
                    <tr>
                        <th class="row-lab" scope="col"></th>
                        <?php foreach ($last['duels'] as $d) { ?>
                        <th scope="col"><?php echo (int)$d['order']; ?></th>
                        <?php } ?>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <th class="row-lab" scope="row">Ситуация</th>
                        <?php foreach ($last['duels'] as $d) {
                            echo portal_sit_td($d, true);
                        } ?>
                    </tr>
                    <tr>
                        <th class="row-lab" scope="row">Тип</th>
                        <?php foreach ($last['duels'] as $d) { ?>
                        <td class="typ"><?php echo h($d['type']); ?></td>
                        <?php } ?>
                    </tr>
                    <tr>
                        <th class="row-lab" scope="row">Игрок 1</th>
                        <?php foreach ($last['duels'] as $d) {
                            echo portal_side_td($d['p1'], $d['s1'], $lastLive ? -1 : (int)$d['winner'], 1, $meId, (int)$d['p1_id'], (int)$d['s1_id'], (($d['type'] ?? '') === 'парный'));
                        } ?>
                    </tr>
                    <tr>
                        <th class="row-lab" scope="row">Игрок 2</th>
                        <?php foreach ($last['duels'] as $d) {
                            echo portal_side_td($d['p2'], $d['s2'], $lastLive ? -1 : (int)$d['winner'], 2, $meId, (int)$d['p2_id'], (int)$d['s2_id'], (($d['type'] ?? '') === 'парный'));
                        } ?>
                    </tr>
                    <?php if (!$lastLive) { ?>
                    <tr>
                        <th class="row-lab" scope="row">Счёт</th>
                        <?php foreach ($last['duels'] as $d) {
                            echo portal_score_td($d);
                        } ?>
                    </tr>
                    <?php } ?>
                    <tr>
                        <th class="row-lab" scope="row">Судьи</th>
                        <?php foreach ($last['duels'] as $d) {
                            echo portal_judges_td($d, $meId);
                        } ?>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="last-duels">
            <?php foreach ($last['duels'] as $d) { ?>
            <article class="duel-card">
                <h3 class="duel-card-head"><span class="duel-num"><?php echo (int)$d['order']; ?></span>
                <span class="duel-typ"><?php echo h($d['type']); ?></span></h3>
                <table class="duel-mini"><tbody>
                    <tr><th scope="row">Ситуация</th><?php echo portal_sit_td($d, true); ?></tr>
                    <tr><th scope="row">Игрок 1</th><?php echo portal_side_td($d['p1'], $d['s1'], $lastLive ? -1 : (int)$d['winner'], 1, $meId, (int)$d['p1_id'], (int)$d['s1_id'], (($d['type'] ?? '') === 'парный')); ?></tr>
                    <tr><th scope="row">Игрок 2</th><?php echo portal_side_td($d['p2'], $d['s2'], $lastLive ? -1 : (int)$d['winner'], 2, $meId, (int)$d['p2_id'], (int)$d['s2_id'], (($d['type'] ?? '') === 'парный')); ?></tr>
                    <?php if (!$lastLive) { ?>
                    <tr><th scope="row">Счёт</th><?php echo portal_score_td($d); ?></tr>
                    <?php } ?>
                    <tr><th scope="row">Судьи</th><?php echo portal_judges_td($d, $meId); ?></tr>
                </tbody></table>
            </article>
            <?php } ?>
        </div>
        <?php } ?>
        </div>
    </section>
    </div>
  </div>
</main>

<script type="application/json" id="people-json"><?php echo json_encode($people, JSON_UNESCAPED_UNICODE); ?></script>
<script type="application/json" id="events-json"><?php echo json_encode($events, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG); ?></script>
<script type="application/json" id="rating-fill-json"><?php echo json_encode($widgetFill, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG); ?></script>
<script type="application/json" id="rating-tips-json"><?php echo rating_tooltip_json($ratingTips); ?></script>
<script type="application/json" id="stats-tips-json"><?php echo portal_stats_tips_json(is_array($myStats) ? ($myStats['tips'] ?? []) : []); ?></script>
<div id="rating-tip"></div>
<?php if (!$me) { portal_who_modal($loginNext, $loginNext !== ''); } ?>
<script src="js/menu.js?v=3"></script>
<script src="js/home.js?v=37"></script>
</body>
</html>
