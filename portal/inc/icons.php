<?php
declare(strict_types=1);

function portal_icon(string $id): string
{
    return '<svg class="ico" aria-hidden="true"><use href="#i-' . h($id) . '"></use></svg>';
}

/** Оранжевый кружок с белой i: тултип только с иконки, не с подписи. */
function portal_tip_mark(): string
{
    return '<span class="tip-ico" aria-hidden="true">i</span>';
}

function portal_tip_ico(string $kind, array $attrs = []): string
{
    $html = '<span class="tip-ico has-tip" data-tip="' . h($kind) . '"';
    foreach ($attrs as $k => $v) {
        $name = preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)$k);
        if ($name === '') {
            continue;
        }
        $html .= ' ' . $name . '="' . h((string)$v) . '"';
    }
    $html .= ' role="button" tabindex="0" aria-label="подробнее">i</span>';
    return $html;
}

function portal_icon_sprite(): void
{
    echo '<div class="icon-sprite">';
    echo <<<'SVG'
<svg xmlns="http://www.w3.org/2000/svg">
  <symbol id="i-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
  </symbol>
  <symbol id="i-user" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="8" r="3.5"/><path d="M5 19c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/>
  </symbol>
  <symbol id="i-calendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>
  </symbol>
  <symbol id="i-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3l2.6 5.4 6 .9-4.3 4.2 1 5.9L12 16.8 6.7 19.4l1-5.9L3.4 9.3l6-.9z"/>
  </symbol>
  <symbol id="i-next" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 12h14M13 6l6 6-6 6"/>
  </symbol>
  <symbol id="i-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3V4z"/><path d="M5 4a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h14"/>
  </symbol>
  <symbol id="i-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>
  </symbol>
  <symbol id="i-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 21V4m0 0h11l-2 3.5L16 11H5"/>
  </symbol>
  <symbol id="i-stats" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 20V10M12 20V4M20 20v-7"/>
  </symbol>
  <symbol id="i-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 11l8-7 8 7"/><path d="M6 10.5V20h12v-9.5"/>
  </symbol>
  <symbol id="i-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 7h6l2 2h10v11H3V7z"/>
  </symbol>
  <symbol id="i-video" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="6" width="13" height="12" rx="2"/>
    <path d="M16 10l5-3v10l-5-3z"/>
  </symbol>
</svg>
SVG;
    echo '</div>';
}
