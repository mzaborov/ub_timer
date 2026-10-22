(function () {
  var raw = document.getElementById('org-people-json');
  var tree = document.getElementById('org-people-tree');
  var ul = document.getElementById('org-people-ul');
  var countEl = document.getElementById('org-people-count');
  var card = document.getElementById('org-people-card');
  var qEl = document.getElementById('org-people-q');
  var addBox = document.getElementById('org-people-add');
  var newBox = document.getElementById('org-people-new');
  var newBtn = document.getElementById('org-people-new-btn');
  var errEl = document.getElementById('org-people-err');
  var csrfEl = document.getElementById('org-people-csrf');
  if (!raw || !tree || !ul || !card || !csrfEl) {
    return;
  }
  var data = JSON.parse(raw.textContent || '{}');
  var people = data.people || [];
  var circles = data.circles || [];
  var funnel = data.funnel || { stages: [], goals: [], note: '' };
  var selected = { all: true };
  var personId = 0;
  var statsCache = {};
  var statsBusy = {};
  var statsFailed = {};
  var query = '';
  var draftInv = null;
  var newOpen = false;
  var busy = false;
  var peopleTab = 'list';
  var listPane = document.getElementById('org-people-list-pane');
  var funnelPane = document.getElementById('org-people-funnel-pane');
  var hintEl = document.getElementById('org-people-hint');
  var funnelChart = document.getElementById('org-funnel-chart');
  var funnelGoals = document.getElementById('org-funnel-goals');
  var funnelNote = document.getElementById('org-funnel-note');
  var funnelUl = document.getElementById('org-funnel-ul');
  var funnelNamesH = document.getElementById('org-funnel-names-h');
  var funnelPick = null;
  var peopleById = {};
  people.forEach(function (p) {
    peopleById[p.id] = p;
  });

  function capFirst(s) {
    s = String(s || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

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

  function svgIcon(id) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function invKey(cid, inv) {
    return 'i:' + cid + ':' + encodeURIComponent(inv);
  }

  function parseNode(key) {
    if (key === 'all') {
      return { type: 'all' };
    }
    if (key.indexOf('c:') === 0) {
      return { type: 'circle', id: parseInt(key.slice(2), 10) };
    }
    if (key.indexOf('i:') === 0) {
      var rest = key.slice(2);
      var i = rest.indexOf(':');
      return {
        type: 'inv',
        circleId: parseInt(rest.slice(0, i), 10),
        inv: decodeURIComponent(rest.slice(i + 1)),
      };
    }
    return { type: 'all' };
  }

  function selectedKeys() {
    return Object.keys(selected).filter(function (k) {
      return selected[k];
    });
  }

  function soleInv() {
    var keys = selectedKeys();
    if (keys.length !== 1) {
      return null;
    }
    var n = parseNode(keys[0]);
    return n.type === 'inv' ? n : null;
  }

  function showErr(msg) {
    if (!errEl) {
      return;
    }
    errEl.hidden = !msg;
    errEl.textContent = msg || '';
  }

  function circleInvs(cid) {
    var c = circles.find(function (x) {
      return x.id === cid;
    });
    return c ? Object.keys(c.involvements || {}) : [];
  }

  function matchPerson(p) {
    var keys = selectedKeys();
    if (!keys.length || selected.all) {
      return true;
    }
    return keys.some(function (key) {
      var n = parseNode(key);
      if (n.type === 'circle') {
        return p.memberships.some(function (m) {
          return m.circleId === n.id;
        });
      }
      if (n.type === 'inv') {
        return p.memberships.some(function (m) {
          return m.circleId === n.circleId && m.involvement === n.inv;
        });
      }
      return true;
    });
  }

  function visible() {
    var qq = query.trim().toLowerCase();
    return people.filter(function (p) {
      return matchPerson(p) && (!qq || p.name.toLowerCase().indexOf(qq) !== -1);
    });
  }

  function applyData(next) {
    people = next.people || [];
    circles = next.circles || [];
    funnel = next.funnel || { stages: [], goals: [], note: '' };
    peopleById = {};
    people.forEach(function (p) {
      peopleById[p.id] = p;
    });
    if (draftInv) {
      var still = circleInvs(draftInv.circleId).indexOf(draftInv.inv) !== -1;
      if (still) {
        draftInv = null;
      }
    }
    renderAll();
  }

  function api(action, fields, beforeApply) {
    if (busy) {
      return Promise.reject(new Error('busy'));
    }
    busy = true;
    var body = new URLSearchParams();
    body.set('csrf', csrfEl.value);
    body.set('ajax', '1');
    body.set('action', action);
    Object.keys(fields).forEach(function (k) {
      body.set(k, fields[k]);
    });
    return fetch(window.location.pathname + window.location.search, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
      credentials: 'same-origin',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (res) {
        busy = false;
        if (res.error) {
          showErr(res.error);
          throw new Error(res.error);
        }
        showErr('');
        if (typeof beforeApply === 'function') {
          beforeApply(res);
        }
        if (res.data) {
          applyData(res.data);
        }
        return res;
      })
      .catch(function (e) {
        busy = false;
        if (e.message !== 'busy' && !errEl.textContent) {
          showErr(e.message || 'Не удалось сохранить');
        }
        throw e;
      });
  }

  function renderAll() {
    renderTree();
    renderList();
    renderNewForm();
    renderAddBar();
    renderFunnel();
    renderCard();
  }

  function openFunnelList(title, ids, kind, key) {
    funnelPick = { title: title, ids: ids || [], kind: kind, key: key };
    renderFunnel();
  }

  function setPeopleTab(tab) {
    peopleTab = tab === 'funnel' ? 'funnel' : 'list';
    document.querySelectorAll('[data-people-tab]').forEach(function (btn) {
      btn.classList.toggle('is-on', btn.getAttribute('data-people-tab') === peopleTab);
    });
    if (listPane) {
      listPane.hidden = peopleTab !== 'list';
    }
    if (funnelPane) {
      funnelPane.hidden = peopleTab !== 'funnel';
    }
    if (hintEl) {
      hintEl.hidden = peopleTab !== 'list';
    }
    if (card) {
      card.hidden = peopleTab !== 'list';
    }
    var url = new URL(window.location.href);
    if (peopleTab === 'funnel') {
      url.searchParams.set('v', 'funnel');
    } else {
      url.searchParams.delete('v');
    }
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  function renderFunnel() {
    if (funnelNote) {
      funnelNote.textContent = funnel.note || '';
    }
    if (funnelGoals) {
      funnelGoals.replaceChildren.apply(
        funnelGoals,
        (funnel.goals || []).map(function (g) {
          var box = el(
            'button',
            'org-funnel-goal' + (funnelPick && funnelPick.kind === 'goal' && funnelPick.key === g.key ? ' is-on' : '')
          );
          box.type = 'button';
          if (g.hint) {
            box.title = g.hint;
          }
          box.appendChild(el('span', 'org-funnel-goal-n', String((g.ids || []).length)));
          box.appendChild(el('span', 'org-funnel-goal-t', g.title));
          box.addEventListener('click', function () {
            openFunnelList(g.title, g.ids, 'goal', g.key);
          });
          return box;
        })
      );
    }
    if (funnelChart) {
      var stages = funnel.stages || [];
      var n = Math.max(stages.length, 1);
      funnelChart.replaceChildren.apply(
        funnelChart,
        stages.map(function (s, i) {
          var top = 3 + i * (26 / n);
          var bot = 3 + (i + 1) * (26 / n);
          var band = el(
            'button',
            'org-funnel-band org-funnel-band-' +
              s.key +
              (funnelPick && funnelPick.kind === 'stage' && funnelPick.key === s.key ? ' is-on' : '')
          );
          band.type = 'button';
          if (s.hint) {
            band.title = s.hint;
          }
          band.style.setProperty('--in-t', top + '%');
          band.style.setProperty('--in-b', bot + '%');
          band.appendChild(el('span', 'org-funnel-band-title', s.title));
          band.appendChild(el('span', 'org-funnel-band-n', String((s.ids || []).length)));
          band.addEventListener('click', function () {
            openFunnelList(s.title, s.ids, 'stage', s.key);
          });
          return band;
        })
      );
    }
    if (funnelNamesH) {
      funnelNamesH.textContent = funnelPick
        ? funnelPick.title + ' · ' + funnelPick.ids.length
        : 'Клик по ступени или цифре';
    }
    if (funnelUl) {
      var rows = [];
      if (funnelPick) {
        rows = funnelPick.ids
          .map(function (id) {
            return peopleById[id];
          })
          .filter(Boolean)
          .sort(function (a, b) {
            return a.name.localeCompare(b.name, 'ru');
          });
      }
      funnelUl.replaceChildren.apply(
        funnelUl,
        rows.map(function (p) {
          var li = el('li', 'org-funnel-item');
          li.appendChild(el('span', 'org-funnel-name', p.name));
          var tg = (p.telegram || '').replace(/^@/, '');
          if (tg) {
            var a = document.createElement('a');
            a.className = 'org-funnel-tg';
            a.href = 'https://t.me/' + tg;
            a.target = '_blank';
            a.rel = 'noopener';
            a.title = 'Написать в Telegram' + (p.telegram ? ': ' + p.telegram : '');
            a.setAttribute('aria-label', 'Написать в Telegram: ' + p.name);
            a.appendChild(svgIcon('i-telegram'));
            li.appendChild(a);
          }
          if (p.telegram_id) {
            var aid = document.createElement('a');
            aid.className = 'org-funnel-tg org-funnel-tg--id';
            aid.href = 'tg://user?id=' + p.telegram_id;
            aid.title = 'Открыть чат по Telegram ID ' + p.telegram_id + ' (может не сработать, нужен Telegram)';
            aid.setAttribute('aria-label', 'Telegram по ID: ' + p.name);
            aid.appendChild(svgIcon('i-id'));
            li.appendChild(aid);
          }
          return li;
        })
      );
    }
  }

  function startRename(row, value, onSave) {
    var input = el('input', 'org-tree-edit');
    input.value = value;
    input.setAttribute('aria-label', 'Новое название');
    row.replaceChildren(input);
    input.focus();
    input.select();
    var done = false;
    function finish(ok) {
      if (done) {
        return;
      }
      done = true;
      var next = input.value.trim();
      if (ok && next && next !== value) {
        onSave(next);
      } else {
        renderTree();
      }
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', function () {
      finish(true);
    });
  }

  var collapsed = new Set();
  (function initCollapsed() {
    circles.forEach(function (c) {
      if (c.kind === 'group') {
        collapsed.add(c.id);
      }
    });
  })();

  function renderTree() {
    tree.replaceChildren();
    var toolbar = el('div', 'org-tree-toolbar');
    [
      { label: 'Свернуть всё', action: 'collapse-all' },
      { label: 'Развернуть всё', action: 'expand-all' },
      { label: 'Группы', action: 'toggle-groups' },
    ].forEach(function (btn) {
      var b = el('button', 'org-tree-toolbar-btn', btn.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (btn.action === 'collapse-all') {
          circles.forEach(function (c) { collapsed.add(c.id); });
        } else if (btn.action === 'expand-all') {
          collapsed.clear();
        } else if (btn.action === 'toggle-groups') {
          circles.forEach(function (c) {
            if (c.kind === 'group') {
              if (collapsed.has(c.id)) collapsed.delete(c.id); else collapsed.add(c.id);
            }
          });
        }
        renderTree();
      });
      toolbar.appendChild(b);
    });
    tree.appendChild(toolbar);

    var all = el('div', 'org-tree-node' + (selected.all ? ' is-on' : ''));
    all.setAttribute('data-node', 'all');
    all.setAttribute('role', 'button');
    all.tabIndex = 0;
    all.appendChild(el('span', 'org-tree-title', 'Все'));
    all.appendChild(el('span', 'org-tree-n', String(people.length)));
    tree.appendChild(all);

    var byParent = {};
    circles.forEach(function (c) {
      var pid = c.parentId == null ? 0 : c.parentId;
      byParent[pid] = byParent[pid] || [];
      byParent[pid].push(c);
    });

    function renderCircle(c, container) {
      var wrap = el('div', 'org-tree-circle' + (c.kind ? ' org-tree-kind-' + c.kind : ''));
      var row = el('div', 'org-tree-row');

      var names = circleInvs(c.id);
      if (draftInv && draftInv.circleId === c.id && names.indexOf(draftInv.inv) === -1) {
        names = names.concat([draftInv.inv]);
      }
      var childCircles = byParent[c.id] || [];
      var hasKids = names.length > 0 || childCircles.length > 0;
      var isCollapsed = collapsed.has(c.id);

      if (hasKids) {
        var toggle = el('button', 'org-tree-toggle' + (isCollapsed ? ' is-collapsed' : ''), isCollapsed ? '▶' : '▼');
        toggle.type = 'button';
        toggle.title = isCollapsed ? 'Развернуть' : 'Свернуть';
        toggle.addEventListener('click', function (e) {
          e.stopPropagation();
          if (collapsed.has(c.id)) {
            collapsed.delete(c.id);
          } else {
            collapsed.add(c.id);
          }
          renderTree();
        });
        row.appendChild(toggle);
      }

      var node = el('div', 'org-tree-node' + (selected['c:' + c.id] ? ' is-on' : ''));
      node.setAttribute('data-node', 'c:' + c.id);
      node.setAttribute('role', 'button');
      node.tabIndex = 0;
      node.appendChild(el('span', 'org-tree-title', c.title));
      node.appendChild(el('span', 'org-tree-n', String(c.members)));
      var pen = el('button', 'org-tree-pen', '✎');
      pen.type = 'button';
      pen.title = 'Переименовать круг';
      pen.addEventListener('click', function (e) {
        e.stopPropagation();
        startRename(row, c.title, function (title) {
          api('org_circle_rename', { circle_id: String(c.id), title: title }).catch(function () {});
        });
      });
      row.appendChild(node);
      row.appendChild(pen);
      wrap.appendChild(row);

      var kids = el('div', 'org-tree-kids' + (isCollapsed ? ' is-collapsed' : ''));

      names.forEach(function (inv) {
        var key = invKey(c.id, inv);
        var irow = el('div', 'org-tree-row');
        var inode = el(
          'div',
          'org-tree-node org-tree-inv' + (selected[key] ? ' is-on' : '')
        );
        inode.setAttribute('data-node', key);
        inode.setAttribute('role', 'button');
        inode.tabIndex = 0;
        inode.appendChild(el('span', 'org-tree-title', inv));
        var cnt = (c.involvements && c.involvements[inv]) || 0;
        inode.appendChild(el('span', 'org-tree-n', String(cnt)));
        var ipen = el('button', 'org-tree-pen', '✎');
        ipen.type = 'button';
        ipen.title = 'Переименовать участие';
        ipen.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!cnt) {
            return;
          }
          startRename(irow, inv, function (title) {
            var newKey = invKey(c.id, title);
            var prev = selected;
            api(
              'org_inv_rename',
              {
                circle_id: String(c.id),
                old: inv,
                title: title,
              },
              function () {
                selected = {};
                selected[newKey] = true;
              }
            ).catch(function () {
              selected = prev;
              renderAll();
            });
          });
        });
        var ix = el('button', 'org-tree-x', '×');
        ix.type = 'button';
        ix.title = 'Удалить участие';
        ix.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!cnt) {
            return;
          }
          if (!confirm('Убрать участие «' + inv + '» у ' + cnt + ' человек?')) {
            return;
          }
          var delKey = key;
          api(
            'org_inv_delete',
            {
              circle_id: String(c.id),
              involvement: inv,
            },
            function () {
              if (selected[delKey]) {
                selected = { all: true };
              }
              if (draftInv && draftInv.circleId === c.id && draftInv.inv === inv) {
                draftInv = null;
              }
            }
          ).catch(function () {});
        });
        irow.appendChild(inode);
        if (cnt) {
          irow.appendChild(ipen);
          irow.appendChild(ix);
        }
        kids.appendChild(irow);
      });

      var addInv = el('button', 'org-tree-add', '+ участие');
      addInv.type = 'button';
      addInv.addEventListener('click', function (e) {
        e.stopPropagation();
        var input = el('input', 'org-tree-edit');
        input.placeholder = 'новое участие';
        addInv.replaceWith(input);
        input.focus();
        function commit() {
          var name = input.value.trim();
          if (!name) {
            renderTree();
            return;
          }
          draftInv = { circleId: c.id, inv: name };
          selected = {};
          selected[invKey(c.id, name)] = true;
          renderAll();
          var addInput = addBox && addBox.querySelector('input');
          if (addInput) {
            addInput.focus();
          }
        }
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            commit();
          }
          if (ev.key === 'Escape') {
            ev.preventDefault();
            renderTree();
          }
        });
        input.addEventListener('blur', function () {
          if (document.activeElement !== input) {
            commit();
          }
        });
      });
      kids.appendChild(addInv);

      childCircles.forEach(function (child) {
        renderCircle(child, kids);
      });

      wrap.appendChild(kids);
      container.appendChild(wrap);
    }

    var roots = byParent[0] || [];
    roots.forEach(function (c) {
      renderCircle(c, tree);
    });
  }

  function renderList() {
    var rows = visible();
    countEl.textContent = rows.length + ' чел.';
    ul.replaceChildren.apply(
      ul,
      rows.map(function (p) {
        var li = document.createElement('li');
        li.className =
          'org-people-li' + (p.id === personId ? ' is-on' : '') + (p.active ? '' : ' is-off');
        li.setAttribute('data-id', String(p.id));
        var name = el('span', 'org-people-name', p.name);
        var meta = el('span', 'org-people-meta');
        var labels = [];
        p.memberships.forEach(function (m) {
          if (labels.indexOf(m.circle) === -1) {
            labels.push(m.circle);
          }
        });
        meta.textContent = labels.join(' · ');
        li.appendChild(name);
        li.appendChild(meta);
        return li;
      })
    );
    if (personId && !rows.some(function (p) { return p.id === personId; })) {
      personId = 0;
    }
  }

  function attachSuggest(input, items, onPick, allowFree) {
    var list = el('ul', 'org-suggest');
    list.hidden = true;
    input.parentNode.appendChild(list);

    function close() {
      list.hidden = true;
      list.replaceChildren();
    }

    function shown() {
      var q = input.value.trim().toLowerCase();
      var hits = items.filter(function (it) {
        return !q || it.label.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 12);
      list.replaceChildren();
      hits.forEach(function (it, idx) {
        var li = el('li', idx === 0 ? 'is-on' : '', it.label);
        li.addEventListener('mousedown', function (e) {
          e.preventDefault();
          onPick(it);
          input.value = '';
          close();
        });
        list.appendChild(li);
      });
      list.hidden = !hits.length;
    }

    input.addEventListener('input', shown);
    input.addEventListener('focus', shown);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        var first = list.querySelector('li');
        if (first && !list.hidden) {
          first.dispatchEvent(new Event('mousedown'));
          return;
        }
        if (allowFree && input.value.trim()) {
          onPick({ label: input.value.trim(), value: input.value.trim() });
          input.value = '';
          close();
        }
      }
    });
    input.addEventListener('blur', function () {
      setTimeout(close, 120);
    });
  }

  function renderNewForm() {
    if (!newBox) {
      return;
    }
    newBox.replaceChildren();
    if (!newOpen) {
      newBox.hidden = true;
      return;
    }
    newBox.hidden = false;
    var form = document.createElement('form');
    var name = el('input', 'org-people-q');
    name.placeholder = 'ФИО';
    name.setAttribute('aria-label', 'ФИО');
    name.autocomplete = 'off';
    name.required = true;
    var email = el('input', 'org-people-q');
    email.placeholder = 'email';
    email.setAttribute('aria-label', 'email');
    email.autocomplete = 'off';
    var tg = el('input', 'org-people-q');
    tg.placeholder = 'telegram';
    tg.setAttribute('aria-label', 'telegram');
    tg.autocomplete = 'off';
    var save = el('button', 'org-people-new-save', 'Создать');
    save.type = 'submit';
    var cancel = el('button', 'org-people-new-cancel', 'Отмена');
    cancel.type = 'button';
    cancel.addEventListener('click', function () {
      newOpen = false;
      renderNewForm();
    });
    form.appendChild(name);
    form.appendChild(email);
    form.appendChild(tg);
    form.appendChild(save);
    form.appendChild(cancel);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fullName = name.value.trim();
      if (!fullName) {
        showErr('Нужно ФИО');
        name.focus();
        return;
      }
      api(
        'org_person_add',
        {
          full_name: fullName,
          email: email.value.trim(),
          telegram: tg.value.trim(),
        },
        function (res) {
          newOpen = false;
          query = '';
          if (qEl) {
            qEl.value = '';
          }
          selected = { all: true };
          if (res.person_id) {
            personId = parseInt(res.person_id, 10) || 0;
          }
        }
      ).catch(function () {});
    });
    newBox.appendChild(form);
    name.focus();
  }

  function renderAddBar() {
    if (!addBox) {
      return;
    }
    var inv = soleInv();
    addBox.replaceChildren();
    if (!inv) {
      addBox.hidden = true;
      return;
    }
    addBox.hidden = false;
    addBox.appendChild(el('span', 'muted', 'Добавить в это участие'));
    var wrap = el('div', 'org-suggest-wrap');
    var input = el('input', 'org-people-q');
    input.placeholder = 'фамилия…';
    input.autocomplete = 'off';
    wrap.appendChild(input);
    addBox.appendChild(wrap);
    var taken = {};
    people.forEach(function (p) {
      if (
        p.memberships.some(function (m) {
          return m.circleId === inv.circleId && m.involvement === inv.inv;
        })
      ) {
        taken[p.id] = true;
      }
    });
    var items = people
      .filter(function (p) {
        return !taken[p.id];
      })
      .map(function (p) {
        return { label: p.name, value: String(p.id) };
      });
    attachSuggest(input, items, function (it) {
      api('org_mem_add', {
        circle_id: String(inv.circleId),
        person_id: it.value,
        involvement: inv.inv,
      }).catch(function () {});
    }, false);
  }

  function addRow(dl, k, v, href) {
    if (!v) {
      return;
    }
    dl.appendChild(el('dt', '', k));
    var dd = el('dd');
    if (href) {
      var a = document.createElement('a');
      a.href = href;
      a.textContent = v;
      dd.appendChild(a);
    } else {
      dd.textContent = v;
    }
    dl.appendChild(dd);
  }

  function loadStats(pid) {
    if (statsCache[pid] || statsBusy[pid] || statsFailed[pid]) {
      return;
    }
    statsBusy[pid] = true;
    var body = new URLSearchParams();
    body.set('csrf', csrfEl.value);
    body.set('ajax', '1');
    body.set('action', 'org_person_stats');
    body.set('person_id', String(pid));
    fetch(window.location.pathname + window.location.search, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
      credentials: 'same-origin',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (res) {
        statsBusy[pid] = false;
        if (res && res.stats) {
          statsCache[pid] = res.stats;
          if (personId === pid) {
            renderCard();
          }
        }
      })
      .catch(function () {
        statsBusy[pid] = false;
        statsFailed[pid] = true;
        if (personId === pid) {
          renderCard();
        }
      });
  }

  function statsLine(label, value) {
    var li = el('li');
    li.appendChild(el('span', '', label));
    li.appendChild(el('b', '', String(parseInt(value, 10) || 0)));
    return li;
  }

  function renderPersonStats(p) {
    var box = el('div', 'org-person-mystats');
    box.appendChild(el('h3', '', 'Статистика'));
    var st = statsCache[p.id];
    if (!st) {
      box.appendChild(
        el(
          'p',
          'org-person-mystats-empty',
          statsFailed[p.id] ? 'Статистика недоступна' : 'Загрузка статистики…'
        )
      );
      loadStats(p.id);
      return box;
    }
    var body = el('div', 'org-person-mystats-body');
    var kpis = el('ul', 'stats-kpis');
    kpis.appendChild(statsLine('Играл', st.played));
    kpis.appendChild(statsLine('Секундировал', st.seconded));
    kpis.appendChild(statsLine('Судил', st.judged));
    kpis.appendChild(statsLine('Участие в турнирах', st.tournaments));
    kpis.appendChild(statsLine('Выиграл', st.won));
    kpis.appendChild(statsLine('Проиграл', st.lost));
    body.appendChild(kpis);
    var rivalsCol = el('div', 'stats-rivals-col');
    rivalsCol.appendChild(el('h4', '', 'С кем играл'));
    var rivals = st.rivals || [];
    if (!rivals.length) {
      rivalsCol.appendChild(el('p', 'org-person-mystats-empty', 'Пока нет поединков игроком.'));
    } else {
      var line = el('p', 'stats-rivals');
      rivals.forEach(function (rv, i) {
        if (i) {
          line.appendChild(document.createTextNode(', '));
        }
        var tone = rv.tone === 'win' || rv.tone === 'lose' ? rv.tone : 'even';
        var span = el('span', 'rival rival--' + tone);
        span.appendChild(document.createTextNode(rv.name));
        var n = parseInt(rv.n, 10) || 0;
        if (n > 0) {
          span.appendChild(el('span', 'n', ' (' + n + ')'));
        }
        if (rv.id) {
          span.title = 'Открыть карточку';
          span.addEventListener('click', function () {
            selectPerson(rv.id);
          });
        }
        line.appendChild(span);
      });
      rivalsCol.appendChild(line);
    }
    body.appendChild(rivalsCol);
    box.appendChild(body);
    return box;
  }

  function selectPerson(id, scroll) {
    personId = parseInt(id, 10) || 0;
    if (personId) {
      try {
        var u = new URL(window.location.href);
        u.searchParams.set('person', String(personId));
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) {}
    }
    renderList();
    renderCard();
    if (scroll !== false && card && card.scrollIntoView) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderCard() {
    var p = people.find(function (x) {
      return x.id === personId;
    });
    card.replaceChildren();
    if (!p) {
      card.appendChild(el('p', 'muted', 'Выберите человека в списке.'));
      return;
    }
    var head = el('div', 'org-person-head');
    head.appendChild(el('h2', '', p.name));
    if (!p.active) {
      head.appendChild(el('span', 'org-person-off', 'не активен'));
    }
    if (p.games === 0 && p.judged === 0) {
      var delBtn = el('button', 'org-person-del', 'Удалить');
      delBtn.type = 'button';
      delBtn.title = 'Только если нет игр и судейств в протоколах';
      delBtn.addEventListener('click', function () {
        if (
          !window.confirm(
            'Удалить «' + p.name + '»?\nКарточка и членства исчезнут. Действие необратимо.'
          )
        ) {
          return;
        }
        api('org_person_delete', { person_id: String(p.id) })
          .then(function () {
            personId = 0;
            renderAll();
          })
          .catch(function () {});
      });
      head.appendChild(delBtn);
    }
    card.appendChild(head);

    var body = el('div', 'org-person-body');
    var left = el('div', 'org-person-stats');
    var dl = el('dl', 'org-person-dl');
    addRow(dl, 'Игры', String(p.games));
    addRow(dl, 'Судейства', String(p.judged));
    left.appendChild(dl);
    if (p.funnelNow || p.funnelNext) {
      var funnel = el('div', 'org-person-funnel');
      if (p.funnelNow) {
        var nowRow = el('p', 'org-person-funnel-now');
        nowRow.appendChild(el('span', '', 'Сейчас:'));
        nowRow.appendChild(el('span', 'org-chip org-funnel-pill', capFirst(p.funnelNow)));
        funnel.appendChild(nowRow);
      }
      if (p.funnelNext) {
        var done = p.funnelNext === 'цель стрима достигнута';
        var line = el('p', done ? 'org-funnel-done' : 'org-funnel-next');
        line.textContent = done ? p.funnelNext : ('Куда развивать дальше: ' + p.funnelNext);
        funnel.appendChild(line);
      }
      left.appendChild(funnel);
    }
    var contacts = el('dl', 'org-person-dl');
    addRow(contacts, 'Email', p.email, p.email ? 'mailto:' + p.email : '');
    var tg = (p.telegram || '').replace(/^@/, '');
    addRow(contacts, 'Telegram', p.telegram, tg ? 'https://t.me/' + tg : '');
    if (p.telegram_id) {
      addRow(contacts, 'Telegram (ID)', String(p.telegram_id), 'tg://user?id=' + p.telegram_id);
    }
    addRow(contacts, 'Заметки', p.notes);
    if (contacts.childNodes.length) {
      left.appendChild(contacts);
    }
    body.appendChild(left);

    var table = document.createElement('table');
    table.className = 'org-circles-table';
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    var tbody = document.createElement('tbody');
    var tr = document.createElement('tr');
    circles.forEach(function (c) {
      hr.appendChild(el('th', '', c.title));
      var td = document.createElement('td');
      var chips = el('div', 'org-chips');
      p.memberships
        .filter(function (m) {
          return m.circleId === c.id;
        })
        .forEach(function (m) {
          var chip = el('span', 'org-chip');
          chip.appendChild(el('span', '', m.involvement));
          var x = el('button', 'org-chip-x', '×');
          x.type = 'button';
          x.title = 'Убрать';
          x.addEventListener('click', function () {
            api('org_mem_remove', {
              circle_id: String(c.id),
              person_id: String(p.id),
              involvement: m.involvement,
            }).catch(function () {});
          });
          chip.appendChild(x);
          chips.appendChild(chip);
        });
      var wrap = el('div', 'org-suggest-wrap org-chip-add-wrap');
      var input = el('input', 'org-chip-add');
      input.placeholder = '+ участие';
      input.autocomplete = 'off';
      wrap.appendChild(input);
      chips.appendChild(wrap);
      td.appendChild(chips);
      tr.appendChild(td);
      var have = {};
      p.memberships.forEach(function (m) {
        if (m.circleId === c.id) {
          have[m.involvement] = true;
        }
      });
      var items = circleInvs(c.id)
        .filter(function (inv) {
          return !have[inv];
        })
        .map(function (inv) {
          return { label: inv, value: inv };
        });
      attachSuggest(input, items, function (it) {
        api('org_mem_add', {
          circle_id: String(c.id),
          person_id: String(p.id),
          involvement: it.value || it.label,
        }).catch(function () {});
      }, true);
    });
    thead.appendChild(hr);
    tbody.appendChild(tr);
    table.appendChild(thead);
    table.appendChild(tbody);
    var circlesWrap = el('div', 'org-circles-scroll');
    circlesWrap.appendChild(table);
    body.appendChild(circlesWrap);
    card.appendChild(body);
    card.appendChild(renderPersonStats(p));
  }

  function setSelection(key, multi) {
    if (key === 'all' || !multi) {
      selected = {};
      selected[key] = true;
    } else {
      delete selected.all;
      if (selected[key]) {
        delete selected[key];
      } else {
        selected[key] = true;
      }
      if (!selectedKeys().length) {
        selected = { all: true };
      }
    }
    renderTree();
    renderList();
    renderAddBar();
  }

  tree.addEventListener('click', function (e) {
    if (e.target.closest('input, button')) {
      return;
    }
    var node = e.target.closest('[data-node]');
    if (!node) {
      return;
    }
    setSelection(node.getAttribute('data-node'), e.ctrlKey || e.metaKey);
  });
  tree.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') {
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') {
      return;
    }
    var node = e.target.closest('[data-node]');
    if (!node) {
      return;
    }
    e.preventDefault();
    setSelection(node.getAttribute('data-node'), e.ctrlKey || e.metaKey);
  });
  ul.addEventListener('click', function (e) {
    var li = e.target.closest('[data-id]');
    if (!li) {
      return;
    }
    selectPerson(parseInt(li.getAttribute('data-id'), 10), false);
  });
  if (qEl) {
    qEl.addEventListener('input', function () {
      query = qEl.value;
      renderList();
    });
  }
  if (newBtn) {
    newBtn.addEventListener('click', function () {
      newOpen = !newOpen;
      renderNewForm();
    });
  }
  document.querySelectorAll('[data-people-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setPeopleTab(btn.getAttribute('data-people-tab'));
    });
  });
  var startParams = new URLSearchParams(window.location.search);
  var startTab = startParams.get('v');
  setPeopleTab(startTab === 'funnel' ? 'funnel' : 'list');
  renderAll();
  var startPerson = parseInt(startParams.get('person') || '0', 10) || 0;
  if (startPerson && peopleById[startPerson]) {
    selectPerson(startPerson, false);
  }
})();
