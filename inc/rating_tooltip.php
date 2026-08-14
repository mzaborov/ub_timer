<?php
/**
 * HTML тултипа расшифровки рейтинга (PHP 5.2).
 * Слагаемые из rating_weights(); списки — из details, которые считает
 * rating_compute(). Страница rating.php и виджет портала только вызывают.
 */

function rating_esc($s) {
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function rating_fmt_pts($n) {
    $n = (float)$n;
    if (abs($n - round($n)) < 0.001) return (string)((int)round($n));
    return number_format($n, 1, '.', '');
}

function rating_fmt_weight($w) {
    $w = (float)$w;
    if (abs($w - round($w)) < 0.001) return (string)((int)round($w));
    return (string)$w;
}

function rating_tooltip_formula_html($row) {
    $W = rating_weights();
    $items = array(
        array('Турниры', 'tourn', $W['tourn']),
        array('Победы', 'win', $W['win']),
        array('Поражения', 'lose', $W['lose']),
        array('Победы секунданта', 'swin', $W['swin']),
        array('Поражения секунданта', 'slose', $W['slose']),
        array('Судил', 'judge', $W['judge']),
        array('Голоса', 'votes', $W['votes']),
    );
    $html = '<table>';
    $i = 0;
    $n = count($items);
    for ($i = 0; $i < $n; $i++) {
        $key = $items[$i][1];
        $cnt = isset($row[$key]) ? (float)$row[$key] : 0;
        $w = $items[$i][2];
        $pts = $cnt * $w;
        $line = rating_fmt_pts($cnt) . '×' . rating_fmt_weight($w) . ' = ' . rating_fmt_pts($pts);
        $html .= '<tr><th>' . rating_esc($items[$i][0]) . '</th><td>' . rating_esc($line) . '</td></tr>';
    }
    $sum = isset($row['rating']) ? number_format((float)$row['rating'], 1, '.', '') : '';
    $html .= '<tr class="tip-sum"><td colspan="2">= ' . rating_esc($sum) . '</td></tr></table>';
    return $html;
}

function rating_tooltip_list_html($items) {
    if (!$items || !count($items)) return '<p class="tip-empty">Нет</p>';
    $n = count($items);
    $show = $n > 15 ? 15 : $n;
    $extra = $n - $show;
    $html = '<ul class="tip-list">';
    $i = 0;
    for ($i = 0; $i < $show; $i++) {
        $it = $items[$i];
        if (!is_array($it)) $it = array();
        $ev = (isset($it['ev']) && $it['ev'] !== '') ? $it['ev'] : 'мероприятие';
        $html .= '<li><b>' . rating_esc($ev) . '</b>';
        $parts = array();
        if (isset($it['sit']) && $it['sit'] !== '') $parts[] = rating_esc($it['sit']);
        if (isset($it['bits']) && is_array($it['bits'])) {
            $bits = $it['bits'];
            $bn = count($bits);
            $j = 0;
            for ($j = 0; $j < $bn; $j++) {
                if ($bits[$j] !== '') $parts[] = rating_esc($bits[$j]);
            }
        }
        if (count($parts)) $html .= '<br>' . implode(' · ', $parts);
        $html .= '</li>';
    }
    $html .= '</ul>';
    if ($extra > 0) $html .= '<p class="tip-more">… ещё ' . $extra . '</p>';
    return $html;
}

/**
 * pid => array(rating => html, tourn => html, ...)
 */
function rating_tooltip_pack($rows, $details) {
    $kinds = array('tourn', 'win', 'lose', 'swin', 'slose', 'judge', 'votes');
    $out = array();
    $n = count($rows);
    $i = 0;
    for ($i = 0; $i < $n; $i++) {
        $row = $rows[$i];
        if (isset($row['_gap']) && $row['_gap']) continue;
        if (!isset($row['pid'])) continue;
        $pid = (int)$row['pid'];
        $pack = array();
        $pack['rating'] = rating_tooltip_formula_html($row);
        $det = isset($details[$pid]) ? $details[$pid] : array();
        $ki = 0;
        for ($ki = 0; $ki < 7; $ki++) {
            $k = $kinds[$ki];
            if (isset($det[$k]) && count($det[$k])) {
                $pack[$k] = rating_tooltip_list_html($det[$k]);
            }
        }
        $out[(string)$pid] = $pack;
    }
    return $out;
}

function rating_tooltip_json($pack) {
    $json = json_encode($pack);
    if (!$json) $json = '{}';
    return str_replace('</', '<\/', $json);
}
