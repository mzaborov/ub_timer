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
