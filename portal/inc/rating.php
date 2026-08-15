<?php
declare(strict_types=1);

$ratingCalc = dirname(__FILE__) . '/rating_calc.php';
if (!is_file($ratingCalc)) {
    $ratingCalc = dirname(__FILE__) . '/../../inc/rating_calc.php';
}
require $ratingCalc;
require dirname($ratingCalc) . '/rating_tooltip.php';

/** Строки рейтинга: формула в inc/rating_calc.php, здесь только выборка. */
function portal_rating_rows(mysqli $db): array
{
    $people = [];
    $r = $db->query('SELECT id, full_name FROM people');
    while ($row = $r->fetch_assoc()) {
        $people[(int)$row['id']] = $row['full_name'];
    }

    $circleRows = [];
    $r = $db->query(
        'SELECT cm.person_id, c.title, cm.involvement FROM circle_memberships cm
         JOIN circles c ON c.id = cm.circle_id'
    );
    while ($row = $r->fetch_assoc()) {
        $circleRows[] = $row;
    }

    $judgeRows = [];
    $r = $db->query('SELECT duel_id, person_id, vote FROM duel_judges');
    while ($row = $r->fetch_assoc()) {
        $judgeRows[] = $row;
    }

    $duelRows = [];
    $r = $db->query(
        'SELECT d.id, d.player1_id, d.second1_id, d.player2_id, d.second2_id,
                d.situation_id, d.duel_type, d.event_id, e.event_type, e.title
         FROM duels d JOIN events e ON e.id = d.event_id'
    );
    while ($row = $r->fetch_assoc()) {
        $duelRows[] = $row;
    }

    $sitRows = [];
    $r = $db->query('SELECT id, code, num FROM situations');
    if ($r) {
        while ($row = $r->fetch_assoc()) {
            $sitRows[(int)$row['id']] = ['code' => $row['code'], 'num' => $row['num']];
        }
    }

    $computed = rating_compute($people, $circleRows, $judgeRows, $duelRows, $sitRows);
    return $computed['rows'];
}

/** pid => HTML формулы (те же слагаемые, что на rating.php). */
function portal_rating_tips(array $items, array $fill): array
{
    return rating_tooltip_pack(array_merge($items, $fill), []);
}

/** Легенда весов для заголовка «Количество баллов». */
function portal_rating_formula_html(): string
{
    $W = rating_weights();
    $items = [
        ['Турниры', 'tourn'],
        ['Победы', 'win'],
        ['Поражения', 'lose'],
        ['Победы секунданта', 'swin'],
        ['Поражения секунданта', 'slose'],
        ['Судил', 'judge'],
        ['Голоса', 'votes'],
    ];
    $html = '<table>';
    foreach ($items as $it) {
        $w = $W[$it[1]] ?? 0;
        $html .= '<tr><th>' . rating_esc($it[0]) . '</th><td>× '
            . rating_esc(rating_fmt_weight($w)) . '</td></tr>';
    }
    $html .= '</table>';
    return $html;
}

/** HTML пунктов <ol class="rating-list"> (виджет или полный список). */
function portal_rating_echo_items(array $items, int $meId): void
{
    foreach ($items as $row) {
        if (!empty($row['_gap'])) {
            echo '<li class="gap">…</li>';
            continue;
        }
        $isMe = $meId && (int)$row['pid'] === $meId;
        $pts = rtrim(rtrim(number_format((float)$row['rating'], 1, ',', ' '), '0'), ',');
        echo '<li class="' . ($isMe ? 'is-me' : '') . '" data-pid="' . (int)$row['pid'] . '">';
        echo '<span class="place">' . (int)$row['place'] . '</span>';
        echo '<span class="name">' . h((string)$row['name']) . '</span>';
        echo '<span class="pts has-tip" data-tip="rating" role="button" tabindex="0" aria-label="подробнее">';
        echo h($pts) . portal_tip_mark();
        echo '</span>';
        echo '</li>';
    }
}

/**
 * Виджет главной (десктоп, рядом с календарём): минимум топ-10.
 * Хвост — в fill: JS добирает строки до низа календаря.
 * Мобильная страница ?p=rating рендерит полный список отдельно, без fill.
 * Гость и «я в топ-10»: подряд с 1-го, без «…».
 * «Я» ниже топа: топ-10, «…», окно (я − $around … я), дальше fill.
 *
 * @return array{items: list<array>, fill: list<array>}
 */
function portal_rating_widget(array $rows, int $meId, int $around = 2): array
{
    $topN = 10;
    $top = array_slice($rows, 0, $topN);
    $mine = null;
    foreach ($rows as $row) {
        if ((int)$row['pid'] === $meId) {
            $mine = $row;
            break;
        }
    }
    if ($meId <= 0 || $mine === null) {
        return [
            'items' => $top,
            'fill' => array_slice($rows, $topN),
        ];
    }
    $idx = (int)$mine['place'] - 1;
    $from = max(0, $idx - $around);
    if ($from <= $topN) {
        $coreEnd = max($topN, $idx + 1);
        return [
            'items' => array_slice($rows, 0, $coreEnd),
            'fill' => array_slice($rows, $coreEnd),
        ];
    }
    $aroundRows = array_slice($rows, $from, $idx - $from + 1);
    return [
        'items' => array_merge($top, [['_gap' => true]], $aroundRows),
        'fill' => array_slice($rows, $idx + 1),
    ];
}
