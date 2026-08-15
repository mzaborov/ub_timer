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

function isSituationsBankStandalonePage_() {
    return document.body && document.body.classList.contains("sb-app");
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
    return {
        index: index,
        num: num,
        code: code,
        name: String(raw.name || "").trim(),
        type: String(raw.type || "").trim(),
        descriptionHtml: descriptionHtml,
        descriptionPlain: descriptionPlain,
        rolesJson: rolesJson,
        rolesPlain: rolesPlain,
        hasFormatting: !!(descriptionHtml || rolesJson)
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
            var metaParts = [];
            if (p.date) metaParts.push(p.date);
            if (p.event) metaParts.push(p.event);
            var meta = metaParts.join(" · ");
            var w = p.winner | 0;
            var vs = renderSituationPlayName_(p.p1, w === 1) +
                ' <span class="sb-play-vs">vs</span> ' +
                renderSituationPlayName_(p.p2, w === 2);
            var scoreHtml = "";
            if (p.score) {
                scoreHtml = '<span class="sb-play-score">' + escapeHtmlSituationsBank(p.score) + "</span>";
                if (w === 0) scoreHtml += ' <span class="sb-play-draw">ничья</span>';
            }
            var videoHtml = "";
            var url = String(p.video || "").trim();
            if (/^https?:\/\//i.test(url)) {
                videoHtml = '<a class="sb-play-video vid-pill" href="' + escapeHtmlSituationsBank(url) +
                    '" target="_blank" rel="noopener">видео</a>';
            }
            items += '<li class="sb-play">' +
                (meta ? '<p class="sb-play-meta">' + escapeHtmlSituationsBank(meta) + "</p>" : "") +
                '<p class="sb-play-line">' + vs +
                (scoreHtml ? " · " + scoreHtml : "") +
                (videoHtml ? " " + videoHtml : "") +
                "</p></li>";
            rowsHtml += "<tr>" +
                "<td>" + escapeHtmlSituationsBank(p.date || "") + "</td>" +
                "<td>" + escapeHtmlSituationsBank(p.event || "") + "</td>" +
                "<td>" + renderSituationPlayName_(p.p1, w === 1) + "</td>" +
                "<td>" + renderSituationPlayName_(p.p2, w === 2) + "</td>" +
                "<td>" + scoreHtml + "</td>" +
                '<td class="sb-plays-td-video">' + videoHtml + "</td>" +
                "</tr>";
        }
        inner =
            '<ul class="sb-plays">' + items + "</ul>" +
            '<div class="sb-plays-wrap">' +
            '<table class="sb-plays-table">' +
            "<thead><tr>" +
            "<th>Дата</th><th>Мероприятие</th><th>Игрок 1</th><th>Игрок 2</th><th>Счёт</th><th>Видео</th>" +
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
            '<h2 class="sb-detail-title">' + escapeHtmlSituationsBank(row.code) + "</h2>" +
            '<div class="sb-field"><p class="sb-field-label">Тип</p><p class="sb-field-value">' +
            escapeHtmlSituationsBank(row.type || "—") + "</p></div>" +
            '<div class="sb-field"><p class="sb-field-label sb-field-label--section">Описание ситуации</p>' + descHtml + "</div>" +
            (isSituationBankExpress_(row) ? "" :
                '<div class="sb-field"><p class="sb-field-label sb-field-label--section">Роли и интересы</p>' +
                renderSituationRolesBlock_(row) + "</div>") +
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
            tbody += '<tr class="sb-row' + activeCls + '" data-index="' + row.index + '">' +
                '<td class="sb-cell-code">' + escapeHtmlSituationsBank(row.code) + "</td>" +
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

function buildSituationRolesShareText_(row) {
    if (isSituationBankExpress_(row)) return "";
    if (row.rolesJson && row.rolesJson.length) {
        var lines = [];
        var isExpress = String(row.type || "").toLowerCase().indexOf("экспресс") !== -1;
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
        if (window.history) {
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

    ensureSituationsBankFromQuery_();
    applySituationsBankHomeLinks_();
    bindSituationsBankSearchToggle_();
    initSituationsBankSwipe_();
    initSituationsBankLayoutWatch_();

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

    loadSituationsBankAndPlays_(false).then(function () {
        renderSituationsBankList_();
        applySituationsBankLayout_();
        openSituationFromLocation_();
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
