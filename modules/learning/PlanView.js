// modules/learning/PlanView.js — полный 7-месячный план обучения (T4.1).

import { getAllMonthlyExamProgress, saveMonthlyExamProgress } from '../../core/db.js';
import { moduleButton } from '../../core/learningLinks.js';
import { buildMonthlyExamChecklist, calculateMonthlyExamProgress } from '../../core/learningProgress.js';
import {
  LearningSearchPanel,
  card,
  debounce,
  field,
  learningHeader,
  moduleLinks,
  progressBar,
  readQueryParam,
  screen,
  text,
  withLearningContent,
} from './learningUi.js';

export function LearningPlanView() {
  return withLearningContent(renderPlan);
}

async function renderPlan(content) {
  const examRows = await getAllMonthlyExamProgress().catch(() => []);
  const examsByMonth = new Map(examRows.map((row) => [row.month, row]));
  const section = screen('learning learning-plan');
  section.append(
    learningHeader('План обучения', 'Семь месяцев, четырнадцать спринтов, недели, проекты, карьерные действия и связи с тренажером.'),
    LearningSearchPanel(content),
    overview(content),
    monthsRoadmap(content, examsByMonth),
  );
  return section;
}

function overview(content) {
  const box = card('learning-plan-overview');
  box.append(
    text('h2', 'learning-card__title', content.plan.title),
    text('p', 'learning-muted', content.plan.subtitle),
  );
  const stats = document.createElement('div');
  stats.className = 'learning-summary learning-summary--compact';
  stats.append(
    smallStat('Длительность', `${content.plan.durationMonths} месяцев`),
    smallStat('Нагрузка', content.plan.weeklyLoad),
    smallStat('Практика / теория', content.plan.practiceTheoryRatio),
    smallStat('Фокус рынка', (content.plan.marketFocus || []).join(', ')),
  );
  box.append(stats);

  const rules = document.createElement('ul');
  rules.className = 'learning-list';
  for (const rule of content.plan.rules || []) {
    const li = document.createElement('li');
    li.textContent = rule;
    rules.append(li);
  }
  box.append(text('h3', 'learning-subtitle', 'Правила маршрута'), rules);
  return box;
}

function monthsRoadmap(content, examsByMonth) {
  const wrap = document.createElement('div');
  wrap.className = 'learning-months';
  const selectedMonth = Number(readQueryParam('month'));

  for (const month of content.plan.months || []) {
    const box = card('learning-month');
    box.id = `month-${month.month}`;
    if (selectedMonth === month.month) box.classList.add('is-highlighted');

    const head = document.createElement('header');
    head.className = 'learning-month__head';
    head.append(
      text('span', 'learning-month__badge', `Месяц ${month.month}`),
      text('h2', 'learning-card__title', month.title),
      text('p', 'learning-muted', month.focus),
    );
    box.append(head);

    const meta = document.createElement('div');
    meta.className = 'learning-month__meta';
    meta.append(
      smallStat('Артефакт', month.artifact || 'Портфолио-результат'),
      smallStat('Навыки', (month.skills || []).join(', ')),
    );
    box.append(meta);

    box.append(text('h3', 'learning-subtitle', 'Спринты'));
    const sprints = document.createElement('div');
    sprints.className = 'learning-sprints';
    for (const sprint of month.sprints || []) sprints.append(sprintCard(sprint));
    box.append(sprints);

    box.append(text('h3', 'learning-subtitle', 'Недели и темы'));
    const weeks = document.createElement('div');
    weeks.className = 'learning-weeks';
    for (const week of month.weeks || []) weeks.append(weekCard(week, month));
    box.append(weeks);

    if (month.projects?.length) {
      box.append(text('h3', 'learning-subtitle', 'Проекты месяца'));
      const projects = document.createElement('div');
      projects.className = 'learning-mini-grid';
      for (const project of month.projects) {
        const projectCard = card('learning-mini-card');
        projectCard.append(
          text('strong', '', project.title),
          text('p', 'learning-muted', project.businessQuestion),
        );
        projects.append(projectCard);
      }
      box.append(projects);
    }

    if (month.careerActions?.length) {
      box.append(text('h3', 'learning-subtitle', 'Карьерные действия'));
      const list = document.createElement('ul');
      list.className = 'learning-list';
      for (const action of month.careerActions) {
        const li = document.createElement('li');
        li.textContent = action;
        list.append(li);
      }
      box.append(list);
    }

    const moduleIds = month.trainerLinks?.map((link) => link.module) || [];
    box.append(text('h3', 'learning-subtitle', 'Подходящие модули тренажера'), moduleLinks(moduleIds));
    box.append(monthlyExamPanel(month, examsByMonth.get(month.month)));
    wrap.append(box);
  }
  return wrap;
}

function sprintCard(sprint) {
  const box = card('learning-sprint');
  box.append(
    text('span', 'learning-month__badge', `Спринт ${sprint.sprint}`),
    text('strong', '', sprint.title),
    text('p', 'learning-muted', `Недели: ${(sprint.weeks || []).join(', ')}`),
    text('p', 'learning-muted', `Definition of done: ${sprint.definitionOfDone}`),
  );
  return box;
}

function weekCard(week, month) {
  const box = card('learning-week');
  box.append(text('strong', '', `Неделя ${week.week}: ${week.title}`));
  const list = document.createElement('ul');
  list.className = 'learning-list';
  for (const topic of week.topics || []) {
    const li = document.createElement('li');
    li.append(document.createTextNode(topic));
    const firstModule = month.trainerLinks?.[0]?.module;
    if (firstModule) li.append(moduleButton(firstModule, 'Практика'));
    list.append(li);
  }
  box.append(list);
  return box;
}

function monthlyExamPanel(month, saved) {
  const checklist = buildMonthlyExamChecklist(month);
  const state = {
    month: month.month,
    checks: saved?.checks || {},
    notes: saved?.notes || '',
    completedAt: saved?.completedAt || null,
  };
  const box = document.createElement('section');
  box.className = 'learning-exam';
  box.append(
    text('h3', 'learning-subtitle', 'Экзамен месяца'),
    text('p', 'learning-muted', 'Чек-лист готовности для перехода к следующему месяцу.'),
  );

  const progressSlot = document.createElement('div');
  const status = text('span', 'learning-exam__status', '');
  const renderProgress = () => {
    const progress = calculateMonthlyExamProgress(checklist, state);
    status.textContent = progress.total > 0 && progress.completed === progress.total
      ? 'Готов'
      : 'Не готов';
    status.dataset.ready = String(progress.total > 0 && progress.completed === progress.total);
    progressSlot.replaceChildren(progressBar(progress, `${progress.completed}/${progress.total} пунктов готово`));
  };
  renderProgress();
  box.append(status, progressSlot);

  const form = document.createElement('form');
  form.className = 'learning-exam__form';
  const list = document.createElement('div');
  list.className = 'learning-exam__checks';
  for (const item of checklist) {
    const control = checkbox(Boolean(state.checks[item.id]));
    control.dataset.checkId = item.id;
    list.append(checkboxField(item.title, control, item.description));
  }

  const notes = textarea(state.notes);
  form.append(list, field('Заметки к экзамену', notes));
  const message = text('p', 'learning-muted', 'Состояние сохраняется локально и попадет в общий экспорт прогресса.');
  form.append(message);

  const persist = async () => {
    state.checks = readChecks(form);
    state.notes = notes.value;
    const progress = calculateMonthlyExamProgress(checklist, state);
    state.completedAt = progress.total > 0 && progress.completed === progress.total
      ? (state.completedAt || new Date().toISOString())
      : null;
    renderProgress();
    try {
      const savedState = await saveMonthlyExamProgress(state);
      state.completedAt = savedState.completedAt;
      message.dataset.kind = 'ok';
      message.textContent = 'Экзамен месяца сохранен.';
    } catch (err) {
      message.dataset.kind = 'error';
      message.textContent = err?.message || 'Не удалось сохранить экзамен месяца.';
    }
  };
  const debouncedPersist = debounce(persist, 300);
  form.addEventListener('change', persist);
  form.addEventListener('input', (event) => {
    if (event.target === notes) debouncedPersist();
  });

  box.append(form);
  return box;
}

function readChecks(form) {
  const checks = {};
  for (const inputEl of form.querySelectorAll('[data-check-id]')) {
    checks[inputEl.dataset.checkId] = inputEl.checked;
  }
  return checks;
}

function checkbox(checked) {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = Boolean(checked);
  return el;
}

function textarea(value) {
  const el = document.createElement('textarea');
  el.rows = 3;
  el.value = value || '';
  return el;
}

function checkboxField(label, control, hint = '') {
  const wrap = document.createElement('label');
  wrap.className = 'learning-check learning-check--wide';
  const body = document.createElement('span');
  body.append(text('span', '', label));
  if (hint) body.append(text('small', 'learning-muted', hint));
  wrap.append(control, body);
  return wrap;
}

function smallStat(label, value) {
  const box = document.createElement('div');
  box.className = 'learning-small-stat';
  box.append(text('span', '', label), text('strong', '', value || '—'));
  return box;
}
