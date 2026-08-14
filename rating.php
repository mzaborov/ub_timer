<?php
/**
 * Рейтинг по канону Google (лист «Рейтинг -по Алфавиту»).
 * Веса: турнир 10, победа игрока 5, поражение 3, секундант выиграл 4,
 * секундант проиграл 2, судил 1, голос 0.3.
 * Турнир ×10 — каждый бой игроком на мероприятии типа «турнир»
 * (проигрыш тоже) плюс 1 раз за встречу, если человек ни разу не был
 * игроком, но хотя бы раз секундировал (проигрыш секунданта тоже).
 * Ничья / нет голосов — без победы и поражения.
 * Гости не в таблице: ФУБ вне стрима «Стрим поединки я-ИТ-ы»
 * и оппоненты Лидер (игрок/секундант на тип=турнир) вне этого стрима.
 * Формула: inc/rating_calc.php. Тултип: inc/rating_tooltip.php.
 */
error_reporting(E_ALL);
ini_set('display_errors', '0');
header('Content-Type: text/html; charset=utf-8');

$cfg = dirname(__FILE__) . '/../db.inc.php';
if (!is_file($cfg)) {
    header('HTTP/1.1 500 Internal Server Error');
    echo 'Нет конфига БД.';
    exit;
}
require $cfg;
require dirname(__FILE__) . '/inc/rating_calc.php';
require dirname(__FILE__) . '/inc/rating_tooltip.php';

$link = mysql_connect($mysql_host, $mysql_user, $mysql_password);
if (!$link || !mysql_select_db($mysql_database, $link)) {
    header('HTTP/1.1 500 Internal Server Error');
    echo 'Нет связи с БД.';
    exit;
}
mysql_query("SET NAMES utf8mb4", $link);

$people = array();
$r = mysql_query("SELECT id, full_name FROM people", $link);
while ($row = mysql_fetch_assoc($r)) {
    $people[(int)$row['id']] = $row['full_name'];
}

$circleRows = array();
$r = mysql_query(
    "SELECT cm.person_id, c.title, cm.involvement FROM circle_memberships cm JOIN circles c ON c.id = cm.circle_id",
    $link
);
if ($r) {
    while ($row = mysql_fetch_assoc($r)) {
        $circleRows[] = $row;
    }
}

$sitRows = array();
$r = mysql_query("SELECT id, code, num FROM situations", $link);
if ($r) {
    while ($row = mysql_fetch_assoc($r)) {
        $sitRows[(int)$row['id']] = array('code' => $row['code'], 'num' => $row['num']);
    }
}

$judgeRows = array();
$r = mysql_query("SELECT duel_id, person_id, vote FROM duel_judges", $link);
while ($row = mysql_fetch_assoc($r)) {
    $judgeRows[] = $row;
}

$duelRows = array();
$r = mysql_query(
    "SELECT d.id, d.player1_id, d.second1_id, d.player2_id, d.second2_id, d.situation_id, d.duel_type, " .
    "e.id AS event_id, e.event_type, e.title " .
    "FROM duels d JOIN events e ON e.id = d.event_id",
    $link
);
while ($d = mysql_fetch_assoc($r)) {
    $duelRows[] = $d;
}

$computed = rating_compute($people, $circleRows, $judgeRows, $duelRows, $sitRows);
$rows = $computed['rows'];
$details = $computed['details'];

function h($s) {
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

$tipsJson = rating_tooltip_json(rating_tooltip_pack($rows, $details));
?>
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Количество баллов — управленческие поединки</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0; background: #fff; color: #333;
        }
        .page { width: 100%; box-sizing: border-box; }
        header { background: #e65100; color: #1a1a1a; padding: .5rem .75rem .65rem; box-sizing: border-box; }
        .brand h1 { margin: 0; font-size: 1.15rem; font-weight: 700; color: #1a1a1a; }
        header nav { margin: .2rem 0 0; font-size: .9rem; }
        header nav a {
            color: #1a1a1a; background: rgba(255,255,255,.9); text-decoration: none;
            font-weight: 600; padding: .15rem .5rem; border-radius: 4px;
        }
        header nav a:hover { background: #fff; }
        .toolbar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: stretch; margin-top: .55rem; }
        #q {
            flex: 1 1 12rem; max-width: 18rem; min-height: 2.75rem; box-sizing: border-box;
            padding: .45rem .7rem; font-size: 16px; border: 1px solid rgba(0,0,0,.12);
            border-radius: 6px; background: #fff; color: #1a1a1a;
        }
        .sort-btns { display: flex; flex: 1 1 auto; gap: .4rem; }
        .sort-btns button {
            flex: 1; min-height: 2.75rem; min-width: 7.5rem; padding: .4rem .75rem;
            font-size: 1rem; border: 1px solid rgba(0,0,0,.14); border-radius: 6px;
            background: rgba(255,255,255,.88); color: #1a1a1a; cursor: pointer;
        }
        .sort-btns button.active {
            background: #fff; border-color: #fff; color: #1a1a1a; font-weight: 700;
            box-shadow: 0 0 0 1px rgba(0,0,0,.1);
        }
        main { padding: .65rem .75rem 1rem; box-sizing: border-box; }
        .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; width: 100%; }
        .table-wrap table {
            border-collapse: collapse; width: 100%; font-size: .9rem;
        }
        .col-full { display: none; }
        .table-wrap th, .table-wrap td {
            padding: .32rem .45rem; text-align: right; border-bottom: 1px solid #e0e0e0;
            white-space: nowrap; font-variant-numeric: tabular-nums;
        }
        .table-wrap th:nth-child(1), .table-wrap td:nth-child(1) { text-align: right; color: #888; }
        .table-wrap th:nth-child(2), .table-wrap td:nth-child(2) {
            text-align: left; font-variant-numeric: normal;
        }
        .table-wrap th { background: #fff8f0; position: sticky; top: 0; color: #333; }
        th.sortable { cursor: pointer; user-select: none; }
        th.sortable:hover { color: #bf360c; }
        th.sort-on::after { margin-left: .25rem; opacity: .95; }
        th.sort-on.dir-desc::after { content: "▼"; }
        th.sort-on.dir-asc::after { content: "▲"; }
        .table-wrap tr:nth-child(even) { background: #fafafa; }
        .table-wrap tbody tr:hover { background: #fff8f0; }
        .num {
            color: #222; font-weight: 700; cursor: help;
            border-left: 3px solid #e65100; padding-left: .5rem;
        }
        .has-tip { cursor: help; }
        #rating-tip {
            display: none; position: fixed; z-index: 80; max-width: min(92vw, 24rem);
            max-height: min(70vh, 22rem); overflow: auto;
            padding: .45rem .65rem; font-size: .82rem; line-height: 1.4;
            color: #222; background: #fff;
            border: 1px solid #e65100; border-radius: 6px;
            box-shadow: 0 4px 14px rgba(0,0,0,.18); pointer-events: auto;
        }
        #rating-tip table { width: 100%; min-width: 0; border-collapse: collapse; }
        #rating-tip th {
            text-align: left; font-weight: 400; padding: .05rem .9rem .05rem 0;
            white-space: nowrap; color: #333;
        }
        #rating-tip td {
            text-align: right; font-variant-numeric: tabular-nums;
            white-space: nowrap; padding: .05rem 0; color: #222;
        }
        #rating-tip .tip-sum td {
            text-align: right; font-weight: 700; padding-top: .3rem;
            border-top: 1px solid #e65100;
        }
        #rating-tip .tip-list { margin: 0; padding: 0 0 0 1.15rem; text-align: left; }
        #rating-tip .tip-list li { margin: 0 0 .4rem; }
        #rating-tip .tip-empty, #rating-tip .tip-more { margin: .15rem 0 0; color: #555; }
        footer { padding: 1rem .75rem 2rem; font-size: .8rem; color: #666; box-sizing: border-box; }
        a { color: #bf360c; }
        #empty { display: none; margin: .75rem 0; color: #666; }
        #empty.show { display: block; }
        @media (min-width: 768px) {
            .page {
                width: max-content; max-width: 100%; margin: 0 auto;
            }
            header {
                display: flex; align-items: center; gap: .5rem .75rem;
                padding: .35rem .75rem; flex-wrap: wrap;
            }
            .brand {
                display: flex; align-items: baseline; gap: .65rem;
                flex: 0 0 auto; white-space: nowrap;
            }
            .brand h1 { font-size: 1rem; }
            header nav { margin: 0; font-size: .82rem; }
            .toolbar { margin: 0; flex: 1 1 auto; gap: .35rem; min-width: 0; }
            #q {
                min-height: 1.85rem; height: 1.85rem; font-size: .875rem;
                padding: .12rem .5rem; flex: 1 1 8rem; max-width: 14rem;
            }
            .sort-btns { flex: 0 0 auto; }
            .sort-btns button {
                min-height: 1.85rem; min-width: 0; flex: 0 0 auto;
                padding: .12rem .65rem; font-size: .8125rem;
            }
            main { padding: 0; }
            footer { padding: .85rem .75rem 1.75rem; }
            .table-wrap table { width: auto; font-size: 1rem; }
            .col-short { display: none; }
            .col-full { display: inline; }
        }
        @media (max-width: 640px) {
            .table-wrap table { font-size: .85rem; }
            .col-extra { display: none; }
        }
    </style>
</head>
<body>
<div class="page">
<header>
    <div class="brand">
        <h1>Количество баллов</h1>
        <nav><a href="index.html">Часы</a> · <a href="situations-bank.html">Банк ситуаций</a></nav>
    </div>
    <div class="toolbar">
        <div class="sort-btns" role="group" aria-label="Сортировка">
            <button type="button" id="sort-rating" data-sort="rating">По баллам</button>
            <button type="button" id="sort-name" data-sort="name">По ФИО</button>
        </div>
        <input id="q" type="search" placeholder="найти человека" autocomplete="off" aria-label="найти человека">
    </div>
</header>
<main>
<div class="table-wrap">
<table>
    <thead>
        <tr>
            <th>#</th>
            <th class="sortable" data-sort="name" id="th-name">Человек</th>
            <th class="sortable" data-sort="rating" id="th-rating"><span class="col-short">Баллы</span><span class="col-full">Количество баллов</span></th>
            <th class="col-extra"><span class="col-short">Турнир</span><span class="col-full">Турниры</span></th>
            <th class="col-extra"><span class="col-short">Побед</span><span class="col-full">Победы</span></th>
            <th class="col-extra"><span class="col-short">Пораж.</span><span class="col-full">Поражения</span></th>
            <th class="col-extra"><span class="col-short">Сек. победы</span><span class="col-full">Победы секунданта</span></th>
            <th class="col-extra"><span class="col-short">Сек. пор.</span><span class="col-full">Поражения секунданта</span></th>
            <th class="col-extra">Судил</th>
            <th class="col-extra"><span class="col-short">Голосов</span><span class="col-full">Голоса</span></th>
        </tr>
    </thead>
    <tbody id="rating-body">
<?php
$i = 0;
foreach ($rows as $row) {
    $i++;
    $sum = number_format($row['rating'], 1, '.', '');
    $pid = (int)$row['pid'];
    echo "<tr data-pid=\"" . $pid . "\" data-name=\"" . h($row['name']) . "\" data-rating=\"" . h($sum) . "\" data-place=\"" . $i . "\"";
    echo " data-tourn=\"" . (int)$row['tourn'] . "\" data-win=\"" . (int)$row['win'] . "\" data-lose=\"" . (int)$row['lose'] . "\"";
    echo " data-swin=\"" . (int)$row['swin'] . "\" data-slose=\"" . (int)$row['slose'] . "\" data-judge=\"" . (int)$row['judge'] . "\" data-votes=\"" . (int)$row['votes'] . "\">";
    echo "<td>" . $i . "</td>";
    echo "<td>" . h($row['name']) . "</td>";
    echo "<td class=\"num has-tip\" data-tip=\"rating\">" . $sum . "</td>";
    echo "<td class=\"col-extra has-tip\" data-tip=\"tourn\">" . (int)$row['tourn'] . "</td>";
    echo "<td class=\"col-extra has-tip\" data-tip=\"win\">" . (int)$row['win'] . "</td>";
    echo "<td class=\"col-extra has-tip\" data-tip=\"lose\">" . (int)$row['lose'] . "</td>";
    echo "<td class=\"col-extra has-tip\" data-tip=\"swin\">" . (int)$row['swin'] . "</td>";
    echo "<td class=\"col-extra has-tip\" data-tip=\"slose\">" . (int)$row['slose'] . "</td>";
    echo "<td class=\"col-extra has-tip\" data-tip=\"judge\">" . (int)$row['judge'] . "</td>";
    echo "<td class=\"col-extra has-tip\" data-tip=\"votes\">" . (int)$row['votes'] . "</td>";
    echo "</tr>\n";
}
?>
    </tbody>
</table>
</div>
<p id="empty">Никого не найдено.</p>
</main>
<footer>
    Веса: турнир ×10 (каждый бой игроком + 1 раз за встречу, если только секундант), победа игрока ×5, поражение ×3, секундант выиграл ×4, проиграл ×2, судил ×1, набранный голос ×0.3.
    Ничья по голосам не даёт победу и поражение.
    Гости других клубов скрыты: ФУБ вне стрима я-ИТ-ы и оппоненты Лидер вне стрима.
    <?php echo count($rows); ?> человек.
</footer>
</div>
<div id="rating-tip"></div>
<script type="application/json" id="rating-tips-json"><?php echo $tipsJson; ?></script>
<script>
(function () {
    var tbody = document.getElementById('rating-body');
    var qEl = document.getElementById('q');
    var emptyEl = document.getElementById('empty');
    var btnRating = document.getElementById('sort-rating');
    var btnName = document.getElementById('sort-name');
    var thName = document.getElementById('th-name');
    var thRating = document.getElementById('th-rating');
    var state = { sort: 'rating', dir: 'desc', q: '' };

    function fold(s) {
        return String(s || '').toLowerCase().replace(/ё/g, 'е');
    }

    function parseQuery() {
        var out = {};
        var s = location.search.replace(/^\?/, '');
        if (!s) return out;
        var parts = s.split('&');
        var i, kv, k, v;
        for (i = 0; i < parts.length; i++) {
            if (!parts[i]) continue;
            kv = parts[i].split('=');
            k = decodeURIComponent(kv[0].replace(/\+/g, ' '));
            v = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
            out[k] = v;
        }
        return out;
    }

    var skipHistory = true;

    function writeUrl() {
        if (skipHistory) return;
        var parts = [];
        if (state.sort !== 'rating' || state.dir !== 'desc') {
            parts.push('sort=' + encodeURIComponent(state.sort));
            if (!((state.sort === 'rating' && state.dir === 'desc') ||
                  (state.sort === 'name' && state.dir === 'asc'))) {
                parts.push('dir=' + encodeURIComponent(state.dir));
            }
        }
        if (state.q) parts.push('q=' + encodeURIComponent(state.q));
        var next = location.pathname + (parts.length ? '?' + parts.join('&') : '');
        var now = location.pathname + location.search;
        if (next === now) return;
        if (history.replaceState) history.replaceState(null, '', next);
    }

    function readUrl() {
        var p = parseQuery();
        if (p.sort === 'name' || p.sort === 'rating') state.sort = p.sort;
        if (p.dir === 'asc' || p.dir === 'desc') {
            state.dir = p.dir;
        } else {
            state.dir = (state.sort === 'name') ? 'asc' : 'desc';
        }
        state.q = p.q ? p.q : '';
        qEl.value = state.q;
    }

    function cmpRows(a, b) {
        var mul = (state.dir === 'asc') ? 1 : -1;
        if (state.sort === 'name') {
            var c = fold(a.getAttribute('data-name')).localeCompare(fold(b.getAttribute('data-name')), 'ru');
            if (c) return c * (state.dir === 'asc' ? 1 : -1);
            return parseFloat(b.getAttribute('data-rating')) - parseFloat(a.getAttribute('data-rating'));
        }
        var ra = parseFloat(a.getAttribute('data-rating'));
        var rb = parseFloat(b.getAttribute('data-rating'));
        if (ra !== rb) return (ra - rb) * mul;
        return fold(a.getAttribute('data-name')).localeCompare(fold(b.getAttribute('data-name')), 'ru');
    }

    function markSortUi() {
        btnRating.className = (state.sort === 'rating') ? 'active' : '';
        btnName.className = (state.sort === 'name') ? 'active' : '';
        thName.className = 'sortable' + (state.sort === 'name' ? ' sort-on dir-' + state.dir : '');
        thRating.className = 'sortable' + (state.sort === 'rating' ? ' sort-on dir-' + state.dir : '');
    }

    function apply() {
        var rows = [];
        var i, row, show, nShow;
        for (i = 0; i < tbody.rows.length; i++) rows.push(tbody.rows[i]);
        rows.sort(cmpRows);
        nShow = 0;
        var needle = fold(state.q);
        for (i = 0; i < rows.length; i++) {
            row = rows[i];
            show = !needle || fold(row.getAttribute('data-name')).indexOf(needle) !== -1;
            row.style.display = show ? '' : 'none';
            if (show) nShow++;
            tbody.appendChild(row);
        }
        emptyEl.className = nShow ? '' : 'show';
        markSortUi();
        writeUrl();
    }

    function setSort(sort) {
        if (state.sort === sort) {
            state.dir = (state.dir === 'asc') ? 'desc' : 'asc';
        } else {
            state.sort = sort;
            state.dir = (sort === 'name') ? 'asc' : 'desc';
        }
        apply();
    }

    btnRating.onclick = function () { setSort('rating'); };
    btnName.onclick = function () { setSort('name'); };
    thName.onclick = function () { setSort('name'); };
    thRating.onclick = function () { setSort('rating'); };

    var qTimer = null;
    qEl.oninput = function () {
        state.q = qEl.value;
        if (qTimer) clearTimeout(qTimer);
        qTimer = setTimeout(apply, 40);
    };

    var TIPS = {};
    (function loadTips() {
        var el = document.getElementById('rating-tips-json');
        if (!el) return;
        var raw = el.textContent || el.innerHTML || '{}';
        try { TIPS = JSON.parse(raw); } catch (err) { TIPS = {}; }
    })();

    var tipBox = document.getElementById('rating-tip');
    var stickyCell = null;
    var hideTimer = null;

    function tipHtmlFor(cell) {
        var kind = cell.getAttribute('data-tip');
        var tr = cell.parentNode;
        var pid = tr.getAttribute('data-pid');
        var pack = TIPS[pid] || {};
        return pack[kind] || '<p class="tip-empty">Нет</p>';
    }

    function cancelHide() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }

    function scheduleHide() {
        if (stickyCell) return;
        cancelHide();
        hideTimer = setTimeout(function () { hideTip(); }, 220);
    }

    function placeTip(cell) {
        cancelHide();
        tipBox.innerHTML = tipHtmlFor(cell);
        tipBox.style.display = 'block';
        var r = cell.getBoundingClientRect();
        var tw = tipBox.offsetWidth || 240;
        var th = tipBox.offsetHeight || 48;
        var left = r.left;
        if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
        if (left < 8) left = 8;
        var top = r.bottom + 6;
        if (top + th > window.innerHeight - 8) top = r.top - th - 6;
        if (top < 8) top = 8;
        tipBox.style.left = left + 'px';
        tipBox.style.top = top + 'px';
    }

    function hideTip() {
        stickyCell = null;
        cancelHide();
        tipBox.style.display = 'none';
    }

    function hasTipClass(el) {
        return el && el.className && (' ' + el.className + ' ').indexOf(' has-tip ') !== -1;
    }

    function cellFromEvent(e) {
        var t = e.target || e.srcElement;
        while (t && t !== tbody) {
            if (hasTipClass(t)) return t;
            t = t.parentNode;
        }
        return null;
    }

    function isInTip(t) {
        while (t) {
            if (t === tipBox) return true;
            t = t.parentNode;
        }
        return false;
    }

    tbody.onclick = function (e) {
        var cell = cellFromEvent(e);
        if (!cell) return;
        if (stickyCell === cell) { hideTip(); }
        else { stickyCell = cell; placeTip(cell); }
        if (e.stopPropagation) e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
    };

    tbody.onmouseover = function (e) {
        if (stickyCell) return;
        var cell = cellFromEvent(e);
        if (cell) placeTip(cell);
    };

    tbody.onmouseout = function (e) {
        if (stickyCell) return;
        var rel = e.relatedTarget || e.toElement;
        if (isInTip(rel)) return;
        while (rel) {
            if (rel === tbody) return;
            rel = rel.parentNode;
        }
        scheduleHide();
    };

    tipBox.onmouseover = function () { cancelHide(); };
    tipBox.onmouseout = function (e) {
        if (stickyCell) return;
        var rel = e.relatedTarget || e.toElement;
        if (isInTip(rel)) return;
        scheduleHide();
    };

    document.onclick = function (e) {
        var t = e.target || e.srcElement;
        if (isInTip(t)) return;
        while (t) {
            if (hasTipClass(t)) return;
            t = t.parentNode;
        }
        hideTip();
    };

    window.onscroll = function () {
        if (stickyCell) placeTip(stickyCell);
    };

    readUrl();
    apply();
    skipHistory = false;
})();
</script>
</body>
</html>
