// Банк ситуаций: загрузка из MySQL через JSON API портала, просмотр и поиск.
// Страница: situations-bank.html (mobile-first). Модалка в index.html — опционально.

var SITUATIONS_BANK_API_URL =
    "https://ciocdo-org-skills.zaborov.ru/api/situations.php";

var SITUATION_PLAYS_URL = "js/situation-plays.json";

var situationsBankRows = [];
var situationsBankSelectedIndex = -1;
var situationsBankSearchQuery = "";
var situationPlaysByCode = null;

var SB_DESKTOP_MQ = "(min-width: 900px)";
var SB_PORTAL_HOME = "https://ciocdo-org-skills.zaborov.ru/";

function sitPlayEventHref_(p) {
    var iso = String((p && p.iso) || "").trim();
    var eid = (p && p.eventId) | 0;
    if (isSituationsBankOrgMode_()) {
        if (eid <= 0) return "";
        var href = "./?p=org&s=events&id=" + eid;
        if (/^\d{4}/.test(iso)) href += "&y=" + iso.slice(0, 4);
        return href;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        return SB_PORTAL_HOME + "?iso=" + encodeURIComponent(iso);
    }
    return "";
}

function renderSituationPlayEvent_(p) {
    var name = String((p && p.event) || "").trim();
    if (!name) return "—";
    var href = sitPlayEventHref_(p);
    if (!href) return escapeHtmlSituationsBank(name);
    return '<a class="sb-play-event" href="' + escapeHtmlSituationsBank(href) + '">' +
        escapeHtmlSituationsBank(name) + "</a>";
}

function renderSituationPlayVideoPill_(url, extraClass, label) {
    url = String(url || "").trim();
    if (!/^https?:\/\//i.test(url)) return "";
    extraClass = extraClass ? " " + extraClass : "";
    return '<a class="sb-play-video vid-pill' + extraClass + '" href="' +
        escapeHtmlSituationsBank(url) + '" target="_blank" rel="noopener">' +
        escapeHtmlSituationsBank(label) + "</a>";
}

function isSituationsBankStandalonePage_() {
    return !!document.querySelector(".sb-app");
}

function isSituationsBankOrgMode_() {
    return !!(window.UB_ORG_SITUATIONS);
}

function situationsBankFromPortal_() {
    try {
        var params = new URLSearchParams(location.search);
        if ((params.get("from") || "").toLowerCase() === "portal") return true;
    } catch (e) {}
    try {
        var ref = document.referrer || "";
        if (/ciocdo-org-skills\.zaborov\.ru/i.test(ref)) return true;
    } catch (e2) {}
    return false;
}

function situationsBankSearchKeep_() {
    return situationsBankFromPortal_() ? "?from=portal" : "";
}

function situationsBankPageUrl_(hash) {
    var path = "situations-bank.html" + situationsBankSearchKeep_();
    if (hash !== undefined && hash !== null && String(hash) !== "") {
        path += "#" + hash;
    }
    return path;
}

function ensureSituationsBankFromQuery_() {
    if (!situationsBankFromPortal_()) return;
    try {
        var params = new URLSearchParams(location.search);
        if ((params.get("from") || "").toLowerCase() === "portal") return;
        params.set("from", "portal");
        var qs = params.toString();
        var next = "situations-bank.html" + (qs ? "?" + qs : "") + (location.hash || "");
        if (window.history && window.history.replaceState) {
            window.history.replaceState(history.state, "", next);
        }
    } catch (e3) {}
}

function applySituationsBankHomeLinks_() {
    var href = situationsBankFromPortal_() ? SB_PORTAL_HOME : "index.html";
    var links = document.querySelectorAll(".sb-home-link");
    var i;
    for (i = 0; i < links.length; i++) {
        links[i].href = href;
    }
}

function isSituationsBankDesktop_() {
    return !!(window.matchMedia && window.matchMedia(SB_DESKTOP_MQ).matches);
}

function escapeHtmlSituationsBank(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function parseSituationNumFromCode_(code) {
    var m = String(code || "").match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
}

/** Служебные/пустые строки — не показываем в списке. */
function isExcludedSituationBankCode_(code) {
    var c = String(code || "").trim();
    if (!c) return true;
    if (/^-+$/.test(c)) return true;
    var lower = c.toLowerCase();
    if (lower.indexOf("случайн") !== -1) return true;
    if (/^00([-–]|$)/.test(c)) return true;
    return false;
}

function normalizeSituationBankApiRow_(raw, index) {
    if (!raw) return null;
    var code = String(raw.code || "").trim();
    if (!code || isExcludedSituationBankCode_(code)) return null;
    var rolesJson = raw.rolesJson;
    if (typeof rolesJson === "string" && rolesJson.trim()) {
        try {
            rolesJson = JSON.parse(rolesJson.trim());
        } catch (e) {
            console.warn("situations-bank: невалидный rolesJson для", code, e);
            rolesJson = null;
        }
    }
    if (!rolesJson || !rolesJson.length) rolesJson = null;
    var descriptionHtml = String(raw.descriptionHtml || raw.description || "").trim();
    var descriptionPlain = String(raw.descriptionPlain || "").trim();
    var rolesPlain = String(raw.rolesPlain || "").trim();
    if (!descriptionHtml && !descriptionPlain && !rolesJson && !rolesPlain) return null;
    var num = raw.num != null && raw.num !== "" ? Number(raw.num) : 0;
    if (!num) num = parseSituationNumFromCode_(code) || 0;
    var published = true;
    if (Object.prototype.hasOwnProperty.call(raw, "isPublished")) {
        published = !!raw.isPublished;
    }
    return {
        index: index,
        id: raw.id != null && raw.id !== "" ? Number(raw.id) : 0,
        num: num,
        code: code,
        name: String(raw.name || "").trim(),
        type: String(raw.type || "").trim(),
        descriptionHtml: descriptionHtml,
        descriptionPlain: descriptionPlain,
        rolesJson: rolesJson,
        rolesPlain: rolesPlain,
        hasFormatting: !!(descriptionHtml || rolesJson),
        reviewUrl: String(raw.reviewUrl || "").trim(),
        reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
        isPublished: published
    };
}

function setSituationsBankStatus_(message, isError) {
    var el = document.getElementById("situations-bank-status");
    if (!el) return;
    el.textContent = message || "";
    if (isSituationsBankStandalonePage_()) {
        el.className = "sb-status" + (message ? (isError ? " sb-status--error" : "") : " sb-hidden");
    } else {
        el.className = "small mb-2 " + (isError ? "text-danger" : "text-muted");
        el.style.display = message ? "block" : "none";
    }
}

function setSituationsBankLoading_(loading) {
    var el = document.getElementById("situations-bank-loading");
    if (el) {
        if (isSituationsBankStandalonePage_()) {
            el.className = loading ? "sb-loading" : "sb-loading sb-hidden";
        } else {
            el.style.display = loading ? "block" : "none";
        }
    }
    var list = document.getElementById("situations-bank-list");
    var detail = document.getElementById("situations-bank-detail");
    if (list && !isSituationsBankStandalonePage_()) list.style.opacity = loading ? "0.5" : "1";
    if (detail && !isSituationsBankStandalonePage_()) detail.style.opacity = loading ? "0.5" : "1";
}

function situationsBankAssetVersion_() {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].getAttribute("src") || "";
        var m = src.match(/situations-bank\.js\?v=(\d+)/);
        if (m) return m[1];
    }
    return "";
}

function getSituationPlaysForCode_(code) {
    if (!situationPlaysByCode || !code) return [];
    var key = String(code).trim();
    if (situationPlaysByCode[key]) return situationPlaysByCode[key];
    var lower = key.toLowerCase();
    for (var k in situationPlaysByCode) {
        if (Object.prototype.hasOwnProperty.call(situationPlaysByCode, k) &&
            String(k).trim().toLowerCase() === lower) {
            return situationPlaysByCode[k];
        }
    }
    return [];
}

function getSituationGeneralReviews_(row) {
    var duelUrls = {};
    var plays = getSituationPlaysForCode_(row && row.code);
    var i;
    for (i = 0; i < plays.length; i++) {
        var pu = String((plays[i] && plays[i].review) || "").trim();
        if (pu) duelUrls[pu] = true;
    }
    var items = [];
    var list = (row && row.reviews) || [];
    for (i = 0; i < list.length; i++) {
        var it = list[i] || {};
        var url = String(it.url || "").trim();
        if (!/^https?:\/\//i.test(url)) continue;
        if ((it.duelId | it.duel_id | 0) > 0) continue;
        if (duelUrls[url]) continue;
        items.push({
            url: url,
            label: String(it.label || "разбор").trim() || "разбор",
            date: String(it.date || "").trim(),
            iso: String(it.iso || "").trim(),
            event: String(it.event || "").trim(),
            eventId: it.eventId | 0
        });
    }
    return items;
}

function renderSituationReviewsBlock_(row) {
    var reviews = getSituationGeneralReviews_(row);
    if (!reviews.length) return "";
    var items = "";
    var rowsHtml = "";
    var i;
    for (i = 0; i < reviews.length; i++) {
        var r = reviews[i];
        var eventHtml = r.event ? renderSituationPlayEvent_(r) : "—";
        var dateHtml = r.date ? escapeHtmlSituationsBank(r.date) : "—";
        var pill = renderSituationPlayVideoPill_(r.url, "sb-review", r.label);
        var metaHtml = "";
        if (r.date) metaHtml += escapeHtmlSituationsBank(r.date);
        if (r.event) {
            if (metaHtml) metaHtml += " · ";
            metaHtml += eventHtml;
        }
        items += '<li class="sb-play">' +
            (metaHtml ? '<p class="sb-play-meta">' + metaHtml + "</p>" : "") +
            '<p class="sb-play-line">' + (pill || escapeHtmlSituationsBank(r.label)) + "</p></li>";
        rowsHtml += "<tr>" +
            "<td>" + dateHtml + "</td>" +
            "<td>" + eventHtml + "</td>" +
            '<td class="sb-plays-td-video">' + pill + "</td>" +
            "</tr>";
    }
    return '<div class="sb-plays-panel">' +
        '<p class="sb-plays-heading">Разборы</p>' +
        '<ul class="sb-plays">' + items + "</ul>" +
        '<div class="sb-plays-wrap">' +
        '<table class="sb-plays-table">' +
        "<thead><tr><th>Дата</th><th>Мероприятие</th><th>Разбор</th></tr></thead>" +
        "<tbody>" + rowsHtml + "</tbody></table></div></div>";
}

function renderSituationPlayName_(name, isWinner) {
    var text = escapeHtmlSituationsBank(name || "—");
    if (isWinner) return "<b>" + text + "</b>";
    return text;
}

function renderSituationPlaysBlock_(row) {
    if (situationPlaysByCode === null) return "";
    var plays = getSituationPlaysForCode_(row && row.code);
    var inner;
    if (!plays.length) {
        inner = '<p class="sb-plays-empty">Эту ситуацию ещё не играли</p>';
    } else {
        var items = "";
        var rowsHtml = "";
        for (var i = 0; i < plays.length; i++) {
            var p = plays[i];
            var eventHtml = renderSituationPlayEvent_(p);
            var metaHtml = "";
            if (p.date) metaHtml += escapeHtmlSituationsBank(p.date);
            if (p.event) {
                if (metaHtml) metaHtml += " · ";
                metaHtml += eventHtml;
            }
            var w = p.winner | 0;
            var vs = renderSituationPlayName_(p.p1, w === 1) +
                ' <span class="sb-play-vs">vs</span> ' +
                renderSituationPlayName_(p.p2, w === 2);
            var scoreHtml = "";
            if (p.score) {
                scoreHtml = '<span class="sb-play-score">' + escapeHtmlSituationsBank(p.score) + "</span>";
                if (w === 0) scoreHtml += ' <span class="sb-play-draw">ничья</span>';
            }
            var videoHtml = renderSituationPlayVideoPill_(p.video, "", "видео");
            var revLab = String(p.reviewLabel || "разбор").trim() || "разбор";
            var reviewHtml = renderSituationPlayVideoPill_(p.review, "sb-review", revLab);
            items += '<li class="sb-play">' +
                (metaHtml ? '<p class="sb-play-meta">' + metaHtml + "</p>" : "") +
                '<p class="sb-play-line">' + vs +
                (scoreHtml ? " · " + scoreHtml : "") +
                (videoHtml ? " " + videoHtml : "") +
                (reviewHtml ? " " + reviewHtml : "") +
                "</p></li>";
            rowsHtml += "<tr>" +
                "<td>" + escapeHtmlSituationsBank(p.date || "") + "</td>" +
                "<td>" + eventHtml + "</td>" +
                "<td>" + renderSituationPlayName_(p.p1, w === 1) + "</td>" +
                "<td>" + renderSituationPlayName_(p.p2, w === 2) + "</td>" +
                "<td>" + scoreHtml + "</td>" +
                '<td class="sb-plays-td-video">' + videoHtml + "</td>" +
                '<td class="sb-plays-td-video">' + reviewHtml + "</td>" +
                "</tr>";
        }
        inner =
            '<ul class="sb-plays">' + items + "</ul>" +
            '<div class="sb-plays-wrap">' +
            '<table class="sb-plays-table">' +
            "<thead><tr>" +
            "<th>Дата</th><th>Мероприятие</th><th>Игрок 1</th><th>Игрок 2</th><th>Счёт</th><th>Видео</th><th>Разбор</th>" +
            "</tr></thead><tbody>" + rowsHtml + "</tbody></table></div>";
    }
    return '<div class="sb-plays-panel">' +
        '<p class="sb-plays-heading">Когда играли эту ситуацию</p>' + inner + "</div>";
}

function fetchSituationPlays_() {
    if (situationPlaysByCode) return Promise.resolve(situationPlaysByCode);
    if (location.protocol === "file:") {
        situationPlaysByCode = {};
        return Promise.resolve(situationPlaysByCode);
    }
    var v = situationsBankAssetVersion_();
    var url = SITUATION_PLAYS_URL + (v ? "?v=" + v : "");
    return fetch(url)
        .then(function (resp) {
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            return resp.json();
        })
        .then(function (data) {
            situationPlaysByCode = (data && data.byCode) ? data.byCode : {};
            return situationPlaysByCode;
        })
        .catch(function () {
            situationPlaysByCode = {};
            return situationPlaysByCode;
        });
}

function fetchSituationsBank_(force) {
    if (isSituationsBankOrgMode_()) {
        return fetchOrgSituationsBank_(force);
    }
    if (location.protocol === "file:") {
        var fileMsg = "Страница открыта как файл (file://). Браузер блокирует загрузку данных. " +
            "Откройте через http://localhost (python -m http.server) или https://timer.zaborov.ru/situations-bank.html";
        setSituationsBankStatus_(fileMsg, true);
        return Promise.reject(new Error(fileMsg));
    }
    setSituationsBankLoading_(true);
    setSituationsBankStatus_("Загрузка…");
    var url = SITUATIONS_BANK_API_URL;
    if (force) url += (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
    return fetch(url, { cache: "no-store" })
        .then(function (resp) {
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            return resp.json();
        })
        .then(function (data) {
            var objects = (data && data.rows) ? data.rows : [];
            if (data && Object.prototype.hasOwnProperty.call(data, "playsByCode")) {
                situationPlaysByCode = data.playsByCode || {};
            }
            var rows = [];
            for (var i = 0; i < objects.length; i++) {
                var row = normalizeSituationBankApiRow_(objects[i], rows.length);
                if (row) rows.push(row);
            }
            rows.sort(function (a, b) {
                var na = Number(a.num) || 0;
                var nb = Number(b.num) || 0;
                if (na !== nb) return na - nb;
                return String(a.code).localeCompare(String(b.code), "ru");
            });
            for (var j = 0; j < rows.length; j++) rows[j].index = j;
            situationsBankRows = rows;
            setSituationsBankStatus_("");
            return rows;
        })
        .catch(function (err) {
            setSituationsBankStatus_("Не удалось загрузить: " + (err.message || err), true);
            throw err;
        })
        .finally(function () {
            setSituationsBankLoading_(false);
        });
}

function filterSituationsBankRows_(rows, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(function (row) {
        var hay = [
            row.code, row.name, row.type,
            row.descriptionHtml, row.descriptionPlain,
            row.rolesPlain,
            row.rolesJson ? JSON.stringify(row.rolesJson) : ""
        ].join(" ").toLowerCase();
        return hay.indexOf(q) !== -1;
    });
}

function isSituationBankExpress_(row) {
    return String(row && row.type || "").toLowerCase().indexOf("экспресс") !== -1;
}

function renderSituationRolesBlock_(row) {
    if (row.rolesJson && row.rolesJson.length) {
        var html = "";
        var isExpress = String(row.type || "").toLowerCase().indexOf("экспресс") !== -1;
        for (var i = 0; i < row.rolesJson.length; i++) {
            var r = row.rolesJson[i];
            if (!r || !r.Role) continue;
            if (isSituationsBankStandalonePage_()) {
                html += '<p class="sb-role-line"><b>' + escapeHtmlSituationsBank(r.Role) + "</b>";
                if (isExpress && r.Phrase) {
                    html += " — <em>" + escapeHtmlSituationsBank(r.Phrase) + "</em>";
                } else if (r.Goals) {
                    html += " — " + escapeHtmlSituationsBank(r.Goals);
                }
                html += "</p>";
            } else {
                html += "<p class=\"mb-2\"><b>" + escapeHtmlSituationsBank(r.Role) + "</b>";
                if (isExpress && r.Phrase) {
                    html += " — <em>" + escapeHtmlSituationsBank(r.Phrase) + "</em>";
                } else if (r.Goals) {
                    html += " — " + escapeHtmlSituationsBank(r.Goals);
                }
                html += "</p>";
            }
        }
        return html || '<p class="text-muted">Роли не заданы</p>';
    }
    if (row.rolesPlain) {
        if (isSituationsBankStandalonePage_()) {
            return '<p class="sb-plain">' + escapeHtmlSituationsBank(row.rolesPlain) + "</p>";
        }
        return '<pre class="situations-bank-plain">' + escapeHtmlSituationsBank(row.rolesPlain) + "</pre>";
    }
    return isSituationsBankStandalonePage_()
        ? '<p class="sb-field-value" style="color:#999">Роли не заданы</p>'
        : '<p class="text-muted">Роли не заданы</p>';
}

function renderSituationBankDetail_(row) {
    var detailEl = document.getElementById("situations-bank-detail");
    if (!detailEl) return;

    if (!row) {
        if (isSituationsBankStandalonePage_()) {
            detailEl.innerHTML = '<div class="sb-detail-card"><p class="sb-empty sb-empty--detail">Выберите ситуацию в списке слева</p></div>';
        } else {
            detailEl.innerHTML = '<p class="text-muted p-3">Выберите ситуацию в списке</p>';
        }
        return;
    }

    var descHtml;
    if (row.descriptionHtml) {
        descHtml = '<div class="sb-description-html">' + row.descriptionHtml + "</div>";
    } else if (row.descriptionPlain) {
        descHtml = isSituationsBankStandalonePage_()
            ? '<p class="sb-plain">' + escapeHtmlSituationsBank(row.descriptionPlain) + "</p>"
            : '<pre class="situations-bank-plain">' + escapeHtmlSituationsBank(row.descriptionPlain) + "</pre>";
    } else {
        descHtml = '<p style="color:#999">Описание отсутствует</p>';
    }

    if (isSituationsBankStandalonePage_()) {
        var navHint = buildSituationNavHint_(row.index);
        detailEl.innerHTML =
            '<div class="sb-detail-card">' +
            (navHint ? '<p class="sb-nav-hint">' + navHint + "</p>" : "") +
            '<h2 class="sb-detail-title">' + escapeHtmlSituationsBank(row.code) +
            (isSituationsBankOrgMode_() && row.isPublished === false
                ? ' <span class="sb-draft">черновик</span>' : "") +
            "</h2>" +
            '<div class="sb-field"><p class="sb-field-label">Тип</p><p class="sb-field-value">' +
            escapeHtmlSituationsBank(row.type || "—") + "</p></div>" +
            '<div class="sb-field"><p class="sb-field-label sb-field-label--section">Описание ситуации</p>' + descHtml + "</div>" +
            (isSituationBankExpress_(row) ? "" :
                '<div class="sb-field"><p class="sb-field-label sb-field-label--section">Роли и интересы</p>' +
                renderSituationRolesBlock_(row) + "</div>") +
            renderSituationReviewsBlock_(row) +
            renderSituationPlaysBlock_(row) +
            "</div>";
        return;
    }

    var fmtNote = row.hasFormatting
        ? '<span class="badge bg-success-subtle text-success-emphasis">с форматированием</span>'
        : '<span class="badge bg-secondary-subtle text-secondary">без форматирования (plain text)</span>';
    detailEl.innerHTML =
        '<div class="situations-bank-detail-inner p-3">' +
        '<h5 class="mb-2">' + escapeHtmlSituationsBank(row.code) + "</h5>" +
        '<div class="mb-2 small">' + fmtNote + "</div>" +
        '<div class="mb-1 fw-semibold">Описание</div>' + descHtml +
        '<div class="mb-1 mt-3 fw-semibold">Роли и интересы</div>' +
        '<div class="situations-bank-roles">' + renderSituationRolesBlock_(row) + "</div>" +
        renderSituationReviewsBlock_(row) +
        renderSituationPlaysBlock_(row) +
        "</div>";
}

function renderSituationsBankList_() {
    var listEl = document.getElementById("situations-bank-list");
    if (!listEl) return;
    var filtered = filterSituationsBankRows_(situationsBankRows, situationsBankSearchQuery);

    if (isSituationsBankStandalonePage_()) {
        if (!filtered.length) {
            listEl.innerHTML = '<tr><td colspan="3" class="sb-empty">Ничего не найдено</td></tr>';
            return;
        }
        var tbody = "";
        for (var i = 0; i < filtered.length; i++) {
            var row = filtered[i];
            var activeCls = row.index === situationsBankSelectedIndex ? " sb-row--active" : "";
            var draft = (isSituationsBankOrgMode_() && row.isPublished === false)
                ? ' <span class="sb-draft">черновик</span>' : "";
            tbody += '<tr class="sb-row' + activeCls + '" data-index="' + row.index + '">' +
                '<td class="sb-cell-code">' + escapeHtmlSituationsBank(row.code) + draft + "</td>" +
                '<td class="sb-cell-type">' + escapeHtmlSituationsBank(row.type || "—") + "</td>" +
                '<td class="sb-cell-chevron"><i class="fa-solid fa-chevron-right"></i></td></tr>';
        }
        listEl.innerHTML = tbody;
        var trs = listEl.querySelectorAll(".sb-row");
        for (var t = 0; t < trs.length; t++) {
            trs[t].addEventListener("click", function () {
                selectSituationBankRow_(parseInt(this.getAttribute("data-index"), 10));
            });
        }
        scrollSituationsBankActiveRowIntoView_();
        return;
    }

    if (!filtered.length) {
        listEl.innerHTML = '<div class="text-muted p-2">Ничего не найдено</div>';
        return;
    }
    var html = '<div class="list-group list-group-flush situations-bank-list-inner">';
    for (var j = 0; j < filtered.length; j++) {
        var r = filtered[j];
        var active = r.index === situationsBankSelectedIndex ? " active" : "";
        html += '<button type="button" class="list-group-item list-group-item-action situations-bank-list-item' + active +
            '" data-index="' + r.index + '">' +
            '<span class="situations-bank-list-code">' + escapeHtmlSituationsBank(r.code) + "</span>" +
            '<div class="small text-muted">' + escapeHtmlSituationsBank(r.type || "—") + "</div></button>";
    }
    html += "</div>";
    listEl.innerHTML = html;
    var buttons = listEl.querySelectorAll(".situations-bank-list-item");
    for (var b = 0; b < buttons.length; b++) {
        buttons[b].addEventListener("click", function () {
            selectSituationBankRow_(parseInt(this.getAttribute("data-index"), 10));
        });
    }
}

function getSituationBankRowByIndex_(index) {
    for (var i = 0; i < situationsBankRows.length; i++) {
        if (situationsBankRows[i].index === index) return situationsBankRows[i];
    }
    return null;
}

function getFilteredSituationBankRows_() {
    return filterSituationsBankRows_(situationsBankRows, situationsBankSearchQuery);
}

function getSituationNavPosition_(rowIndex) {
    var filtered = getFilteredSituationBankRows_();
    for (var i = 0; i < filtered.length; i++) {
        if (filtered[i].index === rowIndex) return { pos: i, total: filtered.length, filtered: filtered };
    }
    return { pos: -1, total: filtered.length, filtered: filtered };
}

function buildSituationNavHint_(rowIndex) {
    var nav = getSituationNavPosition_(rowIndex);
    if (nav.total <= 1) return "";
    return "← листайте · " + (nav.pos + 1) + " из " + nav.total + " →";
}

function stripHtmlToPlainText_(html) {
    if (!html) return "";
    var d = document.createElement("div");
    d.innerHTML = html;
    return (d.textContent || d.innerText || "").replace(/\s+/g, " ").trim();
}

function formatSituationRolesPlain_(row) {
    if (!row) return "";
    if (row.rolesJson && row.rolesJson.length) {
        var lines = [];
        var isExpress = isSituationBankExpress_(row);
        for (var i = 0; i < row.rolesJson.length; i++) {
            var r = row.rolesJson[i];
            if (!r || !r.Role) continue;
            if (isExpress && r.Phrase) {
                lines.push(r.Role + " — " + r.Phrase);
            } else if (r.Goals) {
                lines.push(r.Role + " — " + r.Goals);
            } else {
                lines.push(r.Role);
            }
        }
        return lines.join("\n");
    }
    return row.rolesPlain || "";
}

function buildSituationRolesShareText_(row) {
    if (isSituationBankExpress_(row)) return "";
    return formatSituationRolesPlain_(row);
}

function buildSituationShareText_(row) {
    if (!row) return "";
    var desc = row.descriptionHtml
        ? stripHtmlToPlainText_(row.descriptionHtml)
        : (row.descriptionPlain || "");
    var roles = buildSituationRolesShareText_(row);
    var parts = [row.code];
    if (row.type) parts[0] += " (" + row.type + ")";
    parts.push("");
    if (desc) {
        parts.push("Описание ситуации:");
        parts.push(desc);
        parts.push("");
    }
    if (roles) {
        parts.push("Роли и интересы:");
        parts.push(roles);
    }
    return parts.join("\n").trim();
}

function showSituationsBankToast_(message) {
    var el = document.getElementById("sb-share-toast");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("sb-hidden");
    clearTimeout(showSituationsBankToast_._t);
    showSituationsBankToast_._t = setTimeout(function () {
        el.classList.add("sb-hidden");
    }, 2200);
}

function shareSituationBank_() {
    var row = getSituationBankRowByIndex_(situationsBankSelectedIndex);
    if (!row) return;
    var text = buildSituationShareText_(row);
    var title = row.code;

    function openTelegramShare_() {
        window.open("https://t.me/share/url?text=" + encodeURIComponent(text), "_blank", "noopener,noreferrer");
    }

    if (navigator.share) {
        navigator.share({ title: title, text: text }).catch(function (err) {
            if (err && err.name === "AbortError") return;
            openTelegramShare_();
        });
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
            showSituationsBankToast_("Скопировано. Вставьте в Telegram.");
            setTimeout(openTelegramShare_, 400);
        }).catch(openTelegramShare_);
        return;
    }

    openTelegramShare_();
}

function flashSituationDetailSwipe_(direction) {
    var el = document.getElementById("situations-bank-detail");
    if (!el) return;
    el.classList.remove("sb-detail--swipe-left", "sb-detail--swipe-right");
    void el.offsetWidth;
    el.classList.add(direction === 1 ? "sb-detail--swipe-left" : "sb-detail--swipe-right");
}

function navigateSituationBank_(delta) {
    if (situationsBankSelectedIndex < 0) return;
    var nav = getSituationNavPosition_(situationsBankSelectedIndex);
    if (nav.pos < 0 || nav.total <= 1) return;
    var nextPos = nav.pos + delta;
    if (nextPos < 0 || nextPos >= nav.total) return;
    flashSituationDetailSwipe_(delta);
    selectSituationBankRow_(nav.filtered[nextPos].index, { keepDetailScreen: true, replaceHistory: true });
    var detailEl = document.getElementById("situations-bank-detail");
    if (detailEl) detailEl.scrollTop = 0;
}

function initSituationsBankSwipe_() {
    var panel = document.getElementById("situations-bank-detail");
    if (!panel) return;
    var startX = 0;
    var startY = 0;
    var tracking = false;

    panel.addEventListener("touchstart", function (e) {
        if (isSituationsBankDesktop_()) return;
        if (!e.touches || e.touches.length !== 1) return;
        if (document.getElementById("sb-screen-detail").classList.contains("sb-hidden")) return;
        if (e.target && e.target.closest && e.target.closest(".sb-plays-wrap")) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        tracking = true;
    }, { passive: true });

    panel.addEventListener("touchend", function (e) {
        if (!tracking || !e.changedTouches || !e.changedTouches.length) return;
        tracking = false;
        var dx = e.changedTouches[0].clientX - startX;
        var dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        if (dx < 0) navigateSituationBank_(1);
        else navigateSituationBank_(-1);
    }, { passive: true });

    panel.addEventListener("keydown", function (e) {
        if (!isSituationsBankDesktop_() && document.getElementById("sb-screen-detail").classList.contains("sb-hidden")) return;
        if (e.key === "ArrowRight") navigateSituationBank_(1);
        else if (e.key === "ArrowLeft") navigateSituationBank_(-1);
    });
}

function scrollSituationsBankActiveRowIntoView_() {
    var listEl = document.getElementById("situations-bank-list");
    if (!listEl) return;
    var activeEl = listEl.querySelector(".sb-row--active");
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
        activeEl.scrollIntoView({ block: "nearest" });
    }
}

function markSituationsBankListActive_(index) {
    var listEl = document.getElementById("situations-bank-list");
    if (!listEl) return;
    var trs = listEl.querySelectorAll(".sb-row");
    for (var i = 0; i < trs.length; i++) {
        var idx = parseInt(trs[i].getAttribute("data-index"), 10);
        trs[i].classList.toggle("sb-row--active", idx === index);
    }
    scrollSituationsBankActiveRowIntoView_();
}

function applySituationsBankLayout_() {
    var list = document.getElementById("sb-screen-list");
    var detail = document.getElementById("sb-screen-detail");
    if (!list || !detail) return;
    if (isSituationsBankDesktop_()) {
        list.classList.remove("sb-hidden");
        detail.classList.remove("sb-hidden");
        if (situationsBankSelectedIndex < 0) {
            renderSituationBankDetail_(null);
        }
        return;
    }
    if (situationsBankSelectedIndex >= 0) {
        list.classList.add("sb-hidden");
        detail.classList.remove("sb-hidden");
        return;
    }
    detail.classList.add("sb-hidden");
    list.classList.remove("sb-hidden");
}

function initSituationsBankLayoutWatch_() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia(SB_DESKTOP_MQ);
    function onChange() {
        applySituationsBankLayout_();
    }
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
}

function situationsBankShowDetailScreen_() {
    if (isSituationsBankDesktop_()) {
        applySituationsBankLayout_();
        return;
    }
    document.getElementById("sb-screen-list").classList.add("sb-hidden");
    document.getElementById("sb-screen-detail").classList.remove("sb-hidden");
}

function situationsBankPageBack_() {
    if (isSituationsBankDesktop_()) return;
    document.getElementById("sb-screen-detail").classList.add("sb-hidden");
    document.getElementById("sb-screen-list").classList.remove("sb-hidden");
    if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", situationsBankPageUrl_());
    }
}

function selectSituationBankRow_(index, options) {
    options = options || {};
    situationsBankSelectedIndex = index;
    var row = getSituationBankRowByIndex_(index);
    if (isSituationsBankStandalonePage_()) {
        markSituationsBankListActive_(index);
        renderSituationBankDetail_(row);
        if (!options.keepDetailScreen) situationsBankShowDetailScreen_();
        var detailEl = document.getElementById("situations-bank-detail");
        if (detailEl && isSituationsBankDesktop_()) {
            try { detailEl.focus(); } catch (eFocus) {}
        }
        if (!isSituationsBankOrgMode_() && window.history) {
            var url = situationsBankPageUrl_(index);
            if (options.replaceHistory && window.history.replaceState) {
                window.history.replaceState({ sbDetail: index }, "", url);
            } else if (window.history.pushState) {
                window.history.pushState({ sbDetail: index }, "", url);
            }
        }
        return;
    }
    renderSituationsBankList_();
    renderSituationBankDetail_(row);
}

function onSituationsBankSearchInput_(event) {
    situationsBankSearchQuery = event && event.target ? event.target.value : "";
    renderSituationsBankList_();
}

function loadSituationsBankAndPlays_(force) {
    return fetchSituationsBank_(force).then(function (rows) {
        if (situationPlaysByCode) return rows;
        if (isSituationsBankOrgMode_()) {
            situationPlaysByCode = {};
            return rows;
        }
        return fetchSituationPlays_().then(function () { return rows; });
    });
}

function refreshSituationsBank() {
    situationPlaysByCode = null;
    loadSituationsBankAndPlays_(true).then(function () {
        renderSituationsBankList_();
        if (situationsBankSelectedIndex >= 0) {
            renderSituationBankDetail_(getSituationBankRowByIndex_(situationsBankSelectedIndex));
        }
    }).catch(function () {
        renderSituationsBankList_();
    });
}

function bindSituationsBankSearchToggle_() {
    var toggle = document.getElementById("sb-search-toggle");
    var panel = document.getElementById("sb-search-panel");
    if (!toggle || !panel) return;
    toggle.addEventListener("click", function () {
        panel.classList.toggle("sb-hidden");
        if (!panel.classList.contains("sb-hidden")) {
            var input = document.getElementById("situations-bank-search");
            if (input) input.focus();
        }
    });
}

function initSituationsBankPage_() {
    if (!isSituationsBankStandalonePage_()) return;

    if (!isSituationsBankOrgMode_()) {
        ensureSituationsBankFromQuery_();
        applySituationsBankHomeLinks_();
    }
    bindSituationsBankSearchToggle_();
    initSituationsBankSwipe_();
    initSituationsBankLayoutWatch_();
    initOrgSituationsBank_();

    if (!isSituationsBankOrgMode_()) {
        window.addEventListener("popstate", function () {
            if (isSituationsBankDesktop_()) {
                if (!location.hash) {
                    situationsBankSelectedIndex = -1;
                    renderSituationsBankList_();
                    renderSituationBankDetail_(null);
                }
                return;
            }
            if (document.getElementById("sb-screen-detail").classList.contains("sb-hidden")) return;
            situationsBankPageBack_();
        });
    }

    loadSituationsBankAndPlays_(false).then(function () {
        renderSituationsBankList_();
        applySituationsBankLayout_();
        if (!isSituationsBankOrgMode_()) openSituationFromLocation_();
        if (isSituationsBankDesktop_() && situationsBankSelectedIndex < 0) {
            renderSituationBankDetail_(null);
        }
    }).catch(function () {
        renderSituationsBankList_();
        applySituationsBankLayout_();
    });
}

function findSituationBankRowByCode_(code) {
    code = String(code || "").trim();
    if (!code) return null;
    var lower = code.toLowerCase();
    var i;
    var row;
    for (i = 0; i < situationsBankRows.length; i++) {
        row = situationsBankRows[i];
        if (String(row.code || "").trim() === code) return row;
    }
    for (i = 0; i < situationsBankRows.length; i++) {
        row = situationsBankRows[i];
        if (String(row.code || "").trim().toLowerCase() === lower) return row;
    }
    return null;
}

function openSituationFromLocation_() {
    var code = "";
    try {
        var params = new URLSearchParams(location.search);
        code = params.get("code") || params.get("c") || "";
    } catch (e) {}
    if (code) {
        try { code = decodeURIComponent(code); } catch (e2) {}
        var byCode = findSituationBankRowByCode_(code);
        if (byCode) {
            selectSituationBankRow_(byCode.index, { replaceHistory: true });
            return;
        }
    }
    var hash = location.hash.replace(/^#/, "");
    if (!hash) return;
    var decoded = hash;
    try { decoded = decodeURIComponent(hash); } catch (e3) {}
    if (/^\d+$/.test(decoded)) {
        selectSituationBankRow_(parseInt(decoded, 10));
        return;
    }
    var byHash = findSituationBankRowByCode_(decoded);
    if (byHash) selectSituationBankRow_(byHash.index, { replaceHistory: true });
}

function openSituationsBankModal() {
    window.location.href = "situations-bank.html";
}

function applyOrgSitPayload_(data) {
    var objects = (data && data.rows) ? data.rows : [];
    if (data && Object.prototype.hasOwnProperty.call(data, "playsByCode")) {
        situationPlaysByCode = data.playsByCode || {};
    }
    var rows = [];
    for (var i = 0; i < objects.length; i++) {
        var row = normalizeSituationBankApiRow_(objects[i], rows.length);
        if (row) rows.push(row);
    }
    rows.sort(function (a, b) {
        var na = Number(a.num) || 0;
        var nb = Number(b.num) || 0;
        if (na !== nb) return na - nb;
        return String(a.code).localeCompare(String(b.code), "ru");
    });
    for (var j = 0; j < rows.length; j++) rows[j].index = j;
    situationsBankRows = rows;
    setSituationsBankStatus_("");
    return rows;
}

function fetchOrgSituationsBank_(force) {
    setSituationsBankLoading_(true);
    setSituationsBankStatus_("Загрузка…");
    var boot = document.getElementById("org-sit-json");
    var p;
    if (!force && boot && boot.textContent && !fetchOrgSituationsBank_._usedBoot) {
        fetchOrgSituationsBank_._usedBoot = true;
        try {
            p = Promise.resolve(JSON.parse(boot.textContent));
        } catch (e) {
            p = orgSitPost_("org_sit_list", {});
        }
    } else {
        p = orgSitPost_("org_sit_list", {});
    }
    return p.then(function (data) {
        if (data && data.error) throw new Error(data.error);
        return applyOrgSitPayload_(data.data || data);
    }).catch(function (err) {
        setSituationsBankStatus_("Не удалось загрузить: " + (err.message || err), true);
        throw err;
    }).finally(function () {
        setSituationsBankLoading_(false);
    });
}

function orgSitPost_(action, fields) {
    var csrfEl = document.getElementById("org-sit-csrf");
    var body = new URLSearchParams();
    body.set("csrf", csrfEl ? csrfEl.value : "");
    body.set("ajax", "1");
    body.set("action", action);
    Object.keys(fields || {}).forEach(function (k) {
        body.set(k, fields[k] == null ? "" : String(fields[k]));
    });
    return fetch(window.location.pathname + window.location.search, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body,
        credentials: "same-origin"
    }).then(function (resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.json();
    });
}

function orgSitEditorEl_() {
    return document.getElementById("sb-editor");
}

function orgSitShowEditor_(show) {
    var ed = orgSitEditorEl_();
    if (!ed) return;
    if (show) {
        ed.classList.remove("sb-hidden");
        ed.hidden = false;
    } else {
        ed.classList.add("sb-hidden");
        ed.hidden = true;
    }
}

var orgSitDescSyncLock_ = false;
var orgSitDescTab_ = "visual";
var orgSitRolesTab_ = "table";
var orgSitLastType_ = "классика";

function orgSitDescVisual_() {
    return document.getElementById("sb-ed-visual");
}

function orgSitDescTextarea_() {
    return document.getElementById("sb-ed-desc");
}

function orgSitUnwrapNode_(el) {
    var parent = el && el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
}

function orgSitReplaceTag_(el, tagName) {
    var neu = document.createElement(tagName);
    while (el.firstChild) neu.appendChild(el.firstChild);
    el.parentNode.replaceChild(neu, el);
    return neu;
}

function orgSitStripInlineMarks_(root) {
    if (!root || !root.querySelectorAll) return;
    var marks = root.querySelectorAll("strong, b, em, i, u");
    for (var i = marks.length - 1; i >= 0; i--) orgSitUnwrapNode_(marks[i]);
}

function orgSitKeepDescTags_(root) {
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll("*");
    for (var i = nodes.length - 1; i >= 0; i--) {
        var el = nodes[i];
        var tag = el.tagName;
        if (tag === "STRONG" || tag === "EM") {
            while (el.attributes && el.attributes.length) {
                el.removeAttribute(el.attributes[0].name);
            }
            if (!(el.textContent || "").trim()) orgSitUnwrapNode_(el);
            continue;
        }
        if (tag === "BR") {
            el.parentNode.replaceChild(document.createTextNode(" "), el);
            continue;
        }
        if (tag === "B") {
            orgSitReplaceTag_(el, "strong");
            continue;
        }
        if (tag === "I") {
            orgSitReplaceTag_(el, "em");
            continue;
        }
        orgSitUnwrapNode_(el);
    }
}

function orgSitSerializeDesc_(root) {
    if (!root) return "";
    var clone = root.cloneNode(true);
    orgSitKeepDescTags_(clone);
    var html = clone.innerHTML || "";
    html = html.replace(/&nbsp;/gi, " ");
    html = html.replace(/<div>/gi, " ").replace(/<\/div>/gi, "");
    html = html.replace(/<p>/gi, " ").replace(/<\/p>/gi, "");
    html = html.replace(/<br\s*\/?>/gi, " ");
    html = html.replace(/\s+/g, " ").trim();
    return html;
}

function orgSitNormalizeDescHtml_(html) {
    var d = document.createElement("div");
    d.innerHTML = html || "";
    orgSitKeepDescTags_(d);
    return orgSitSerializeDesc_(d);
}

function orgSitSetDescHtml_(html) {
    orgSitDescSyncLock_ = true;
    var ta = orgSitDescTextarea_();
    var vis = orgSitDescVisual_();
    var norm = orgSitNormalizeDescHtml_(html || "");
    if (ta) ta.value = norm;
    if (vis) vis.innerHTML = norm;
    orgSitDescSyncLock_ = false;
}

function orgSitSyncDescFromVisual_() {
    if (orgSitDescSyncLock_) return;
    var vis = orgSitDescVisual_();
    var ta = orgSitDescTextarea_();
    if (!vis || !ta) return;
    orgSitDescSyncLock_ = true;
    ta.value = orgSitSerializeDesc_(vis);
    orgSitDescSyncLock_ = false;
}

function orgSitSyncDescFromTextarea_() {
    if (orgSitDescSyncLock_) return;
    var vis = orgSitDescVisual_();
    var ta = orgSitDescTextarea_();
    if (!vis || !ta) return;
    orgSitDescSyncLock_ = true;
    vis.innerHTML = orgSitNormalizeDescHtml_(ta.value || "");
    orgSitDescSyncLock_ = false;
}

function orgSitMarkHint_(text) {
    var el = document.getElementById("sb-ed-mark-hint");
    if (el) el.textContent = text || "";
}

function orgSitSelectionInDesc_() {
    var root = orgSitDescVisual_();
    var sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    return { sel: sel, range: range, root: root };
}

function orgSitClosestMark_(node, root) {
    while (node && node !== root) {
        if (node.nodeType === 1) {
            var t = node.tagName;
            if (t === "STRONG" || t === "EM" || t === "B" || t === "I" || t === "U") return node;
        }
        node = node.parentNode;
    }
    return null;
}

function orgSitWrapDesc_(tagName) {
    var ctx = orgSitSelectionInDesc_();
    if (!ctx) return;
    if (ctx.range.collapsed) {
        orgSitMarkHint_("Выделите фрагмент в тексте");
        return;
    }
    orgSitMarkHint_("");
    var frag = ctx.range.extractContents();
    var tmp = document.createElement("div");
    tmp.appendChild(frag);
    orgSitStripInlineMarks_(tmp);
    var wrap = document.createElement(tagName);
    while (tmp.firstChild) wrap.appendChild(tmp.firstChild);
    ctx.range.insertNode(wrap);
    ctx.root.normalize();
    ctx.sel.removeAllRanges();
    var nr = document.createRange();
    nr.selectNodeContents(wrap);
    ctx.sel.addRange(nr);
    orgSitSyncDescFromVisual_();
}

function orgSitUnwrapDesc_() {
    var ctx = orgSitSelectionInDesc_();
    if (!ctx) return;
    orgSitMarkHint_("");
    if (ctx.range.collapsed) {
        var n = ctx.range.startContainer;
        if (n.nodeType === 3) n = n.parentNode;
        var mark = orgSitClosestMark_(n, ctx.root);
        if (mark) orgSitUnwrapNode_(mark);
        else orgSitMarkHint_("Нет разметки в курсоре");
    } else {
        var frag = ctx.range.extractContents();
        var tmp = document.createElement("div");
        tmp.appendChild(frag);
        orgSitStripInlineMarks_(tmp);
        var last = null;
        while (tmp.firstChild) {
            last = ctx.range.insertNode(tmp.firstChild);
            ctx.range.setStartAfter(last);
        }
        ctx.root.normalize();
    }
    orgSitSyncDescFromVisual_();
}

function orgSitInitDescEditor_() {
    var vis = orgSitDescVisual_();
    var ta = orgSitDescTextarea_();
    var roleBtn = document.getElementById("sb-ed-mark-role");
    var phraseBtn = document.getElementById("sb-ed-mark-phrase");
    var unwrapBtn = document.getElementById("sb-ed-mark-unwrap");
    function keepSel(e) { e.preventDefault(); }
    if (roleBtn) {
        roleBtn.addEventListener("mousedown", keepSel);
        roleBtn.addEventListener("click", function () { orgSitWrapDesc_("strong"); });
    }
    if (phraseBtn) {
        phraseBtn.addEventListener("mousedown", keepSel);
        phraseBtn.addEventListener("click", function () { orgSitWrapDesc_("em"); });
    }
    if (unwrapBtn) {
        unwrapBtn.addEventListener("mousedown", keepSel);
        unwrapBtn.addEventListener("click", orgSitUnwrapDesc_);
    }
    if (vis) {
        vis.addEventListener("input", orgSitSyncDescFromVisual_);
        vis.addEventListener("blur", orgSitSyncDescFromVisual_);
        vis.addEventListener("keydown", function (e) {
            if (e.key === "Enter") e.preventDefault();
        });
        vis.addEventListener("paste", function (e) {
            e.preventDefault();
            var t = (e.clipboardData || window.clipboardData).getData("text/plain") || "";
            t = t.replace(/\s+/g, " ");
            document.execCommand("insertText", false, t);
        });
    }
    if (ta) ta.addEventListener("input", orgSitSyncDescFromTextarea_);
}

function orgSitHighlightRoles_() {
    var ta = document.getElementById("sb-ed-roles");
    var hi = document.getElementById("sb-ed-roles-hi");
    if (!ta || !hi) return;
    var src = ta.value || "";
    var pretty = src;
    try {
        if (src.trim()) pretty = JSON.stringify(JSON.parse(src), null, 2);
    } catch (e1) {}
    if (window.hljs && typeof window.hljs.highlight === "function") {
        try {
            hi.innerHTML = window.hljs.highlight(pretty, { language: "json" }).value;
            return;
        } catch (e2) {}
    }
    hi.textContent = pretty;
}

function orgSitCurrentType_() {
    var el = document.getElementById("sb-ed-type");
    return el && el.value ? el.value : "классика";
}

function orgSitIsExpress_() {
    return orgSitCurrentType_() === "экспресс";
}

function orgSitPadNum_(n) {
    n = parseInt(n, 10);
    if (!n || n < 1) return "";
    return n < 10 ? ("0" + n) : String(n);
}

function orgSitUpdateCodePreview_() {
    var numEl = document.getElementById("sb-ed-num");
    var nameEl = document.getElementById("sb-ed-name");
    var prev = document.getElementById("sb-ed-code-preview");
    if (!prev) return;
    var pad = orgSitPadNum_(numEl ? numEl.value : "");
    var name = nameEl ? String(nameEl.value || "").trim().replace(/\s+/g, " ") : "";
    prev.textContent = pad && name ? (pad + "-" + name) : "—";
}

function orgSitSyncMarkupButtons_() {
    var phraseBtn = document.getElementById("sb-ed-mark-phrase");
    if (phraseBtn) phraseBtn.hidden = !orgSitIsExpress_();
}

function orgSitSetAiMode_(isEdit) {
    var box = document.getElementById("sb-ed-ai-box");
    if (!box) return;
    if (isEdit) {
        box.classList.remove("sb-ed-ai-box--create");
        box.open = false;
    } else {
        box.classList.add("sb-ed-ai-box--create");
        box.open = true;
    }
}

function orgSitActivateTab_(tabBtns, paneMap, key) {
    var i;
    for (i = 0; i < tabBtns.length; i++) {
        var btn = tabBtns[i];
        var btnKey = btn.getAttribute("data-tab-key")
            || btn.getAttribute("data-desc-tab")
            || btn.getAttribute("data-roles-tab");
        var on = btnKey === key;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
    }
    Object.keys(paneMap).forEach(function (k) {
        var pane = paneMap[k];
        if (!pane) return;
        var show = k === key;
        pane.classList.toggle("sb-hidden", !show);
        pane.hidden = !show;
    });
}

function orgSitSetDescTab_(tab, skipSync) {
    if (tab !== "html" && tab !== "visual") tab = "visual";
    if (!skipSync && tab !== orgSitDescTab_) {
        if (tab === "html") orgSitSyncDescFromVisual_();
        else orgSitSyncDescFromTextarea_();
    }
    orgSitDescTab_ = tab;
    orgSitActivateTab_(
        document.querySelectorAll("#sb-editor [data-desc-tab]"),
        {
            visual: document.getElementById("sb-ed-pane-visual"),
            html: document.getElementById("sb-ed-pane-html")
        },
        tab
    );
}

function orgSitSyncRolesColHeader_() {
    var col = document.getElementById("sb-ed-roles-col2");
    if (col) col.textContent = orgSitIsExpress_() ? "Фраза" : "Интерес";
}

function orgSitRolesTbody_() {
    return document.getElementById("sb-ed-roles-tbody");
}

function orgSitFlushRoleRow_(tr, asExpress) {
    if (!tr) return;
    var roleInp = tr.querySelector(".sb-ed-role-role");
    var extraInp = tr.querySelector(".sb-ed-role-extra");
    var role = roleInp ? roleInp.value : "";
    var extra = extraInp ? extraInp.value : "";
    tr.setAttribute("data-role", role);
    if (asExpress) tr.setAttribute("data-phrase", extra);
    else tr.setAttribute("data-goals", extra);
}

function orgSitFillRoleRowExtra_(tr) {
    var extraInp = tr.querySelector(".sb-ed-role-extra");
    if (!extraInp) return;
    extraInp.value = orgSitIsExpress_()
        ? (tr.getAttribute("data-phrase") || "")
        : (tr.getAttribute("data-goals") || "");
    extraInp.placeholder = orgSitIsExpress_() ? "Агрессивная фраза" : "Интерес / цель";
}

function orgSitAppendRoleRow_(item) {
    var tbody = orgSitRolesTbody_();
    if (!tbody) return;
    item = item || {};
    var tr = document.createElement("tr");
    tr.setAttribute("data-role", item.Role || "");
    tr.setAttribute("data-goals", item.Goals || "");
    tr.setAttribute("data-phrase", item.Phrase || "");
    tr.innerHTML =
        '<td><input class="sb-ed-role-role" type="text"></td>' +
        '<td><input class="sb-ed-role-extra" type="text"></td>' +
        '<td class="sb-ed-roles-td-del"><button type="button" class="sb-ed-role-del" title="Удалить строку" aria-label="Удалить строку">×</button></td>';
    tbody.appendChild(tr);
    var roleInp = tr.querySelector(".sb-ed-role-role");
    if (roleInp) roleInp.value = item.Role || "";
    orgSitFillRoleRowExtra_(tr);
}

function orgSitRolesTableToJson_() {
    var tbody = orgSitRolesTbody_();
    var ta = document.getElementById("sb-ed-roles");
    if (!tbody || !ta) return;
    var express = orgSitIsExpress_();
    var rows = [];
    var trs = tbody.querySelectorAll("tr");
    var i;
    for (i = 0; i < trs.length; i++) {
        orgSitFlushRoleRow_(trs[i], express);
        var role = String(trs[i].getAttribute("data-role") || "").trim();
        if (!role) continue;
        var item = { Role: role };
        if (express) {
            var ph = String(trs[i].getAttribute("data-phrase") || "").trim();
            if (ph) item.Phrase = ph;
        } else {
            item.Goals = String(trs[i].getAttribute("data-goals") || "").trim();
        }
        rows.push(item);
    }
    ta.value = rows.length ? JSON.stringify(rows, null, 2) : "";
    orgSitHighlightRoles_();
}

function orgSitParseRolesJson_() {
    var ta = document.getElementById("sb-ed-roles");
    var src = ta ? String(ta.value || "").trim() : "";
    if (!src) return [];
    var data = JSON.parse(src);
    if (!Array.isArray(data)) throw new Error("roles JSON: нужен массив");
    return data;
}

function orgSitRolesJsonToTable_() {
    var data;
    try {
        data = orgSitParseRolesJson_();
    } catch (e) {
        var err = document.getElementById("sb-editor-err");
        if (err) {
            err.hidden = false;
            err.textContent = "Исправьте JSON ролей, затем переключитесь на таблицу";
        }
        return false;
    }
    var tbody = orgSitRolesTbody_();
    if (!tbody) return true;
    tbody.innerHTML = "";
    if (!data.length) orgSitAppendRoleRow_({});
    else {
        var i;
        for (i = 0; i < data.length; i++) {
            var r = data[i] && typeof data[i] === "object" ? data[i] : {};
            orgSitAppendRoleRow_(r);
        }
    }
    orgSitSyncRolesColHeader_();
    return true;
}

function orgSitSetRolesTab_(tab, skipSync) {
    if (tab !== "json" && tab !== "table") tab = "table";
    if (!skipSync && tab !== orgSitRolesTab_) {
        if (tab === "json") orgSitRolesTableToJson_();
        else if (!orgSitRolesJsonToTable_()) return false;
    }
    orgSitRolesTab_ = tab;
    orgSitActivateTab_(
        document.querySelectorAll("#sb-editor [data-roles-tab]"),
        {
            table: document.getElementById("sb-ed-pane-roles-table"),
            json: document.getElementById("sb-ed-pane-roles-json")
        },
        tab
    );
    return true;
}

function orgSitOnTypeChange_() {
    var tbody = orgSitRolesTbody_();
    var wasExpress = orgSitLastType_ === "экспресс";
    if (tbody && orgSitRolesTab_ === "table") {
        var trs = tbody.querySelectorAll("tr");
        var i;
        for (i = 0; i < trs.length; i++) {
            orgSitFlushRoleRow_(trs[i], wasExpress);
            orgSitFillRoleRowExtra_(trs[i]);
        }
        orgSitRolesTableToJson_();
    }
    orgSitLastType_ = orgSitCurrentType_();
    orgSitSyncRolesColHeader_();
    orgSitSyncMarkupButtons_();
}

function orgSitFillEditor_(row) {
    document.getElementById("sb-ed-id").value = row && row.id ? String(row.id) : "";
    document.getElementById("sb-ed-num").value = row && row.num ? String(row.num) : "";
    document.getElementById("sb-ed-name").value = row ? (row.name || "") : "";
    document.getElementById("sb-ed-type").value = row && row.type ? row.type : "классика";
    document.getElementById("sb-ed-pub").checked = !!(row && row.isPublished);
    orgSitLastType_ = orgSitCurrentType_();
    orgSitUpdateCodePreview_();
    orgSitSetDescHtml_(row ? (row.descriptionHtml || "") : "");
    orgSitMarkHint_("");
    var rolesText = "";
    if (row && row.rolesJson) {
        try { rolesText = JSON.stringify(row.rolesJson, null, 2); } catch (e) {}
    }
    document.getElementById("sb-ed-roles").value = rolesText;
    document.getElementById("sb-ed-source").value = row
        ? stripHtmlToPlainText_(row.descriptionHtml || row.descriptionPlain || "")
        : "";
    document.getElementById("sb-ed-roles-plain").value = formatSituationRolesPlain_(row);
    document.getElementById("sb-editor-title").textContent = row && row.id ? "Редактировать ситуацию" : "Новая ситуация";
    var err = document.getElementById("sb-editor-err");
    if (err) { err.hidden = true; err.textContent = ""; }
    var st = document.getElementById("sb-ed-ai-status");
    if (st) st.textContent = "";
    orgSitSetAiMode_(!!(row && row.id));
    orgSitSetDescTab_("visual", true);
    orgSitHighlightRoles_();
    orgSitRolesJsonToTable_();
    orgSitSetRolesTab_("table", true);
    orgSitSyncMarkupButtons_();
    orgSitSyncRolesColHeader_();
}

function orgSitOpenCreate_() {
    orgSitFillEditor_(null);
    orgSitShowEditor_(true);
    var num = document.getElementById("sb-ed-num");
    if (num) num.focus();
}

function orgSitOpenEdit_() {
    var row = getSituationBankRowByIndex_(situationsBankSelectedIndex);
    if (!row) {
        setSituationsBankStatus_("Сначала выберите ситуацию", true);
        return;
    }
    orgSitFillEditor_(row);
    orgSitShowEditor_(true);
}

function orgSitCollectDescForSave_() {
    if (orgSitDescTab_ === "html") orgSitSyncDescFromTextarea_();
    else orgSitSyncDescFromVisual_();
}

function orgSitCollectRolesForSave_() {
    if (orgSitRolesTab_ === "table") orgSitRolesTableToJson_();
}

function orgSitSave_(event) {
    if (event) event.preventDefault();
    orgSitCollectDescForSave_();
    orgSitCollectRolesForSave_();
    var err = document.getElementById("sb-editor-err");
    var pub = document.getElementById("sb-ed-pub");
    orgSitPost_("org_sit_save", {
        id: document.getElementById("sb-ed-id").value,
        name: document.getElementById("sb-ed-name").value,
        num: document.getElementById("sb-ed-num").value,
        duel_type: document.getElementById("sb-ed-type").value,
        description: document.getElementById("sb-ed-desc").value,
        roles_json: document.getElementById("sb-ed-roles").value,
        is_published: pub && pub.checked ? "1" : ""
    }).then(function (res) {
        if (res.error) throw new Error(res.error);
        var data = res.data || res;
        applyOrgSitPayload_(data);
        renderSituationsBankList_();
        var keepId = res.id || parseInt(document.getElementById("sb-ed-id").value, 10) || 0;
        var found = null;
        if (keepId) {
            for (var i = 0; i < situationsBankRows.length; i++) {
                if (situationsBankRows[i].id === keepId) { found = situationsBankRows[i]; break; }
            }
        }
        orgSitShowEditor_(false);
        if (found) selectSituationBankRow_(found.index, { replaceHistory: true });
        else {
            situationsBankSelectedIndex = -1;
            renderSituationBankDetail_(null);
            applySituationsBankLayout_();
        }
        if (err) { err.hidden = true; err.textContent = ""; }
    }).catch(function (e) {
        if (err) { err.hidden = false; err.textContent = e.message || String(e); }
    });
}

function orgSitGenerate_() {
    var st = document.getElementById("sb-ed-ai-status");
    var err = document.getElementById("sb-editor-err");
    var btn = document.getElementById("sb-ed-ai");
    orgSitCollectDescForSave_();
    var text = (document.getElementById("sb-ed-source").value || "").trim();
    if (!text) text = (document.getElementById("sb-ed-desc").value || "").trim();
    if (!text) {
        if (err) { err.hidden = false; err.textContent = "Нужен исходный текст"; }
        return;
    }
    if (btn) btn.disabled = true;
    if (st) st.textContent = "Генерация…";
    orgSitPost_("org_sit_generate", {
        text: text,
        duel_type: document.getElementById("sb-ed-type").value,
        roles_plain: document.getElementById("sb-ed-roles-plain").value
    }).then(function (res) {
        if (res.error) throw new Error(res.error);
        if (res.descriptionHtml != null) orgSitSetDescHtml_(res.descriptionHtml);
        if (res.rolesJson != null) document.getElementById("sb-ed-roles").value = res.rolesJson;
        orgSitHighlightRoles_();
        if (orgSitRolesTab_ === "table") orgSitRolesJsonToTable_();
        if (st) st.textContent = "Подставлено, не сохранено";
        if (err) { err.hidden = true; err.textContent = ""; }
    }).catch(function (e) {
        if (err) { err.hidden = false; err.textContent = e.message || String(e); }
        if (st) st.textContent = "";
    }).finally(function () {
        if (btn) btn.disabled = false;
    });
}

function initOrgSituationsBank_() {
    if (!isSituationsBankOrgMode_()) return;
    var createBtn = document.getElementById("sb-org-create");
    var editBtn = document.getElementById("sb-org-edit");
    var form = document.getElementById("sb-editor-form");
    var cancel = document.getElementById("sb-ed-cancel");
    var ai = document.getElementById("sb-ed-ai");
    var roles = document.getElementById("sb-ed-roles");
    var typeEl = document.getElementById("sb-ed-type");
    var numEl = document.getElementById("sb-ed-num");
    var nameEl = document.getElementById("sb-ed-name");
    var addRole = document.getElementById("sb-ed-roles-add");
    var tbody = orgSitRolesTbody_();
    if (createBtn) createBtn.addEventListener("click", orgSitOpenCreate_);
    if (editBtn) editBtn.addEventListener("click", orgSitOpenEdit_);
    if (form) form.addEventListener("submit", orgSitSave_);
    if (cancel) cancel.addEventListener("click", function () { orgSitShowEditor_(false); });
    if (ai) ai.addEventListener("click", orgSitGenerate_);
    if (roles) {
        roles.addEventListener("input", orgSitHighlightRoles_);
        roles.addEventListener("scroll", function () {
            var pre = roles.parentNode && roles.parentNode.querySelector(".sb-json-hi");
            if (pre) pre.scrollTop = roles.scrollTop;
        });
    }
    if (typeEl) typeEl.addEventListener("change", orgSitOnTypeChange_);
    if (numEl) numEl.addEventListener("input", orgSitUpdateCodePreview_);
    if (nameEl) nameEl.addEventListener("input", orgSitUpdateCodePreview_);
    document.querySelectorAll("#sb-editor [data-desc-tab]").forEach(function (btn) {
        btn.setAttribute("data-tab-key", btn.getAttribute("data-desc-tab"));
        btn.addEventListener("click", function () {
            orgSitSetDescTab_(btn.getAttribute("data-desc-tab"));
        });
    });
    document.querySelectorAll("#sb-editor [data-roles-tab]").forEach(function (btn) {
        btn.setAttribute("data-tab-key", btn.getAttribute("data-roles-tab"));
        btn.addEventListener("click", function () {
            orgSitSetRolesTab_(btn.getAttribute("data-roles-tab"));
        });
    });
    if (addRole) {
        addRole.addEventListener("click", function () {
            orgSitAppendRoleRow_({});
        });
    }
    if (tbody) {
        tbody.addEventListener("click", function (e) {
            var t = e.target;
            if (t && t.nodeType === 3) t = t.parentNode;
            var del = t && t.closest ? t.closest(".sb-ed-role-del") : null;
            if (!del) return;
            var tr = del.closest("tr");
            if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
            if (tbody.querySelectorAll("tr").length === 0) orgSitAppendRoleRow_({});
        });
    }
    orgSitInitDescEditor_();
}

