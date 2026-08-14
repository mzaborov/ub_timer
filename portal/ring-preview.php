<?php
declare(strict_types=1);
header('Content-Type: text/html; charset=utf-8');

/** Кандидаты кольца — одни и те же для онлайна и офлайна. */
$variants = [
    ['slug' => 'orange', 'name' => 'Фирменный оранжевый', 'hex' => '#e65100'],
    ['slug' => 'white', 'name' => 'Белый', 'hex' => '#ffffff'],
    ['slug' => 'black', 'name' => 'Чёрный', 'hex' => '#111111'],
    ['slug' => 'navy', 'name' => 'Графит / тёмно-синий', 'hex' => '#1a365d'],
    ['slug' => 'gold', 'name' => 'Золото / жёлтый', 'hex' => '#ffd54f'],
    ['slug' => 'teal', 'name' => 'Тёмный бирюзовый', 'hex' => '#004d40'],
    ['slug' => 'purple', 'name' => 'Глубокий фиолетовый', 'hex' => '#4a148c'],
    ['slug' => 'brown', 'name' => 'Тёплый коричневый', 'hex' => '#3e2723'],
    ['slug' => 'cream', 'name' => 'Кремовый / слоновая кость', 'hex' => '#ffecb3'],
    ['slug' => 'forest', 'name' => 'Лесной зелёный', 'hex' => '#1b5e20'],
    ['slug' => 'cyan', 'name' => 'Голубой / циан', 'hex' => '#00acc1'],
    ['slug' => 'blue', 'name' => 'Ярко-синий', 'hex' => '#1565c0'],
];

$rpDefaultOnline = '#e65100';
$rpDefaultOffline = '#ffffff';

/** Даты календаря 2026 как на главной (без шаблонных Онлайн 10). */
$rpEvents = [
    '2026-02-07' => ['type' => 'онлайн', 'status' => 'Проведено', 'title' => 'Онлайн 24 07.02.2026'],
    '2026-03-15' => ['type' => 'онлайн', 'status' => 'Проведено', 'title' => 'Онлайн 25 15.03.2026'],
    '2026-04-11' => ['type' => 'онлайн', 'status' => 'Отменено', 'title' => 'Онлайн 11.04.2026'],
    '2026-05-31' => ['type' => 'онлайн', 'status' => 'Проведено', 'title' => 'Онлайн 26 31.05.2026'],
    '2026-06-27' => ['type' => 'купала', 'status' => 'Проведено', 'title' => 'Купала 2026 27.06.2026'],
    '2026-06-28' => ['type' => 'купала', 'status' => 'Проведено', 'title' => 'Купала 2026 28.06.2026'],
    '2026-08-09' => ['type' => 'онлайн', 'status' => 'Проведено', 'title' => 'Онлайн 27 09.08.2026'],
    '2026-09-19' => ['type' => 'онлайн', 'status' => 'Запланировано', 'title' => 'Онлайн 28 19.09.2026'],
    '2026-10-25' => ['type' => 'онлайн', 'status' => 'Запланировано', 'title' => 'Онлайн 29 25.10.2026'],
    '2026-12-05' => ['type' => 'новогоднее', 'status' => 'Запланировано', 'title' => 'НГ Разморозка 2026'],
    '2026-12-06' => ['type' => 'новогоднее', 'status' => 'Запланировано', 'title' => 'НГ Разморозка 2026'],
];

$rpToday = '2026-08-14';
$rpYear = 2026;
$rpMonths = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function rp_h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function rp_is_special(string $type): bool
{
    return $type === 'купала' || $type === 'новогоднее';
}

function rp_is_planned(string $status): bool
{
    return $status === 'Запланировано' || $status === 'Подготовка';
}

function rp_month_html(
    int $year,
    int $month,
    string $today,
    array $byDay,
    array $monthNames
): string {
    $first = new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month));
    $startDow = ((int) $first->format('N')) - 1;
    $dim = (int) $first->format('t');
    $html = '<div class="month"><h2>' . rp_h($monthNames[$month - 1]) . '</h2><table><tbody>';
    $day = 1 - $startDow;
    for ($row = 0; $row < 6; $row++) {
        $html .= '<tr>';
        $empty = true;
        for ($col = 0; $col < 7; $col++) {
            if ($day < 1 || $day > $dim) {
                $html .= '<td></td>';
            } else {
                $empty = false;
                $iso = sprintf('%04d-%02d-%02d', $year, $month, $day);
                $ev = $byDay[$iso] ?? null;
                $cls = [];
                $kind = 'empty';
                if ($col >= 5) {
                    $cls[] = 'wknd';
                }
                if ($ev) {
                    $cls[] = 'ev';
                    if (rp_is_special((string) $ev['type'])) {
                        $cls[] = 'special';
                        $cls[] = 'offline';
                        $kind = 'offline';
                    }
                    if ($ev['type'] === 'онлайн') {
                        $cls[] = 'online';
                        $kind = 'online';
                    }
                    if (rp_is_planned((string) $ev['status'])) {
                        $cls[] = 'planned';
                    }
                    if ($ev['status'] === 'Отменено') {
                        $cls[] = 'cancelled';
                    }
                }
                if ($iso < $today) {
                    $cls[] = 'past';
                }
                $title = $ev['title'] ?? '';
                $html .= '<td';
                if ($cls) {
                    $html .= ' class="' . rp_h(implode(' ', $cls)) . '"';
                }
                $html .= ' data-iso="' . rp_h($iso) . '" data-kind="' . rp_h($kind) . '"';
                if ($title !== '') {
                    $html .= ' title="' . rp_h($title) . '"';
                }
                $html .= '>' . $day . '</td>';
            }
            $day++;
        }
        $html .= '</tr>';
        if ($empty && $row > 3) {
            break;
        }
    }
    $html .= '</tbody></table></div>';
    return $html;
}

function rp_year_html(int $year, string $today, array $byDay, array $monthNames): string
{
    $html = '<div class="year-cal">';
    for ($m = 1; $m <= 12; $m++) {
        $html .= rp_month_html($year, $m, $today, $byDay, $monthNames);
    }
    $html .= '</div>';
    return $html;
}

function rp_swatches_html(array $variants, string $activeHex): string
{
    $html = '';
    foreach ($variants as $v) {
        $on = strcasecmp($v['hex'], $activeHex) === 0 ? ' is-on' : '';
        $html .= '<button type="button" class="rp-swatch-btn' . $on . '" data-hex="' . rp_h($v['hex']) . '"'
            . ' title="' . rp_h($v['name'] . ' ' . $v['hex']) . '">'
            . '<i class="rp-chip" style="background:' . rp_h($v['hex']) . '"></i>'
            . '<span class="rp-chip-label">' . rp_h($v['name']) . '</span>'
            . '<span class="rp-chip-hex">' . rp_h($v['hex']) . '</span>'
            . '</button>';
    }
    return $html;
}
?>
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Черновик: цвет кольца календаря</title>
    <link rel="icon" href="assets/favicon.png">
    <link rel="stylesheet" href="css/portal.css?v=42">
    <style>
        html { scroll-padding-top: 3.4rem; }
        .rp {
            max-width: 48rem;
            margin: 0 auto;
            padding: 1.25rem 1.25rem 3rem;
        }
        .rp-banner {
            margin: 0 0 1.1rem;
            padding: 0.75rem 0.9rem;
            background: #fff8e1;
            border: 1px dashed #e65100;
            border-radius: 8px;
        }
        .rp-banner strong { color: #bf360c; }
        .rp-banner p { margin: 0.35rem 0 0; color: var(--muted); font-size: 0.92rem; }
        .rp h1 { margin: 0 0 0.35rem; font-size: 1.15rem; }
        .rp-legend {
            display: flex;
            flex-wrap: wrap;
            gap: 0.45rem 1rem;
            margin: 0 0 0.85rem;
            font-size: 0.82rem;
            color: var(--muted);
        }
        .rp-legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
        .rp-mini {
            display: inline-block;
            width: 1.15rem;
            height: 1.05rem;
            border: 1px solid #ccc;
            vertical-align: middle;
            font-size: 0.55rem;
            font-weight: 700;
            line-height: 1.05rem;
            text-align: center;
            position: relative;
            box-sizing: border-box;
        }
        .rp-mini.sel::after {
            content: "";
            position: absolute;
            inset: 0;
            border: 2px solid currentColor;
            pointer-events: none;
            box-sizing: border-box;
        }
        .rp-pickers {
            position: sticky;
            top: 0;
            z-index: 20;
            margin: 0 0 1rem;
            padding: 0.5rem 0 0.65rem;
            background: #fafafa;
            border-bottom: 1px solid var(--line);
        }
        .rp-picker + .rp-picker { margin-top: 0.55rem; }
        .rp-picker-label {
            margin: 0 0 0.3rem;
            font-size: 0.82rem;
            font-weight: 700;
        }
        .rp-swatches {
            display: flex;
            flex-wrap: wrap;
            gap: 0.3rem;
        }
        .rp-swatch-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            margin: 0;
            padding: 0.18rem 0.42rem 0.18rem 0.22rem;
            border: 2px solid #ddd;
            border-radius: 4px;
            background: #fff;
            cursor: pointer;
            font: inherit;
            font-size: 0.72rem;
            color: #333;
            line-height: 1.15;
        }
        .rp-swatch-btn:hover { border-color: #e65100; }
        .rp-swatch-btn.is-on {
            border-color: #e65100;
            box-shadow: 0 0 0 1px #e65100;
        }
        .rp-chip {
            display: inline-block;
            width: 1.05rem;
            height: 1.05rem;
            border: 1px solid #bbb;
            border-radius: 2px;
            flex: 0 0 auto;
            box-sizing: border-box;
        }
        .rp-chip-hex {
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            color: var(--muted);
        }
        .rp-cal {
            --sel-ring-online: <?php echo rp_h($rpDefaultOnline); ?>;
            --sel-ring-offline: <?php echo rp_h($rpDefaultOffline); ?>;
            --sel-ring-empty: #1a365d;
        }
        .rp .year-cal {
            width: 100%;
            max-width: 100%;
        }
        .rp .month td[data-iso] {
            cursor: pointer;
            user-select: none;
        }
        .rp .month td.sel {
            position: relative;
            z-index: 1;
        }
        .rp .month td.sel::after {
            content: "";
            position: absolute;
            inset: 0;
            border: 3px solid var(--sel-ring-empty);
            pointer-events: none;
            box-sizing: border-box;
        }
        .rp .month td.ev.sel::after {
            border-color: var(--sel-ring-offline);
        }
        .rp .month td.ev.online.sel::after {
            border-color: var(--sel-ring-online);
        }
        @media (max-width: 640px) {
            .rp { padding-left: 0.7rem; padding-right: 0.7rem; }
            .rp-chip-label { display: none; }
        }
    </style>
</head>
<body>
<main class="rp">
    <div class="rp-banner">
        <h1><strong>Черновик, потом удалим.</strong> Цвет кольца выбранного дня</h1>
        <p>Один календарь 2026, как на главной. Клик по дню включает/выключает кольцо (можно несколько сразу). Сверху два переключателя: онлайн и офлайн (Купала/НГ). Пустой день — кольцо графитом <code>#1a365d</code>.</p>
    </div>
    <p class="rp-legend">
        <span><i class="rp-mini" style="background:#00897b;color:#fff;border-color:#00796b;">14</i> онлайн прошедший</span>
        <span><i class="rp-mini" style="background:#b2dfdb;color:#00695c;border-color:#80cbc4;">15</i> онлайн план</span>
        <span><i class="rp-mini" style="background:#e65100;color:#fff;border-color:#e65100;">21</i> Купала/НГ прошедший</span>
        <span><i class="rp-mini" style="background:#ffe0b2;color:#e65100;border-color:#ffcc80;">22</i> Купала/НГ план</span>
        <span><i class="rp-mini" style="background:#bdbdbd;color:#424242;border-color:#9e9e9e;text-decoration:line-through;">11</i> отменено</span>
        <span><i class="rp-mini sel" style="background:#00897b;color:#e65100;border-color:#00796b;">9</i> выбранный онлайн</span>
        <span><i class="rp-mini sel" style="background:#e65100;color:#fff;border-color:#e65100;">27</i> выбранный офлайн</span>
    </p>
    <div class="rp-pickers">
        <div class="rp-picker" data-picker="online">
            <p class="rp-picker-label">Онлайн — цвет кольца выбранного дня</p>
            <div class="rp-swatches">
                <?php echo rp_swatches_html($variants, $rpDefaultOnline); ?>
            </div>
        </div>
        <div class="rp-picker" data-picker="offline">
            <p class="rp-picker-label">Офлайн (Купала / НГ) — цвет кольца выбранного дня</p>
            <div class="rp-swatches">
                <?php echo rp_swatches_html($variants, $rpDefaultOffline); ?>
            </div>
        </div>
    </div>
    <div class="rp-cal">
        <?php echo rp_year_html($rpYear, $rpToday, $rpEvents, $rpMonths); ?>
    </div>
</main>
<script src="js/ring-preview.js"></script>
</body>
</html>
