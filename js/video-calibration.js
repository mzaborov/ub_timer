/* Калибровка видео: QR с серверным временем + запись метки в protocol_events. */
(function () {
    var CAL_DURATION_MS = 3000;
    var busy = false;
    var countdownTimer = null;

    function token_() {
        var s = '';
        if (window.crypto && window.crypto.getRandomValues) {
            var a = new Uint8Array(12);
            window.crypto.getRandomValues(a);
            for (var i = 0; i < a.length; i++) {
                s += ('0' + a[i].toString(16)).slice(-2);
            }
        } else {
            s = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        }
        return s;
    }

    function el_(id) {
        return document.getElementById(id);
    }

    function setStatus_(text) {
        var e = el_('videoCalibrationStatus');
        if (e) e.textContent = text || '';
    }

    function setCountdown_(text) {
        var e = el_('videoCalibrationCountdown');
        if (e) e.textContent = String(text == null ? '' : text);
    }

    function setServerTime_(ms) {
        var e = el_('videoCalibrationServerTime');
        if (!e) return;
        if (!ms) {
            e.textContent = '';
            return;
        }
        var d = new Date(ms);
        e.textContent = 'Сервер: ' + d.toLocaleString('ru-RU') + '.' + ('00' + d.getMilliseconds()).slice(-3);
    }

    function close_() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
        var modalEl = el_('videoCalibrationModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            var m = bootstrap.Modal.getInstance(modalEl);
            if (m) m.hide();
        }
        busy = false;
    }

    function startCountdown_() {
        var left = Math.ceil(CAL_DURATION_MS / 1000);
        setCountdown_(left);
        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = setInterval(function () {
            left--;
            if (left <= 0) {
                setCountdown_(0);
                clearInterval(countdownTimer);
                countdownTimer = null;
                setTimeout(close_, 250);
                return;
            }
            setCountdown_(left);
        }, 1000);
    }

    function drawQr_(payload) {
        var box = el_('videoCalibrationQr');
        if (!box) return false;
        box.innerHTML = '';
        if (typeof QRCode === 'undefined') {
            setStatus_('QR-библиотека не загрузилась');
            return false;
        }
        new QRCode(box, {
            text: payload,
            width: 360,
            height: 360,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
        return true;
    }

    function fail_(message) {
        setStatus_(message || 'Не удалось записать калибровку');
        setCountdown_('');
        setTimeout(close_, 2500);
    }

    function openVideoCalibration() {
        if (busy) return;
        if (typeof dbWriteActive_ !== 'function' || !dbWriteActive_()) {
            alert('Сначала загрузите мероприятие из БД (режим «из базы»).');
            return;
        }
        var modalEl = el_('videoCalibrationModal');
        if (!modalEl || typeof bootstrap === 'undefined') return;
        if (typeof QRCode === 'undefined') {
            alert('QR-библиотека не загрузилась. Обновите страницу.');
            return;
        }
        busy = true;
        var box = el_('videoCalibrationQr');
        if (box) box.innerHTML = '';
        setCountdown_('…');
        setServerTime_(0);
        setStatus_('Запись в БД…');
        var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();

        var token = token_();
        var payload = {
            event_id: Number(dbEventId) || 0,
            duel_id: (typeof dbWriteDuelId_ === 'function' ? dbWriteDuelId_() : 0) || 0,
            token: token,
            duration_ms: CAL_DURATION_MS
        };
        var xhr = new XMLHttpRequest();
        xhr.open('POST', 'db.php?action=calibration', true);
        xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            var r = null;
            try { r = JSON.parse(xhr.responseText); } catch (e) {}
            if (xhr.status < 200 || xhr.status >= 300 || !r || !r.ok) {
                var err = r && r.error ? String(r.error) : ('HTTP ' + xhr.status);
                if (xhr.status === 403 || err === 'org_required') {
                    fail_('Нужен режим организатора');
                } else {
                    fail_('Ошибка записи: ' + err);
                }
                return;
            }
            var ts = Number(r.server_ts) || 0;
            var qrText = 'v=1&k=cal&e=' + (Number(r.event_id) || payload.event_id)
                + '&d=' + (Number(r.duel_id) || payload.duel_id)
                + '&id=' + encodeURIComponent(r.token || token)
                + '&ts=' + ts;
            if (!drawQr_(qrText)) {
                fail_('Не удалось нарисовать QR');
                return;
            }
            setStatus_('QR записан в БД. Не закрывайте окно.');
            setServerTime_(ts);
            startCountdown_();
        };
        xhr.send(JSON.stringify(payload));
    }

    var modalEl = el_('videoCalibrationModal');
    if (modalEl) {
        modalEl.addEventListener('hidden.bs.modal', function () {
            if (countdownTimer) {
                clearInterval(countdownTimer);
                countdownTimer = null;
            }
            var box = el_('videoCalibrationQr');
            if (box) box.innerHTML = '';
            busy = false;
        });
    }

    window.openVideoCalibration = openVideoCalibration;
})();
