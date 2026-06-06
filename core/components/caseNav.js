// core/components/caseNav.js — переход между кейсами без возврата в каталог.
//
// Два механизма (PRD-навигация в духе буткемпов Scrimba/ZTM «Next lesson»):
//   • caseNavFooter — постоянная панель «← предыдущий / следующий →» внизу экрана
//     кейса (видна всегда, не только после завершения); работает на десктопе и мобиле.
//   • installSwipeNav — свайп влево/вправо по экрану кейса = следующий/предыдущий
//     (мобильный жест). Срабатывает только на ЯВНО горизонтальном движении и не
//     перехватывает жесты внутри интерактивных областей (таблицы-сортировки, ползунки,
//     редактор SQL, графики), чтобы не мешать прохождению кейса.
//
// Соседи берутся из единого маршрута курса (courseNav). Хост кейса (caseHost.js)
// оборачивает любой экран кейса этой обвязкой — отдельным CaseView её знать не нужно.
//
// ES-модуль: `import { caseNavFooter, installSwipeNav } from
//             '../../core/components/caseNav.js'`.

import { getAdjacent, caseHash } from '../courseNav.js';
import { navigate } from '../router.js';

// --- Постоянная панель «предыдущий / следующий» ------------------------------
export function caseNavFooter(moduleId, caseId) {
  const nav = document.createElement('nav');
  nav.className = 'case-nav';
  nav.setAttribute('aria-label', 'Переход между кейсами курса');

  // Соседи приходят асинхронно (манифест кэширован — практически мгновенно).
  getAdjacent(caseId)
    .then(({ prev, next, index }) => {
      // Кейс вне линейного маршрута (пользовательский кейс 5.7) — вместо
      // противоречивой пары «первый/последний» даём ссылку к списку кейсов модуля.
      if (index === -1) {
        nav.classList.add('case-nav--single');
        nav.append(backToModuleLink(moduleId));
        return;
      }
      nav.append(navSlot('prev', prev), navSlot('next', next));
    })
    .catch((err) => {
      console.error('[caseNav] не удалось определить соседние кейсы', err);
    });

  return nav;
}

// Ссылка «к списку кейсов модуля» — для кейсов вне линейного маршрута.
function backToModuleLink(moduleId) {
  const a = document.createElement('a');
  a.className = 'case-nav__link case-nav__link--prev';
  a.href = `#/module/${encodeURIComponent(moduleId)}`;
  a.append(arrow('prev'), textBlock('К списку кейсов', 'Вернуться к кейсам модуля'));
  return a;
}

function navSlot(dir, c) {
  const isNext = dir === 'next';
  const hintText = isNext ? 'Следующий кейс' : 'Предыдущий кейс';

  if (!c) {
    const span = document.createElement('span');
    span.className = `case-nav__link case-nav__link--${dir} case-nav__link--disabled`;
    span.setAttribute('aria-disabled', 'true');
    span.append(arrow(dir), textBlock(hintText, isNext ? 'Это последний кейс курса' : 'Это первый кейс курса'));
    return span;
  }

  const a = document.createElement('a');
  a.className = `case-nav__link case-nav__link--${dir}`;
  a.href = caseHash(c);
  const text = textBlock(hintText, c.title);
  if (isNext) a.append(text, arrow(dir));
  else a.append(arrow(dir), text);
  return a;
}

function textBlock(hint, title) {
  const wrap = document.createElement('span');
  wrap.className = 'case-nav__text';
  const h = document.createElement('span');
  h.className = 'case-nav__hint';
  h.textContent = hint;
  const t = document.createElement('span');
  t.className = 'case-nav__title';
  t.textContent = title;
  wrap.append(h, t);
  return wrap;
}

function arrow(dir) {
  const span = document.createElement('span');
  span.className = 'case-nav__arrow';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = dir === 'next' ? '→' : '←';
  return span;
}

// --- Свайп между кейсами (мобильный жест) ------------------------------------
const SWIPE_MIN_DX = 70;          // минимальная горизонтальная дистанция, px
const SWIPE_AXIS_RATIO = 0.6;     // |dy| должно быть < 0.6·|dx| — иначе это вертикальная прокрутка
const SWIPE_MAX_MS = 700;         // дольше — это уже не «свайп», а перетаскивание

// Жест не должен угонять взаимодействие внутри этих областей кейса.
const INTERACTIVE_SELECTOR = [
  'input', 'textarea', 'select', 'button', 'a', 'canvas', 'table',
  '[role="slider"]', '.CodeMirror', '.sql-editor',
  '.prioritization', '.cause-tree', '.case-view__table-wrap',
].join(',');

export function installSwipeNav(el, caseId) {
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let tracking = false;

  const onStart = (e) => {
    if (!e.touches || e.touches.length !== 1) { tracking = false; return; }
    const t = e.touches[0];
    // Старт внутри интерактивного элемента — не наш жест.
    if (t.target instanceof Element && t.target.closest(INTERACTIVE_SELECTOR)) {
      tracking = false;
      return;
    }
    startX = t.clientX;
    startY = t.clientY;
    startT = Date.now();
    tracking = true;
  };

  const onEnd = (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Date.now() - startT > SWIPE_MAX_MS) return;
    if (Math.abs(dx) < SWIPE_MIN_DX) return;
    if (Math.abs(dy) > Math.abs(dx) * SWIPE_AXIS_RATIO) return; // слишком «по диагонали»

    getAdjacent(caseId)
      .then(({ prev, next }) => {
        const target = dx < 0 ? next : prev; // влево → следующий, вправо → предыдущий
        if (target) navigate(caseHash(target));
      })
      .catch((err) => console.error('[caseNav] свайп: соседи недоступны', err));
  };

  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchend', onEnd, { passive: true });

  return () => {
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('touchend', onEnd);
  };
}
