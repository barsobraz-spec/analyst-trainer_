// modules/learning/TasksView.js — чек-лист практических задач и слабые места (T4.2/T4.4).

import { getAllTaskProgress, saveTaskProgress } from '../../core/db.js';
import { calculateChecklistProgress, groupWeakSpots, TASK_STATUS } from '../../core/learningProgress.js';
import { moduleButton } from '../../core/learningLinks.js';
import { navigate } from '../../core/router.js';
import { loadPracticeSlice, enrichContentWithPractice } from '../../core/learningContent.js?v=v1.9';
import { loadIndex } from '../../core/caseLoader.js';
import { topicsForSkill } from '../../core/topicGraph.js';
import { TopicGraphPanel } from '../../core/components/TopicGraphPanel.js';
import { LearningRemindersPanel, REMINDER_SUGGESTIONS } from './LearningReminders.js';
import {
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
} from './learningUi.js?v=v1.9';

// Максимум задач в первом рендере списка. Кнопка «Показать ещё» грузит остаток.
const TASK_PAGE_SIZE = 50;

export function LearningTasksView() {
  return withLearningContent(renderTasks);
}

async function renderTasks(baseContent) {
  const section = screen('learning learning-tasks');
  section.append(
    learningHeader('Задачи', 'Выберите тему, затем работайте только с ее задачами. Статусы хранятся только в IndexedDB.'),
  );

  const progressRows = await getAllTaskProgress().catch(() => []);
  const progress = toProgressMap(progressRows);
  const params = currentFilters();
  const selectedSkill = params.skill || skillByTaskId(baseContent, params.task);

  if (!selectedSkill) {
    section.append(topicPicker(baseContent, progressRows));
    return section;
  }

  // Ленивая загрузка практики только для выбранного навыка (~30–290 КБ вместо 1 МБ).
  let content = baseContent;
  const practiceSlice = await loadPracticeSlice(selectedSkill).catch(() => []);
  if (practiceSlice.length > 0) {
    content = enrichContentWithPractice(baseContent, practiceSlice);
  }

  section.append(topicHeader(content, progressRows, selectedSkill));
  const topicsPanel = TopicGraphPanel({
    title: 'Связанные темы',
    topics: topicsForSkill(content.topicGraph, selectedSkill, 5),
    graph: content.topicGraph,
    content,
    casesById: await loadCasesById().catch((err) => {
      console.warn('[learning/tasks] case index для topic panel недоступен:', err.message || err);
      return new Map();
    }),
    maxTopics: 5,
    showEmpty: true,
    emptyText: 'Для этой темы связи пока не настроены.',
    errorText: 'Связи тем сейчас недоступны. Список задач работает без них.',
    className: 'topic-graph-panel--learning',
  });
  if (topicsPanel) section.append(topicsPanel);
  section.append(filters(selectedSkill));

  const filtered = filterTasks(content, progress, selectedSkill);
  const weakGroups = groupWeakSpots(
    content.allTasks.filter((task) => task.skill === selectedSkill),
    progressRows,
    content.tasks.skills,
  );
  section.append(taskList(content, filtered, progress, selectedSkill));
  section.append(weakSpots(weakGroups));
  section.append(await LearningRemindersPanel({
    title: 'Напоминания по повторению',
    scopes: ['weak_spots'],
    suggestions: weakGroups.length > 0 ? [REMINDER_SUGGESTIONS.weakSpots] : [],
    emptyText: 'Активных напоминаний по слабым местам нет.',
  }));
  return section;
}

function topicPicker(content, progressRows) {
  const box = card('learning-topic-picker');
  box.append(
    text('h2', 'learning-card__title', 'Выберите тему'),
    text('p', 'learning-muted', 'Сначала откройте направление, например Excel. Длинный список задач появится только внутри выбранной темы.'),
  );

  const grid = document.createElement('div');
  grid.className = 'learning-topic-grid';
  for (const skill of content.tasks.skills || []) {
    const tasks = content.allTasks.filter((task) => task.skill === skill.id);
    const progress = calculateChecklistProgress(tasks, progressRows);
    grid.append(topicButton(skill, tasks.length, progress));
  }
  box.append(grid);
  return box;
}

function topicButton(skill, taskCount, progress) {
  const a = document.createElement('a');
  a.className = 'learning-topic-button';
  a.href = `#/learning/tasks?skill=${encodeURIComponent(skill.id)}`;
  a.append(
    text('strong', 'learning-topic-button__title', skill.title),
    text('span', 'learning-topic-button__meta', `${taskCount} задач · ${progress.completed} готово`),
  );
  return a;
}

function topicHeader(content, progressRows, selectedSkill) {
  const skill = content.skillsById.get(selectedSkill);
  const title = skill?.title || selectedSkill;
  const topicTasks = content.allTasks.filter((task) => task.skill === selectedSkill);
  const box = card('learning-tasks-summary learning-topic-current');
  const checklist = calculateChecklistProgress(topicTasks, progressRows);
  const back = document.createElement('a');
  back.className = 'learning-button learning-button--small';
  back.href = '#/learning/tasks';
  back.textContent = 'Назад к темам';
  box.append(
    back,
    text('h2', 'learning-card__title', title),
    progressBar(checklist, `${checklist.completed}/${checklist.total} задач готово`),
  );
  return box;
}

function filters(selectedSkill) {
  const params = currentFilters();
  const form = document.createElement('form');
  form.className = 'learning-filters';

  const skill = document.createElement('input');
  skill.type = 'hidden';
  skill.name = 'skill';
  skill.value = selectedSkill;

  const search = document.createElement('input');
  search.type = 'search';
  search.name = 'q';
  search.placeholder = 'Поиск внутри темы';
  search.value = params.q;

  const status = document.createElement('select');
  status.name = 'status';
  status.append(option('', 'Все статусы', params.status));
  for (const key of Object.keys(TASK_STATUS_LABELS)) {
    status.append(option(key, TASK_STATUS_LABELS[key], params.status));
  }

  for (const control of [search, status]) {
    control.addEventListener('change', () => submitFilters(form));
    if (control === search) control.addEventListener('input', () => submitFilters(form));
  }
  form.append(skill, field('Поиск', search), field('Статус', status));
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

function filterTasks(content, progress, selectedSkill = '') {
  const params = currentFilters();
  const q = params.q.toLowerCase().replace(/ё/g, 'е');
  return content.allTasks.filter((task) => {
    if (selectedSkill && task.skill !== selectedSkill) return false;
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

function buildTaskRow(task, content, progress, selectedTask) {
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
  return row;
}

function taskList(content, tasks, progress, selectedSkill = '') {
  const wrap = card('learning-task-list');
  const skill = content.skillsById.get(selectedSkill);
  const title = skill ? `${skill.title}: ${tasks.length} задач` : `Найдено задач: ${tasks.length}`;
  wrap.append(text('h2', 'learning-card__title', title));
  if (tasks.length === 0) {
    wrap.append(emptyPanel('По текущим фильтрам задач нет.'));
    return wrap;
  }

  const selectedTask = readQueryParam('task');
  const groups = groupBy(tasks, (task) => `${task.month}:${task.skill}`);

  // Для масштабирования до 10 000+ задач: рендерим первые TASK_PAGE_SIZE строк,
  // остальные добавляются кнопкой «Показать ещё».
  let renderedCount = 0;
  const deferred = []; // { groupEl, task } — задачи за пределами первой страницы

  for (const group of groups.values()) {
    const first = group[0];
    const skillTitle = content.skillsById.get(first.skill)?.title || first.skill;
    const groupEl = document.createElement('section');
    groupEl.className = 'learning-task-group';
    groupEl.append(text('h3', 'learning-subtitle', `Месяц ${first.month} · ${skillTitle}`));

    for (const task of group) {
      if (renderedCount < TASK_PAGE_SIZE) {
        groupEl.append(buildTaskRow(task, content, progress, selectedTask));
        renderedCount++;
      } else {
        deferred.push({ groupEl, task });
      }
    }
    wrap.append(groupEl);
  }

  if (deferred.length > 0) {
    const showMore = document.createElement('button');
    showMore.type = 'button';
    showMore.className = 'learning-button learning-show-more';
    showMore.textContent = `Показать ещё ${deferred.length} задач`;
    showMore.addEventListener('click', () => {
      for (const { groupEl, task } of deferred) {
        groupEl.append(buildTaskRow(task, content, progress, selectedTask));
      }
      showMore.remove();
    });
    wrap.append(showMore);
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
    skill: params.get('skill') || '',
    status: params.get('status') || '',
    task: params.get('task') || '',
  };
}

function skillByTaskId(content, taskId) {
  if (!taskId) return '';
  return content.allTasks.find((task) => task.id === taskId)?.skill || '';
}

async function loadCasesById() {
  const { entries } = await loadIndex();
  return new Map((entries || [])
    .filter((item) => item.caseId && item.module && item.status !== 'error')
    .map((item) => [item.caseId, item]));
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
