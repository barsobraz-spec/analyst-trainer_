// modules/learning/TasksView.js — чек-лист практических задач и слабые места (T4.2/T4.4).

import { getAllTaskProgress, saveTaskProgress } from '../../core/db.js';
import { calculateChecklistProgress, groupWeakSpots, TASK_STATUS } from '../../core/learningProgress.js';
import { moduleButton } from '../../core/learningLinks.js';
import { navigate } from '../../core/router.js';
import { LearningRemindersPanel, REMINDER_SUGGESTIONS } from './LearningReminders.js';
import {
  LearningSearchPanel,
  TASK_STATUS_LABELS,
  card,
  emptyPanel,
  field,
  learningHeader,
  progressBar,
  readQueryParam,
  screen,
  statusSelect,
  text,
  toProgressMap,
  withLearningContent,
} from './learningUi.js?v=practice-content-2';

export function LearningTasksView() {
  return withLearningContent(renderTasks);
}

async function renderTasks(content) {
  const section = screen('learning learning-tasks');
  section.append(
    learningHeader('Задачи', 'Практический чек-лист из основного плана и enhancement pack. Статусы хранятся только в IndexedDB.'),
    LearningSearchPanel(content),
  );

  const progressRows = await getAllTaskProgress().catch(() => []);
  const progress = toProgressMap(progressRows);
  section.append(topSummary(content, progressRows));
  section.append(filters(content));

  const filtered = filterTasks(content, progress);
  const weakGroups = groupWeakSpots(content.allTasks, progressRows, content.tasks.skills);
  section.append(taskList(content, filtered, progress));
  section.append(weakSpots(weakGroups));
  section.append(await LearningRemindersPanel({
    title: 'Напоминания по повторению',
    scopes: ['weak_spots'],
    suggestions: weakGroups.length > 0 ? [REMINDER_SUGGESTIONS.weakSpots] : [],
    emptyText: 'Активных напоминаний по слабым местам нет.',
  }));
  return section;
}

function topSummary(content, progressRows) {
  const box = card('learning-tasks-summary');
  const checklist = calculateChecklistProgress(content.allTasks, progressRows);
  box.append(text('h2', 'learning-card__title', 'Прогресс чек-листа'), progressBar(checklist, `${checklist.completed}/${checklist.total} задач готово`));
  return box;
}

function filters(content) {
  const params = currentFilters();
  const form = document.createElement('form');
  form.className = 'learning-filters';

  const search = document.createElement('input');
  search.type = 'search';
  search.name = 'q';
  search.placeholder = 'Поиск по задачам';
  search.value = params.q;

  const month = document.createElement('select');
  month.name = 'month';
  month.append(option('', 'Все месяцы', params.month));
  for (const item of content.plan.months || []) {
    month.append(option(String(item.month), `Месяц ${item.month}`, params.month));
  }

  const skill = document.createElement('select');
  skill.name = 'skill';
  skill.append(option('', 'Все навыки', params.skill));
  for (const item of content.tasks.skills || []) {
    skill.append(option(item.id, item.title, params.skill));
  }

  const status = document.createElement('select');
  status.name = 'status';
  status.append(option('', 'Все статусы', params.status));
  for (const key of Object.keys(TASK_STATUS_LABELS)) {
    status.append(option(key, TASK_STATUS_LABELS[key], params.status));
  }

  for (const control of [search, month, skill, status]) {
    control.addEventListener('change', () => submitFilters(form));
    if (control === search) control.addEventListener('input', () => submitFilters(form));
  }
  form.append(field('Поиск', search), field('Месяц', month), field('Навык', skill), field('Статус', status));
  return form;
}

function submitFilters(form) {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (String(value).trim()) params.set(key, String(value).trim());
  }
  location.hash = `#/learning/tasks${params.toString() ? `?${params}` : ''}`;
}

function filterTasks(content, progress) {
  const params = currentFilters();
  const q = params.q.toLowerCase().replace(/ё/g, 'е');
  return content.allTasks.filter((task) => {
    if (params.month && String(task.month) !== params.month) return false;
    if (params.skill && task.skill !== params.skill) return false;
    const status = progress.get(task.id)?.status || TASK_STATUS.notStarted;
    if (params.status && status !== params.status) return false;
    if (!q) return true;
    const skill = content.skillsById.get(task.skill)?.title || task.skill;
    const practice = content.practicesByTaskId?.get(task.id);
    const haystack = [
      task.title,
      task.id,
      task.number,
      skill,
      `месяц ${task.month}`,
      ...(task.trainerModules || []),
      practice?.practiceContent?.businessContext,
      practice?.practiceContent?.managerRequest,
      practice?.practiceContent?.businessGoal,
      ...(practice?.practiceContent?.skills || []),
    ].join(' ').toLowerCase().replace(/ё/g, 'е');
    return haystack.includes(q);
  });
}

function taskList(content, tasks, progress) {
  const wrap = card('learning-task-list');
  wrap.append(text('h2', 'learning-card__title', `Найдено задач: ${tasks.length}`));
  if (tasks.length === 0) {
    wrap.append(emptyPanel('По текущим фильтрам задач нет.'));
    return wrap;
  }

  const selectedTask = readQueryParam('task');
  const groups = groupBy(tasks, (task) => `${task.month}:${task.skill}`);
  for (const group of groups.values()) {
    const first = group[0];
    const skill = content.skillsById.get(first.skill)?.title || first.skill;
    const groupEl = document.createElement('section');
    groupEl.className = 'learning-task-group';
    groupEl.append(text('h3', 'learning-subtitle', `Месяц ${first.month} · ${skill}`));

    for (const task of group) {
      const row = document.createElement('article');
      row.className = 'learning-task-row';
      row.id = task.id;
      if (selectedTask === task.id) row.classList.add('is-highlighted');
      const body = document.createElement('div');
      body.className = 'learning-task-row__body';
      body.append(
        text('span', 'learning-task-row__num', task.number ? `#${task.number}` : task.source || 'extra'),
        text('strong', 'learning-task-row__title', task.title),
      );
      const links = document.createElement('div');
      links.className = 'learning-task-row__links';
      for (const moduleId of task.trainerModules || []) links.append(moduleButton(moduleId, 'Практика'));
      body.append(links);

      const controls = document.createElement('div');
      controls.className = 'learning-task-row__controls';
      const current = progress.get(task.id);
      const select = statusSelect(Object.keys(TASK_STATUS_LABELS), TASK_STATUS_LABELS, current?.status || TASK_STATUS.notStarted);
      select.addEventListener('change', async () => {
        await saveTaskProgress({
          taskId: task.id,
          status: select.value,
          month: task.month,
          skill: task.skill,
          notes: current?.notes || '',
        });
        navigate(location.hash.replace(/^#/, '') || '/learning/tasks');
      });
      controls.append(select);
      row.append(body, controls);
      const practice = content.practicesByTaskId?.get(task.id);
      if (practice) row.append(practiceDetails(practice, selectedTask === task.id));
      groupEl.append(row);
    }
    wrap.append(groupEl);
  }
  return wrap;
}

function practiceDetails(practice, open = false) {
  const content = practice.practiceContent || {};
  const details = document.createElement('details');
  details.className = 'learning-task-practice learning-details';
  details.open = open;
  const summary = document.createElement('summary');
  summary.textContent = 'Полная практика';
  details.append(summary);

  const meta = document.createElement('div');
  meta.className = 'learning-practice-meta';
  meta.append(
    text('span', '', practice.section || ''),
    text('span', '', practice.skill?.title || ''),
    text('span', '', `${difficultyLabel(content.difficulty)} · ${content.estimatedTime || '—'} мин`),
  );
  details.append(meta);

  details.append(
    practiceBlock('Бизнес-контекст', content.businessContext),
    practiceBlock('Запрос руководителя', content.managerRequest),
    practiceBlock('Цель бизнеса', content.businessGoal),
    inputDataBlock(content.inputData),
    practiceBlock('Задача аналитика', content.analystTask),
    practiceBlock('Ожидаемый результат', content.expectedResult),
    practiceBlock('Бизнес-вывод', content.businessConclusion),
    practiceBlock('Критерии проверки', content.validationCriteria),
    practiceBlock('Типичные ошибки', content.commonMistakes),
    practiceBlock('Навыки', content.skills),
    practiceBlock('Что оценивает работодатель', content.hiringSignal),
    practiceBlock('Ценность для портфолио', portfolioText(content.portfolioValue)),
    practiceBlock('Вопросы на интервью', content.interviewQuestions),
  );
  return details;
}

function practiceBlock(title, value) {
  const section = document.createElement('section');
  section.className = 'learning-practice-block';
  section.append(text('h4', 'learning-practice-block__title', title));
  if (Array.isArray(value)) {
    section.append(list(value));
  } else {
    section.append(text('p', 'learning-muted', value || 'Не указано.'));
  }
  return section;
}

function inputDataBlock(inputData = {}) {
  const section = document.createElement('section');
  section.className = 'learning-practice-block';
  section.append(text('h4', 'learning-practice-block__title', 'Входные данные'));
  if (inputData.description) section.append(text('p', 'learning-muted', inputData.description));
  const tables = Array.isArray(inputData.tables) ? inputData.tables : [];
  if (tables.length === 0) return section;

  const table = document.createElement('table');
  table.className = 'learning-table learning-practice-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Таблица / файл', 'Поля', 'Источник']) headRow.append(text('th', '', label));
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  for (const item of tables) {
    const row = document.createElement('tr');
    row.append(
      text('td', '', item.name || ''),
      text('td', '', (item.fields || []).join(', ')),
      text('td', '', item.source || ''),
    );
    tbody.append(row);
  }
  table.append(thead, tbody);
  section.append(table);
  return section;
}

function list(items = []) {
  const ul = document.createElement('ul');
  ul.className = 'learning-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = String(item);
    ul.append(li);
  }
  return ul;
}

function portfolioText(value) {
  if (!value || typeof value !== 'object') return value || 'Не указано.';
  return `${value.canUse ? 'Да' : 'Нет'}: ${value.note || ''}`;
}

function difficultyLabel(value) {
  return {
    easy: 'easy',
    medium: 'medium',
    hard: 'hard',
  }[value] || 'difficulty не указана';
}

function weakSpots(groups) {
  const box = card('learning-weak-spots');
  box.append(text('h2', 'learning-card__title', 'Слабые места'));
  if (groups.length === 0) {
    box.append(emptyPanel('Задач со статусом «Повторить» пока нет.'));
    return box;
  }
  for (const group of groups) {
    const block = document.createElement('section');
    block.className = 'learning-weak-group';
    block.append(text('h3', 'learning-subtitle', `${group.title}: ${group.count}`));
    const list = document.createElement('ul');
    list.className = 'learning-list';
    for (const task of group.tasks) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#/learning/tasks?task=${encodeURIComponent(task.id)}&status=repeat`;
      a.textContent = task.title;
      li.append(a);
      for (const moduleId of task.trainerModules || []) li.append(moduleButton(moduleId, 'Практика'));
      list.append(li);
    }
    block.append(list);
    box.append(block);
  }
  return box;
}

function currentFilters() {
  const hash = location.hash.replace(/^#/, '');
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  return {
    q: params.get('q') || '',
    month: params.get('month') || '',
    skill: params.get('skill') || '',
    status: params.get('status') || '',
  };
}

function option(value, label, selected) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  if (value === selected) opt.selected = true;
  return opt;
}

function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}
