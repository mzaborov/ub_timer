// Банк ситуаций: загрузка из published Google Sheets CSV, просмотр и поиск.
// Страница: situations-bank.html (mobile-first). Модалка в index.html — опционально.

var SITUATIONS_BANK_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQdj_LL6itPtL1m5TaoMigxcC3yZSwSa4RRG4Tk1_ro-xblfD1NtmxeuyWbo4mO1OLMvrc54g8s-ZO-/pub?gid=94326902&single=true&output=csv";

var SITUATIONS_BANK_CACHE_KEY = "ub-timer-situations-bank-v2";
var SITUATIONS_BANK_CACHE_TTL_MS = 60 * 60 * 1000;

var situationsBankRows = [];
var situationsBankSelectedIndex = -1;
var situationsBankSearchQuery = "";

function isSituationsBankStandalonePage_() {
    return document.body && document.body.classList.contains("sb-app");
}

function escapeHtmlSituationsBank(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function parseCsvToRows_(text) {
    var rows = [];
    var row = [];
    var field = "";
    var i = 0;
    var inQuotes = false;
    while (i < text.length) {
        var ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            field += ch;
            i++;
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
            i++;
            continue;
        }
        if (ch === ",") {
            row.push(field);
            field = "";
            i++;
            continue;
        }
        if (ch === "\r") {
            i++;
            continue;
        }
        if (ch === "\n") {
            row.push(field);
            if (row.length > 1 || row[0] !== "") rows.push(row);
            row = [];
            field = "";
            i++;
            continue;
        }
        field += ch;
        i++;
    }
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows;
}

function csvRowsToObjects_(matrix) {
    if (!matrix || matrix.length < 2) return [];
    var headers = matrix[0].map(function (h) { return String(h || "").trim(); });
    var out = [];
    for (var r = 1; r < matrix.length; r++) {
        var obj = {};
        var line = matrix[r];
        for (var c = 0; c < headers.length; c++) {
            if (!headers[c]) continue;
            obj[headers[c]] = line[c] != null ? line[c] : "";
        }
        out.push(obj);
    }
    return out;
}

function pickField_(raw, names) {
    for (var i = 0; i < names.length; i++) {
        if (raw[names[i]] != null && String(raw[names[i]]).trim() !== "") return String(raw[names[i]]).trim();
    }
    return "";
}

function parseSituationNumFromCode_(code) {
    var m = String(code || "").match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
}

/** Служебные/пустые строки таблицы (задел на выбор из банка) — не показываем в списке. */
function isExcludedFromSituationsBankList_(code, raw) {
    var c = String(code || "").trim();
    if (!c) return true;
    if (/^-+$/.test(c)) return true;
    var lower = c.toLowerCase();
    if (lower.indexOf("случайн") !== -1) return true;
    if (/^00([-–]|$)/.test(c)) return true;
    var num = String(pickField_(raw, ["Номер"]) || "").trim();
    if (num === "00") return true;
    var name = pickField_(raw, ["Название ситуации", "SituationName"]).toLowerCase();
    if (name === "случайная ситуация") return true;
    var desc = pickField_(raw, ["SituationDescription", "Полное описание", "Описание"]);
    var roles = pickField_(raw, ["SituationRoles", "Роли и интересы", "Roles"]);
    if (!desc && !roles) return true;
    return false;
}

function normalizeSituationBankRow_(raw, index) {
    var code = pickField_(raw, ["Код", "Code"]);
    if (!code || isExcludedFromSituationsBankList_(code, raw)) return null;
    var descriptionHtml = pickField_(raw, ["SituationDescription"]);
    var descriptionPlain = pickField_(raw, ["Полное описание", "Описание"]);
    var rolesPlain = pickField_(raw, ["Роли и интересы", "Roles"]);
    var rolesJsonRaw = pickField_(raw, ["SituationRoles"]);
    var rolesJson = null;
    if (rolesJsonRaw) {
        try {
            rolesJson = JSON.parse(rolesJsonRaw.trim());
        } catch (e) {
            console.warn("situations-bank: невалидный SituationRoles для", code, e);
        }
    }
    return {
        index: index,
        num: parseSituationNumFromCode_(code) || pickField_(raw, ["Номер"]) || 0,
        code: code,
        name: pickField_(raw, ["Название ситуации", "SituationName"]),
        type: pickField_(raw, ["Тип", "Type"]),
        descriptionHtml: descriptionHtml,
        descriptionPlain: descriptionPlain,
        rolesJson: rolesJson,
        rolesPlain: rolesPlain,
        hasFormatting: !!(descriptionHtml || rolesJson)
    };
}

function readSituationsBankCache_() {
    try {
        var raw = sessionStorage.getItem(SITUATIONS_BANK_CACHE_KEY);
        if (!raw) return null;
        var data = JSON.parse(raw);
        if (!data || !data.fetchedAt || !data.rows) return null;
        if (Date.now() - data.fetchedAt > SITUATIONS_BANK_CACHE_TTL_MS) return null;
        return data.rows;
    } catch (e) {
        return null;
    }
}

function writeSituationsBankCache_(rows) {
    try {
        sessionStorage.setItem(SITUATIONS_BANK_CACHE_KEY, JSON.stringify({
            fetchedAt: Date.now(),
            rows: rows
        }));
    } catch (e) {
        console.warn("situations-bank: cache write failed", e);
    }
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

function fetchSituationsBank_(force) {
    if (location.protocol === "file:") {
        var fileMsg = "Страница открыта как файл (file://). Браузер блокирует загрузку данных. " +
            "Откройте через http://localhost (python -m http.server) или https://timer.zaborov.ru/situations-bank.html";
        setSituationsBankStatus_(fileMsg, true);
        return Promise.reject(new Error(fileMsg));
    }
    if (!force) {
        var cached = readSituationsBankCache_();
        if (cached && cached.length) {
            situationsBankRows = cached;
            setSituationsBankStatus_("Из кэша (" + cached.length + "). Нажмите ↻ для обновления.");
            return Promise.resolve(cached);
        }
    }
    setSituationsBankLoading_(true);
    setSituationsBankStatus_("Загрузка…");
    return fetch(SITUATIONS_BANK_CSV_URL)
        .then(function (resp) {
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            return resp.text();
        })
        .then(function (text) {
            var matrix = parseCsvToRows_(text);
            var objects = csvRowsToObjects_(matrix);
            var rows = [];
            for (var i = 0; i < objects.length; i++) {
                var row = normalizeSituationBankRow_(objects[i], rows.length);
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
            writeSituationsBankCache_(rows);
            setSituationsBankStatus_("");
            return rows;
        })
        .catch(function (err) {
            var cached = readSituationsBankCache_();
            if (cached && cached.length) {
                situationsBankRows = cached;
                setSituationsBankStatus_("Нет сети — показан кэш (" + cached.length + ").", true);
                return cached;
            }
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
            detailEl.innerHTML = "";
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
            (navHint ? '<p class="sb-nav-hint">' + navHint + "</p>" : "") +
            '<h2 class="sb-detail-title">' + escapeHtmlSituationsBank(row.code) + "</h2>" +
            '<div class="sb-field"><p class="sb-field-label">Тип</p><p class="sb-field-value">' +
            escapeHtmlSituationsBank(row.type || "—") + "</p></div>" +
            '<div class="sb-field"><p class="sb-field-label sb-field-label--section">Описание ситуации</p>' + descHtml + "</div>" +
            (isSituationBankExpress_(row) ? "" :
                '<div class="sb-field"><p class="sb-field-label sb-field-label--section">Роли и интересы</p>' +
                renderSituationRolesBlock_(row) + "</div>");
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
        '<div class="situations-bank-roles">' + renderSituationRolesBlock_(row) + "</div></div>";
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
            tbody += '<tr class="sb-row" data-index="' + row.index + '">' +
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
        if (!e.touches || e.touches.length !== 1) return;
        if (document.getElementById("sb-screen-detail").classList.contains("sb-hidden")) return;
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
        if (document.getElementById("sb-screen-detail").classList.contains("sb-hidden")) return;
        if (e.key === "ArrowRight") navigateSituationBank_(1);
        else if (e.key === "ArrowLeft") navigateSituationBank_(-1);
    });
}

function situationsBankShowDetailScreen_() {
    document.getElementById("sb-screen-list").classList.add("sb-hidden");
    document.getElementById("sb-screen-detail").classList.remove("sb-hidden");
}

function situationsBankPageBack_() {
    document.getElementById("sb-screen-detail").classList.add("sb-hidden");
    document.getElementById("sb-screen-list").classList.remove("sb-hidden");
    if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", "situations-bank.html");
    }
}

function selectSituationBankRow_(index, options) {
    options = options || {};
    situationsBankSelectedIndex = index;
    var row = getSituationBankRowByIndex_(index);
    if (isSituationsBankStandalonePage_()) {
        renderSituationBankDetail_(row);
        if (!options.keepDetailScreen) situationsBankShowDetailScreen_();
        if (window.history) {
            var url = "situations-bank.html#" + index;
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

function refreshSituationsBank() {
    fetchSituationsBank_(true).then(function () {
        renderSituationsBankList_();
        if (situationsBankSelectedIndex >= 0) {
            renderSituationBankDetail_(getSituationBankRowByIndex_(situationsBankSelectedIndex));
        }
    }).catch(function () {
        renderSituationsBankList_();
    });
}

function initSituationsBankPage_() {
    if (!isSituationsBankStandalonePage_()) return;

    initSituationsBankSwipe_();

    window.addEventListener("popstate", function () {
        if (document.getElementById("sb-screen-detail").classList.contains("sb-hidden")) return;
        situationsBankPageBack_();
    });

    fetchSituationsBank_(false).then(function () {
        renderSituationsBankList_();
        var hash = location.hash.replace(/^#/, "");
        if (hash && !isNaN(parseInt(hash, 10))) {
            selectSituationBankRow_(parseInt(hash, 10));
        }
    }).catch(function () {
        renderSituationsBankList_();
    });
}

function openSituationsBankModal() {
    window.location.href = "situations-bank.html";
}
