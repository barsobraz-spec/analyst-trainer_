// modules/analytics/ReflectionJournal.js — журнал рефлексии (T9.3.1).
//
// PRD §5.8 Ф5: просмотр сохранённых самооценок и заметок по кейсам с фильтрацией по
// модулю и диапазону дат. Источник — события прохождения (notes, selfAssessment,
// score, время), обогащённые названием кейса и сложностью. Только отображение и
// клиентская фильтрация; данные приходят готовыми из экрана аналитики.
//
// ES-модуль: `import { ReflectionJournal } from './modules/analytics/ReflectionJournal.js'`.

import { getModule } from '../../core/modules.js';

export function ReflectionJournal({ events = [] } = {}) {
  const root = document.createElement('section');
  root.className = 'analytics-section reflection-journal';

  const h2 = document.createElement('h2');
  h2.className = 'analytics-section__title';
  h2.textContent = 'Журнал рефлексии';
  root.append(h2);

  // События по убыванию времени (свежие сверху) — копия, исходный массив не трогаем.
  const all = [...events].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));

  if (all.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'reflection-journal__empty';
    empty.textContent = 'Пока нет записей — пройдите кейс, чтобы он появился в журнале.';
    root.append(empty);
    return root;
  }

  // --- Фильтры: модуль + диапазон дат (T9.3.2) --------------------------------
  const filters = document.createElement('div');
  filters.className = 'reflection-journal__filters';

  const moduleSelect = document.createElement('select');
  moduleSelect.className = 'reflection-journal__filter';
  moduleSelect.setAttribute('aria-label', 'Фильтр по модулю');
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'Все модули';
  moduleSelect.append(allOpt);
  // Только модули, по которым есть события.
  const presentModules = [...new Set(all.map((e) => e.module))].sort();
  for (const id of presentModules) {
    const opt = document.createElement('option');
    opt.value = id;
    const mod = getModule(id);
    opt.textContent = mod ? `${id} · ${mod.title}` : id;
    moduleSelect.append(opt);
  }

  const fromInput = dateInput('С даты');
  const toInput = dateInput('По дату');

  filters.append(
    labeled('Модуль', moduleSelect),
    labeled('С', fromInput),
    labeled('По', toInput),
  );
  root.append(filters);

  const list = document.createElement('div');
  list.className = 'reflection-journal__list';
  root.append(list);

  function applyFilters() {
    const mod = moduleSelect.value;
    const fromTs = fromInput.value ? new Date(`${fromInput.value}T00:00:00`).getTime() : null;
    const toTs = toInput.value ? new Date(`${toInput.value}T23:59:59`).getTime() : null;

    const visible = all.filter((e) => {
      if (mod && e.module !== mod) return false;
      const t = e.finishedAt ?? 0;
      if (fromTs != null && t < fromTs) return false;
      if (toTs != null && t > toTs) return false;
      return true;
    });

    list.replaceChildren();
    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'reflection-journal__empty';
      empty.textContent = 'Нет записей под выбранные фильтры.';
      list.append(empty);
      return;
    }
    for (const e of visible) list.append(buildEntry(e));
  }

  moduleSelect.addEventListener('change', applyFilters);
  fromInput.addEventListener('change', applyFilters);
  toInput.addEventListener('change', applyFilters);

  applyFilters();
  return root;
}

function buildEntry(e) {
  const card = document.createElement('article');
  card.className = 'journal-entry';

  const head = document.createElement('div');
  head.className = 'journal-entry__head';

  const title = document.createElement('span');
  title.className = 'journal-entry__title';
  title.textContent = e.title || e.caseId;

  const mod = getModule(e.module);
  const moduleTag = document.createElement('span');
  moduleTag.className = 'journal-entry__module';
  moduleTag.textContent = mod ? mod.title : e.module;

  const date = document.createElement('span');
  date.className = 'journal-entry__date';
  date.textContent = formatDateTime(e.finishedAt);

  head.append(title, moduleTag, date);
  card.append(head);

  const meta = document.createElement('div');
  meta.className = 'journal-entry__meta';
  meta.append(metaChip(`Результат: ${Number.isFinite(e.score) ? e.score : '—'} / 100`));
  if (Number.isFinite(e.attemptNo)) meta.append(metaChip(`Попытка №${e.attemptNo}`));
  if (Number.isFinite(e.hintsUsed) && e.hintsUsed > 0) meta.append(metaChip(`Подсказок: ${e.hintsUsed}`));
  const selfPct = selfAssessmentPercent(e.selfAssessment);
  if (selfPct != null) meta.append(metaChip(`Самооценка: ${selfPct}%`));
  card.append(meta);

  const notes = String(e.notes || '').trim();
  if (notes) {
    const note = document.createElement('p');
    note.className = 'journal-entry__notes';
    note.textContent = notes;
    card.append(note);
  }

  return card;
}

function selfAssessmentPercent(sa) {
  if (!sa || typeof sa !== 'object') return null;
  if (Number.isFinite(sa.selfFraction)) return Math.round(sa.selfFraction * 100);
  return null;
}

function metaChip(text) {
  const span = document.createElement('span');
  span.className = 'journal-entry__chip';
  span.textContent = text;
  return span;
}

function labeled(labelText, control) {
  const wrap = document.createElement('label');
  wrap.className = 'reflection-journal__field';
  const span = document.createElement('span');
  span.className = 'reflection-journal__field-label';
  span.textContent = labelText;
  wrap.append(span, control);
  return wrap;
}

function dateInput(ariaLabel) {
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'reflection-journal__filter';
  input.setAttribute('aria-label', ariaLabel);
  return input;
}

function formatDateTime(ts) {
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
