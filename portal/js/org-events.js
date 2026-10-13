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
      return { id: s.id, label: s.label, meta: s.type || '' };
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
})();
