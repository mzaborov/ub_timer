<?php
declare(strict_types=1);

function portal_norm_page(string $p): string
{
    return in_array($p, ['profile', 'events', 'stats', 'rating', 'materials'], true) ? $p : '';
}

function portal_page_url(string $p): string
{
    $p = portal_norm_page($p);
    return $p === '' ? './' : './?p=' . rawurlencode($p);
}

/** Только наша форма заявки: register.php?event=N */
function portal_safe_next(?string $next): string
{
    $next = trim((string)$next);
    if (preg_match('/^register\.php\?event=(\d+)$/', $next, $m)) {
        return 'register.php?event=' . (int)$m[1];
    }
    return '';
}

function portal_login_url(string $next = ''): string
{
    $next = portal_safe_next($next);
    $url = './?p=profile';
    if ($next !== '') {
        $url .= '&next=' . rawurlencode($next);
    }
    return $url;
}

/** Скрытая форма identify (ub_me) — общая для шапки и попапа. */
function portal_who_form(string $page, string $loginNext): void
{
    echo '<form method="post" action="./" id="who-form">';
    echo '<input type="hidden" name="action" value="identify">';
    echo '<input type="hidden" name="p" value="' . h($page) . '">';
    echo '<input type="hidden" name="next" value="' . h($loginNext) . '">';
    echo '<input type="hidden" name="person_id" id="who-form-id" value="">';
    echo '</form>';
}

/** Попап «Кто вы?» — тот же autocomplete, что в шапке. */
function portal_who_modal(string $loginNext = '', bool $autoOpen = false): void
{
    $open = $autoOpen ? ' data-open="1"' : '';
    echo '<div id="who-modal" class="who-modal"' . $open . ' hidden>';
    echo '<div class="who-modal-backdrop" data-who-close></div>';
    echo '<div class="who-modal-box" role="dialog" aria-modal="true" aria-labelledby="who-modal-title">';
    echo '<button type="button" class="who-modal-close" data-who-close aria-label="Закрыть">×</button>';
    echo '<h2 id="who-modal-title">' . portal_icon('user') . ' Кто вы?</h2>';
    echo '<p class="who-modal-cta">Войдите, чтобы записаться на встречу</p>';
    echo '<div class="combo" data-combo>';
    echo '<input id="who-modal-input" type="text" autocomplete="off" placeholder="начните вводить фамилию">';
    echo '<ul class="combo-list" hidden></ul>';
    echo '</div></div></div>';
}

function portal_nav_items(string $bankUrl, string $timerUrl): array
{
    return [
        ['id' => 'profile', 'label' => 'Профиль', 'icon' => 'user', 'href' => './?p=profile'],
        ['id' => 'events', 'label' => 'Мероприятия', 'icon' => 'calendar', 'href' => './?p=events'],
        ['id' => 'stats', 'label' => 'Моя статистика', 'icon' => 'stats', 'href' => './?p=stats'],
        ['id' => 'rating', 'label' => 'Рейтинг', 'icon' => 'star', 'href' => './?p=rating'],
        ['id' => 'bank', 'label' => 'Банк ситуаций', 'icon' => 'book', 'href' => $bankUrl],
        ['id' => 'materials', 'label' => 'Материалы', 'icon' => 'folder', 'href' => './?p=materials'],
        ['id' => 'clocks', 'label' => 'Часы', 'icon' => 'clock', 'href' => $timerUrl],
    ];
}

function portal_menu_button(): void
{
    echo '<button type="button" class="menu-btn" id="menu-btn" aria-label="Меню" aria-expanded="false" aria-controls="menu-drawer">';
    echo '<span class="menu-bars" aria-hidden="true"></span>';
    echo '</button>';
}

function portal_guest_cta(): string
{
    return 'Войдите, чтобы увидеть свою статистику и рейтинг';
}

function portal_menu_drawer(array $items, string $page = '', bool $guest = false): void
{
    echo '<div class="menu-backdrop" id="menu-backdrop" hidden></div>';
    echo '<aside class="menu-drawer" id="menu-drawer" hidden>';
    echo '<div class="menu-drawer-head"><strong>Меню</strong>';
    echo '<button type="button" class="menu-close" id="menu-close" aria-label="Закрыть">×</button></div>';
    echo '<nav class="menu-links">';
    foreach ($items as $item) {
        if ($guest && $item['id'] === 'stats') {
            continue;
        }
        $on = ($item['id'] === $page);
        $cta = $guest && $item['id'] === 'profile';
        $cls = 'menu-item';
        if ($on) {
            $cls .= ' is-on';
        }
        if ($cta) {
            $cls .= ' menu-item--cta';
        }
        echo '<a class="' . $cls . '" href="' . h($item['href']) . '"';
        if ($on) {
            echo ' aria-current="page"';
        }
        echo '>' . portal_icon($item['icon']);
        echo '<span class="menu-item-text"><span>' . h($item['label']) . '</span>';
        if ($cta) {
            echo '<span class="menu-cta">' . h(portal_guest_cta()) . '</span>';
        }
        echo '</span></a>';
    }
    echo '</nav></aside>';
}

function portal_hub(array $items, bool $guest = false): void
{
    echo '<nav class="hub" aria-label="Разделы">';
    foreach ($items as $item) {
        if ($guest && $item['id'] === 'stats') {
            continue;
        }
        $cta = $guest && $item['id'] === 'profile';
        echo '<a class="hub-item' . ($cta ? ' hub-item--cta' : '') . '" href="' . h($item['href']) . '">';
        echo '<span class="hub-ico">' . portal_icon($item['icon']) . '</span>';
        echo '<span class="hub-label">' . h($item['label']) . '</span>';
        if ($cta) {
            echo '<span class="hub-cta">' . h(portal_guest_cta()) . '</span>';
        }
        echo '</a>';
    }
    echo '</nav>';
}
