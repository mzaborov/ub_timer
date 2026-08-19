(function () {
  var form = document.getElementById('org-mat-form');
  var errEl = document.getElementById('org-mat-err');
  var csrfEl = document.getElementById('org-mat-csrf');
  var titleEl = document.getElementById('org-mat-title');
  var bodyEl = document.getElementById('org-mat-body');
  var idEl = document.getElementById('org-mat-id');
  if (!form || !csrfEl || !bodyEl) return;

  var busy = false;
  var markedReady = false;

  function showErr(msg) {
    if (!errEl) return;
    errEl.hidden = !msg;
    errEl.textContent = msg || '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function prepareMarked() {
    if (markedReady || !window.marked) return;
    try {
      if (typeof window.marked.use === 'function') {
        window.marked.use({
          gfm: true,
          breaks: true,
          renderer: { html: function () { return ''; } },
        });
      } else if (typeof window.marked.setOptions === 'function') {
        window.marked.setOptions({ gfm: true, breaks: true });
      }
    } catch (e) {}
    markedReady = true;
  }

  function parseMd(text) {
    var src = String(text || '');
    prepareMarked();
    try {
      if (window.marked && typeof window.marked.parse === 'function') {
        return window.marked.parse(src, { async: false });
      }
      if (typeof window.marked === 'function') {
        return window.marked(src);
      }
    } catch (e) {}
    return '<pre>' + esc(src) + '</pre>';
  }

  function preview() {
    var box = document.getElementById('org-mat-preview');
    if (!box) return;
    var title = (titleEl && titleEl.value || '').trim();
    var html = '';
    if (title) {
      html += '<h1><svg class="ico" aria-hidden="true"><use href="#i-book"></use></svg> ' + esc(title) + '</h1>';
    }
    html += '<div class="mat-body">' + parseMd(bodyEl.value) + '</div>';
    box.innerHTML = html;
  }

  function api(fields) {
    if (busy) return Promise.reject(new Error('busy'));
    busy = true;
    var body = new URLSearchParams();
    body.set('csrf', csrfEl.value);
    body.set('ajax', '1');
    body.set('action', 'org_mat_save');
    Object.keys(fields || {}).forEach(function (k) {
      body.set(k, fields[k]);
    });
    return fetch(window.location.pathname + window.location.search, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
      credentials: 'same-origin',
    })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        busy = false;
        var res;
        try {
          res = JSON.parse(text);
        } catch (e) {
          showErr('Сервер вернул не JSON. Обновите страницу.');
          throw new Error('not-json');
        }
        if (res.error) {
          showErr(res.error);
          throw new Error(res.error);
        }
        showErr('');
        return res;
      })
      .catch(function (e) {
        busy = false;
        if (errEl && errEl.hidden) {
          showErr('Не удалось сохранить.');
        }
        throw e;
      });
  }

  bodyEl.addEventListener('input', preview);
  if (titleEl) titleEl.addEventListener('input', preview);
  preview();

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var saveBtn = document.getElementById('org-mat-save');
    var okEl = document.getElementById('org-mat-ok');
    if (saveBtn) saveBtn.disabled = true;
    api({
      id: idEl ? idEl.value : '0',
      title: titleEl ? titleEl.value : '',
      body_md: bodyEl.value,
    }).then(function (res) {
      if (idEl && res.id) idEl.value = String(res.id);
      if (okEl) {
        okEl.hidden = false;
        window.setTimeout(function () { okEl.hidden = true; }, 2500);
      }
    }).catch(function () {}).then(function () {
      if (saveBtn) saveBtn.disabled = false;
    });
  });
})();
