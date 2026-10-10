(function () {
  'use strict';
  var root = document.querySelector('.org-outreach');
  if (!root) {
    return;
  }
  // Подсветить строки, где пользователь что-то изменил (необязательное удобство).
  root.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || !el.closest) {
      return;
    }
    var tr = el.closest('tr');
    if (tr) {
      tr.classList.add('oc-row-dirty');
    }
  });
  // Для статуса «интересны, но не сейчас» подсказать поле «когда готов».
  root.addEventListener('change', function (e) {
    var sel = e.target;
    if (!sel || sel.tagName !== 'SELECT' || !/^status\[/.test(sel.name || '')) {
      return;
    }
    var tr = sel.closest('tr');
    if (!tr) {
      return;
    }
    var hint = tr.querySelector('input[name^="hint["]');
    if (hint && sel.value === 'later') {
      hint.focus();
    }
  });

  // Сохраняем позицию скролла, чтобы после перезагрузки (добавление/удаление/фильтр)
  // страница не прыгала наверх.
  var KY = 'oc-scroll-y';
  var KK = 'oc-scroll-k';
  function sectionKey() {
    var u = new URL(window.location.href);
    var p = u.searchParams;
    return [u.pathname, p.get('p') || '', p.get('s') || '', p.get('c') || ''].join('|');
  }
  function saveScroll() {
    try {
      sessionStorage.setItem(KY, String(window.scrollY));
      sessionStorage.setItem(KK, sectionKey());
    } catch (err) {
      /* ignore */
    }
  }
  document.addEventListener('submit', saveScroll, true);
  document.addEventListener(
    'click',
    function (e) {
      var t = e.target;
      if (!t || !t.closest) {
        return;
      }
      var a = t.closest('a');
      if (a) {
        var h = a.getAttribute('href') || '';
        if (h && h.charAt(0) !== '#') {
          saveScroll();
        }
        return;
      }
      if (t.closest('button')) {
        saveScroll();
      }
    },
    true
  );
  try {
    if (sessionStorage.getItem(KK) === sectionKey()) {
      var y = parseInt(sessionStorage.getItem(KY) || '0', 10);
      if (y > 0) {
        window.scrollTo(0, y);
        requestAnimationFrame(function () {
          window.scrollTo(0, y);
        });
      }
    }
    sessionStorage.removeItem(KY);
    sessionStorage.removeItem(KK);
  } catch (err) {
    /* ignore */
  }
})();
