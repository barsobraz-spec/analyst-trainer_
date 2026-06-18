// modules/shared/ui.js — мелкие общие кирпичики для новых экранов навигации.
//
// Заголовок страницы, пустое состояние и пара хелперов — в едином стиле главной
// (крупный дисплейный заголовок + приглушённый подзаголовок). Чтобы шесть новых
// страниц выглядели «как главная» и не дублировали верстку.
//
// ES-модуль: `import { pageHeader, emptyState } from './modules/shared/ui.js'`.

// Шапка страницы: крупный заголовок + необязательный подзаголовок.
export function pageHeader(title, subtitle) {
  const head = document.createElement('header');
  head.className = 'page-head';
  const h1 = document.createElement('h1');
  h1.className = 'page-head__title';
  h1.textContent = title;
  head.append(h1);
  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'page-head__sub';
    sub.textContent = subtitle;
    head.append(sub);
  }
  return head;
}

// Встроенные линейные SVG-иконки в едином стиле с сайдбаром (currentColor, без
// эмодзи) — чтобы пустые состояния выглядели «дорого», а не как стикеры. Если
// в `icon` передано имя из набора — рисуем линейную иконку, иначе оставляем
// текст (обратная совместимость с эмодзи на ещё не переведённых экранах).
const LINE_ICONS = {
  clock: [['circle', { cx: '12', cy: '12', r: '8' }], ['path', { d: 'M12 8v4l3 2' }]],
  star: [['path', { d: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9L12 3z' }]],
  chart: [['path', { d: 'M4 20V4' }], ['path', { d: 'M4 20h16' }], ['rect', { x: '7', y: '12', width: '3', height: '5' }], ['rect', { x: '12', y: '8', width: '3', height: '9' }], ['rect', { x: '17', y: '5', width: '3', height: '12' }]],
  database: [['ellipse', { cx: '12', cy: '6', rx: '7', ry: '3' }], ['path', { d: 'M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6' }], ['path', { d: 'M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6' }]],
  briefcase: [['rect', { x: '3', y: '7', width: '18', height: '13', rx: '2' }], ['path', { d: 'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }], ['path', { d: 'M3 12h18' }]],
  book: [['path', { d: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z' }], ['path', { d: 'M19 19H6a2 2 0 0 1-2-2' }]],
  play: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'm10 8 6 4-6 4z' }]],
  target: [['circle', { cx: '12', cy: '12', r: '8' }], ['circle', { cx: '12', cy: '12', r: '3' }]],
  dice: [['rect', { x: '4', y: '4', width: '16', height: '16', rx: '3' }], ['path', { d: 'M9 9h.01' }], ['path', { d: 'M15 15h.01' }], ['path', { d: 'M15 9h.01' }], ['path', { d: 'M9 15h.01' }]],
};

function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Рисует линейную иконку по имени из LINE_ICONS (или null, если имени нет).
function lineIcon(name) {
  if (!LINE_ICONS[name]) return null;
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  for (const [tag, attrs] of LINE_ICONS[name]) svg.append(svgEl(tag, attrs));
  return svg;
}

// Пустое состояние с иконкой, текстом и необязательной кнопкой-ссылкой.
export function emptyState({ icon = 'star', title, text, ctaHref, ctaText }) {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const ic = document.createElement('div');
  ic.className = 'empty-state__icon';
  ic.setAttribute('aria-hidden', 'true');
  const svg = lineIcon(icon);
  if (svg) ic.append(svg);
  else ic.textContent = icon;
  wrap.append(ic);

  const h2 = document.createElement('h2');
  h2.className = 'empty-state__title';
  h2.textContent = title;
  wrap.append(h2);

  if (text) {
    const p = document.createElement('p');
    p.className = 'empty-state__text';
    p.textContent = text;
    wrap.append(p);
  }

  if (ctaHref && ctaText) {
    const a = document.createElement('a');
    a.className = 'empty-state__cta';
    a.href = ctaHref;
    a.textContent = ctaText;
    wrap.append(a);
  }

  return wrap;
}

// Заголовок секции внутри страницы (h2 в стиле дашборда).
export function sectionTitle(text) {
  const h2 = document.createElement('h2');
  h2.className = 'section-title';
  h2.textContent = text;
  return h2;
}

export function spanText(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

// Балл 0–100 в виде цветной пилюли (зелёный ≥80, янтарный ≥60, красный ниже).
// Нечисловой балл → нейтральная пилюля «—».
export function scorePill(score) {
  const span = document.createElement('span');
  span.className = 'score-pill';
  if (typeof score === 'number' && Number.isFinite(score)) {
    span.textContent = String(score);
    span.dataset.level = score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low';
  } else {
    span.textContent = '—';
    span.dataset.level = 'none';
  }
  return span;
}

// Русская плюрализация (1 кейс / 2 кейса / 5 кейсов).
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
