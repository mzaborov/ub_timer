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
    function refresh() {
      var title = form.querySelector('[name="title"]');
      var date = form.querySelector('[name="starts_on"]');
      var zoom = form.querySelector('[name="zoom_url"]');
      var ref = form.querySelector('[name="referee_person_id"]');
      var plan = form.querySelector('[name="org_role[планированиеМероприятия]"]');
      markNeedFill(title, title && !String(title.value || '').trim());
      markNeedFill(date, date && !date.value);
      markNeedFill(zoom, zoom && !String(zoom.value || '').trim());
      markNeedFill(ref, ref && (!ref.value || ref.value === '0'));
      markNeedFill(plan, plan && (!plan.value || plan.value === '0'));
    }
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    refresh();
  }
  bindNeedFill();

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

  var gen = document.getElementById('org-gen-pairs');
  var msg = document.getElementById('org-gen-msg');
  if (gen && msg) {
    gen.addEventListener('click', function () {
      msg.hidden = false;
    });
  }
})();
