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

// Пустое состояние с иконкой, текстом и необязательной кнопкой-ссылкой.
export function emptyState({ icon = '★', title, text, ctaHref, ctaText }) {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const ic = document.createElement('div');
  ic.className = 'empty-state__icon';
  ic.setAttribute('aria-hidden', 'true');
  ic.textContent = icon;
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
