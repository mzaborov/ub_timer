(function () {
  'use strict';

  var root = document.getElementById('org-vc');
  if (!root) return;

  var dataEl = document.getElementById('org-vc-data');
  var DATA = {};
  try {
    DATA = JSON.parse((dataEl && dataEl.textContent) || '{}') || {};
  } catch (e) {
    DATA = {};
  }

  var el = {
    eventSelect: document.getElementById('org-vc-event-select'),
    file: document.getElementById('org-vc-file'),
    fileMeta: document.getElementById('org-vc-file-meta'),
    calNote: document.getElementById('org-vc-cal-note'),
    qrScan: document.getElementById('org-vc-qr-scan'),
    clearFile: document.getElementById('org-vc-clear'),
    video: document.getElementById('org-vc-video'),
    playerEmpty: document.getElementById('org-vc-player-empty'),
    nudge: document.getElementById('org-vc-nudge'),
    canvas: document.getElementById('org-vc-canvas'),
    recStart: document.getElementById('org-vc-rec-start'),
    shift: document.getElementById('org-vc-shift'),
    auto: document.getElementById('org-vc-auto'),
    crf: document.getElementById('org-vc-crf'),
    preset: document.getElementById('org-vc-preset'),
    fps: document.getElementById('org-vc-fps'),
    template: document.getElementById('org-vc-template'),
    gap: document.getElementById('org-vc-gap'),
    tail: document.getElementById('org-vc-tail'),
    exportBtn: document.getElementById('org-vc-export'),
    clearDraft: document.getElementById('org-vc-clear-draft'),
    search: document.getElementById('org-vc-search'),
    list: document.getElementById('org-vc-duel-list'),
    noDuels: document.getElementById('org-vc-no-duels'),
    count: document.getElementById('org-vc-count'),
    selected: document.getElementById('org-vc-selected'),
    frameStart: document.getElementById('org-vc-frame-start'),
    frameEnd: document.getElementById('org-vc-frame-end'),
    frameStartT: document.getElementById('org-vc-frame-start-t'),
    frameEndT: document.getElementById('org-vc-frame-end-t'),
    issues: document.getElementById('org-vc-issues'),
    steps: document.getElementById('org-vc-steps'),
    saveState: document.getElementById('org-vc-save-state'),
    serviceDot: document.getElementById('org-vc-service-dot'),
    serviceText: document.getElementById('org-vc-service-text'),
    serviceCheck: document.getElementById('org-vc-service-check'),
    cut: document.getElementById('org-vc-cut'),
    publish: document.getElementById('org-vc-publish')
  };
  if (!el.canvas) return;

  var LS_PREFIX = 'ub_vc_draft_v1_';
  var SERVICE_URL = 'http://127.0.0.1:8765';
  var MIN_LEN = 0.5;
  var ctx = el.canvas.getContext('2d');
  var probes = { start: document.createElement('video'), end: document.createElement('video') };
  var thumbProbe = document.createElement('video');
  thumbProbe.muted = true;
  thumbProbe.playsInline = true;
  thumbProbe.preload = 'auto';
  /* Detached <video> в Chromium ищет кадры в разы медленнее; держим пробники в DOM. */
  var probeHost = document.createElement('div');
  probeHost.id = 'org-vc-probe-host';
  probeHost.setAttribute('aria-hidden', 'true');
  probeHost.style.cssText = 'position:absolute;left:-9999px;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none';
  document.body.appendChild(probeHost);
  probeHost.appendChild(probes.start);
  probeHost.appendChild(probes.end);
  probeHost.appendChild(thumbProbe);
  var thumbQueue = [];
  var thumbBusy = false;
  var thumbCurrent = null;
  var thumbTimer = 0;
  var thumbSettle = 0;
  var thumbToken = 0;
  var thumbWaiting = false;
  var frameToken = { start: 0, end: 0 };
  var saveTimer = 0;
  var previewTimer = 0;
  var cw = 0;
  var ch = 118;
  var dpr = 1;

  Object.keys(probes).forEach(function (k) {
    probes[k].muted = true;
    probes[k].playsInline = true;
    probes[k].preload = 'auto';
  });

  var state = {
    eventId: DATA.event ? DATA.event.id : 0,
    hasFile: false,
    fileUrl: '',
    fileName: '',
    fileSize: 0,
    duration: 0,
    recordingStartMs: DATA.recordingStartMs || 0,
    recStartSource: 'event',
    qrScanToken: 0,
    qrScanning: false,
    shiftSec: 0,
    gapSec: 2,
    tailSec: 5,
    crf: 20,
    preset: 'medium',
    fps: 25,
    template: '{дата}_{мероприятие}_{номер}_{игрок1}_vs_{игрок2}.mp4',
    selected: -1,
    view: { start: 0, end: 600 },
    duels: [],
    issues: [],
    query: ''
  };

  function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
  }

  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtClock(sec) {
    if (!isFinite(sec)) return '—';
    var neg = sec < 0;
    sec = Math.abs(sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    var out = h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : pad2(m) + ':' + pad2(s);
    return (neg ? '−' : '') + out;
  }

  function fmtDur(sec) {
    if (!isFinite(sec) || sec <= 0) return '—';
    var total = Math.round(sec);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + ' ч ' + m + ' мин';
    if (m > 0) return m + ' мин ' + pad2(s) + ' с';
    return s + ' с';
  }

  function dispStart(d) {
    return d.baseStart + state.shiftSec;
  }

  function dispEnd(d) {
    return d.baseEnd + state.shiftSec;
  }

  function duelName(d) {
    var a = d.p1 || '—';
    var b = d.p2 || '—';
    return a + ' vs ' + b;
  }

  function sanitizeName(s) {
    return String(s == null ? '' : s)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, 160);
  }

  function buildFilename(d) {
    var ev = DATA.event || {};
    var map = {
      'дата': ev.startsOn || '',
      'мероприятие': sanitizeName(ev.title || ''),
      'номер': pad2(d.order),
      'игрок1': sanitizeName(d.p1 || ''),
      'игрок2': sanitizeName(d.p2 || '')
    };
    var out = state.template || '{дата}_{мероприятие}_{номер}_{игрок1}_vs_{игрок2}.mp4';
    Object.keys(map).forEach(function (k) {
      out = out.split('{' + k + '}').join(map[k]);
    });
    out = sanitizeName(out);
    if (!/\.mp4$/i.test(out)) out += '.mp4';
    return out;
  }

  function maxTimelineEnd() {
    if (state.duration > 0) {
      return Math.max(30, state.duration + Math.max(5, state.duration * 0.02));
    }
    var end = 0;
    state.duels.forEach(function (d) {
      end = Math.max(end, dispEnd(d) + 30);
    });
    if (!end) end = 600;
    return Math.max(30, end);
  }

  function ensureView(forceFit) {
    var end = maxTimelineEnd();
    if (forceFit) {
      state.view = { start: 0, end: end };
      return;
    }
    var span = state.view.end - state.view.start;
    if (!isFinite(span) || span <= 0.5 || state.view.end > end * 1.8 || state.view.end < end * 0.35) {
      state.view = { start: 0, end: end };
    }
  }

  function tToX(t) {
    var span = state.view.end - state.view.start;
    if (span <= 0) span = 1;
    return ((t - state.view.start) / span) * cw;
  }

  function xToT(x) {
    var span = state.view.end - state.view.start;
    return state.view.start + (x / Math.max(1, cw)) * span;
  }

  function rgba(hex, alpha) {
    var h = hex.replace('#', '');
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  var COLORS = {
    proto: '#00897b',
    guess: '#ef6c00',
    manual: '#5c6bc0',
    warn: '#c62828'
  };

  function sourceColor(d, warn) {
    if (warn) return COLORS.warn;
    return COLORS[d.source] || COLORS.guess;
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function warnSet() {
    var set = {};
    state.issues.forEach(function (it) {
      set[it.i] = true;
    });
    return set;
  }

  function tickStep(span) {
    var steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
    for (var i = 0; i < steps.length; i++) {
      if ((steps[i] / span) * cw >= 62) return steps[i];
    }
    return 7200;
  }

  function draw() {
    if (!cw) return;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, cw, ch);

    var rulerH = 23;
    var blockTop = 30;
    var blockH = 54;
    var span = state.view.end - state.view.start;
    var warnings = warnSet();

    ctx.fillStyle = '#eceff1';
    ctx.fillRect(0, 0, cw, rulerH);
    ctx.strokeStyle = '#cfd8dc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rulerH + 0.5);
    ctx.lineTo(cw, rulerH + 0.5);
    ctx.stroke();

    var step = tickStep(span);
    var first = Math.ceil(state.view.start / step) * step;
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    for (var t = first; t <= state.view.end; t += step) {
      var x = tToX(t);
      if (x < -1 || x > cw + 1) continue;
      ctx.strokeStyle = '#b0bec5';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, rulerH - 6);
      ctx.lineTo(x + 0.5, rulerH);
      ctx.stroke();
      ctx.fillStyle = '#607d8b';
      var lab = step >= 3600 ? fmtClock(t).replace(/^00:/, '') : fmtClock(t);
      ctx.fillText(lab, x + 4, rulerH / 2);
    }

    state.duels.forEach(function (d, i) {
      if (!d.include) return;
      var x1 = tToX(dispStart(d));
      var x2 = tToX(dispEnd(d));
      if (x2 < -20 || x1 > cw + 20) return;
      var w = Math.max(2, x2 - x1);
      var warn = !!warnings[i];
      var color = sourceColor(d, warn);
      ctx.fillStyle = rgba(color, i === state.selected ? 0.34 : 0.18);
      roundRect(x1, blockTop, w, blockH, 5);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = i === state.selected ? 2.5 : 1.2;
      ctx.stroke();

      if (w > 26) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x1 + 2, blockTop, w - 4, blockH);
        ctx.clip();
        ctx.fillStyle = '#263238';
        ctx.font = '700 11px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.fillText('#' + d.order, x1 + 5, blockTop + 13);
        if (w > 54) {
          ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
          ctx.fillStyle = '#37474f';
          ctx.fillText(duelName(d), x1 + 5, blockTop + 30);
          ctx.fillStyle = '#607d8b';
          ctx.fillText(fmtDur(d.baseEnd - d.baseStart), x1 + 5, blockTop + 45);
        }
        ctx.restore();
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1 + 0.5, blockTop - 4);
      ctx.lineTo(x1 + 0.5, blockTop + blockH + 4);
      ctx.moveTo(x2 - 0.5, blockTop - 4);
      ctx.lineTo(x2 - 0.5, blockTop + blockH + 4);
      ctx.stroke();
    });

    var pt = 0;
    if (state.hasFile) {
      pt = el.video.currentTime || 0;
    }
    if (pt >= state.view.start - 1 && pt <= state.view.end + 1) {
      var px = tToX(pt);
      ctx.strokeStyle = '#e65100';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, rulerH);
      ctx.lineTo(px + 0.5, ch - 6);
      ctx.stroke();
      ctx.fillStyle = '#e65100';
      ctx.beginPath();
      ctx.moveTo(px - 4, rulerH);
      ctx.lineTo(px + 4, rulerH);
      ctx.lineTo(px, rulerH + 6);
      ctx.closePath();
      ctx.fill();
    }

    if (!state.duels.length) {
      ctx.fillStyle = '#90a4ae';
      ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Нет поединков для разметки', cw / 2, blockTop + blockH / 2);
      ctx.textAlign = 'left';
    }
  }

  function resizeCanvas() {
    var rect = el.canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cw = Math.max(320, Math.round(rect.width || 640));
    ch = Math.round(rect.height || 118);
    el.canvas.width = Math.round(cw * dpr);
    el.canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function autoCalibrateRecStart() {
    if (state.recStartSource === 'manual' || state.recStartSource === 'qr' || !state.duration) return false;
    var lastEnd = 0;
    state.duels.forEach(function (d) {
      if (d.protoEndMs && d.protoEndMs > lastEnd) lastEnd = d.protoEndMs;
    });
    if (!lastEnd) return false;
    state.recordingStartMs = Math.round(lastEnd - state.duration * 1000 + state.tailSec * 1000);
    state.recStartSource = 'auto';
    return true;
  }

  function setCalNote_(text, cls) {
    if (!el.calNote) return;
    el.calNote.textContent = text || '';
    el.calNote.hidden = !text;
    el.calNote.classList.remove('is-ok', 'is-warn');
    if (cls) el.calNote.classList.add(cls);
  }

  function parseCalibrationPayload_(text) {
    var parts = String(text || '').split('&');
    var q = {};
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var eq = p.indexOf('=');
      if (eq < 0) continue;
      var k = decodeURIComponent(p.slice(0, eq));
      var v = decodeURIComponent(p.slice(eq + 1).replace(/\+/g, ' '));
      q[k] = v;
    }
    if (q.v !== '1' || q.k !== 'cal') return null;
    var ts = Number(q.ts);
    if (!isFinite(ts) || ts <= 0) return null;
    return {
      eventId: Number(q.e) || 0,
      duelId: Number(q.d) || 0,
      token: q.id || '',
      ts: ts
    };
  }

  function waitSeek_(video, t) {
    return new Promise(function (resolve) {
      if (Math.abs(video.currentTime - t) < 0.02) {
        resolve();
        return;
      }
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener('seeked', finish);
        resolve();
      }
      var timer = setTimeout(finish, 2500);
      video.addEventListener('seeked', finish);
      try {
        video.currentTime = t;
      } catch (e) {
        finish();
      }
    });
  }

  async function scanQrCalibration_() {
    if (!state.fileUrl || typeof jsQR !== 'function') return;
    var myToken = ++state.qrScanToken;
    var src = state.fileUrl;
    var probe = document.createElement('video');
    probe.muted = true;
    probe.preload = 'auto';
    probeHost.appendChild(probe);
    probe.src = src;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    var ready = await new Promise(function (resolve) {
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        probe.removeEventListener('loadedmetadata', onmeta);
        probe.removeEventListener('error', onerr);
        resolve(ok);
      }
      function onmeta() { finish(!!(probe.videoWidth && probe.videoHeight)); }
      function onerr() { finish(false); }
      var timer = setTimeout(function () { finish(!!(probe.videoWidth && probe.videoHeight)); }, 8000);
      probe.addEventListener('loadedmetadata', onmeta);
      probe.addEventListener('error', onerr);
      probe.load();
    });
    if (!ready || myToken !== state.qrScanToken || src !== state.fileUrl) return;

    /* Даём превью поединков догрузиться, чтобы не конкурировать за декодер. */
    for (var wait = 0; wait < 5000; wait += 250) {
      if (!thumbBusy && !thumbQueue.length) break;
      await new Promise(function (r) { setTimeout(r, 250); });
      if (myToken !== state.qrScanToken || src !== state.fileUrl) return;
    }

    var duration = isFinite(probe.duration) && probe.duration > 0 ? probe.duration : state.duration;
    var maxT = Math.min(duration || 0, 180);
    var samples = [];
    for (var t = 0.5; t < maxT; t += 1) samples.push(t);
    if (!samples.length) samples.push(Math.min(0.1, maxT));

    var w = Math.min(1280, probe.videoWidth || 1280);
    var h = Math.round(w * ((probe.videoHeight || 720) / (probe.videoWidth || 1280)));
    canvas.width = w;
    canvas.height = h;
    setCalNote_('Ищу QR-маркер в начале записи…', '');

    var found = null;
    for (var i = 0; i < samples.length; i++) {
      if (myToken !== state.qrScanToken || src !== state.fileUrl) {
        cleanupProbe_();
        return;
      }
      await waitSeek_(probe, samples[i]);
      if (myToken !== state.qrScanToken || src !== state.fileUrl) {
        cleanupProbe_();
        return;
      }
      try {
        ctx.drawImage(probe, 0, 0, w, h);
        var img = ctx.getImageData(0, 0, w, h);
        var code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
          var cal = parseCalibrationPayload_(code.data);
          if (cal) {
            found = { cal: cal, t: samples[i], raw: code.data };
            break;
          }
        }
      } catch (e) {}
      if (i % 5 === 0) {
        setCalNote_('Ищу QR-маркер… ' + fmtClock(samples[i]) + ' / ' + fmtClock(maxT), '');
      }
    }
    if (found) {
      /* Уточняем момент появления маркера: шаг 0,1 с назад от найденного кадра. */
      var from = Math.max(0.1, found.t - 1.2);
      for (var rt = from; rt < found.t; rt += 0.1) {
        if (myToken !== state.qrScanToken || src !== state.fileUrl) break;
        await waitSeek_(probe, rt);
        try {
          ctx.drawImage(probe, 0, 0, w, h);
          var rimg = ctx.getImageData(0, 0, w, h);
          var rcode = jsQR(rimg.data, rimg.width, rimg.height, { inversionAttempts: 'dontInvert' });
          if (rcode && rcode.data === found.raw) {
            found.t = Math.round(rt * 10) / 10;
            break;
          }
        } catch (e) {}
      }
    }
    cleanupProbe_();
    if (myToken !== state.qrScanToken || src !== state.fileUrl) return;

    if (!found) {
      setCalNote_(state.recStartSource === 'auto'
        ? 'QR-маркер не найден; старт рассчитан по протоколу.'
        : 'QR-маркер не найден. Проверьте старт записи вручную.', 'is-warn');
      return;
    }
    if (found.cal.eventId && state.eventId && found.cal.eventId !== state.eventId) {
      setCalNote_('QR относится к другому мероприятию (id ' + found.cal.eventId + ').', 'is-warn');
      return;
    }
    if (state.recStartSource === 'manual') {
      setCalNote_('QR найден, но старт записи задан вручную — оставляю ручное значение.', 'is-warn');
      return;
    }
    state.recordingStartMs = Math.round(found.cal.ts - found.t * 1000);
    state.recStartSource = 'qr';
    autoLayout(false);
    scheduleSave();
    setCalNote_('QR найден: старт записи '
      + msToLocalInput(state.recordingStartMs).replace('T', ' ')
      + ' (маркер на ' + fmtClock(found.t) + ').', 'is-ok');

    function cleanupProbe_() {
      probe.removeAttribute('src');
      try { probe.load(); } catch (e) {}
      probe.remove();
    }
  }

  function autoLayout(keepManual) {
    var list = state.duels;
    if (!list.length) {
      ensureView(true);
      draw();
      renderListValues();
      updateSteps();
      return;
    }
    var rec = state.recordingStartMs;
    var protoStarts = [];
    var knownLens = [];
    list.forEach(function (d) {
      if (d.protoStartMs) protoStarts.push(d.protoStartMs);
      if (d.protoStartMs && d.protoEndMs) {
        knownLens.push((d.protoEndMs - d.protoStartMs) / 1000 + state.tailSec);
      } else if (d.protoDurationSec) {
        knownLens.push(d.protoDurationSec + state.tailSec);
      }
    });
    knownLens.sort(function (a, b) { return a - b; });
    var typicalLen = knownLens.length
      ? knownLens[Math.floor(knownLens.length / 2)]
      : Math.max(300, ((list[0] && list[0].roundMinutes) || 5) * 60 * 2);
    typicalLen = Math.max(20, typicalLen);
    if (!rec && protoStarts.length) {
      rec = Math.min.apply(null, protoStarts);
      state.recordingStartMs = rec;
    }
    var cursor = 0;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (keepManual && d.source === 'manual') {
        cursor = d.baseEnd + state.gapSec;
        continue;
      }
      var start;
      var end;
      if (rec && d.protoStartMs) {
        start = (d.protoStartMs - rec) / 1000;
        if (d.protoEndMs) {
          end = (d.protoEndMs - rec) / 1000 + state.tailSec;
        } else {
          end = start + (d.protoDurationSec ? d.protoDurationSec + state.tailSec : 600);
        }
        d.source = 'proto';
      } else {
        start = Math.max(cursor, 0);
        var len = d.protoDurationSec
          ? Math.max(20, d.protoDurationSec + state.tailSec)
          : typicalLen;
        end = start + len;
        d.source = 'guess';
      }
      if (rec) {
        for (var j = i + 1; j < list.length; j++) {
          if (!list[j].protoStartMs) continue;
          var nextStart = (list[j].protoStartMs - rec) / 1000;
          if (nextStart > start && end > nextStart - 0.5) {
            end = Math.max(start + MIN_LEN, nextStart - state.gapSec);
          }
          break;
        }
      }
      d.baseStart = round3(Math.max(0, snapLeftFrame(start)));
      d.baseEnd = round3(Math.max(d.baseStart + MIN_LEN, end));
      cursor = d.baseEnd + state.gapSec;
    }
    syncRecStartInput();
    ensureView(true);
    draw();
    renderListValues();
    renderSelected();
    computeIssues();
    updateSteps();
    scheduleSave();
    schedulePreview();
  }

  function syncRecStartInput() {
    if (!el.recStart) return;
    if (!state.recordingStartMs) {
      el.recStart.value = '';
      return;
    }
    el.recStart.value = msToLocalInput(state.recordingStartMs);
  }

  function msToLocalInput(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-'
      + pad2(d.getMonth() + 1) + '-'
      + pad2(d.getDate()) + 'T'
      + pad2(d.getHours()) + ':'
      + pad2(d.getMinutes()) + ':'
      + pad2(d.getSeconds());
  }

  function parseLocalInput(v) {
    if (!v) return 0;
    var t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
  }

  function computeIssues() {
    var issues = [];
    var prev = null;
    state.duels.forEach(function (d, i) {
      if (!d.include) return;
      var s = dispStart(d);
      var e = dispEnd(d);
      if (e <= s) {
        issues.push({ i: i, text: 'Поединок ' + d.order + ': конец раньше начала' });
      }
      if (e - s < 10) {
        issues.push({ i: i, text: 'Поединок ' + d.order + ': фрагмент короче 10 секунд' });
      }
      if (s < -0.01) {
        issues.push({ i: i, text: 'Поединок ' + d.order + ': начало уходит в минус' });
      }
      if (state.duration && e > state.duration + 0.5) {
        issues.push({ i: i, text: 'Поединок ' + d.order + ': конец за пределами записи' });
      }
      if (prev && s < dispEnd(prev) - 0.05) {
        issues.push({ i: i, text: 'Поединок ' + d.order + ': пересекается с поединком ' + prev.order });
      }
      if (!d.p1 || !d.p2) {
        issues.push({ i: i, text: 'Поединок ' + d.order + ': не указаны оба игрока' });
      }
      prev = d;
    });
    state.issues = issues;
    renderIssues();
    draw();
    return issues;
  }

  function renderIssues() {
    if (!el.issues) return;
    if (!state.issues.length) {
      el.issues.hidden = true;
      el.issues.innerHTML = '';
      return;
    }
    var shown = state.issues.slice(0, 5);
    el.issues.hidden = false;
    el.issues.innerHTML = shown.map(function (it) {
      return '<li><button type="button" class="org-vc-issue-btn" data-i="' + it.i + '">' + esc(it.text) + '</button></li>';
    }).join('');
  }

  function renderList() {
    if (!el.list) return;
    if (!state.duels.length) {
      el.list.innerHTML = '';
      if (el.noDuels) el.noDuels.hidden = false;
      updateCount();
      return;
    }
    if (el.noDuels) el.noDuels.hidden = true;
    el.list.innerHTML = state.duels.map(function (d, i) {
      return '<article class="org-vc-duel" data-i="' + i + '">'
        + '<div class="org-vc-duel-head">'
        + '<span class="org-vc-num">' + esc(d.order) + '</span>'
        + '<span class="org-vc-names" title="' + esc(duelName(d)) + '">' + esc(duelName(d)) + '</span>'
        + '<span class="org-vc-badge" data-role="badge"></span>'
        + (d.video ? '<span class="org-vc-video-mark" title="Видео уже привязано">&#9679;</span>' : '')
        + '</div>'
        + '<div class="org-vc-frames org-vc-duel-frames">'
        + '<figure><canvas width="320" height="180" data-frame="start"></canvas>'
        + '<figcaption>1-й кадр <b data-role="thumb-start-t">—</b></figcaption></figure>'
        + '<figure><canvas width="320" height="180" data-frame="end"></canvas>'
        + '<figcaption>последний <b data-role="thumb-end-t">—</b></figcaption></figure>'
        + '</div>'
        + '<div class="org-vc-duel-times">'
        + '<label class="org-vc-field">Начало <input type="number" step="0.001" data-f="start"></label>'
        + '<label class="org-vc-field">Конец <input type="number" step="0.001" data-f="end"></label>'
        + '<span class="org-vc-dur" data-role="dur">—</span>'
        + '</div>'
        + '<div class="org-vc-duel-actions">'
        + '<button type="button" data-act="seek-start" title="Перейти к началу (первый кадр)">&#9654; начало</button>'
        + '<button type="button" data-act="seek-end" title="Перейти к концу (последний кадр)">конец &#9654;</button>'
        + '<button type="button" data-act="set-start" title="Начало только этого поединка в позиции плеера (по левому полному кадру)">[ в точке</button>'
        + '<button type="button" data-act="set-end" title="Конец в позиции плеера">] в точке</button>'
        + '<button type="button" data-act="prev" title="Предыдущий поединок">&#8592;</button>'
        + '<button type="button" data-act="next" title="Следующий поединок">&#8594;</button>'
        + '<label class="org-vc-include"><input type="checkbox" data-act="include"> в нарезку</label>'
        + '</div>'
        + '</article>';
    }).join('');
    renderListValues();
  }

  function renderListValues(force) {
    if (!el.list) return;
    var cards = el.list.querySelectorAll('.org-vc-duel');
    var warnings = warnSet();
    Array.prototype.forEach.call(cards, function (card) {
      var i = parseInt(card.getAttribute('data-i'), 10);
      var d = state.duels[i];
      if (!d) return;
      var prevBadge = card.querySelector('[data-role="badge"]');
      var durEl = card.querySelector('[data-role="dur"]');
      var startInput = card.querySelector('[data-f="start"]');
      var endInput = card.querySelector('[data-f="end"]');
      var thumbStartT = card.querySelector('[data-role="thumb-start-t"]');
      var thumbEndT = card.querySelector('[data-role="thumb-end-t"]');
      var chk = card.querySelector('[data-act="include"]');
      var badge = warnings[i] ? 'warn' : d.source;
      var badgeText = warnings[i] ? 'проверить' : (d.source === 'proto' ? 'протокол' : d.source === 'manual' ? 'вручную' : 'расчёт');
      card.classList.toggle('is-selected', i === state.selected);
      card.classList.toggle('is-off', !d.include);
      card.classList.remove('is-proto', 'is-guess', 'is-manual', 'is-warn');
      card.classList.add('is-' + badge);
      if (prevBadge) {
        prevBadge.className = 'org-vc-badge org-vc-badge--' + badge;
        prevBadge.textContent = badgeText;
      }
      if (durEl) durEl.textContent = fmtDur(d.baseEnd - d.baseStart);
      if (thumbStartT) thumbStartT.textContent = fmtClock(dispStart(d));
      if (thumbEndT) thumbEndT.textContent = fmtClock(dispEnd(d));
      if (startInput && (force || document.activeElement !== startInput)) {
        startInput.value = round3(dispStart(d)).toFixed(3);
      }
      if (endInput && (force || document.activeElement !== endInput)) {
        endInput.value = round3(dispEnd(d)).toFixed(3);
      }
      if (chk) chk.checked = !!d.include;
      applyFilter(card, d);
    });
    queueThumbs();
    updateCount();
  }

  function applyFilter(card, d) {
    if (!state.query) {
      card.classList.remove('is-hidden');
      return;
    }
    var hay = (String(d.order) + ' ' + d.p1 + ' ' + d.p2 + ' ' + d.situation).toLowerCase();
    card.classList.toggle('is-hidden', hay.indexOf(state.query) === -1);
  }

  function updateCount() {
    if (!el.count) return;
    var included = state.duels.filter(function (d) { return d.include; }).length;
    el.count.textContent = state.duels.length
      ? '(' + included + ' из ' + state.duels.length + ')'
      : '';
  }

  function updateSelection() {
    renderListValues();
    renderSelected();
  }

  function renderSelected() {
    var d = state.duels[state.selected];
    if (!el.selected) return;
    if (!d) {
      el.selected.textContent = 'Поединок не выбран';
      el.frameStartT.textContent = '—';
      el.frameEndT.textContent = '—';
      clearFrame(el.frameStart);
      clearFrame(el.frameEnd);
      return;
    }
    el.selected.innerHTML = '<span>#' + esc(d.order) + '</span> ' + esc(duelName(d))
      + (d.situation ? ' <span>· ' + esc(d.situation) + '</span>' : '')
      + ' <span>· ' + fmtClock(dispStart(d)) + '–' + fmtClock(dispEnd(d)) + '</span>'
      + ' <span>· ' + fmtDur(dispEnd(d) - dispStart(d)) + '</span>';
    el.frameStartT.textContent = fmtClock(dispStart(d));
    el.frameEndT.textContent = fmtClock(dispEnd(d));
    schedulePreview();
  }

  function clearFrame(canvas) {
    if (!canvas) return;
    var c = canvas.getContext('2d');
    c.fillStyle = '#101418';
    c.fillRect(0, 0, canvas.width, canvas.height);
  }

  function schedulePreview() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(grabSelectedFrames, 220);
  }

  function grabSelectedFrames() {
    var d = state.duels[state.selected];
    if (!d) return;
    var eps = frameEps();
    grabFrame(dispStart(d) + eps, el.frameStart, 'start');
    grabFrame(Math.max(dispStart(d) + eps, dispEnd(d) - eps), el.frameEnd, 'end');
  }

  function seekVideo(video, target) {
    if (typeof video.fastSeek === 'function') {
      try {
        video.fastSeek(target);
        return;
      } catch (e) {}
    }
    video.currentTime = target;
  }

  function grabFrame(t, canvas, key) {
    if (!canvas || !state.fileUrl || !state.hasFile) return;
    var probe = probes[key];
    if (!probe) return;
    var token = ++frameToken[key];
    function paint() {
      if (frameToken[key] !== token) return;
      var c = canvas.getContext('2d');
      c.fillStyle = '#101418';
      c.fillRect(0, 0, canvas.width, canvas.height);
      var vw = probe.videoWidth;
      var vh = probe.videoHeight;
      if (!vw || !vh) return;
      var scale = Math.min(canvas.width / vw, canvas.height / vh);
      var dw = vw * scale;
      var dh = vh * scale;
      try {
        c.drawImage(probe, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      } catch (e) {}
    }
    function seekNow() {
      var dur = probe.duration || state.duration;
      if (!isFinite(dur) || dur <= 0) return;
      var target = clamp(t, 0, Math.max(0, dur - 0.05));
      var onSeeked = function () {
        probe.removeEventListener('seeked', onSeeked);
        paint();
      };
      probe.addEventListener('seeked', onSeeked);
      try {
        seekVideo(probe, target);
      } catch (e) {
        probe.removeEventListener('seeked', onSeeked);
      }
    }
    if (probe.readyState >= 1) {
      seekNow();
    } else {
      probe.addEventListener('loadedmetadata', seekNow, { once: true });
    }
  }

  function thumbKey(i, kind, t) {
    return i + ':' + kind + ':' + round3(t).toFixed(3);
  }

  function thumbCanvasTime(d, kind) {
    var eps = frameEps();
    if (kind === 'start') return dispStart(d) + eps;
    return Math.max(dispStart(d) + eps, dispEnd(d) - eps);
  }

  function drawThumbPlaceholder(canvas, text) {
    if (!canvas) return;
    var c = canvas.getContext('2d');
    c.fillStyle = '#101418';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#78909c';
    c.font = '600 13px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, canvas.width / 2, canvas.height / 2);
    canvas.removeAttribute('data-key');
    canvas.removeAttribute('data-pending');
  }

  function drawThumb(canvas, probe) {
    if (!canvas) return;
    var c = canvas.getContext('2d');
    c.fillStyle = '#101418';
    c.fillRect(0, 0, canvas.width, canvas.height);
    var vw = probe.videoWidth;
    var vh = probe.videoHeight;
    if (!vw || !vh) return;
    var scale = Math.min(canvas.width / vw, canvas.height / vh);
    var dw = vw * scale;
    var dh = vh * scale;
    try {
      c.drawImage(probe, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    } catch (e) {}
  }

  function resetThumbs() {
    thumbQueue.length = 0;
    thumbCurrent = null;
    thumbBusy = false;
    thumbWaiting = false;
    window.clearTimeout(thumbTimer);
    window.clearTimeout(thumbSettle);
    if (!el.list) return;
    var canvases = el.list.querySelectorAll('[data-frame]');
    Array.prototype.forEach.call(canvases, function (canvas) {
      drawThumbPlaceholder(canvas, state.hasFile ? 'кадр…' : 'нет видео');
    });
  }

  function queueThumb(canvas, i, kind, t, retried) {
    if (!canvas) return;
    if (!state.hasFile || !state.fileUrl) {
      drawThumbPlaceholder(canvas, 'нет видео');
      return;
    }
    var key = thumbKey(i, kind, t);
    if (canvas.getAttribute('data-key') === key) return;
    if (canvas.getAttribute('data-pending') === key) return;
    for (var q = thumbQueue.length - 1; q >= 0; q--) {
      if (thumbQueue[q].canvas === canvas) thumbQueue.splice(q, 1);
    }
    canvas.setAttribute('data-pending', key);
    thumbQueue.push({ canvas: canvas, t: t, key: key, i: i, kind: kind, retried: !!retried });
  }

  function queueThumbs() {
    if (!el.list) return;
    var cards = el.list.querySelectorAll('.org-vc-duel');
    Array.prototype.forEach.call(cards, function (card) {
      var i = parseInt(card.getAttribute('data-i'), 10);
      var d = state.duels[i];
      if (!d) return;
      queueThumb(card.querySelector('[data-frame="start"]'), i, 'start', thumbCanvasTime(d, 'start'));
      queueThumb(card.querySelector('[data-frame="end"]'), i, 'end', thumbCanvasTime(d, 'end'));
    });
    processThumbQueue();
  }

  function finishThumb(token, paint) {
    if (!thumbCurrent || thumbCurrent.token !== token) return;
    var task = thumbCurrent;
    thumbCurrent = null;
    thumbBusy = false;
    window.clearTimeout(thumbTimer);
    window.clearTimeout(thumbSettle);
    if (task.canvas.isConnected && task.canvas.getAttribute('data-pending') === task.key) {
      if (paint) {
        drawThumb(task.canvas, thumbProbe);
        task.canvas.setAttribute('data-key', task.key);
      }
      task.canvas.removeAttribute('data-pending');
    }
    if (!paint && !task.retried && task.canvas.isConnected) {
      window.setTimeout(function () {
        if (!task.canvas.isConnected) return;
        queueThumb(task.canvas, task.i, task.kind, task.t, true);
        processThumbQueue();
      }, 300);
    }
    processThumbQueue();
  }

  function processThumbQueue() {
    if (thumbBusy || !thumbQueue.length) return;
    if (!state.hasFile || !state.fileUrl) {
      thumbQueue.length = 0;
      return;
    }
    if (thumbProbe.readyState < 1) {
      if (!thumbWaiting) {
        thumbWaiting = true;
        thumbProbe.addEventListener('loadedmetadata', function () {
          thumbWaiting = false;
          processThumbQueue();
        }, { once: true });
      }
      return;
    }
    var task = thumbQueue.shift();
    if (!task.canvas.isConnected || task.canvas.getAttribute('data-pending') !== task.key) {
      processThumbQueue();
      return;
    }
    var dur = thumbProbe.duration;
    if (!isFinite(dur) || dur <= 0) {
      task.canvas.removeAttribute('data-pending');
      processThumbQueue();
      return;
    }
    var target = clamp(task.t, 0, Math.max(0, dur - 0.05));
    var token = ++thumbToken;
    task.token = token;
    task.target = target;
    thumbCurrent = task;
    thumbBusy = true;
    window.clearTimeout(thumbTimer);
    window.clearTimeout(thumbSettle);
    thumbTimer = window.setTimeout(function () {
      finishThumb(token, false);
    }, 15000);
    thumbSettle = window.setTimeout(function () {
      if (!thumbCurrent || thumbCurrent.token !== token) return;
      if (thumbProbe.seeking || thumbProbe.readyState < 2) return;
      finishThumb(token, true);
    }, 700);
    if (Math.abs(thumbProbe.currentTime - target) < 0.001 && !thumbProbe.seeking && thumbProbe.readyState >= 2) {
      finishThumb(token, true);
      return;
    }
    try {
      seekVideo(thumbProbe, target);
    } catch (e) {
      finishThumb(token, false);
    }
  }

  thumbProbe.addEventListener('seeked', function () {
    if (!thumbCurrent) return;
    /* fastSeek останавливается на ключевом кадре — допускаем отклонение. */
    if (Math.abs(thumbProbe.currentTime - thumbCurrent.target) > 12) return;
    finishThumb(thumbCurrent.token, true);
  });
  thumbProbe.addEventListener('error', function () {
    if (!thumbCurrent) return;
    finishThumb(thumbCurrent.token, false);
  });

  function seekTo(t) {
    if (!state.hasFile) return;
    var dur = state.duration || el.video.duration || 0;
    var target = clamp(t, 0, dur > 0 ? Math.max(0, dur - 0.05) : t);
    try {
      el.video.currentTime = target;
    } catch (e) {}
    followPlayhead(target);
    draw();
  }

  function snapLeftFrame(t) {
    var fps = state.fps > 0 ? state.fps : 25;
    var dur = state.duration || (el.video && el.video.duration) || 0;
    var max = dur > 0 ? Math.max(0, dur - 0.001) : Math.max(0, t);
    var x = clamp(t, 0, max);
    return Math.max(0, Math.floor(x * fps + 1e-6) / fps);
  }

  function frameEps() {
    var fps = state.fps > 0 ? state.fps : 25;
    return 0.5 / fps;
  }

  function ceilFrame(t) {
    var fps = state.fps > 0 ? state.fps : 25;
    return Math.ceil(t * fps - 1e-6) / fps;
  }

  function setStartAtPlayhead(i) {
    var d = state.duels[i];
    if (!d || !state.hasFile) return;
    if (!el.video.paused) el.video.pause();
    var t = snapLeftFrame(el.video.currentTime || 0);
    setBoundary(i, 'start', t);
    var actual = dispStart(d);
    selectDuel(i, false);
    seekTo(actual);
  }

  function markStartAtPlayhead() {
    if (state.selected < 0 || state.selected >= state.duels.length) return;
    var d = state.duels[state.selected];
    if (!d || !state.hasFile) return;
    if (!el.video.paused) el.video.pause();
    var t = snapLeftFrame(el.video.currentTime || 0);
    var delta = t - dispStart(d);
    if (Math.abs(delta) < 0.0005) return;
    state.shiftSec = round3(t - d.baseStart);
    if (el.shift) el.shift.value = String(state.shiftSec);
    ensureView(true);
    renderListValues(true);
    renderSelected();
    computeIssues();
    updateSteps();
    scheduleSave();
  }

  function selectDuel(i, seek) {
    if (i < 0 || i >= state.duels.length) return;
    state.selected = i;
    var d = state.duels[i];
    if (seek) seekTo(dispStart(d) + 0.2);
    updateSelection();
    var card = el.list ? el.list.querySelector('.org-vc-duel[data-i="' + i + '"]') : null;
    if (card) card.scrollIntoView({ block: 'nearest' });
    scheduleSave();
  }

  function setBoundary(i, which, t) {
    var d = state.duels[i];
    if (!d) return;
    if (!isFinite(t)) {
      renderListValues(true);
      return;
    }
    t = Math.max(0, t);
    var prev = null;
    var next = null;
    for (var j = i - 1; j >= 0; j--) {
      if (state.duels[j].include) { prev = state.duels[j]; break; }
    }
    for (var k = i + 1; k < state.duels.length; k++) {
      if (state.duels[k].include) { next = state.duels[k]; break; }
    }
    if (which === 'start') {
      var minStart = prev ? dispEnd(prev) + 0.01 : 0;
      var maxStart = dispEnd(d) - MIN_LEN;
      t = clamp(t, minStart, Math.max(minStart, maxStart));
      t = snapLeftFrame(t);
      if (t < minStart) t = ceilFrame(minStart);
      if (t > maxStart) t = snapLeftFrame(maxStart);
      d.baseStart = round3(t - state.shiftSec);
    } else {
      var minEnd = dispStart(d) + MIN_LEN;
      var maxEnd = next ? dispStart(next) - 0.01 : (state.duration || maxTimelineEnd());
      t = clamp(t, minEnd, Math.max(minEnd, maxEnd));
      d.baseEnd = round3(t - state.shiftSec);
    }
    d.source = 'manual';
    computeIssues();
    renderListValues(true);
    if (i === state.selected) renderSelected();
    scheduleSave();
  }

  function followPlayhead(t) {
    var span = state.view.end - state.view.start;
    if (!isFinite(span) || span <= 0) return;
    if (t < state.view.start || t > state.view.end) {
      state.view.start = Math.max(0, t - span * 0.2);
      state.view.end = state.view.start + span;
    } else if (t > state.view.start + span * 0.94) {
      state.view.start = Math.max(0, t - span * 0.1);
      state.view.end = state.view.start + span;
    }
  }

  function hitTest(mx, my) {
    var blockTop = 30;
    var blockH = 54;
    var nearest = null;
    state.duels.forEach(function (d, i) {
      if (!d.include) return;
      var x1 = tToX(dispStart(d));
      var x2 = tToX(dispEnd(d));
      if (my < blockTop - 8 || my > blockTop + blockH + 8) return;
      var d1 = Math.abs(mx - x1);
      var d2 = Math.abs(mx - x2);
      if (d1 <= 7 && (!nearest || d1 < nearest.dist)) nearest = { i: i, which: 'start', dist: d1 };
      if (d2 <= 7 && (!nearest || d2 < nearest.dist)) nearest = { i: i, which: 'end', dist: d2 };
    });
    if (nearest) return nearest;
    for (var i = 0; i < state.duels.length; i++) {
      var d = state.duels[i];
      if (!d.include) continue;
      var a = tToX(dispStart(d));
      var b = tToX(dispEnd(d));
      if (mx >= a && mx <= b && my >= blockTop && my <= blockTop + blockH) {
        return { i: i, which: 'body' };
      }
    }
    return null;
  }

  var drag = null;
  var pan = null;

  el.canvas.addEventListener('pointerdown', function (e) {
    if (el.canvas.focus) {
      try { el.canvas.focus({ preventScroll: true }); } catch (err) {}
    }
    var rect = el.canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    if (e.button === 1 || e.altKey) {
      pan = { x: mx, viewStart: state.view.start, viewEnd: state.view.end };
      el.canvas.setPointerCapture(e.pointerId);
      el.canvas.classList.add('is-dragging');
      e.preventDefault();
      return;
    }
    if (my <= 23) {
      seekTo(xToT(mx));
      return;
    }
    var hit = hitTest(mx, my);
    if (hit && hit.which !== 'body') {
      drag = { i: hit.i, which: hit.which, moved: false };
      el.canvas.setPointerCapture(e.pointerId);
      el.canvas.classList.add('is-dragging');
      e.preventDefault();
      return;
    }
    if (hit && hit.which === 'body') {
      selectDuel(hit.i, false);
      seekTo(xToT(mx));
      return;
    }
    seekTo(xToT(mx));
  });

  el.canvas.addEventListener('pointermove', function (e) {
    var rect = el.canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    if (pan) {
      var span = pan.viewEnd - pan.viewStart;
      var shift = ((pan.x - mx) / Math.max(1, cw)) * span;
      var start = clamp(pan.viewStart + shift, 0, Math.max(0, maxTimelineEnd() - span));
      state.view.start = start;
      state.view.end = start + span;
      draw();
      return;
    }
    if (drag) {
      drag.moved = true;
      setBoundary(drag.i, drag.which, xToT(mx));
      return;
    }
    var hit = hitTest(mx, my);
    el.canvas.classList.toggle('is-dragging', !!(hit && hit.which !== 'body'));
  });

  function endPointer(e) {
    if (drag) {
      if (!drag.moved) selectDuel(drag.i, false);
      drag = null;
      scheduleSave();
    }
    if (pan) pan = null;
    el.canvas.classList.remove('is-dragging');
    if (e && el.canvas.hasPointerCapture && el.canvas.hasPointerCapture(e.pointerId)) {
      el.canvas.releasePointerCapture(e.pointerId);
    }
  }
  el.canvas.addEventListener('pointerup', endPointer);
  el.canvas.addEventListener('pointercancel', endPointer);

  el.canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = el.canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var t = xToT(mx);
    var span = state.view.end - state.view.start;
    var factor = e.deltaY < 0 ? 0.8 : 1.25;
    var nextSpan = clamp(span * factor, 2, Math.max(30, maxTimelineEnd() * 2));
    var ratio = (t - state.view.start) / Math.max(0.001, span);
    var start = clamp(t - nextSpan * ratio, 0, Math.max(0, maxTimelineEnd() - nextSpan));
    state.view.start = start;
    state.view.end = start + nextSpan;
    draw();
  }, { passive: false });

  function zoom(factor) {
    var span = state.view.end - state.view.start;
    var center = state.hasFile ? el.video.currentTime : (state.view.start + span / 2);
    var nextSpan = clamp(span * factor, 2, Math.max(30, maxTimelineEnd() * 2));
    var start = clamp(center - nextSpan / 2, 0, Math.max(0, maxTimelineEnd() - nextSpan));
    state.view.start = start;
    state.view.end = start + nextSpan;
    draw();
  }

  Array.prototype.forEach.call(root.querySelectorAll('[data-zoom]'), function (btn) {
    btn.addEventListener('click', function () {
      var mode = btn.getAttribute('data-zoom');
      if (mode === 'fit') {
        ensureView(true);
        draw();
      } else if (mode === 'in') {
        zoom(0.6);
      } else {
        zoom(1.67);
      }
    });
  });

  function scheduleSave() {
    setSaveState('dirty');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDraft, 400);
  }

  function setSaveState(kind) {
    if (!el.saveState) return;
    el.saveState.classList.remove('is-saved', 'is-dirty');
    if (kind === 'saved') {
      el.saveState.textContent = 'Черновик сохранён ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      el.saveState.classList.add('is-saved');
    } else if (kind === 'dirty') {
      el.saveState.textContent = 'Есть несохранённые изменения';
      el.saveState.classList.add('is-dirty');
    } else {
      el.saveState.textContent = 'Черновик не сохранён';
    }
  }

  function draftKey() {
    return LS_PREFIX + state.eventId;
  }

  function saveDraft() {
    if (!state.eventId) return;
    var obj = {
      v: 1,
      eventId: state.eventId,
      fileName: state.fileName,
      fileSize: state.fileSize,
      duration: state.duration,
      recordingStartMs: state.recordingStartMs,
      recStartSource: state.recStartSource,
      shiftSec: state.shiftSec,
      gapSec: state.gapSec,
      tailSec: state.tailSec,
      crf: state.crf,
      preset: state.preset,
      fps: state.fps,
      template: state.template,
      selected: state.selected,
      duels: state.duels.map(function (d) {
        return {
          duelId: d.duelId,
          baseStart: d.baseStart,
          baseEnd: d.baseEnd,
          source: d.source,
          include: d.include
        };
      })
    };
    try {
      localStorage.setItem(draftKey(), JSON.stringify(obj));
      setSaveState('saved');
    } catch (e) {
      setSaveState('dirty');
    }
  }

  function loadDraft() {
    if (!state.eventId) return false;
    var raw = null;
    try {
      raw = localStorage.getItem(draftKey());
    } catch (e) {
      return false;
    }
    if (!raw) return false;
    var obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return false;
    }
    if (!obj || obj.v !== 1) return false;
    state.fileName = String(obj.fileName || '');
    state.fileSize = (obj.fileSize || 0);
    state.duration = (obj.duration || 0);
    state.recordingStartMs = obj.recordingStartMs || 0;
    state.recStartSource = obj.recStartSource || '';
    if (!state.recStartSource) {
      /* Старые черновики: отличающийся от времени мероприятия старт считаем ручным. */
      state.recStartSource = (obj.recStartManual === true
        || (obj.recordingStartMs && DATA.recordingStartMs
          && Math.abs(Number(obj.recordingStartMs) - Number(DATA.recordingStartMs)) > 1000))
        ? 'manual' : 'event';
    }
    state.shiftSec = Number(obj.shiftSec) || 0;
    state.gapSec = obj.gapSec != null ? Number(obj.gapSec) : 2;
    state.tailSec = obj.tailSec != null ? Number(obj.tailSec) : 5;
    state.crf = obj.crf != null ? Number(obj.crf) : 20;
    state.preset = obj.preset || 'medium';
    state.fps = obj.fps != null && Number(obj.fps) > 0 ? Number(obj.fps) : 25;
    state.template = obj.template || state.template;
    state.selected = typeof obj.selected === 'number' ? obj.selected : -1;
    var byId = {};
    (obj.duels || []).forEach(function (d) {
      byId[d.duelId] = d;
    });
    state.duels.forEach(function (d) {
      var saved = byId[d.duelId];
      if (!saved) return;
      if (isFinite(saved.baseStart)) d.baseStart = Number(saved.baseStart);
      if (isFinite(saved.baseEnd)) d.baseEnd = Number(saved.baseEnd);
      if (saved.source) d.source = saved.source;
      if (saved.include != null) d.include = !!saved.include;
    });
    return true;
  }

  function applySettingsToInputs() {
    if (el.recStart) el.recStart.value = state.recordingStartMs ? msToLocalInput(state.recordingStartMs) : '';
    if (el.shift) el.shift.value = String(state.shiftSec);
    if (el.crf) el.crf.value = String(state.crf);
    if (el.preset) el.preset.value = state.preset;
    if (el.fps) el.fps.value = String(state.fps);
    if (el.template) el.template.value = state.template;
    if (el.gap) el.gap.value = String(state.gapSec);
    if (el.tail) el.tail.value = String(state.tailSec);
  }

  function updateFileMeta() {
    if (el.nudge) el.nudge.hidden = !state.hasFile;
    if (!el.fileMeta) return;
    if (state.hasFile) {
      var size = state.fileSize ? (state.fileSize / (1024 * 1024)).toFixed(0) + ' МБ' : '';
      el.fileMeta.innerHTML = '<b>' + esc(state.fileName) + '</b>'
        + (size ? ' · ' + size : '')
        + (state.duration ? ' · ' + fmtClock(state.duration) : '');
      return;
    }
    if (state.fileName) {
      el.fileMeta.innerHTML = 'В черновике: <b>' + esc(state.fileName) + '</b> — выберите файл снова';
      return;
    }
    el.fileMeta.textContent = 'Файл не выбран';
  }

  function updateSteps() {
    if (!el.steps) return;
    var items = {
      import: el.steps.querySelector('[data-step="import"]'),
      markup: el.steps.querySelector('[data-step="markup"]'),
      cut: el.steps.querySelector('[data-step="cut"]'),
      publish: el.steps.querySelector('[data-step="publish"]')
    };
    function set(li, cls) {
      if (!li) return;
      li.classList.remove('is-done', 'is-active', 'is-locked');
      if (cls) li.classList.add(cls);
    }
    if (state.hasFile) {
      set(items.import, 'is-done');
      set(items.markup, state.issues.length ? 'is-active' : 'is-done');
    } else {
      set(items.import, 'is-active');
      set(items.markup, '');
    }
    set(items.cut, 'is-locked');
    set(items.publish, 'is-locked');
  }

  function refreshAll() {
    computeIssues();
    renderListValues();
    renderSelected();
    updateFileMeta();
    updateSteps();
    draw();
  }

  if (el.eventSelect) {
    el.eventSelect.addEventListener('change', function () {
      var url = new URL(window.location.href);
      url.searchParams.set('p', 'org');
      url.searchParams.set('s', 'videocut');
      if (el.eventSelect.value && el.eventSelect.value !== '0') {
        url.searchParams.set('event', el.eventSelect.value);
      } else {
        url.searchParams.delete('event');
      }
      window.location.href = url.toString();
    });
  }

  if (el.file) {
    el.file.addEventListener('change', function () {
      var file = el.file.files && el.file.files[0];
      if (!file) return;
      if (state.fileName && state.recStartSource !== 'manual'
          && (state.fileName !== file.name || state.fileSize !== file.size)) {
        /* Другая запись: прежняя калибровка (QR/авто) к ней не относится. */
        state.recStartSource = 'event';
      }
      state.qrScanToken++;
      setCalNote_('', '');
      if (state.fileUrl) {
        try { URL.revokeObjectURL(state.fileUrl); } catch (e) {}
      }
      state.fileUrl = URL.createObjectURL(file);
      state.hasFile = true;
      if (el.qrScan) el.qrScan.disabled = false;
      state.fileName = file.name;
      state.fileSize = file.size;
      probes.start.src = state.fileUrl;
      probes.end.src = state.fileUrl;
      thumbProbe.src = state.fileUrl;
      thumbProbe.load();
      el.video.src = state.fileUrl;
      el.video.hidden = false;
      if (el.playerEmpty) el.playerEmpty.hidden = true;
      resetThumbs();
      renderListValues(true);
      updateFileMeta();
      updateSteps();
      setSaveState('dirty');
    });
  }

  if (el.qrScan) {
    el.qrScan.addEventListener('click', function () {
      if (state.qrScanning || !state.hasFile) return;
      state.qrScanning = true;
      el.qrScan.disabled = true;
      var oldText = el.qrScan.textContent;
      el.qrScan.textContent = 'Ищу QR…';
      function done() {
        state.qrScanning = false;
        el.qrScan.disabled = !state.hasFile;
        el.qrScan.textContent = oldText;
      }
      scanQrCalibration_().then(done, function () {
        setCalNote_('Не удалось выполнить поиск QR.', 'is-warn');
        done();
      });
    });
  }

  el.video.addEventListener('loadedmetadata', function () {
    var d = el.video.duration;
    if (isFinite(d) && d > 0) {
      var prev = state.duration;
      state.duration = d;
      if (prev && Math.abs(prev - d) > 2) {
        /* Черновик от другого файла: не двигаем границы автоматически. */
      }
      if (autoCalibrateRecStart()) {
        autoLayout(false);
      } else {
        ensureView(!prev);
        refreshAll();
      }
      scheduleSave();
    }
  });

  el.video.addEventListener('timeupdate', function () {
    draw();
    if (!el.video.paused) {
      var before = state.view.start;
      followPlayhead(el.video.currentTime);
      if (before !== state.view.start) draw();
    }
  });
  el.video.addEventListener('seeked', draw);
  el.video.addEventListener('play', draw);
  el.video.addEventListener('pause', draw);

  if (el.clearFile) {
    el.clearFile.addEventListener('click', function () {
      state.qrScanToken++;
      setCalNote_('', '');
      if (state.fileUrl) {
        try { URL.revokeObjectURL(state.fileUrl); } catch (e) {}
      }
      state.fileUrl = '';
      state.hasFile = false;
      if (el.qrScan) el.qrScan.disabled = true;
      state.fileName = '';
      state.fileSize = 0;
      el.video.removeAttribute('src');
      el.video.load();
      Object.keys(probes).forEach(function (k) {
        probes[k].removeAttribute('src');
        probes[k].load();
      });
      thumbProbe.removeAttribute('src');
      thumbProbe.load();
      resetThumbs();
      if (el.playerEmpty) el.playerEmpty.hidden = false;
      if (el.file) el.file.value = '';
      clearFrame(el.frameStart);
      clearFrame(el.frameEnd);
      refreshAll();
      scheduleSave();
    });
  }

  if (el.nudge) {
    el.nudge.addEventListener('click', function (e) {
      if (e.target.closest('#org-vc-mark-start')) {
        markStartAtPlayhead();
        return;
      }
      var btn = e.target.closest('[data-nudge]');
      if (!btn || !state.hasFile) return;
      var step = parseFloat(btn.getAttribute('data-nudge'));
      if (!isFinite(step)) return;
      if (!el.video.paused) el.video.pause();
      seekTo((el.video.currentTime || 0) + step);
    });
  }

  if (el.fps) {
    el.fps.addEventListener('change', function () {
      var v = parseFloat(el.fps.value);
      if (!isFinite(v) || v < 1) v = 25;
      if (v > 240) v = 240;
      state.fps = v;
      el.fps.value = String(v);
      renderListValues(true);
      schedulePreview();
      scheduleSave();
    });
  }

  if (el.recStart) {
    el.recStart.addEventListener('change', function () {
      state.recordingStartMs = parseLocalInput(el.recStart.value);
      state.recStartSource = 'manual';
      autoLayout(true);
    });
  }

  if (el.shift) {
    el.shift.addEventListener('change', function () {
      var v = parseFloat(el.shift.value);
      state.shiftSec = isFinite(v) ? v : 0;
      el.shift.value = String(state.shiftSec);
      refreshAll();
      scheduleSave();
    });
  }

  function bindNumber(input, key, min) {
    if (!input) return;
    input.addEventListener('change', function () {
      var v = parseFloat(input.value);
      if (!isFinite(v) || v < min) v = min;
      state[key] = v;
      input.value = String(v);
      autoLayout(true);
    });
  }
  bindNumber(el.gap, 'gapSec', 0);
  bindNumber(el.tail, 'tailSec', 0);

  if (el.crf) {
    el.crf.addEventListener('change', function () {
      var v = parseInt(el.crf.value, 10);
      if (!isFinite(v)) v = 20;
      state.crf = clamp(v, 0, 51);
      el.crf.value = String(state.crf);
      scheduleSave();
    });
  }
  if (el.preset) {
    el.preset.addEventListener('change', function () {
      state.preset = el.preset.value || 'medium';
      scheduleSave();
    });
  }
  if (el.template) {
    el.template.addEventListener('change', function () {
      state.template = el.template.value || state.template;
      scheduleSave();
    });
  }

  if (el.auto) {
    el.auto.addEventListener('click', function () {
      autoLayout(false);
    });
  }

  if (el.list) {
    el.list.addEventListener('click', function (e) {
      var card = e.target.closest('.org-vc-duel');
      if (!card) return;
      var i = parseInt(card.getAttribute('data-i'), 10);
      var actEl = e.target.closest('[data-act]');
      if (actEl && actEl.tagName !== 'INPUT') {
        e.preventDefault();
        var act = actEl.getAttribute('data-act');
        var d = state.duels[i];
        if (!d) return;
        if (act === 'seek-start') { selectDuel(i, false); seekTo(dispStart(d) + frameEps()); }
        else if (act === 'seek-end') { selectDuel(i, false); seekTo(dispEnd(d) - frameEps()); }
        else if (act === 'set-start') { setStartAtPlayhead(i); }
        else if (act === 'set-end') { setBoundary(i, 'end', (state.hasFile ? el.video.currentTime : dispEnd(d))); selectDuel(i, false); }
        else if (act === 'prev') selectDuel(i - 1, true);
        else if (act === 'next') selectDuel(i + 1, true);
        return;
      }
      if (e.target.closest('input,label,button')) return;
      var active = document.activeElement;
      if (active && active !== document.body && typeof active.blur === 'function') active.blur();
      selectDuel(i, false);
    });
    el.list.addEventListener('focusin', function (e) {
      var card = e.target.closest('.org-vc-duel');
      if (!card) return;
      var i = parseInt(card.getAttribute('data-i'), 10);
      if (i !== state.selected) selectDuel(i, false);
    });
    el.list.addEventListener('change', function (e) {
      var card = e.target.closest('.org-vc-duel');
      if (!card) return;
      var i = parseInt(card.getAttribute('data-i'), 10);
      var d = state.duels[i];
      if (!d) return;
      if (e.target.matches('[data-f="start"]')) {
        setBoundary(i, 'start', parseFloat(e.target.value));
      } else if (e.target.matches('[data-f="end"]')) {
        setBoundary(i, 'end', parseFloat(e.target.value));
      } else if (e.target.matches('[data-act="include"]')) {
        d.include = !!e.target.checked;
        computeIssues();
        renderListValues();
        updateSteps();
        scheduleSave();
      }
    });
  }

  if (el.issues) {
    el.issues.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-i]');
      if (!btn) return;
      var i = parseInt(btn.getAttribute('data-i'), 10);
      if (isFinite(i)) selectDuel(i, true);
    });
  }

  if (el.search) {
    el.search.addEventListener('input', function () {
      state.query = el.search.value.trim().toLowerCase();
      renderListValues();
    });
  }

  if (el.exportBtn) {
    el.exportBtn.addEventListener('click', function () {
      var ev = DATA.event || {};
      var recEff = state.recordingStartMs
        ? state.recordingStartMs - state.shiftSec * 1000
        : 0;
      var out = {
        v: 1,
        eventId: state.eventId,
        event: ev.title || '',
        date: ev.startsOn || '',
        recordingStartMs: recEff,
        recordingStart: recEff ? new Date(recEff).toISOString() : null,
        fileName: state.fileName,
        duration: state.duration,
        shiftSec: state.shiftSec,
        fps: state.fps,
        ffmpeg: { crf: state.crf, preset: state.preset, audio: 'copy' },
        fragments: []
      };
      state.duels.forEach(function (d) {
        if (!d.include) return;
        var s = dispStart(d);
        var e = dispEnd(d);
        out.fragments.push({
          duelId: d.duelId,
          order: d.order,
          players: [d.p1, d.p2],
          start: round3(s),
          end: round3(e),
          duration: round3(e - s),
          startAbs: recEff ? new Date(recEff + s * 1000).toISOString() : null,
          endAbs: recEff ? new Date(recEff + e * 1000).toISOString() : null,
          filename: buildFilename(d)
        });
      });
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'videocut-' + state.eventId + '.json';
      document.body.appendChild(a);
      a.click();
      window.setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    });
  }

  if (el.clearDraft) {
    el.clearDraft.addEventListener('click', function () {
      if (!window.confirm('Очистить черновик разметки для этого мероприятия?')) return;
      try { localStorage.removeItem(draftKey()); } catch (e) {}
      state.shiftSec = 0;
      state.gapSec = 2;
      state.tailSec = 5;
      state.selected = -1;
      state.duels.forEach(function (d) {
        d.source = 'guess';
        d.include = true;
      });
      applySettingsToInputs();
      autoLayout(false);
      setSaveState('saved');
    });
  }

  function serviceFail() {
    if (el.serviceDot) el.serviceDot.className = 'org-vc-dot is-off';
    if (el.serviceText) el.serviceText.textContent = 'сервис не запущен';
  }

  if (el.serviceCheck) {
    el.serviceCheck.addEventListener('click', function () {
      if (el.serviceDot) el.serviceDot.className = 'org-vc-dot is-wait';
      if (el.serviceText) el.serviceText.textContent = 'проверяем…';
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = window.setTimeout(function () {
        if (ctrl) ctrl.abort();
      }, 2500);
      fetch(SERVICE_URL + '/health', ctrl ? { signal: ctrl.signal, mode: 'cors' } : { mode: 'cors' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('bad status')); })
        .then(function (res) {
          window.clearTimeout(timer);
          if (el.serviceDot) el.serviceDot.className = 'org-vc-dot is-on';
          if (el.serviceText) {
            el.serviceText.textContent = 'сервис онлайн'
              + (res && res.ffmpeg ? ' · ffmpeg ok' : '');
          }
        })
        .catch(function () {
          window.clearTimeout(timer);
          serviceFail();
        });
    });
  }

  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (e.key === 'Escape' && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
      if (e.target && typeof e.target.blur === 'function') e.target.blur();
      return;
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var key = e.key;
    var step = e.shiftKey ? 0.1 : 1;
    if (key === ' ') {
      e.preventDefault();
      if (!state.hasFile) return;
      if (el.video.paused) el.video.play(); else el.video.pause();
    } else if (key === 'ArrowLeft') {
      e.preventDefault();
      if (state.hasFile) seekTo((el.video.currentTime || 0) - step);
    } else if (key === 'ArrowRight') {
      e.preventDefault();
      if (state.hasFile) seekTo((el.video.currentTime || 0) + step);
    } else if (key === 'j' || key === 'J') {
      e.preventDefault();
      if (state.hasFile) seekTo((el.video.currentTime || 0) - 5);
    } else if (key === 'k' || key === 'K') {
      e.preventDefault();
      if (state.hasFile) { if (el.video.paused) el.video.play(); else el.video.pause(); }
    } else if (key === 'l' || key === 'L') {
      e.preventDefault();
      if (state.hasFile) seekTo((el.video.currentTime || 0) + 5);
    } else if (key === '[') {
      e.preventDefault();
      if (state.selected >= 0) {
        setBoundary(state.selected, 'start', state.hasFile ? el.video.currentTime : dispStart(state.duels[state.selected]));
      }
    } else if (key === ']') {
      e.preventDefault();
      if (state.selected >= 0) {
        setBoundary(state.selected, 'end', state.hasFile ? el.video.currentTime : dispEnd(state.duels[state.selected]));
      }
    } else if (key === 'n' || key === 'N') {
      e.preventDefault();
      if (state.selected < state.duels.length - 1) selectDuel(state.selected + 1, true);
    } else if (key === 'p' || key === 'P') {
      e.preventDefault();
      if (state.selected > 0) selectDuel(state.selected - 1, true);
    } else if (key === 'Home') {
      e.preventDefault();
      if (state.hasFile) seekTo(0);
    } else if (key === 'End') {
      e.preventDefault();
      if (state.hasFile) seekTo(state.duration || el.video.duration || 0);
    }
  });

  window.addEventListener('resize', resizeCanvas);
  if (window.ResizeObserver) {
    new ResizeObserver(resizeCanvas).observe(el.canvas);
  }

  /* Инициализация */
  state.duels = (DATA.duels || []).map(function (d) {
    return {
      duelId: d.duelId,
      order: d.order,
      type: d.type,
      roundMinutes: d.roundMinutes,
      situation: d.situation,
      p1: d.p1,
      p2: d.p2,
      protoStartMs: d.protoStartMs || null,
      protoEndMs: d.protoEndMs || null,
      protoDurationSec: d.protoDurationSec,
      video: d.video || null,
      baseStart: 0,
      baseEnd: 0,
      source: 'guess',
      include: true
    };
  });
  if (state.selected < 0 && state.duels.length) state.selected = 0;

  var hadDraft = loadDraft();
  applySettingsToInputs();
  updateFileMeta();
  renderList();

  if (!hadDraft) {
    autoLayout(false);
  } else {
    ensureView(true);
    computeIssues();
    renderListValues();
    renderSelected();
    updateSteps();
    draw();
    setSaveState('saved');
  }

  el.video.hidden = !state.hasFile;
  if (el.playerEmpty) el.playerEmpty.hidden = state.hasFile;
  updateFileMeta();
  updateSteps();
  resizeCanvas();
  if (state.duels.length && state.selected >= 0) {
    renderSelected();
  }
})();
