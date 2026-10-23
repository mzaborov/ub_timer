(function () {
  function bindToasts() {
    var box = document.querySelector('.org-toasts');
    if (!box) {
      return;
    }
    var ms = box.querySelector('.is-err') ? 3500 : 2500;
    setTimeout(function () {
      box.classList.add('is-off');
      setTimeout(function () {
        if (box.parentNode) {
          box.parentNode.removeChild(box);
        }
      }, 400);
    }, ms);
  }
  bindToasts();

  function autoReviewLabel(url) {
    url = String(url || '');
    if (/\.(xlsx|xls|ods|csv)(\?|#|$)/i.test(url) ||
        url.indexOf('spreadsheets') >= 0 ||
        /docs\.google\.com\/spreadsheets/i.test(url)) {
      return 'материал';
    }
    return 'разбор';
  }

  function reviewOptsFromBtn(btn) {
    if (!btn) {
      return {};
    }
    return {
      id: btn.getAttribute('data-review-id') | 0,
      sitId: btn.getAttribute('data-sit-id') | 0,
      duelId: btn.getAttribute('data-duel-id') | 0,
      eventId: btn.getAttribute('data-event-id') | 0,
      url: btn.getAttribute('data-url') || '',
      title: btn.getAttribute('data-title') || '',
      iso: btn.getAttribute('data-iso') || ''
    };
  }

  function reviewPost(action, fields) {
    var csrfEl = document.getElementById('org-events-csrf');
    var body = new URLSearchParams();
    body.set('csrf', csrfEl ? csrfEl.value : '');
    body.set('ajax', '1');
    body.set('action', action);
    Object.keys(fields || {}).forEach(function (k) {
      body.set(k, fields[k] == null ? '' : String(fields[k]));
    });
    return fetch(window.location.pathname + window.location.search, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
      credentials: 'same-origin'
    }).then(function (resp) {
      if (!resp.ok) {
        throw new Error('HTTP ' + resp.status);
      }
      return resp.json();
    });
  }

  function reviewUpdateHint() {
    var urlEl = document.getElementById('org-rv-url');
    var labEl = document.getElementById('org-rv-label');
    var hint = document.getElementById('org-rv-hint');
    if (!hint) {
      return;
    }
    var auto = autoReviewLabel(urlEl ? urlEl.value : '');
    hint.textContent = labEl && labEl.value === 'auto' ? ('сейчас: ' + auto) : '';
  }

  function reviewShowEditor(show) {
    var ed = document.getElementById('org-rv-editor');
    if (!ed) {
      return;
    }
    ed.hidden = !show;
  }

  function reviewFillEditor(opts) {
    opts = opts || {};
    var isEdit = (opts.id | 0) > 0;
    var title = document.getElementById('org-rv-title');
    if (title) {
      title.textContent = isEdit ? 'Править разбор' : 'Добавить разбор';
    }
    document.getElementById('org-rv-id').value = (opts.id | 0) || '';
    document.getElementById('org-rv-sit').value = (opts.sitId | 0) || '';
    document.getElementById('org-rv-duel').value = String((opts.duelId | 0) || 0);
    document.getElementById('org-rv-event').value = String((opts.eventId | 0) || 0);
    document.getElementById('org-rv-url').value = opts.url || '';
    var lab = document.getElementById('org-rv-label');
    var rawTitle = String(opts.title || '').trim().toLowerCase();
    if (lab) {
      lab.value = rawTitle === 'разбор' || rawTitle === 'материал' ? rawTitle : 'auto';
    }
    var iso = String(opts.iso || '').trim();
    document.getElementById('org-rv-date').value = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';
    var err = document.getElementById('org-rv-err');
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }
    reviewUpdateHint();
  }

  function reviewSave(event) {
    if (event) {
      event.preventDefault();
    }
    var err = document.getElementById('org-rv-err');
    var duelId = parseInt(document.getElementById('org-rv-duel').value, 10) || 0;
    var url = (document.getElementById('org-rv-url').value || '').trim();
    if (!duelId) {
      if (err) {
        err.hidden = false;
        err.textContent = 'Не указан поединок';
      }
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      if (err) {
        err.hidden = false;
        err.textContent = 'Нужна ссылка https://…';
      }
      return;
    }
    reviewPost('org_review_save', {
      id: document.getElementById('org-rv-id').value,
      situation_id: document.getElementById('org-rv-sit').value,
      duel_id: duelId,
      event_id: document.getElementById('org-rv-event').value,
      url: url,
      title: document.getElementById('org-rv-label').value,
      video_date: document.getElementById('org-rv-date').value
    }).then(function (res) {
      if (res.error) {
        throw new Error(res.error);
      }
      window.location.reload();
    }).catch(function (e) {
      if (err) {
        err.hidden = false;
        err.textContent = e.message || String(e);
      }
    });
  }

  function reviewDelete(opts) {
    var id = opts && (opts.id | 0);
    if (!id) {
      return;
    }
    if (!window.confirm('Удалить этот разбор?')) {
      return;
    }
    reviewPost('org_review_delete', { id: id }).then(function (res) {
      if (res.error) {
        throw new Error(res.error);
      }
      window.location.reload();
    }).catch(function (e) {
      window.alert(e.message || String(e));
    });
  }

  function bindReviews() {
    var grid = document.querySelector('.org-gg-wrap');
    var form = document.getElementById('org-rv-form');
    var cancel = document.getElementById('org-rv-cancel');
    var urlEl = document.getElementById('org-rv-url');
    var labEl = document.getElementById('org-rv-label');
    var editor = document.getElementById('org-rv-editor');
    if (!grid || !form) {
      return;
    }
    grid.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.nodeType === 3) {
        t = t.parentNode;
      }
      var btn = t && t.closest ? t.closest('[data-review-add],[data-review-edit],[data-review-delete]') : null;
      if (!btn) {
        return;
      }
      e.preventDefault();
      var opts = reviewOptsFromBtn(btn);
      if (btn.getAttribute('data-review-delete')) {
        reviewDelete(opts);
        return;
      }
      reviewFillEditor(opts);
      reviewShowEditor(true);
      if (urlEl) {
        urlEl.focus();
      }
    });
    form.addEventListener('submit', reviewSave);
    if (cancel) {
      cancel.addEventListener('click', function () {
        reviewShowEditor(false);
      });
    }
    if (editor) {
      editor.addEventListener('click', function (e) {
        if (e.target === editor) {
          reviewShowEditor(false);
        }
      });
    }
    if (urlEl) {
      urlEl.addEventListener('input', reviewUpdateHint);
    }
    if (labEl) {
      labEl.addEventListener('change', reviewUpdateHint);
    }
  }
  bindReviews();

  function markNeedFill(el, empty) {
    if (!el) {
      return;
    }
    if (empty) {
      el.classList.add('org-need-fill');
    } else {
      el.classList.remove('org-need-fill');
    }
  }

  function bindNeedFill() {
    var form = document.querySelector('.org-attrs-form');
    if (!form) {
      return;
    }
    var typeSel = form.querySelector('[name="event_type"]');
    function refresh() {
      var title = form.querySelector('[name="title"]');
      var date = form.querySelector('[name="starts_on"]');
      var zoom = form.querySelector('[name="zoom_url"]');
      var ref = form.querySelector('[name="referee_person_id"]');
      var plan = form.querySelector('[name="org_role[планированиеМероприятия]"]');
      var isTrain = typeSel && typeSel.value === 'обучение';
      markNeedFill(title, title && !String(title.value || '').trim());
      markNeedFill(date, date && !date.value);
      markNeedFill(zoom, zoom && !String(zoom.value || '').trim());
      markNeedFill(ref, ref && !isTrain && (!ref.value || ref.value === '0'));
      markNeedFill(plan, plan && (!plan.value || plan.value === '0'));
    }
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    refresh();
  }
  bindNeedFill();

  function bindTrainingType() {
    var form = document.querySelector('.org-attrs-form');
    var typeSel = form ? form.querySelector('[name="event_type"]') : null;
    var refSel = form ? form.querySelector('[name="referee_person_id"]') : null;
    if (!typeSel || !refSel) {
      return;
    }
    function parseIds(attr) {
      try {
        return JSON.parse(refSel.getAttribute(attr) || '[]');
      } catch (e) {
        return [];
      }
    }
    var arbiters = parseIds('data-arbiters');
    var trainers = parseIds('data-trainers');
    var trainLabel = refSel.getAttribute('data-train-label') || 'Ведущий';
    var defaultLabel = refSel.getAttribute('data-default-label') || 'Арбитр';

    function update() {
      var isTrain = typeSel.value === 'обучение';
      var allowed = isTrain ? trainers : arbiters;
      var row = refSel.closest('tr');
      var labelCell = row ? row.querySelector('.org-staff-role') : null;
      if (labelCell) {
        labelCell.textContent = isTrain ? trainLabel : defaultLabel;
      }
      var selectedHidden = false;
      Array.prototype.forEach.call(refSel.options, function (opt) {
        if (opt.value === '0') {
          return;
        }
        var show = allowed.indexOf(parseInt(opt.value, 10)) >= 0;
        opt.style.display = show ? '' : 'none';
        if (opt.selected && !show) {
          selectedHidden = true;
        }
      });
      if (selectedHidden) {
        refSel.value = '0';
      }
    }
    typeSel.addEventListener('change', update);
    update();
  }
  bindTrainingType();

  function bindCopyButtons() {
    var buttons = document.querySelectorAll('.org-copy-btn');
    if (!buttons.length) {
      return;
    }
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-copy') || '';
        if (!text) {
          return;
        }
        var done = function () {
          var old = btn.textContent;
          btn.textContent = 'Скопировано';
          btn.classList.add('is-copied');
          setTimeout(function () {
            btn.textContent = old;
            btn.classList.remove('is-copied');
          }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {});
        } else {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
            done();
          } catch (e) {}
          document.body.removeChild(ta);
        }
      });
    });
  }
  bindCopyButtons();

  var raw = document.getElementById('org-events-json');
  if (!raw) {
    return;
  }
  var data = JSON.parse(raw.textContent || '{}');
  var people = data.people || [];
  var situations = data.situations || [];

  people.sort(function (a, b) {
    if (!!a.applied !== !!b.applied) {
      return a.applied ? -1 : 1;
    }
    return String(a.name).localeCompare(String(b.name), 'ru');
  });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) {
      n.className = cls;
    }
    if (text != null) {
      n.textContent = text;
    }
    return n;
  }

  function personItems(skipApplied) {
    return people
      .filter(function (p) {
        return !skipApplied || !p.applied;
      })
      .map(function (p) {
        return {
          id: p.id,
          label: p.name,
          meta: p.applied ? 'заявка' : '',
        };
      });
  }

  function sitItems(type) {
    var items = situations.map(function (s) {
      return { id: s.id, label: s.label, meta: s.type || '', url: s.url || '' };
    });
    if (!type) {
      return items;
    }
    return items.slice().sort(function (a, b) {
      var am = a.meta === type ? 0 : 1;
      var bm = b.meta === type ? 0 : 1;
      return am - bm;
    });
  }

  function attachCombo(wrap) {
    var kind = wrap.getAttribute('data-combo') || '';
    var hidden = wrap.querySelector('input[type="hidden"]');
    var input = wrap.querySelector('input[type="text"]');
    if (!hidden || !input) {
      return;
    }
    var list = el('ul', 'org-suggest');
    list.hidden = true;
    wrap.appendChild(list);
    var skipApplied = kind === 'reg-add';
    var view = wrap.querySelector('.org-combo-view');
    var arrow = wrap.querySelector('.org-combo-arrow');
    var editOrig = null;
    if (view) {
      input.hidden = true;
    }

    function beginEdit() {
      if (!view) {
        return;
      }
      editOrig = { id: hidden.value, label: input.value };
      wrap.classList.add('is-editing');
      input.hidden = false;
      input.focus();
      input.select();
      shown();
    }

    function endEdit() {
      if (!view) {
        return;
      }
      wrap.classList.remove('is-editing');
      input.hidden = true;
    }

    function syncView() {
      if (!view) {
        return;
      }
      var id = parseInt(hidden.value, 10) || 0;
      if (kind === 'sit') {
        var foundSit = id > 0
          ? situations.find(function (x) {
              return x.id === id;
            })
          : null;
        view.textContent = foundSit ? foundSit.label : (input.value || '—');
        if (foundSit && foundSit.url) {
          view.setAttribute('href', foundSit.url);
        } else {
          view.removeAttribute('href');
        }
        return;
      }
      if (id > 0) {
        var found = people.find(function (x) {
          return x.id === id;
        });
        view.textContent = found ? found.name : input.value;
        view.setAttribute('href', '?p=org&s=people&person=' + id);
      } else {
        view.textContent = '—';
        view.removeAttribute('href');
      }
    }

    if (view) {
      var viewClickTimer = null;
      view.addEventListener('click', function (e) {
        var href = view.getAttribute('href') || '';
        e.preventDefault();
        if (!href || viewClickTimer) {
          return;
        }
        viewClickTimer = setTimeout(function () {
          viewClickTimer = null;
          window.open(href, '_blank', 'noopener');
        }, 250);
      });
      view.addEventListener('dblclick', function (e) {
        e.preventDefault();
        if (viewClickTimer) {
          clearTimeout(viewClickTimer);
          viewClickTimer = null;
        }
        beginEdit();
      });
    }
    if (arrow) {
      arrow.addEventListener('click', function (e) {
        e.preventDefault();
        beginEdit();
      });
    }

    function items() {
      if (kind === 'sit') {
        var row = wrap.closest('tr');
        var typeSel = row ? row.querySelector('select[name="duel_type[]"]') : null;
        return sitItems(typeSel ? typeSel.value : '');
      }
      return personItems(skipApplied);
    }

    function close() {
      list.hidden = true;
      list.replaceChildren();
    }

    function pick(it) {
      hidden.value = String(it.id || 0);
      input.value = it.label || '';
      close();
      if (view) {
        syncView();
        endEdit();
      }
      if (kind === 'reg-add' && it.id) {
        var form = wrap.closest('form');
        if (form) {
          form.submit();
        }
      }
    }

    function shown() {
      var q = input.value.trim().toLowerCase();
      var hits = items()
        .filter(function (it) {
          return !q || String(it.label).toLowerCase().indexOf(q) !== -1;
        });
      if (kind !== 'sit') {
        hits = hits.slice(0, 12);
      }
      list.replaceChildren();
      if (kind !== 'reg-add' && hidden.value !== '0' && hidden.value !== '') {
        var clr = el('li', '', '—');
        clr.addEventListener('mousedown', function (e) {
          e.preventDefault();
          hidden.value = '0';
          input.value = '';
          close();
          if (view) {
            syncView();
            endEdit();
          }
        });
        list.appendChild(clr);
      }
      hits.forEach(function (it, idx) {
        var li = el('li', idx === 0 ? 'is-on' : '');
        li.appendChild(document.createTextNode(it.label));
        if (it.meta) {
          li.appendChild(el('span', 'org-sug-meta', it.meta));
        }
        li.addEventListener('mousedown', function (e) {
          e.preventDefault();
          pick(it);
        });
        list.appendChild(li);
      });
      list.hidden = !list.childNodes.length;
    }

    input.addEventListener('input', function () {
      if (!input.value.trim()) {
        hidden.value = '0';
      } else if (kind === 'sit') {
        var typed = input.value.trim();
        var hit = items().some(function (it) {
          return it.label === typed;
        });
        if (!hit) {
          hidden.value = '0';
        }
      }
      shown();
    });
    input.addEventListener('focus', shown);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (view) {
          if (editOrig) {
            hidden.value = editOrig.id;
            input.value = editOrig.label;
          }
          syncView();
          endEdit();
        }
        close();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (kind === 'sit') {
          var typed = input.value.trim();
          var exact = items().filter(function (it) {
            return it.label === typed;
          })[0];
          if (exact) {
            pick(exact);
          } else {
            hidden.value = '0';
            close();
          }
          return;
        }
        var first = list.querySelector('li.is-on') || list.querySelector('li');
        if (first && !list.hidden) {
          first.dispatchEvent(new Event('mousedown'));
        }
      }
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        close();
        if (kind === 'reg-add') {
          return;
        }
        var id = parseInt(hidden.value, 10) || 0;
        if (kind === 'sit' && !id) {
          return;
        }
        if (!id) {
          input.value = '';
          return;
        }
        var pool = kind === 'sit' ? situations : people;
        var found = pool.find(function (x) {
          return x.id === id;
        });
        input.value = found ? found.label || found.name || '' : '';
        if (view) {
          syncView();
          endEdit();
        }
      }, 120);
    });
  }

  document.querySelectorAll('.org-combo').forEach(attachCombo);

  function bindRegEdit() {
    document.querySelectorAll('.org-reg-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('[data-reg-row]');
        if (!row) {
          return;
        }
        var rid = row.getAttribute('data-reg-row');
        var editRow = document.querySelector('[data-reg-edit="' + rid + '"]');
        if (editRow) {
          row.hidden = true;
          editRow.hidden = false;
        }
      });
    });
    document.querySelectorAll('.org-reg-edit-cancel').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var editRow = btn.closest('[data-reg-edit]');
        if (!editRow) {
          return;
        }
        var rid = editRow.getAttribute('data-reg-edit');
        var row = document.querySelector('[data-reg-row="' + rid + '"]');
        editRow.hidden = true;
        if (row) {
          row.hidden = false;
        }
      });
    });
  }
  bindRegEdit();

  function bindRegTypePref() {
    document.querySelectorAll('.org-reg-edit-form').forEach(function (form) {
      var play = form.querySelector('input[name="wants_play"]');
      var typeSel = form.querySelector('select[name="duel_type_pref"]');
      if (!play || !typeSel) {
        return;
      }
      function toggle() {
        typeSel.disabled = !play.checked;
        if (!play.checked) {
          typeSel.value = '';
        }
      }
      play.addEventListener('change', toggle);
      toggle();
    });
  }
  bindRegTypePref();

  function bindSlotsClear() {
    var form = document.getElementById('org-slots-clear-form');
    if (!form) {
      return;
    }
    form.addEventListener('submit', function (e) {
      if (!window.confirm('Очистить сетку? Будут сняты игроки и секунданты со всех незафиксированных слотов (типы, судьи и зафиксированные пары сохранятся).')) {
        e.preventDefault();
      }
    });
  }
  bindSlotsClear();

  function bindRegConfirms() {
    var form = document.getElementById('org-reg-confirm-form');
    if (!form) {
      return;
    }
    var pidField = form.querySelector('input[name="person_id"]');
    var valField = form.querySelector('input[name="confirmed"]');
    var boxes = document.querySelectorAll('.org-confirm-box');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].addEventListener('change', function () {
        pidField.value = this.getAttribute('data-pid');
        valField.value = this.checked ? '1' : '0';
        form.submit();
      });
    }
  }
  bindRegConfirms();

  function bindSlotDates() {
    var WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    document.addEventListener('click', function (e) {
      var cell = e.target && e.target.closest ? e.target.closest('.org-date-cell') : null;
      if (!cell) {
        return;
      }
      var input = cell.querySelector('.org-date-input');
      if (!input) {
        return;
      }
      if (typeof input.showPicker === 'function') {
        e.preventDefault();
        try {
          input.showPicker();
        } catch (err) {
          input.style.opacity = '1';
          input.focus();
        }
      }
    });
    document.addEventListener('change', function (e) {
      var input = e.target;
      if (!input || !input.classList || !input.classList.contains('org-date-input')) {
        return;
      }
      var cell = input.closest('.org-date-cell');
      var view = cell ? cell.querySelector('.org-date-view') : null;
      if (!view || !input.value) {
        return;
      }
      var parts = input.value.split('-');
      var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      view.textContent = isNaN(d.getTime()) ? '' : WD[d.getDay()];
      cell.title = input.value;
    });
  }
  bindSlotDates();

  function initTypeCombos() {
    var combos = document.querySelectorAll('.org-type-combo');
    if (!combos.length) {
      return;
    }
    var openMenu = null;
    var openCombo = null;

    function closeMenu() {
      if (!openMenu) {
        return;
      }
      openMenu.hidden = true;
      openMenu.removeAttribute('style');
      if (openCombo) {
        openCombo.appendChild(openMenu);
      }
      openMenu = null;
      openCombo = null;
    }

    Array.prototype.forEach.call(combos, function (combo) {
      var btn = combo.querySelector('.org-type-btn');
      var menu = combo.querySelector('.org-type-menu');
      var input = combo.querySelector('input[type="hidden"]');
      if (!btn || !menu || !input) {
        return;
      }
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (openMenu === menu) {
          closeMenu();
          return;
        }
        closeMenu();
        var r = btn.getBoundingClientRect();
        document.body.appendChild(menu);
        menu.hidden = false;
        menu.style.position = 'fixed';
        menu.style.left = Math.round(r.left) + 'px';
        menu.style.top = Math.round(r.bottom + 2) + 'px';
        openMenu = menu;
        openCombo = combo;
      });
      menu.addEventListener('click', function (e) {
        e.stopPropagation();
        var opt = e.target.closest ? e.target.closest('button[data-value]') : null;
        if (!opt) {
          return;
        }
        var val = opt.getAttribute('data-value');
        var optIcon = opt.querySelector('i');
        var optLabel = opt.querySelector('span');
        input.value = val;
        btn.title = optLabel ? optLabel.textContent : val;
        btn.setAttribute('aria-label', btn.title);
        var btnIcon = btn.querySelector('i');
        if (btnIcon && optIcon) {
          btnIcon.className = optIcon.className;
        }
        Array.prototype.forEach.call(menu.querySelectorAll('button'), function (b) {
          b.classList.toggle('is-on', b === opt);
        });
        closeMenu();
      });
    });

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeMenu();
      }
    });
  }
  initTypeCombos();

  function initEventSplitters() {
    var KEY = 'org-ev-sizes';
    var saved = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(KEY) || '{}') || {};
    } catch (e) {
      saved = {};
    }
    var defs = {
      side: {
        box: '.org-ev-main',
        pane: '.org-ev-col-side',
        cssVar: '--org-side-w',
        min: 240,
        max: 620
      },
      recs: {
        box: '.org-ev-split',
        pane: '.org-ev-recs',
        cssVar: '--org-recs-w',
        min: 180,
        max: 480
      }
    };
    function save() {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(saved));
      } catch (e) {}
    }
    Object.keys(defs).forEach(function (key) {
      var def = defs[key];
      var box = document.querySelector(def.box);
      var handle = document.querySelector('.org-splitter[data-org-resize="' + key + '"]');
      var pane = box ? box.querySelector(def.pane) : null;
      if (!box || !handle || !pane) {
        return;
      }
      if (saved[key]) {
        box.style.setProperty(def.cssVar, saved[key] + 'px');
      }

      handle.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) {
          return;
        }
        e.preventDefault();
        var startX = e.clientX;
        var startW = pane.getBoundingClientRect().width;
        handle.classList.add('is-dragging');
        document.body.classList.add('org-resizing');
        function move(ev) {
          var w = Math.round(startW - (ev.clientX - startX));
          w = Math.max(def.min, Math.min(def.max, w));
          box.style.setProperty(def.cssVar, w + 'px');
        }
        function up() {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          handle.classList.remove('is-dragging');
          document.body.classList.remove('org-resizing');
          var w = parseFloat(box.style.getPropertyValue(def.cssVar)) || 0;
          if (w > 0) {
            saved[key] = Math.round(w);
            save();
          }
        }
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });

      handle.addEventListener('dblclick', function () {
        box.style.removeProperty(def.cssVar);
        delete saved[key];
        save();
      });

      handle.addEventListener('keydown', function (e) {
        var step = e.shiftKey ? 40 : 16;
        var cur = pane.getBoundingClientRect().width;
        if (e.key === 'ArrowLeft') {
          cur += step;
        } else if (e.key === 'ArrowRight') {
          cur -= step;
        } else {
          return;
        }
        e.preventDefault();
        cur = Math.max(def.min, Math.min(def.max, Math.round(cur)));
        box.style.setProperty(def.cssVar, cur + 'px');
        saved[key] = cur;
        save();
      });
    });
  }
  initEventSplitters();
})();
