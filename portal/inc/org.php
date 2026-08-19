<?php
declare(strict_types=1);

function portal_org_section_title(string $s): string
{
    foreach (portal_org_nav_items() as $item) {
        if ($item['id'] === $s) {
            return $item['label'];
        }
    }
    return 'Рабочее место';
}

function portal_echo_org_crumbs(string $section): void
{
    echo '<nav class="org-crumbs" aria-label="Разделы орга">';
    echo '<a class="org-to-members" href="./">К участникам</a>';
    if ($section !== '') {
        echo '<a class="org-crumb" href="' . h(portal_org_url()) . '">← Рабочее место</a>';
        echo '<span class="org-crumb-now">'
            . portal_icon(portal_org_section_icon($section)) . ' '
            . h(portal_org_section_title($section)) . '</span>';
    }
    echo '</nav>';
}

function portal_echo_org_hub(): void
{
    echo '<nav class="org-hub" aria-label="Разделы орга">';
    foreach (portal_org_nav_items() as $item) {
        echo '<a class="hub-item" href="' . h($item['href']) . '">';
        echo '<span class="hub-ico">' . portal_icon($item['icon']) . '</span>';
        echo '<span class="hub-label">' . h($item['label']) . '</span>';
        echo '</a>';
    }
    echo '</nav>';
}

function portal_echo_org_section(string $s): void
{
    if ($s === 'events' || $s === 'people' || $s === 'situations' || $s === 'materials') {
        return;
    }
    $title = portal_org_section_title($s);
    echo '<section class="card org-stub">';
    echo '<h1>' . portal_icon(portal_org_section_icon($s)) . ' ' . h($title) . '</h1>';
    echo '<p class="muted">Раздел пока без наполнения — каркас рабочего места.</p>';
    echo '</section>';
}

function portal_org_section_icon(string $s): string
{
    foreach (portal_org_nav_items() as $item) {
        if ($item['id'] === $s) {
            return $item['icon'];
        }
    }
    return 'lock';
}

function portal_echo_org_main(string $section): void
{
    echo '<div class="org-main">';
    if ($section === '') {
        echo '<h1 class="org-title">' . portal_icon('lock') . ' Рабочее место орга</h1>';
        portal_echo_org_hub();
    } else {
        portal_echo_org_section($section);
    }
    echo '</div>';
}
