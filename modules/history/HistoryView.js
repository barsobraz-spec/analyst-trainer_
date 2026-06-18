// modules/history/HistoryView.js — экран «История» (#/history).
//
// Хронологический журнал всех пройденных кейсов: каждая запись события прохождения
// (PRD §4) — это дата, оценка и время прохождения. Данные читаются из IndexedDB
// (getEvents, только чтение), названия/модули кейсов берутся из манифеста.
// Логику и хранилище не трогаем.
//
// Записи группируются по календарным дням (свежие сверху), как лента активности в
// буткемпах. Повторные прохождения одного кейса показываются отдельными записями
// (с номером попытки) — это полная история, а не «по одному на кейс».
//
// ES-модуль: `import { HistoryView } from './modules/history/HistoryView.js'`.

import { getEvents } from '../../core/db.js';
import { getModule } from '../../core/modules.js';
import { caseHash } from '../../core/courseNav.js';
import { loadCaseMetaMap } from '../shared/caseCatalog.js';
import { formatDuration } from '../analytics/SummaryPanel.js';
import { pageHeader, emptyState, scorePill, spanText, plural } from '../shared/ui.js';

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

export async function HistoryView() {
  const root = document.createElement('section');
  root.className = 'history screen';
  root.append(pageHeader('История', 'Все пройденные кейсы с датой, оценкой и временем прохождения.'));

  let events = [];
  let metaMap = new Map();
  let loadError = null;
  try {
    [events, metaMap] = await Promise.all([getEvents({}), loadCaseMetaMap()]);
  } catch (err) {
    console.error('[history] не удалось загрузить историю', err);
    loadError = err;
  }

  if (loadError) {
    root.append(banner('Не удалось прочитать историю из локального хранилища. Обновите страницу.'));
    return root;
  }

  if (events.length === 0) {
    root.append(emptyState({
      icon: 'clock',
      title: 'История пуста',
      text: 'Здесь появятся все пройденные кейсы. Пройдите первый кейс, чтобы начать вести историю.',
      ctaHref: '#/modules',
      ctaText: 'Открыть каталог →',
    }));
    return root;
  }

  // Сводка над журналом: всего прохождений и сколько разных кейсов.
  const distinct = new Set(events.map((e) => e.caseId)).size;
  const summary = document.createElement('p');
  summary.className = 'history__summary';
  summary.textContent =
    `${events.length} ${plural(events.length, 'прохождение', 'прохождения', 'прохождений')} · ` +
    `${distinct} ${plural(distinct, 'кейс', 'кейса', 'кейсов')}`;
  root.append(summary);

  // events уже отсортированы по убыванию finishedAt (db.getEvents). Группируем по дню.
  const groups = groupByDay(events);
  for (const group of groups) {
    root.append(buildDayGroup(group, metaMap));
  }

  return root;
}

// [{ key, label, items: [...events] }] от свежего дня к старому.
function groupByDay(events) {
  const map = new Map();
  for (const e of events) {
    const ts = e.finishedAt ?? 0;
    const d = new Date(ts);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!map.has(key)) map.set(key, { key, label: DATE_FMT.format(d), items: [] });
    map.get(key).items.push(e);
  }
  return [...map.values()];
}

function buildDayGroup(group, metaMap) {
  const section = document.createElement('section');
  section.className = 'history-day';

  const head = document.createElement('div');
  head.className = 'history-day__head';
  const date = document.createElement('h2');
  date.className = 'history-day__date';
  date.textContent = capitalize(group.label);
  head.append(date, spanText('history-day__count',
    `${group.items.length} ${plural(group.items.length, 'кейс', 'кейса', 'кейсов')}`));
  section.append(head);

  const list = document.createElement('ul');
  list.className = 'history-list';
  for (const e of group.items) list.append(buildEntry(e, metaMap));
  section.append(list);
  return section;
}

function buildEntry(e, metaMap) {
  const li = document.createElement('li');
  li.className = 'history-row';

  // --- Левая часть: время, название (ссылка), модуль ---
  const main = document.createElement('div');
  main.className = 'history-row__main';

  main.append(spanText('history-row__time', TIME_FMT.format(new Date(e.finishedAt ?? 0))));

  const meta = metaMap.get(e.caseId);
  const title = meta ? meta.title : e.caseId;
  let titleEl;
  if (meta && !meta.broken && meta.module) {
    titleEl = document.createElement('a');
    titleEl.href = caseHash({ module: meta.module, caseId: e.caseId });
  } else {
    titleEl = document.createElement('span');
  }
  titleEl.className = 'history-row__title';
  titleEl.textContent = title;
  main.append(titleEl);

  const mod = getModule(e.module);
  const sub = document.createElement('span');
  sub.className = 'history-row__module';
  sub.textContent = mod ? `${mod.id} · ${mod.title}` : e.module;
  if (Number.isFinite(e.attemptNo) && e.attemptNo > 1) {
    sub.textContent += ` · попытка №${e.attemptNo}`;
  }
  main.append(sub);

  li.append(main);

  // --- Правая часть: оценка + время прохождения ---
  const stats = document.createElement('div');
  stats.className = 'history-row__stats';
  stats.append(scorePill(e.score));
  const dur = document.createElement('span');
  dur.className = 'history-row__dur';
  dur.textContent = formatDuration(e.durationSec);
  stats.append(dur);
  li.append(stats);

  return li;
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function banner(text) {
  const p = document.createElement('p');
  p.className = 'history__banner';
  p.textContent = text;
  return p;
}
