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
  attachPersonTips();
  attachCircleAssign();
  if (!raw || !tree || !ul || !card || !csrfEl) {
    return;
  }
  var data = JSON.parse(raw.textContent || '{}');
  var people = data.people || [];
  var circles = data.circles || [];
  var funnel = data.funnel || { stages: [], goals: [], note: '' };
  var selected = { all: true };
  var personId = 0;
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

  function personCardUrl(id) {
    var u = new URL(window.location.href);
    u.search = '?p=org&s=people&person=' + encodeURIComponent(id);
    return u.pathname + u.search;
  }

  function openPersonCard(id) {
    window.open(personCardUrl(id), '_blank', 'noopener');
  }

  function renderCard() {
    card.replaceChildren();
    card.appendChild(el('p', 'muted', 'Клик по человеку откроет карточку в новой вкладке.'));
  }

  function attachCircleAssign() {
    document.querySelectorAll('.org-circle-assign').forEach(function (form) {
      var sel = form.querySelector('select[name="circle_id"]');
      var inp = form.querySelector('input.org-circle-custom');
      if (!sel || !inp) {
        return;
      }
      function sync() {
        var custom = /__custom__$/.test(sel.value || '');
        inp.hidden = !custom;
        if (!custom) {
          inp.value = '';
        } else {
          inp.focus();
        }
      }
      sel.addEventListener('change', sync);
      sync();
    });
  }

  function attachPersonTips() {
    var tipsEl = document.getElementById('org-person-tips-json');
    var page = document.querySelector('.org-person-page');
    if (!tipsEl || !page) {
      return;
    }
    var tips = {};
    try {
      tips = JSON.parse(tipsEl.textContent || '{}');
    } catch (e) {
      tips = {};
    }
    var box = el('div', 'org-tip-box');
    box.hidden = true;
    document.body.appendChild(box);
    function htmlFor(cell) {
      var kind = cell.getAttribute('data-tip') || '';
      if (kind === 'rival') {
        var rid = cell.getAttribute('data-rid') || '';
        var rivals = tips.rivals || {};
        return rivals[rid] || rivals[String(rid)] || '<p class="tip-empty">Нет</p>';
      }
      return tips[kind] || '<p class="tip-empty">Нет</p>';
    }
    function show(cell) {
      box.innerHTML = htmlFor(cell);
      box.hidden = false;
      var r = cell.getBoundingClientRect();
      var tw = box.offsetWidth || 240;
      var th = box.offsetHeight || 48;
      var left = r.left;
      if (left + tw > window.innerWidth - 8) {
        left = window.innerWidth - tw - 8;
      }
      if (left < 8) {
        left = 8;
      }
      var top = r.bottom + 6;
      if (top + th > window.innerHeight - 8) {
        top = r.top - th - 6;
      }
      if (top < 8) {
        top = 8;
      }
      box.style.left = left + 'px';
      box.style.top = top + 'px';
    }
    function hide() {
      box.hidden = true;
    }
    page.querySelectorAll('.has-tip').forEach(function (cell) {
      cell.addEventListener('mouseenter', function () {
        show(cell);
      });
      cell.addEventListener('mouseleave', hide);
      cell.addEventListener('click', function (e) {
        e.preventDefault();
        show(cell);
      });
      cell.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          show(cell);
        }
      });
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.has-tip, .org-tip-box')) {
        hide();
      }
    });
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
    openPersonCard(parseInt(li.getAttribute('data-id'), 10));
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
})();
