// core/components/Sidebar.js — постоянный навигатор приложения (сайдбар + нижняя навигация).
//
// Структура навигации приходит из core/navigation.js: компактный бренд сверху,
// главное меню, свернутые вторичные группы и карточка цели «Junior Analyst» в
// подвале. Сайдбар виден всегда на десктопе; на мобильном сворачивается в нижнюю
// навигацию и выдвижную шторку (drawer).
//
// Сайдбар живёт ВНЕ #app, поэтому переживает перерисовки роутера. Он сам слушает
// hashchange (подсветка активного пункта) и событие at:progress-changed из event.js
// (обновление кольца цели после прохождения кейса — без перезагрузки).
//
// Числа берутся из IndexedDB (loadProgressMap + getOutline) — логика хранилища и
// модулей не трогается. При сбое БД карточка цели показывает 0% (навигатор остаётся
// работоспособным).
//
// ES-модуль: `import { installNavigation } from './core/components/Sidebar.js'`.

import { getOutline, caseHash } from '../courseNav.js';
import { getModule } from '../modules.js';
import { BOTTOM_NAV_ITEMS, NAV_GROUPS } from '../navigation.js';
import { loadProgressMap, moduleProgress, getResumeTarget } from '../progress.js';
import { PROGRESS_EVENT } from '../event.js';
import { ProgressRing } from './ProgressRing.js';

// Точка входа: заполняет каркас оболочки (index.html) и подключает поведение.
// Возвращает { refresh }. Если каркаса нет — тихо выходит.
export function installNavigation() {
  const sidebar = document.getElementById('sidebar');
  const bottomNav = document.getElementById('bottom-nav');
  const scrim = document.getElementById('nav-scrim');
  const toggle = document.getElementById('nav-toggle');
  if (!sidebar) return { refresh: () => {} };

  // --- Бренд -----------------------------------------------------------------
  const brand = document.createElement('a');
  brand.className = 'sidebar__brand';
  brand.href = '#/';
  const logo = document.createElement('span');
  logo.className = 'sidebar__logo';
  logo.setAttribute('aria-hidden', 'true');
  logo.textContent = 'A';
  brand.append(logo, spanText('sidebar__brand-name', 'Analyst Trainer'));

  // --- Меню по разделам ------------------------------------------------------
  const scroll = document.createElement('div');
  scroll.className = 'sidebar__scroll';

  const quickAction = document.createElement('a');
  quickAction.className = 'sb-quick';
  quickAction.href = '#/modules';
  quickAction.append(
    iconEl('play', 'sb-quick__icon'),
    (() => {
      const text = document.createElement('span');
      text.className = 'sb-quick__text';
      text.append(
        spanText('sb-quick__label', 'Следующий шаг'),
        spanText('sb-quick__title', 'Выбрать модуль'),
      );
      return text;
    })(),
  );

  const nav = document.createElement('nav');
  nav.className = 'sb-nav';
  nav.setAttribute('aria-label', 'Основная навигация');

  const navLinks = []; // { el, match }
  const treeSections = []; // { el, trigger, matchers }
  for (const group of NAV_GROUPS) {
    if (group.collapsible) {
      const section = document.createElement('section');
      section.className = 'sb-nav__section sb-nav__section--tree';
      section.dataset.navSection = group.heading;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sb-nav__trigger';
      button.append(
        iconEl(group.icon, 'sb-nav__icon'),
        spanText('sb-nav__label', group.heading),
        iconEl('chevron', 'sb-nav__chevron'),
      );

      const ul = navList(group.items, navLinks, true);
      const setOpen = (open) => {
        section.classList.toggle('is-open', open);
        button.setAttribute('aria-expanded', String(open));
        ul.hidden = !open;
        try {
          localStorage.setItem(group.storageKey, open ? 'true' : 'false');
        } catch {}
      };

      let saved = null;
      try { saved = localStorage.getItem(group.storageKey); } catch {}
      const currentPath = (location.hash.replace(/^#/, '') || '/').split('?')[0];
      const open = saved == null ? group.items.some((item) => matchScore(item.match, currentPath) > 0) : saved === 'true';
      button.addEventListener('click', () => setOpen(!section.classList.contains('is-open')));
      setOpen(open);

      section.append(button, ul);
      nav.append(section);
      treeSections.push({ el: section, trigger: button, matchers: group.items.map((item) => item.match || null) });
      continue;
    }

    if (group.heading) {
      const h = spanText('sb-nav__heading', group.heading.toUpperCase());
      h.setAttribute('role', 'presentation');
      nav.append(h);
    }
    nav.append(navList(group.items, navLinks));
  }
  scroll.append(quickAction, nav);

  // --- Подвал: карточка цели --------------------------------------------------
  const foot = document.createElement('div');
  foot.className = 'sidebar__foot';

  const goal = document.createElement('div');
  goal.className = 'sb-goal';
  const goalRing = document.createElement('div');
  goalRing.className = 'sb-goal__ring';
  const goalText = document.createElement('div');
  goalText.className = 'sb-goal__text';
  goalText.append(
    spanText('sb-goal__title', 'Цель: Junior Analyst'),
    spanText('sb-goal__hint', 'Прогресс по всему курсу'),
  );
  goal.append(goalRing, goalText);

  foot.append(goal);

  sidebar.replaceChildren(brand, scroll, foot);

  // --- Нижняя навигация (мобильная) ------------------------------------------
  let continueTab = null;
  if (bottomNav) {
    const home = bottomNavLink(BOTTOM_NAV_ITEMS.home);
    continueTab = bottomNavLink(BOTTOM_NAV_ITEMS.continue);
    const practice = bottomNavLink(BOTTOM_NAV_ITEMS.practice);
    const plan = bottomNavLink(BOTTOM_NAV_ITEMS.plan);
    const actions = document.createElement('div');
    actions.className = 'bottom-nav__actions';
    actions.append(continueTab, practice, plan);
    bottomNav.replaceChildren(home, actions);
  }

  // --- Выдвижная шторка (drawer) на мобильном --------------------------------
  function setDrawer(open) {
    document.body.classList.toggle('nav-open', open);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }
  if (toggle) toggle.addEventListener('click', () => setDrawer(!document.body.classList.contains('nav-open')));
  if (scrim) scrim.addEventListener('click', () => setDrawer(false));
  sidebar.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('a')) setDrawer(false);
  });

  // --- Подсветка активного пункта --------------------------------------------
  function updateActive() {
    const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];

    // Выбираем один пункт с наибольшей «специфичностью»: exact (2) > prefix (1).
    let best = null;
    let bestScore = 0;
    for (const link of navLinks) {
      const score = matchScore(link.match, path);
      if (score > bestScore) { best = link; bestScore = score; }
    }
    for (const link of navLinks) {
      const active = link === best;
      link.el.classList.toggle('is-current', active);
      if (active) link.el.setAttribute('aria-current', 'page');
      else link.el.removeAttribute('aria-current');
    }
    for (const section of treeSections) {
      const active = section.matchers.some((match) => matchScore(match, path) > 0);
      section.el.classList.toggle('is-current', active);
      section.trigger.classList.toggle('is-current', active);
    }

    updateBottomActive(path);
  }

  function updateBottomActive(path) {
    path = path.split('?')[0];
    if (!bottomNav) return;
    for (const item of bottomNav.querySelectorAll('.bottom-nav__item')) {
      const m = item.dataset.match;
      let active = false;
      if (m === 'home') active = path === '/';
      else if (m === 'practice') active = path === '/practice';
      else if (m === 'plan') active = path === '/learning/plan';
      else if (m === 'continue') active = path.startsWith('/module/') && path.includes('/case/');
      item.classList.toggle('is-current', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
  }

  // --- Карточка цели: общий прогресс курса из IndexedDB ----------------------
  async function refresh() {
    let pct = 0;
    try {
      const outline = await getOutline();
      const progress = await loadProgressMap();
      const resume = getResumeTarget(outline, progress);
      let passed = 0;
      let total = 0;
      for (const mod of outline.modules) {
        const p = moduleProgress(mod.cases, progress);
        passed += p.passed;
        total += p.total;
      }
      pct = total > 0 ? Math.round((passed / total) * 100) : 0;
      updateQuickAction(quickAction, continueTab, resume);
      updateActive();
    } catch (err) {
      console.error('[sidebar] не удалось посчитать прогресс цели', err);
    }
    goalRing.replaceChildren(ProgressRing(pct, { size: 64, stroke: 7 }));
  }

  // --- Слушатели -------------------------------------------------------------
  window.addEventListener('hashchange', () => { setDrawer(false); updateActive(); });
  window.addEventListener(PROGRESS_EVENT, refresh);

  updateActive();
  refresh();
  return { refresh };
}

function updateQuickAction(quickAction, continueTab, resume) {
  let href = '#/modules';
  let label = 'Следующий шаг';
  let title = 'Выбрать модуль';

  if (resume?.kind === 'resume' && resume.case) {
    const mod = getModule(resume.case.module);
    href = caseHash(resume.case);
    label = 'Продолжить';
    title = `${mod ? mod.id : resume.case.module} · ${resume.case.title}`;
  } else if (resume?.kind === 'start' && resume.case) {
    const mod = getModule(resume.case.module);
    href = caseHash(resume.case);
    label = 'Начать';
    title = `${mod ? mod.id : resume.case.module} · ${resume.case.title}`;
  } else if (resume?.kind === 'done') {
    href = '#/analytics';
    label = 'Курс пройден';
    title = 'Посмотреть аналитику';
  }

  quickAction.href = href;
  quickAction.querySelector('.sb-quick__label').textContent = label;
  quickAction.querySelector('.sb-quick__title').textContent = title;

  if (continueTab) continueTab.href = href;
}

// Очки совпадения пункта с путём: 2 — точное, 1 — по префиксу, 0 — нет.
function matchScore(match, path) {
  if (!match) return 0;
  if (match.exact && path === match.exact) return 2;
  if (match.prefix && (path === match.prefix || path.startsWith(`${match.prefix}/`))) return 1;
  return 0;
}

// --- Мелкие помощники --------------------------------------------------------
function navList(items, navLinks, nested = false) {
  const ul = document.createElement('ul');
  ul.className = nested ? 'sb-nav__list sb-nav__list--nested' : 'sb-nav__list';
  for (const item of items) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'sb-nav__item';
    a.href = item.href;
    a.append(iconEl(item.icon, 'sb-nav__icon'), spanText('sb-nav__label', item.label));
    li.append(a);
    ul.append(li);
    navLinks.push({ el: a, match: item.match || null });
  }
  return ul;
}

function spanText(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function bottomNavLink(item) {
  const a = document.createElement('a');
  a.className = 'bottom-nav__item';
  a.href = item.href;
  a.dataset.match = item.match;
  a.append(iconEl(item.icon, 'bottom-nav__icon'), spanText('bottom-nav__label', item.label));
  return a;
}

// Встроенные линейные SVG-иконки (единый стиль, без эмодзи).
const ICONS = {
  home: [
    ['path', { d: 'M4 12 12 4l8 8' }],
    ['path', { d: 'M6 10v10h12V10' }],
  ],
  play: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'm10 8 6 4-6 4z' }],
  ],
  grid: [
    ['rect', { x: '4', y: '4', width: '7', height: '7' }],
    ['rect', { x: '13', y: '4', width: '7', height: '7' }],
    ['rect', { x: '4', y: '13', width: '7', height: '7' }],
    ['rect', { x: '13', y: '13', width: '7', height: '7' }],
  ],
  chevron: [
    ['path', { d: 'm9 6 6 6-6 6' }],
  ],
  target: [
    ['circle', { cx: '12', cy: '12', r: '8' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  star: [
    ['path', { d: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9L12 3z' }],
  ],
  clock: [
    ['circle', { cx: '12', cy: '12', r: '8' }],
    ['path', { d: 'M12 8v4l3 2' }],
  ],
  chart: [
    ['path', { d: 'M4 20V4' }],
    ['path', { d: 'M4 20h16' }],
    ['rect', { x: '7', y: '12', width: '3', height: '5' }],
    ['rect', { x: '12', y: '8', width: '3', height: '9' }],
    ['rect', { x: '17', y: '5', width: '3', height: '12' }],
  ],
  database: [
    ['ellipse', { cx: '12', cy: '6', rx: '7', ry: '3' }],
    ['path', { d: 'M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6' }],
    ['path', { d: 'M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6' }],
  ],
  briefcase: [
    ['rect', { x: '3', y: '7', width: '18', height: '13', rx: '2' }],
    ['path', { d: 'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
    ['path', { d: 'M3 12h18' }],
  ],
  calendar: [
    ['rect', { x: '4', y: '5', width: '16', height: '15', rx: '2' }],
    ['path', { d: 'M8 3v4' }],
    ['path', { d: 'M16 3v4' }],
    ['path', { d: 'M4 10h16' }],
  ],
  map: [
    ['path', { d: 'M9 18 3 20V6l6-2 6 2 6-2v14l-6 2-6-2z' }],
    ['path', { d: 'M9 4v14' }],
    ['path', { d: 'M15 6v14' }],
  ],
  check: [
    ['rect', { x: '4', y: '4', width: '16', height: '16', rx: '2' }],
    ['path', { d: 'm8 12 2.5 2.5L16 9' }],
  ],
  folder: [
    ['path', { d: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }],
  ],
  book: [
    ['path', { d: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z' }],
    ['path', { d: 'M19 19H6a2 2 0 0 1-2-2' }],
  ],
  info: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'M12 11v5' }],
    ['path', { d: 'M12 8h.01' }],
  ],
  settings: [
    ['path', { d: 'M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5z' }],
    ['path', { d: 'M19.4 15a1.8 1.8 0 0 0 .36 2l.05.05a2 2 0 0 1-2.83 2.83l-.05-.05a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.66V21a2 2 0 0 1-4 0v-.08a1.8 1.8 0 0 0-1.1-1.66 1.8 1.8 0 0 0-2 .36l-.05.05a2 2 0 0 1-2.83-2.83l.05-.05a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.66-1.1H3a2 2 0 0 1 0-4h.08a1.8 1.8 0 0 0 1.66-1.1 1.8 1.8 0 0 0-.36-2l-.05-.05a2 2 0 0 1 2.83-2.83l.05.05a1.8 1.8 0 0 0 2 .36 1.8 1.8 0 0 0 1.1-1.66V3a2 2 0 0 1 4 0v.08a1.8 1.8 0 0 0 1.1 1.66 1.8 1.8 0 0 0 2-.36l.05-.05a2 2 0 0 1 2.83 2.83l-.05.05a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.66 1.1H21a2 2 0 0 1 0 4h-.08a1.8 1.8 0 0 0-1.66 1.1z' }],
  ],
};

function iconEl(name, className) {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  for (const [tag, attrs] of ICONS[name] || []) svg.append(svgEl(tag, attrs));
  span.append(svg);
  return span;
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}
