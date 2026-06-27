// modules/learning/learningUi.js — общие DOM-помощники учебной системы.

import { pageHeader } from '../shared/ui.js';
import { loadLearningContent, safeContentFallback } from '../../core/learningContent.js?v=v1.7';
import { searchLearningContent } from '../../core/learningSearch.js?v=v1.7';
import { resolveTrainerModules } from '../../core/learningLinks.js';

export const TASK_STATUS_LABELS = Object.freeze({
  not_started: 'Не начато',
  in_progress: 'В работе',
  done: 'Готово',
  repeat: 'Повторить',
});

export const PROJECT_STATUS_LABELS = Object.freeze({
  not_started: 'Не начат',
  in_progress: 'В работе',
  review: 'На ревью',
  done: 'Готов',
  needs_improvement: 'Доработать',
});

export const APPLICATION_STATUS_LABELS = Object.freeze({
  saved: 'Сохранена',
  applied: 'Откликнулся',
  screening: 'Скрининг',
  test_task: 'Тестовое',
  interview: 'Собеседование',
  offer: 'Оффер',
  rejected: 'Отказ',
  no_response: 'Нет ответа',
  withdrawn: 'Снята',
});

export async function withLearningContent(render) {
  try {
    const content = await loadLearningContent();
    return render(content);
  } catch (err) {
    console.error('[learning] не удалось загрузить контент', err);
    const fallback = safeContentFallback(err);
    const section = screen('learning learning-error');
    section.append(
      pageHeader(fallback.title, fallback.message),
      emptyPanel('JSON-контент не прочитан. Запустите приложение через локальный HTTP-сервер из папки analyst-trainer.'),
    );
    return section;
  }
}

export function screen(className = 'learning') {
  const section = document.createElement('section');
  section.className = `${className} screen`;
  return section;
}

export function learningHeader(title, subtitle) {
  const wrap = document.createElement('div');
  wrap.className = 'learning-head';
  wrap.append(pageHeader(title, subtitle), learningTabs());
  return wrap;
}

function learningTabs() {
  const nav = document.createElement('nav');
  nav.className = 'learning-tabs';
  nav.setAttribute('aria-label', 'Разделы обучения');
  const links = [
    ['#/learning/today', 'Сегодня'],
    ['#/learning/plan', 'План'],
    ['#/learning/tasks', 'Задачи'],
    ['#/learning/projects', 'Проекты'],
    ['#/learning/career', 'Карьера'],
    ['#/learning/mock-interview', 'Mock-интервью'],
  ];
  const current = location.hash.replace(/^#/, '').split('?')[0] || '/learning/today';
  for (const [href, label] of links) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (href.slice(1) === current) {
      a.className = 'is-current';
      a.setAttribute('aria-current', 'page');
    }
    nav.append(a);
  }
  return nav;
}

export function LearningSearchPanel(content) {
  const panel = document.createElement('section');
  panel.className = 'learning-search';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Поиск по темам, задачам, проектам и карьере';
  input.setAttribute('aria-label', 'Поиск по учебной системе');
  const results = document.createElement('div');
  results.className = 'learning-search__results';
  panel.append(input, results);

  input.addEventListener('input', () => {
    const found = searchLearningContent(content, input.value, { limit: 8 });
    results.replaceChildren();
    if (!input.value.trim()) return;
    if (found.length === 0) {
      results.append(emptyPanel('Ничего не найдено. Попробуйте навык, номер месяца или название модуля.'));
      return;
    }
    const list = document.createElement('div');
    list.className = 'learning-search__list';
    for (const item of found) {
      const a = document.createElement('a');
      a.className = 'learning-search__item';
      a.href = item.href;
      a.append(
        text('span', 'learning-search__label', item.label),
        text('strong', 'learning-search__title', item.title),
        text('span', 'learning-search__desc', item.description || ''),
      );
      list.append(a);
    }
    results.append(list);
  });

  return panel;
}

export function card(className = '') {
  const el = document.createElement('article');
  el.className = `learning-card${className ? ` ${className}` : ''}`;
  return el;
}

export function statCard(label, value, hint = '') {
  const el = document.createElement('div');
  el.className = 'learning-stat';
  el.append(text('span', 'learning-stat__label', label), text('strong', 'learning-stat__value', value));
  if (hint) el.append(text('span', 'learning-stat__hint', hint));
  return el;
}

export function progressBar(progress, label = '') {
  const wrap = document.createElement('div');
  wrap.className = 'learning-progress';
  if (label) {
    const row = document.createElement('div');
    row.className = 'learning-progress__row';
    row.append(text('span', '', label), text('strong', '', `${progress.percent}%`));
    wrap.append(row);
  }
  const bar = document.createElement('div');
  bar.className = 'learning-progress__bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(progress.total));
  bar.setAttribute('aria-valuenow', String(progress.completed));
  const fill = document.createElement('span');
  fill.style.width = `${progress.percent}%`;
  bar.append(fill);
  wrap.append(bar);
  return wrap;
}

export function moduleLinks(moduleIds = []) {
  const wrap = document.createElement('div');
  wrap.className = 'learning-module-links';
  for (const module of resolveTrainerModules(moduleIds)) {
    if (module.href) {
      const a = document.createElement('a');
      a.href = module.href;
      a.textContent = `${module.moduleId} · ${module.title}`;
      wrap.append(a);
    } else {
      wrap.append(text('span', 'is-disabled', `${module.moduleId} · неизвестный модуль`));
    }
  }
  return wrap;
}

export function statusSelect(statuses, labels, value) {
  const select = document.createElement('select');
  for (const status of statuses) {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = labels[status] || status;
    if (status === value) option.selected = true;
    select.append(option);
  }
  return select;
}

export function field(labelText, control) {
  const label = document.createElement('label');
  label.className = 'learning-field';
  label.append(text('span', 'learning-field__label', labelText), control);
  return label;
}

export function text(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = String(value ?? '');
  return el;
}

export function button(textValue, className = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `learning-button${className ? ` ${className}` : ''}`;
  btn.textContent = textValue;
  return btn;
}

export function emptyPanel(message) {
  const p = document.createElement('p');
  p.className = 'learning-empty';
  p.textContent = message;
  return p;
}

export function toProgressMap(records = []) {
  return new Map((records || []).map((record) => [record.taskId || record.projectId || record.applicationId, record]));
}

export function formatMonth(month) {
  return `Месяц ${month}`;
}

export function readQueryParam(name) {
  const hash = location.hash.replace(/^#/, '');
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  return new URLSearchParams(query).get(name);
}

export function debounce(fn, ms = 350) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
