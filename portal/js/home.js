(function () {
    var peopleEl = document.getElementById("people-json");
    var eventsEl = document.getElementById("events-json");
    var people = [];
    var events = [];
    try { people = JSON.parse((peopleEl && peopleEl.textContent) || "[]"); } catch (e) {}
    try { events = JSON.parse((eventsEl && eventsEl.textContent) || "[]"); } catch (e) {}

    var MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
        "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

    var TEMPLATE_ONLINE10 = {
        online_10_20: 1, online_10_21: 1, online_10_22: 1,
        online_10_23: 1, online_10_24: 1
    };

    var byDay = {};
    events.forEach(function (ev) {
        if (!ev.start || TEMPLATE_ONLINE10[ev.slug]) return;
        var from = ev.start.slice(0, 10);
        var to = (ev.end || ev.start).slice(0, 10);
        var cur = from;
        while (true) {
            if (!byDay[cur]) byDay[cur] = [];
            byDay[cur].push(ev);
            if (cur >= to) break;
            cur = nextIso(cur);
        }
    });

    function nextIso(iso) {
        var p = iso.split("-");
        var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
        dt.setDate(dt.getDate() + 1);
        return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
    }

    function isSpecial(t) {
        return t === "купала" || t === "новогоднее";
    }

    function isPlanned(s) {
        return s === "Запланировано" || s === "Подготовка";
    }

    function isCancelled(s) {
        return s === "Отменено";
    }

    function renderYear(year) {
        var root = document.getElementById("year-cal");
        if (!root) return;
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var html = "";
        var m;
        for (m = 0; m < 12; m++) {
            html += monthHtml(year, m, today);
        }
        root.innerHTML = html;
    }

    function monthHtml(year, month, today) {
        var first = new Date(year, month, 1);
        var startDow = (first.getDay() + 6) % 7;
        var dim = new Date(year, month + 1, 0).getDate();
        var html = '<div class="month" data-month="' + month + '"><h2>' + MONTHS[month] + '</h2><table><tbody>';
        var day = 1 - startDow;
        var row;
        for (row = 0; row < 6; row++) {
            html += "<tr>";
            var col;
            var empty = true;
            for (col = 0; col < 7; col++) {
                if (day < 1 || day > dim) {
                    html += "<td></td>";
                } else {
                    empty = false;
                    var iso = year + "-" + pad(month + 1) + "-" + pad(day);
                    var dt = new Date(year, month, day);
                    var evs = byDay[iso] || [];
                    var cls = [];
                    if (col >= 5) cls.push("wknd");
                    if (evs.length) {
                        cls.push("ev");
                        if (evs.some(function (e) { return isSpecial(e.type); })) {
                            cls.push("special");
                            cls.push("offline");
                        }
                        if (evs.some(function (e) { return e.type === "онлайн"; })) cls.push("online");
                        if (evs.some(function (e) { return isPlanned(e.status); })) cls.push("planned");
                        if (evs.every(function (e) { return isCancelled(e.status); })) cls.push("cancelled");
                        if (iso === selectedIso) cls.push("sel");
                    }
                    if (dt < today) cls.push("past");
                    var title = evs.map(function (e) { return e.title; }).join(", ");
                    html += '<td class="' + cls.join(" ") + '" data-iso="' + iso + '"' +
                        (title ? ' title="' + esc(title) + '"' : "") + ">" + String(day) + "</td>";
                }
                day++;
            }
            html += "</tr>";
            if (empty && row > 3) break;
        }
        html += "</tbody></table></div>";
        return html;
    }

    var selectedIso = "";
    var lastCard = document.getElementById("last-card");
    var meId = lastCard ? parseInt(lastCard.getAttribute("data-me-id") || "0", 10) : 0;

    function todayIso() {
        var t = new Date();
        return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
    }

    function defaultMeetingIso() {
        var today = todayIso();
        var best = null;
        events.forEach(function (ev) {
            if (ev.type !== "онлайн" || ev.status !== "Проведено") return;
            var d = (ev.start || ev.end || "").slice(0, 10);
            if (!d || d > today) return;
            if (!best || d > best.iso || (d === best.iso && ev.id > best.ev.id)) {
                best = { iso: d, ev: ev };
            }
        });
        return best ? best.iso : "";
    }

    function fmtRu(iso) {
        if (!iso) return "";
        var p = String(iso).slice(0, 10).split("-");
        if (p.length !== 3) return iso;
        return p[2] + "." + p[1] + "." + p[0];
    }

    function meetingHeading(evs, iso, isPlan) {
        var head = isPlan ? "План" : "Результаты";
        var titles = [];
        var seen = {};
        var i;
        for (i = 0; i < evs.length; i++) {
            var t = (evs[i].title || "").trim();
            if (t && !seen[t]) {
                seen[t] = 1;
                titles.push(t);
            }
        }
        var date = fmtRu(iso);
        if (titles.length === 1) {
            var title = titles[0];
            if (date) {
                var re = new RegExp("\\s+" + date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$");
                title = title.replace(re, "").trim();
            }
            if (title) head += ": " + title;
        }
        if (date) head += " · " + date;
        return head;
    }

    function duelsOnDay(ev, iso) {
        var duels = ev.duels || [];
        var anyDate = false;
        var i;
        for (i = 0; i < duels.length; i++) {
            if (duels[i].date) anyDate = true;
        }
        if (!anyDate) {
            return ((ev.start || "").slice(0, 10) === iso) ? duels : [];
        }
        var out = [];
        for (i = 0; i < duels.length; i++) {
            var dd = (duels[i].date || "").slice(0, 10);
            if (dd === iso) out.push(duels[i]);
            else if (!dd && (ev.start || "").slice(0, 10) === iso) out.push(duels[i]);
        }
        return out;
    }

    function columnsForDay(iso) {
        var evs = byDay[iso] || [];
        var cols = [];
        var i, j, duels;
        for (i = 0; i < evs.length; i++) {
            duels = duelsOnDay(evs[i], iso);
            for (j = 0; j < duels.length; j++) {
                cols.push({ ev: evs[i], duel: duels[j] });
            }
        }
        return cols;
    }

    function eventCountInCols(cols) {
        var seen = {};
        var n = 0;
        var i;
        for (i = 0; i < cols.length; i++) {
            var id = cols[i].ev.id;
            if (!seen[id]) { seen[id] = 1; n++; }
        }
        return n;
    }

    function youMark() {
        return '<span class="you" title="это вы">вы</span>';
    }

    function shortFio(name) {
        name = String(name || "").trim();
        if (!name) return "";
        return name.split(/\s+/)[0];
    }

    function videoLink(url, extraClass, label) {
        url = String(url || "").trim();
        if (!/^https?:\/\//i.test(url)) return "";
        var cls = "video-link vid-pill" + (extraClass ? " " + extraClass : "");
        var text = label || "видео";
        return '<a class="' + cls + '" href="' + esc(url) + '" target="_blank" rel="noopener">' +
            '<svg class="ico" aria-hidden="true"><use href="#i-video"></use></svg> ' + esc(text) + "</a>";
    }

    function dayVideoUrl(ev) {
        var url = String((ev && ev.video) || "").trim();
        if (!/^https?:\/\//i.test(url)) return "";
        var duels = (ev && ev.duels) || [];
        var i;
        for (i = 0; i < duels.length; i++) {
            if (String(duels[i].video || "").trim() === url) return "";
        }
        return url;
    }

    function uniqueEvents(evs) {
        var seen = {};
        var out = [];
        var i;
        for (i = 0; i < evs.length; i++) {
            var id = evs[i].id;
            if (!seen[id]) {
                seen[id] = 1;
                out.push(evs[i]);
            }
        }
        return out;
    }

    function setMeetingHead(heading, evs) {
        var headEl = document.getElementById("last-head-text");
        var headH = document.getElementById("last-head");
        var vidEl = document.getElementById("last-head-video");
        if (headEl) headEl.textContent = heading;
        if (headH) {
            if (heading) headH.setAttribute("title", heading);
            else headH.removeAttribute("title");
        }
        if (vidEl) {
            var uniq = uniqueEvents(evs || []);
            vidEl.innerHTML = (uniq.length === 1) ? videoLink(dayVideoUrl(uniq[0]), "", "весь день") : "";
        }
    }

    function sitTd(d, withVideo) {
        var label = d.sit || "—";
        var url = d.sit_url || "";
        var html = '<td class="sit"><span class="with-vid">';
        if (url) {
            html += '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + "</a>";
        } else {
            html += esc(label);
        }
        if (withVideo) html += videoLink(d.video);
        html += "</span></td>";
        return html;
    }

    function sideTd(d, side, showResult) {
        var player = side === 1 ? d.p1 : d.p2;
        var second = side === 1 ? d.s1 : d.s2;
        var playerId = side === 1 ? (d.p1_id | 0) : (d.p2_id | 0);
        var secondId = side === 1 ? (d.s1_id | 0) : (d.s2_id | 0);
        var winner = showResult ? (d.winner | 0) : -1;
        var cls = "side";
        if (showResult) {
            if (winner === side) cls += " win";
            else if (winner === 0) cls += " draw";
        }
        if (meId > 0 && (meId === playerId || meId === secondId)) cls += " is-me";
        var paired = d.type === "парный";
        var html = '<td class="' + cls + '">';
        html += esc(player || "—");
        if (meId > 0 && meId === playerId) html += youMark();
        if (second) {
            html += '<span class="' + (paired ? "pair" : "second") + '">' + esc(second);
            if (meId > 0 && meId === secondId) html += youMark();
            html += "</span>";
        }
        html += "</td>";
        return html;
    }

    function scoreTd(d) {
        var w = d.winner | 0;
        var paired = d.type === "парный";
        var html = '<td class="result' + (w === 0 ? " draw" : "") + '">';
        html += '<span class="score">' + (d.v1 | 0) + ":" + (d.v2 | 0) + "</span>";
        if (w === 0) {
            html += '<span class="outcome">ничья</span>';
        } else {
            var a = shortFio(w === 1 ? d.p1 : d.p2);
            var b = paired ? shortFio(w === 1 ? d.s1 : d.s2) : "";
            var name = a && b ? a + ", " + b : (a || b);
            if (name) html += '<span class="outcome win">' + esc(name) + "</span>";
        }
        html += "</td>";
        return html;
    }

    function judgeNamesHtml(people) {
        return (people || []).map(function (p) {
            var s = esc(p.name || "");
            if (meId > 0 && meId === (p.id | 0)) s += youMark();
            return s;
        }).join(", ");
    }

    function judgesTd(d) {
        var groups = d.judge_groups || [];
        var meHere = false;
        var g, j, people;
        for (g = 0; g < groups.length; g++) {
            people = groups[g].people || [];
            for (j = 0; j < people.length; j++) {
                if (meId > 0 && meId === (people[j].id | 0)) meHere = true;
            }
        }
        var html = '<td class="judges' + (meHere ? " is-me" : "") + '">';
        var flat = d.type === "экспресс" || groups.length === 1;
        if (!groups.length) {
            html += "—";
        } else if (flat) {
            var all = [];
            for (g = 0; g < groups.length; g++) {
                all = all.concat(groups[g].people || []);
            }
            html += judgeNamesHtml(all);
        } else {
            for (g = 0; g < groups.length; g++) {
                html += '<div class="jcol"><strong class="jlab">' + esc(groups[g].label || "") + "</strong> ";
                html += judgeNamesHtml(groups[g].people);
                html += "</div>";
            }
        }
        html += "</td>";
        return html;
    }

    function duelCardHtml(col, showEv, past) {
        var d = col.duel;
        var html = '<article class="duel-card">';
        html += '<h3 class="duel-card-head"><span class="duel-num">' + (d.order | 0) + "</span>";
        html += '<span class="duel-typ">' + esc(d.type || "") + "</span>";
        if (showEv) {
            html += '<span class="duel-ev">' + esc(col.ev.title || "") +
                videoLink(dayVideoUrl(col.ev), "", "весь день") + "</span>";
        }
        html += '</h3><table class="duel-mini"><tbody>';
        html += '<tr><th scope="row">Ситуация</th>' + sitTd(d, true) + "</tr>";
        html += '<tr><th scope="row">Игрок 1</th>' + sideTd(d, 1, past) + "</tr>";
        html += '<tr><th scope="row">Игрок 2</th>' + sideTd(d, 2, past) + "</tr>";
        if (past) html += '<tr><th scope="row">Счёт</th>' + scoreTd(d) + "</tr>";
        html += '<tr><th scope="row">Судьи</th>' + judgesTd(d) + "</tr>";
        html += "</tbody></table></article>";
        return html;
    }

    function renderMeeting(iso) {
        var body = document.getElementById("last-body");
        if (!body) return;
        var evs = iso ? (byDay[iso] || []) : [];
        if (!iso || !evs.length) {
            setMeetingHead("Результаты последней встречи", []);
            body.innerHTML = '<p class="muted">Пока нет прошедших встреч.</p>';
            return;
        }
        var past = iso <= todayIso();
        var heading = meetingHeading(evs, iso, !past);
        setMeetingHead(heading, evs);
        var cols = columnsForDay(iso);
        if (!cols.length) {
            var emptyMsg = "В этот день поединков не было.";
            if (evs.every(function (e) { return isCancelled(e.status); })) emptyMsg = "Отменено";
            else if (!past && evs.every(function (e) { return !(e.duels || []).length; })) {
                emptyMsg = "планирование ещё не начато";
            }
            body.innerHTML = '<p class="muted">' + emptyMsg + "</p>";
            return;
        }
        var showEv = eventCountInCols(cols) > 1;
        var i;
        var html = '<div class="last-grid-wrap"><table class="last-grid"><thead>';
        if (showEv) {
            var seenEvVid = {};
            html += '<tr class="ev-row"><th class="row-lab" scope="col">Мероприятие</th>';
            for (i = 0; i < cols.length; i++) {
                var evTitle = cols[i].ev.title || "";
                var evVid = "";
                if (!seenEvVid[cols[i].ev.id]) {
                    seenEvVid[cols[i].ev.id] = 1;
                    evVid = videoLink(dayVideoUrl(cols[i].ev), "", "весь день");
                }
                html += '<th class="ev-name" title="' + esc(evTitle) + '"><span class="with-vid">' +
                    esc(evTitle) + evVid + "</span></th>";
            }
            html += "</tr>";
        }
        html += '<tr><th class="row-lab" scope="col"></th>';
        for (i = 0; i < cols.length; i++) {
            html += '<th scope="col">' + (cols[i].duel.order | 0) + "</th>";
        }
        html += "</tr></thead><tbody>";
        html += '<tr><th class="row-lab" scope="row">Ситуация</th>';
        for (i = 0; i < cols.length; i++) html += sitTd(cols[i].duel, true);
        html += '</tr><tr><th class="row-lab" scope="row">Тип</th>';
        for (i = 0; i < cols.length; i++) {
            html += '<td class="typ">' + esc(cols[i].duel.type || "") + "</td>";
        }
        html += '</tr><tr><th class="row-lab" scope="row">Игрок 1</th>';
        for (i = 0; i < cols.length; i++) html += sideTd(cols[i].duel, 1, past);
        html += '</tr><tr><th class="row-lab" scope="row">Игрок 2</th>';
        for (i = 0; i < cols.length; i++) html += sideTd(cols[i].duel, 2, past);
        if (past) {
            html += '</tr><tr><th class="row-lab" scope="row">Счёт</th>';
            for (i = 0; i < cols.length; i++) html += scoreTd(cols[i].duel);
        }
        html += '</tr><tr><th class="row-lab" scope="row">Судьи</th>';
        for (i = 0; i < cols.length; i++) html += judgesTd(cols[i].duel);
        html += "</tr></tbody></table></div>";
        html += '<div class="last-duels">';
        for (i = 0; i < cols.length; i++) html += duelCardHtml(cols[i], showEv, past);
        html += "</div>";
        body.innerHTML = html;
    }

    function paintSel() {
        var cells = document.querySelectorAll("#year-cal td.ev");
        var i;
        for (i = 0; i < cells.length; i++) {
            if (cells[i].getAttribute("data-iso") === selectedIso) {
                cells[i].classList.add("sel");
            } else {
                cells[i].classList.remove("sel");
            }
        }
    }

    function scrollToResults() {
        if (!isMobileCal() || !lastCard) return;
        var target = lastCard.querySelector(".last-duels") || lastCard;
        var header = document.querySelector("header.top");
        var extra = 8;
        if (header) {
            var pos = window.getComputedStyle(header).position;
            if (pos === "sticky" || pos === "fixed") {
                extra += header.getBoundingClientRect().height;
            }
        }
        var top = target.getBoundingClientRect().top + window.pageYOffset - extra;
        window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }

    function selectDay(iso, fromCal) {
        if (!iso || !byDay[iso] || !byDay[iso].length) return;
        selectedIso = iso;
        renderMeeting(iso);
        paintSel();
        if (fromCal) scrollToResults();
    }

    function pad(n) { return n < 10 ? "0" + n : String(n); }
    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    }

    function fmtPts(n) {
        var x = Math.round(Number(n) * 10) / 10;
        var neg = x < 0;
        var abs = Math.abs(x);
        var parts = abs.toFixed(1).split(".");
        var intp = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        var s = parts[1] === "0" ? intp : intp + "," + parts[1];
        return neg ? "-" + s : s;
    }

    function ratingFillRows() {
        var el = document.getElementById("rating-fill-json");
        if (!el) return [];
        try { return JSON.parse(el.textContent || "[]"); } catch (e) { return []; }
    }

    function fitRatingFill() {
        var list = document.querySelector(".rating-list-widget") || document.querySelector(".rating-list");
        var cal = document.querySelector(".cal-card");
        var rating = document.querySelector(".rating-card");
        if (!list) return;
        if (window.hideRatingTip) window.hideRatingTip();
        var fill = ratingFillRows();
        var extra = list.querySelectorAll("li.rating-fill");
        var i;
        for (i = 0; i < extra.length; i++) extra[i].remove();
        if (!fill.length) return;

        var wide = window.matchMedia("(min-width: 1100px)").matches;
        // Мобильная страница ?p=rating показывает полный список (.rating-list-full),
        // без подгонки под высоту календаря. Fill — только десктопный виджет.
        if (!wide || !cal || !rating) {
            return;
        }

        // Карточка в сетке растянута до календаря — смотрим низ списка + padding,
        // иначе 10 строк уже «заполняют» высоту и хвост не добирается.
        var target = cal.getBoundingClientRect().bottom;
        var slack = 6;
        for (i = 0; i < fill.length; i++) {
            if (ratingContentBottom(rating, list) >= target - slack) break;
            appendFillRow(list, fill[i]);
            if (ratingContentBottom(rating, list) > target + 24) {
                var last = list.querySelector("li.rating-fill:last-child");
                if (last) last.remove();
                break;
            }
        }
    }

    function ratingContentBottom(rating, list) {
        var pad = 0;
        if (rating) {
            var cs = window.getComputedStyle(rating);
            pad = parseFloat(cs.paddingBottom) || 0;
        }
        var last = list.lastElementChild;
        if (!last) return rating.getBoundingClientRect().bottom;
        return last.getBoundingClientRect().bottom + pad;
    }

    function appendFillRow(list, row) {
        var li = document.createElement("li");
        li.className = "rating-fill";
        if (row.pid) li.setAttribute("data-pid", String(row.pid));
        li.innerHTML = '<span class="place">' + String(row.place) + '</span>' +
            '<span class="name">' + esc(row.name) + '</span>' +
            '<span class="pts has-tip" data-tip="rating">' + esc(fmtPts(row.rating)) + '</span>';
        list.appendChild(li);
    }

    function setupOrgLogin() {
        var form = document.getElementById("org-login-form");
        if (!form) return;
        var hidden = form.querySelector("input[name=password]");
        form.addEventListener("submit", function (e) {
            if (hidden && hidden.value) return;
            e.preventDefault();
            var pw = window.prompt("Пароль организатора");
            if (pw == null || String(pw) === "") return;
            hidden.value = pw;
            form.submit();
        });
    }

    function setupRatingTips() {
        var root = document.querySelector(".rating-card");
        var tipBox = document.getElementById("rating-tip");
        var tipsEl = document.getElementById("rating-tips-json");
        if (!root || !tipBox) return;
        var TIPS = {};
        if (tipsEl) {
            try { TIPS = JSON.parse(tipsEl.textContent || "{}"); } catch (e) { TIPS = {}; }
        }
        var stickyCell = null;
        var hideTimer = null;

        function tipHtmlFor(cell) {
            var kind = cell.getAttribute("data-tip") || "rating";
            if (kind === "formula") {
                return TIPS._formula || '<p class="tip-empty">Нет</p>';
            }
            var li = cell.parentNode;
            var pid = li ? li.getAttribute("data-pid") : "";
            var pack = TIPS[pid] || {};
            return pack[kind] || pack.rating || '<p class="tip-empty">Нет</p>';
        }

        function cancelHide() {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        }

        function hideTip() {
            stickyCell = null;
            cancelHide();
            tipBox.style.display = "none";
        }
        window.hideRatingTip = hideTip;

        function placeTip(cell) {
            cancelHide();
            tipBox.innerHTML = tipHtmlFor(cell);
            tipBox.style.display = "block";
            var r = cell.getBoundingClientRect();
            var tw = tipBox.offsetWidth || 240;
            var th = tipBox.offsetHeight || 48;
            var left = r.left;
            if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
            if (left < 8) left = 8;
            var top = r.bottom + 6;
            if (top + th > window.innerHeight - 8) top = r.top - th - 6;
            if (top < 8) top = 8;
            tipBox.style.left = left + "px";
            tipBox.style.top = top + "px";
        }

        function scheduleHide() {
            if (stickyCell) return;
            cancelHide();
            hideTimer = setTimeout(hideTip, 220);
        }

        function hasTipClass(el) {
            if (!el) return false;
            if (el.classList && el.classList.contains("has-tip")) return true;
            var cn = typeof el.className === "string" ? el.className : (el.getAttribute && el.getAttribute("class")) || "";
            return (" " + cn + " ").indexOf(" has-tip ") !== -1;
        }

        function cellFromEvent(e) {
            var t = e.target || e.srcElement;
            while (t && t !== root) {
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

        function isLink(el) {
            while (el && el !== root) {
                if (el.tagName === "A") return true;
                el = el.parentNode;
            }
            return false;
        }

        root.onclick = function (e) {
            var cell = cellFromEvent(e);
            if (!cell) return;
            if (isLink(cell)) return;
            if (stickyCell === cell) { hideTip(); }
            else { stickyCell = cell; placeTip(cell); }
            if (e.stopPropagation) e.stopPropagation();
            if (e.preventDefault) e.preventDefault();
        };

        root.onmouseover = function (e) {
            if (stickyCell) return;
            var cell = cellFromEvent(e);
            if (cell) placeTip(cell);
        };

        root.onmouseout = function (e) {
            if (stickyCell) return;
            var rel = e.relatedTarget || e.toElement;
            if (isInTip(rel)) return;
            while (rel) {
                if (rel === root) return;
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

        document.addEventListener("click", function (e) {
            var t = e.target || e.srcElement;
            if (isInTip(t)) return;
            while (t) {
                if (hasTipClass(t)) return;
                t = t.parentNode;
            }
            hideTip();
        });
    }

    function setupCombo() {
        var wrap = document.querySelector("[data-combo]");
        if (!wrap) return;
        var input = wrap.querySelector("input[type=text]");
        var list = wrap.querySelector(".combo-list");
        var form = document.getElementById("who-form");
        var hid = document.getElementById("who-form-id");
        var items = [];
        var active = -1;

        function filter(q) {
            q = (q || "").toLowerCase().trim();
            if (!q) return people.slice(0, 20);
            return people.filter(function (p) {
                return p.name.toLowerCase().indexOf(q) !== -1;
            }).slice(0, 30);
        }

        function paint() {
            if (!items.length) {
                list.hidden = true;
                list.innerHTML = "";
                return;
            }
            list.innerHTML = items.map(function (p, i) {
                return '<li data-id="' + p.id + '" class="' + (i === active ? "active" : "") + '">' +
                    esc(p.name) + "</li>";
            }).join("");
            list.hidden = false;
        }

        function show(q) {
            items = filter(q);
            active = items.length ? 0 : -1;
            paint();
        }

        function pick(id, name) {
            input.value = name;
            hid.value = id;
            list.hidden = true;
            form.submit();
        }

        input.addEventListener("focus", function () { show(input.value); });
        input.addEventListener("input", function () { show(input.value); });
        input.addEventListener("keydown", function (e) {
            if (list.hidden) return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                active = Math.min(items.length - 1, active + 1);
                paint();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                active = Math.max(0, active - 1);
                paint();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (active >= 0 && items[active]) pick(items[active].id, items[active].name);
            } else if (e.key === "Escape") {
                list.hidden = true;
            }
        });
        list.addEventListener("mousedown", function (e) {
            var li = e.target.closest("li");
            if (!li) return;
            e.preventDefault();
            pick(li.getAttribute("data-id"), li.textContent);
        });
        document.addEventListener("click", function (e) {
            if (!wrap.contains(e.target)) list.hidden = true;
        });
    }

    var MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн",
        "июл", "авг", "сен", "окт", "ноя", "дек"];
    var mobileMq = window.matchMedia("(max-width: 1099px)");
    var viewYear = new Date().getFullYear();
    var viewMonth = new Date().getMonth();

    function isMobileCal() {
        return mobileMq.matches;
    }

    function syncMobileClass() {
        document.body.classList.toggle("cal-mobile-on", isMobileCal());
    }

    function yearBounds() {
        var minY = new Date().getFullYear();
        var maxY = minY;
        events.forEach(function (ev) {
            if (!ev.start || TEMPLATE_ONLINE10[ev.slug]) return;
            var yy = parseInt(ev.start.slice(0, 4), 10);
            if (yy < minY) minY = yy;
            if (yy > maxY) maxY = yy;
        });
        return { min: minY, max: maxY };
    }

    function yearsWithEvents() {
        var set = {};
        events.forEach(function (ev) {
            if (!ev.start || TEMPLATE_ONLINE10[ev.slug]) return;
            var y1 = parseInt(ev.start.slice(0, 4), 10);
            if (y1) set[y1] = 1;
            if (ev.end) {
                var y2 = parseInt(ev.end.slice(0, 4), 10);
                if (y2) set[y2] = 1;
            }
        });
        return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    }

    function yearList() {
        var ys = yearsWithEvents().slice();
        if (ys.indexOf(2026) < 0) {
            ys.push(2026);
            ys.sort(function (a, b) { return a - b; });
        }
        return ys;
    }

    function monthDotKind(year, month) {
        var special = false;
        var has = false;
        var dim = new Date(year, month + 1, 0).getDate();
        var d;
        for (d = 1; d <= dim; d++) {
            var evs = byDay[year + "-" + pad(month + 1) + "-" + pad(d)];
            if (!evs || !evs.length) continue;
            has = true;
            if (evs.some(function (e) { return isSpecial(e.type); })) special = true;
        }
        if (!has) return "";
        return special ? "special" : "online";
    }

    function lastMonthWithEvents(year) {
        var m;
        for (m = 11; m >= 0; m--) {
            if (monthDotKind(year, m)) return m;
        }
        return 0;
    }

    function initView() {
        var now = new Date();
        var cy = now.getFullYear();
        var cm = now.getMonth();
        if (!isMobileCal()) {
            var b = yearBounds();
            var y = cy;
            if (y < b.min) y = b.min;
            if (y > b.max) y = b.max;
            return { y: y, m: cm };
        }
        var withEv = yearsWithEvents();
        if (withEv.indexOf(cy) >= 0) {
            return { y: cy, m: cm };
        }
        var y = withEv.length ? withEv[withEv.length - 1] : 2026;
        return { y: y, m: lastMonthWithEvents(y) };
    }

    function showMonth(month) {
        viewMonth = month;
        var months = document.querySelectorAll("#year-cal .month");
        var i;
        for (i = 0; i < months.length; i++) {
            if (parseInt(months[i].getAttribute("data-month"), 10) === month) {
                months[i].classList.add("is-on");
            } else {
                months[i].classList.remove("is-on");
            }
        }
    }

    function paintYearChips() {
        var root = document.getElementById("cal-years");
        if (!root) return;
        var ys = yearList();
        var html = "";
        var i;
        for (i = 0; i < ys.length; i++) {
            var on = ys[i] === viewYear;
            html += '<button type="button" role="tab" data-year="' + ys[i] + '"' +
                ' class="' + (on ? "is-on" : "") + '"' +
                ' aria-selected="' + (on ? "true" : "false") + '">' +
                ys[i] + "</button>";
        }
        root.innerHTML = html;
        var active = root.querySelector(".is-on");
        if (active && root.scrollWidth > root.clientWidth) {
            root.scrollLeft = active.offsetLeft - (root.clientWidth - active.offsetWidth) / 2;
        }
    }

    function paintMonthStrip() {
        var root = document.getElementById("cal-month-strip");
        if (!root) return;
        var now = new Date();
        var html = "";
        var m;
        for (m = 0; m < 12; m++) {
            var kind = monthDotKind(viewYear, m);
            var cls = [];
            if (m === viewMonth) cls.push("is-on");
            if (viewYear === now.getFullYear() && m === now.getMonth()) cls.push("is-now");
            if (kind) cls.push("has-dot", "dot-" + kind);
            html += '<button type="button" role="tab" data-month="' + m + '"' +
                ' class="' + cls.join(" ") + '"' +
                ' aria-selected="' + (m === viewMonth ? "true" : "false") + '"' +
                ' aria-label="' + MONTHS[m] + '">' + MONTHS_SHORT[m] + "</button>";
        }
        root.innerHTML = html;
    }

    function paintMonthTitle() {
        var el = document.getElementById("cal-month-title");
        if (el) el.textContent = MONTHS[viewMonth] + " " + viewYear;
    }

    function setupYearNav() {
        var bounds = yearBounds();
        var init = initView();
        viewYear = init.y;
        viewMonth = init.m;
        var label = document.getElementById("cal-year");
        var prev = document.getElementById("cal-prev");
        var next = document.getElementById("cal-next");
        var monthPrev = document.getElementById("cal-month-prev");
        var monthNext = document.getElementById("cal-month-next");
        var yearsEl = document.getElementById("cal-years");
        var stripEl = document.getElementById("cal-month-strip");

        function paintYearGrid() {
            syncMobileClass();
            if (label) label.textContent = String(viewYear);
            if (prev) prev.disabled = viewYear <= bounds.min;
            if (next) next.disabled = viewYear >= bounds.max;
            renderYear(viewYear);
            showMonth(viewMonth);
            paintYearChips();
            paintMonthStrip();
            paintMonthTitle();
            paintSel();
            fitRatingFill();
        }

        function paintMonthOnly() {
            showMonth(viewMonth);
            paintMonthStrip();
            paintMonthTitle();
        }

        function goYear(ny) {
            var now = new Date();
            viewYear = ny;
            if (ny === now.getFullYear()) viewMonth = now.getMonth();
            paintYearGrid();
        }

        function shiftMonth(delta) {
            var ys = yearList();
            var idx = ys.indexOf(viewYear);
            if (idx < 0) idx = 0;
            var nm = viewMonth + delta;
            var yearChanged = false;
            if (nm < 0) {
                nm = 11;
                idx = (idx - 1 + ys.length) % ys.length;
                yearChanged = ys[idx] !== viewYear;
                viewYear = ys[idx];
            } else if (nm > 11) {
                nm = 0;
                idx = (idx + 1) % ys.length;
                yearChanged = ys[idx] !== viewYear;
                viewYear = ys[idx];
            }
            viewMonth = nm;
            if (yearChanged) paintYearGrid();
            else paintMonthOnly();
        }

        if (prev) prev.addEventListener("click", function () {
            if (viewYear > bounds.min) { viewYear -= 1; paintYearGrid(); }
        });
        if (next) next.addEventListener("click", function () {
            if (viewYear < bounds.max) { viewYear += 1; paintYearGrid(); }
        });
        if (monthPrev) monthPrev.addEventListener("click", function () { shiftMonth(-1); });
        if (monthNext) monthNext.addEventListener("click", function () { shiftMonth(1); });
        if (yearsEl) yearsEl.addEventListener("click", function (e) {
            var btn = e.target.closest("button[data-year]");
            if (!btn || !yearsEl.contains(btn)) return;
            goYear(parseInt(btn.getAttribute("data-year"), 10));
        });
        if (stripEl) stripEl.addEventListener("click", function (e) {
            var btn = e.target.closest("button[data-month]");
            if (!btn || !stripEl.contains(btn)) return;
            viewMonth = parseInt(btn.getAttribute("data-month"), 10);
            paintMonthOnly();
        });

        function onModeChange() {
            syncMobileClass();
            if (isMobileCal()) {
                showMonth(viewMonth);
                paintYearChips();
                paintMonthStrip();
                paintMonthTitle();
            }
            fitRatingFill();
        }
        if (mobileMq.addEventListener) mobileMq.addEventListener("change", onModeChange);
        else if (mobileMq.addListener) mobileMq.addListener(onModeChange);

        paintYearGrid();
    }

    var calRoot = document.getElementById("year-cal");
    if (calRoot) {
        calRoot.addEventListener("click", function (e) {
            var td = e.target.closest("td.ev");
            if (!td || !calRoot.contains(td)) return;
            selectDay(td.getAttribute("data-iso"), true);
        });
    }

    selectedIso = defaultMeetingIso();
    if (selectedIso) renderMeeting(selectedIso);
    setupRatingTips();
    setupOrgLogin();
    setupYearNav();
    setupCombo();
    window.addEventListener("resize", fitRatingFill);
    window.addEventListener("load", fitRatingFill);
})();
