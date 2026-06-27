// modules/practice/PracticeView.js — экран «Практика» (#/practice).
//
// Быстрый способ потренироваться: показывает СЛУЧАЙНЫЙ кейс из любого модуля. Если
// кейс не нравится — кнопка «Другой кейс» подбирает другой, не перезагружая страницу.
// Маршрут кейсов берём из core/courseNav (тот же порядок, что у курса), статус — из
// IndexedDB (только чтение). Логику/хранилище не трогаем.
//
// ES-модуль: `import { PracticeView } from './modules/practice/PracticeView.js'`.

import { getModule } from '../../core/modules.js';
import { getOutline, caseHash } from '../../core/courseNav.js';
import { loadProgressMap, statusOf } from '../../core/progress.js';
import { getAllTaskProgress } from '../../core/db.js';
import { loadLearningContent, loadAllPracticeContent, enrichContentWithPractice } from '../../core/learningContent.js?v=v1.9';
import { TASK_STATUS } from '../../core/learningProgress.js';
import { StatusBadge, DifficultyBadge } from '../../core/components/StatusBadge.js';
import { FavoriteButton } from '../../core/components/FavoriteButton.js';
import { pageHeader, emptyState } from '../shared/ui.js';

// Эмодзи-иконка модуля (как на главной, для визуального акцента).
const MODULE_ICON = {
  '5.1': '🔍', '5.2': '💡', '5.3': '📊', '5.4': '🎯',
  '5.5': '🗄️', '5.6': '🚀', '5.7': '⚙️',
};

export async function PracticeView() {
  const root = document.createElement('section');
  root.className = 'practice screen';
  root.append(pageHeader('Практика', 'Кейсы тренажера, связанные задачи учебного плана и быстрый случайный старт.'));

  const [outline, progress, baseContent, taskProgress, practiceItems] = await Promise.all([
    getOutline(),
    loadProgressMap(),
    loadLearningContent().catch(() => null),
    getAllTaskProgress().catch(() => []),
    loadAllPracticeContent().catch(() => []),
  ]);
  // Обогащаем базовый контент всей практикой — нужна для фильтрации и отображения.
  const content = baseContent ? enrichContentWithPractice(baseContent, practiceItems) : null;
  const filters = currentFilters();
  const pool = filterCases(outline.flat, progress, filters, content, taskProgress);

  root.append(filterPanel(outline, content, filters));

  if (outline.flat.length === 0) {
    root.append(emptyState({
      icon: 'dice',
      title: 'Пока нет кейсов для практики',
      text: 'Когда появятся кейсы, здесь можно будет тренироваться на случайных задачах.',
      ctaHref: '#/modules',
      ctaText: 'Открыть каталог →',
    }));
    return root;
  }

  // Слот, который перерисовывается кнопкой «Другой кейс» (без перезагрузки).
  const slot = document.createElement('div');
  slot.className = 'practice__slot';
  root.append(slot);

  let current = null;

  function pick() {
    if (pool.length === 0) {
      slot.replaceChildren(simpleEmpty('По текущим фильтрам кейсов нет. Измените модуль, сложность или статус.'));
      return;
    }
    // Подбираем случайный кейс, отличный от текущего (если есть выбор).
    let next = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && current) {
      let guard = 0;
      while (next.caseId === current.caseId && guard < 20) {
        next = pool[Math.floor(Math.random() * pool.length)];
        guard += 1;
      }
    }
    current = next;
    slot.replaceChildren(buildCard(next, progress, pick));
  }

  pick();
  if (filters.mode === 'tasks' || filters.mode === 'weak') {
    root.append(taskPracticeSection(content, taskProgress, filters));
  }
  return root;
}

function filterPanel(outline, content, filters) {
  const form = document.createElement('form');
  form.className = 'practice-filters';

  const mode = select('mode', [
    ['', 'Случайные кейсы'],
    ['tasks', 'По задачам плана'],
    ['weak', 'По слабым местам'],
  ], filters.mode);

  const moduleOptions = [['', 'Все модули']];
  for (const module of outline.modules || []) {
    moduleOptions.push([module.id, `${module.id} · ${module.title}`]);
  }

  const skillOptions = [['', 'Все навыки']];
  for (const skill of content?.tasks?.skills || []) {
    skillOptions.push([skill.id, skill.title]);
  }

  const module = select('module', moduleOptions, filters.module);
  const difficulty = select('difficulty', [
    ['', 'Любая сложность'],
    ['basic', 'basic'],
    ['intermediate', 'intermediate'],
    ['advanced', 'advanced'],
  ], filters.difficulty);
  const status = select('status', [
    ['', 'Любой статус'],
    ['not_started', 'Не начато'],
    ['in_progress', 'В работе'],
    ['passed', 'Пройдено'],
  ], filters.status);
  const skill = select('skill', skillOptions, filters.skill);

  for (const control of [mode, module, difficulty, status, skill]) {
    control.addEventListener('change', () => submitFilters(form));
  }

  form.append(
    filterField('Режим', mode),
    filterField('Модуль', module),
    filterField('Сложность', difficulty),
    filterField('Статус кейса', status),
    filterField('Навык', skill),
  );
  return form;
}

function filterCases(cases, progress, filters, content, taskProgress) {
  const weakModules = filters.mode === 'weak'
    ? modulesForWeakTasks(content, taskProgress)
    : null;
  const taskModules = filters.mode === 'tasks'
    ? modulesForTaskPractices(content, filters.skill)
    : null;
  return (cases || []).filter((item) => {
    if (filters.module && item.module !== filters.module) return false;
    if (filters.difficulty && item.difficulty !== filters.difficulty) return false;
    if (filters.status && statusOf(progress, item.caseId).status !== filters.status) return false;
    if (weakModules && !weakModules.has(item.module)) return false;
    if (taskModules && taskModules.size > 0 && !taskModules.has(item.module)) return false;
    return true;
  });
}

function taskPracticeSection(content, taskProgress, filters) {
  const section = document.createElement('section');
  section.className = 'practice-linked';
  const title = filters.mode === 'weak' ? 'Практика по слабым местам' : 'Практика по задачам плана';
  section.append(heading(title));

  if (!content) {
    section.append(simpleEmpty('Учебный контент недоступен, поэтому связанные практики не показаны.'));
    return section;
  }

  const taskStatus = new Map(taskProgress.map((item) => [item.taskId, item]));
  const rows = (content.practiceItems || [])
    .filter((item) => {
      const task = content.allTasks.find((candidate) => candidate.id === item.taskId);
      if (filters.skill && task?.skill !== filters.skill && item.skill?.id !== filters.skill) return false;
      if (filters.module && !item.moduleIds?.includes(filters.module)) return false;
      if (filters.mode === 'weak' && taskStatus.get(item.taskId)?.status !== TASK_STATUS.repeat) return false;
      return true;
    })
    .slice(0, 24);

  if (rows.length === 0) {
    section.append(simpleEmpty(filters.mode === 'weak'
      ? 'Задач со статусом «Повторить» для выбранных фильтров нет.'
      : 'Связанных практик по текущим фильтрам нет.'));
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'practice-linked__grid';
  for (const item of rows) grid.append(linkedPracticeCard(item, content, taskStatus));
  section.append(grid);
  return section;
}

function linkedPracticeCard(item, content, taskStatus) {
  const card = document.createElement('article');
  card.className = 'practice-linked-card';
  const task = content.allTasks.find((candidate) => candidate.id === item.taskId);
  const status = taskStatus.get(item.taskId)?.status || TASK_STATUS.notStarted;
  const practice = item.practiceContent || {};
  card.append(
    small('Задача плана'),
    heading(item.taskTitle || task?.title || item.taskId),
    paragraph(practice.businessGoal || practice.businessContext || 'Практика связана с учебной задачей.'),
  );
  const meta = document.createElement('div');
  meta.className = 'practice-linked-card__meta';
  meta.append(
    spanText('', content.skillsById.get(task?.skill || item.skill?.id)?.title || item.skill?.title || 'Навык'),
    spanText('', statusLabel(status)),
    spanText('', `${practice.estimatedTime || 45} мин`),
  );
  card.append(meta);

  const actions = document.createElement('div');
  actions.className = 'practice-linked-card__actions';
  const taskLink = document.createElement('a');
  taskLink.href = `#/learning/tasks?task=${encodeURIComponent(item.taskId)}`;
  taskLink.textContent = 'Открыть задачу';
  actions.append(taskLink);
  for (const moduleId of item.moduleIds || []) {
    const module = getModule(moduleId);
    const link = document.createElement('a');
    link.href = module?.hasCases === false ? '#/analytics' : `#/module/${encodeURIComponent(moduleId)}`;
    link.textContent = module ? `${module.id} · ${module.title}` : moduleId;
    actions.append(link);
  }
  card.append(actions);
  return card;
}

function buildCard(c, progress, onAnother) {
  const card = document.createElement('div');
  card.className = 'practice-card';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'practice-card__eyebrow';
  eyebrow.textContent = 'Случайный кейс';
  card.append(eyebrow);

  // Модуль (иконка + id · название).
  const mod = getModule(c.module);
  const modRow = document.createElement('div');
  modRow.className = 'practice-card__module';
  const icon = document.createElement('span');
  icon.className = 'practice-card__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = MODULE_ICON[c.module] || '•';
  const modName = document.createElement('span');
  modName.className = 'practice-card__module-name';
  modName.textContent = mod ? `${mod.id} · ${mod.title}` : c.module;
  modRow.append(icon, modName);
  card.append(modRow);

  // Название кейса.
  const title = document.createElement('h2');
  title.className = 'practice-card__title';
  title.textContent = c.title;
  card.append(title);

  // Бейджи: сложность + статус + звезда.
  const badges = document.createElement('div');
  badges.className = 'practice-card__badges';
  const st = statusOf(progress, c.caseId);
  badges.append(DifficultyBadge(c.difficulty), StatusBadge(st.status), FavoriteButton(c.caseId));
  card.append(badges);

  // Действия: начать / другой кейс.
  const actions = document.createElement('div');
  actions.className = 'practice-card__actions';

  const start = document.createElement('a');
  start.className = 'practice-card__start';
  start.href = caseHash(c);
  start.textContent = st.status === 'passed' ? 'Пройти снова →' : 'Начать кейс →';

  const another = document.createElement('button');
  another.type = 'button';
  another.className = 'practice-card__another';
  another.textContent = '🎲 Другой кейс';
  another.addEventListener('click', onAnother);

  actions.append(start, another);
  card.append(actions);

  return card;
}

function modulesForWeakTasks(content, taskProgress) {
  if (!content) return new Set();
  const repeatIds = new Set(taskProgress
    .filter((item) => item.status === TASK_STATUS.repeat)
    .map((item) => item.taskId));
  const modules = new Set();
  for (const task of content.allTasks || []) {
    if (!repeatIds.has(task.id)) continue;
    for (const moduleId of task.trainerModules || []) modules.add(moduleId);
  }
  return modules;
}

function modulesForTaskPractices(content, skill) {
  if (!content) return new Set();
  const modules = new Set();
  for (const item of content.practiceItems || []) {
    const task = content.allTasks.find((candidate) => candidate.id === item.taskId);
    if (skill && task?.skill !== skill && item.skill?.id !== skill) continue;
    for (const moduleId of item.moduleIds || []) modules.add(moduleId);
  }
  return modules;
}

function currentFilters() {
  const hash = location.hash.replace(/^#/, '');
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  return {
    mode: params.get('mode') || '',
    module: params.get('module') || '',
    difficulty: params.get('difficulty') || '',
    status: params.get('status') || '',
    skill: params.get('skill') || '',
  };
}

function submitFilters(form) {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (String(value).trim()) params.set(key, String(value).trim());
  }
  location.hash = `#/practice${params.toString() ? `?${params}` : ''}`;
}

function filterField(labelText, control) {
  const label = document.createElement('label');
  label.className = 'practice-filter';
  label.append(spanText('practice-filter__label', labelText), control);
  return label;
}

function select(name, options, value) {
  const control = document.createElement('select');
  control.name = name;
  for (const [optionValue, label] of options) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = label;
    if (optionValue === value) option.selected = true;
    control.append(option);
  }
  return control;
}

function simpleEmpty(message) {
  const p = document.createElement('p');
  p.className = 'practice-empty';
  p.textContent = message;
  return p;
}

function heading(value) {
  const h = document.createElement('h2');
  h.className = 'practice-linked-card__title';
  h.textContent = value;
  return h;
}

function paragraph(value) {
  const p = document.createElement('p');
  p.className = 'practice-linked-card__text';
  p.textContent = value;
  return p;
}

function small(value) {
  const el = document.createElement('span');
  el.className = 'practice-linked-card__eyebrow';
  el.textContent = value;
  return el;
}

function spanText(className, value) {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = value;
  return span;
}

function statusLabel(status) {
  return {
    not_started: 'Не начато',
    in_progress: 'В работе',
    done: 'Готово',
    repeat: 'Повторить',
    passed: 'Пройдено',
    unknown: 'Нет данных',
  }[status] || status;
}
