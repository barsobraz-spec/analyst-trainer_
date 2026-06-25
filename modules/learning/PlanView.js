// modules/learning/PlanView.js — полный 7-месячный план обучения (T4.1).

import { getAllMonthlyExamProgress, saveMonthlyExamProgress } from '../../core/db.js';
import { buildMonthlyExamChecklist, calculateMonthlyExamProgress } from '../../core/learningProgress.js';
import { loadIndex } from '../../core/caseLoader.js';
import { DayDetail, buildWeekDays, dayLabel } from './plan/DayDetail.js?v=v1.5';
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
  const { entries } = await loadIndex().catch(() => ({ entries: [] }));
  const caseIndex = new Map((entries || []).filter((entry) => entry && entry.caseId).map((entry) => [entry.caseId, entry]));
  const section = screen('learning learning-plan');
  section.append(
    learningHeader('План обучения', 'Семь месяцев, четырнадцать спринтов, недели, проекты, карьерные действия и связи с тренажером.'),
    searchPanel(content),
    overview(content),
    monthsRoadmap(content, examsByMonth, caseIndex),
  );
  return section;
}

function searchPanel(content) {
  const box = disclosurePanel('Поиск по курсу', false, 'learning-plan-search');
  box.append(LearningSearchPanel(content));
  return box;
}

function overview(content) {
  const box = disclosurePanel('Обзор плана', false, 'learning-plan-overview');
  box.append(
    text('h3', 'learning-card__title', content.plan.title),
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

function monthsRoadmap(content, examsByMonth, caseIndex) {
  const wrap = document.createElement('div');
  wrap.className = 'learning-plan-browser';
  const months = content.plan.months || [];
  if (months.length === 0) {
    wrap.append(card('learning-month'));
    wrap.firstElementChild.append(text('p', 'learning-empty', 'В плане пока нет месяцев.'));
    return wrap;
  }

  const monthParam = readQueryParam('month');
  if (!monthParam) {
    wrap.append(stepNavigator(months));
    return wrap;
  }

  const selectedMonth = readBoundedNumber(monthParam, 1, months.length, 1);
  const month = months.find((item) => item.month === selectedMonth) || months[0];

  const weekParam = readQueryParam('week');
  if (!weekParam) {
    wrap.append(stepNavigator(months, month));
    return wrap;
  }

  const selectedWeek = readBoundedNumber(weekParam, 1, month.weeks?.length || 1, 1);
  const week = month.weeks?.find((item) => item.week === selectedWeek) || month.weeks?.[selectedWeek - 1] || month.weeks?.[0] || null;
  const days = buildWeekDays(week, month);

  const dayParam = readQueryParam('day');
  if (!dayParam) {
    wrap.append(stepNavigator(months, month, week));
    return wrap;
  }

  const selectedDay = readBoundedNumber(dayParam, 1, days.length || 6, 1);
  const day = days.find((item) => item.day === selectedDay) || days[0];

  wrap.append(
    monthPanel(months, month, week, day, days, examsByMonth.get(month.month), caseIndex),
    planNavigator(months, month, week, day),
  );
  return wrap;
}

function stepNavigator(months, selectedMonth = null, selectedWeek = null) {
  const box = card('learning-plan-step');
  box.append(text('h2', 'learning-card__title', stepTitle(selectedMonth, selectedWeek)));

  const monthGroup = segmentedGroup('Месяцы');
  const monthLinks = monthGroup.querySelector('.learning-segmented');
  for (const month of months) {
    monthLinks.append(segmentLink(
      `Месяц ${month.month}`,
      planHref(month.month),
      month.month === selectedMonth?.month,
    ));
  }
  box.append(monthGroup);

  if (selectedMonth) {
    const weekGroup = segmentedGroup('Недели');
    const weekLinks = weekGroup.querySelector('.learning-segmented');
    for (const week of selectedMonth.weeks || []) {
      weekLinks.append(segmentLink(
        `Неделя ${week.week}`,
        planHref(selectedMonth.month, week.week),
        week.week === selectedWeek?.week,
      ));
    }
    box.append(weekGroup);
  }

  if (selectedMonth && selectedWeek) {
    const dayGroup = segmentedGroup('Дни');
    const dayLinks = dayGroup.querySelector('.learning-segmented');
    for (const day of buildWeekDays(selectedWeek, selectedMonth)) {
      dayLinks.append(segmentLink(
        dayLabel(day),
        planHref(selectedMonth.month, selectedWeek.week, day.day),
        false,
      ));
    }
    box.append(dayGroup);
  }

  return box;
}

function stepTitle(selectedMonth, selectedWeek) {
  if (selectedMonth && selectedWeek) return `Месяц ${selectedMonth.month} · Неделя ${selectedWeek.week}`;
  if (selectedMonth) return `Месяц ${selectedMonth.month}`;
  return 'Выберите месяц';
}

function planNavigator(months, selectedMonth, selectedWeek, selectedDay) {
  const box = disclosurePanel('Переход к другому дню', false, 'learning-plan-nav');

  const monthGroup = segmentedGroup('Месяцы');
  const monthLinks = monthGroup.querySelector('.learning-segmented');
  for (const month of months) {
    monthLinks.append(segmentLink(
      `Месяц ${month.month}`,
      planHref(month.month),
      month.month === selectedMonth.month,
    ));
  }
  box.append(monthGroup);

  const weekGroup = segmentedGroup('Недели');
  const weekLinks = weekGroup.querySelector('.learning-segmented');
  for (const week of selectedMonth.weeks || []) {
    weekLinks.append(segmentLink(
      `Неделя ${week.week}`,
      planHref(selectedMonth.month, week.week),
      selectedWeek?.week === week.week,
    ));
  }
  box.append(weekGroup);

  const dayGroup = segmentedGroup('Дни');
  const dayLinks = dayGroup.querySelector('.learning-segmented');
  for (const day of buildWeekDays(selectedWeek, selectedMonth)) {
    dayLinks.append(segmentLink(
      dayLabel(day),
      planHref(selectedMonth.month, selectedWeek?.week || 1, day.day),
      selectedDay?.day === day.day,
    ));
  }
  box.append(dayGroup);
  return box;
}

function monthPanel(months, month, selectedWeek, selectedDay, days, savedExam, caseIndex) {
  const box = card('learning-month');
  box.id = `month-${month.month}`;
  box.classList.add('is-highlighted');
  box.append(
    focusHeader(months, month, selectedWeek, selectedDay),
    DayDetail(selectedDay, month, selectedWeek, caseIndex),
  );

  const monthInfo = disclosurePanel('Информация о месяце', false);
  monthInfo.append(monthSummary(month));
  box.append(monthInfo);

  const weekInfo = disclosurePanel('Неделя и дни', false);
  weekInfo.append(weekCard(selectedWeek, month, selectedDay, days));
  box.append(weekInfo);

  const sprintInfo = disclosurePanel('Спринты', false);
  const sprints = document.createElement('div');
  sprints.className = 'learning-sprints';
  for (const sprint of month.sprints || []) sprints.append(sprintCard(sprint, selectedWeek));
  sprintInfo.append(sprints);
  box.append(sprintInfo);

  if (month.projects?.length) {
    const projectInfo = disclosurePanel('Проекты месяца', false);
    const projects = document.createElement('div');
    projects.className = 'learning-mini-grid';
    for (const project of month.projects) {
      const projectCard = document.createElement('section');
      projectCard.className = 'learning-mini-card';
      projectCard.append(
        text('strong', '', project.title),
        text('p', 'learning-muted', project.businessQuestion),
      );
      projects.append(projectCard);
    }
    projectInfo.append(projects);
    box.append(projectInfo);
  }

  if (month.careerActions?.length) {
    const careerInfo = disclosurePanel('Карьерные действия', false);
    const list = document.createElement('ul');
    list.className = 'learning-list';
    for (const action of month.careerActions) {
      const li = document.createElement('li');
      li.textContent = action;
      list.append(li);
    }
    careerInfo.append(list);
    box.append(careerInfo);
  }

  const moduleIds = month.trainerLinks?.map((link) => link.module) || [];
  const moduleInfo = disclosurePanel('Подходящие модули тренажера', false);
  moduleInfo.append(moduleLinks(moduleIds));
  box.append(moduleInfo);

  const examInfo = disclosurePanel('Экзамен месяца', false);
  examInfo.append(monthlyExamPanel(month, savedExam));
  box.append(examInfo);
  return box;
}

function focusHeader(months, month, week, day) {
  const head = document.createElement('header');
  head.className = 'learning-focus-head';
  const prevHref = adjacentDayHref(months, month, week, day, -1);
  const nextHref = adjacentDayHref(months, month, week, day, 1);

  const copy = document.createElement('div');
  copy.className = 'learning-focus-head__copy';
  copy.append(
    text('span', 'learning-month__badge', `Месяц ${month.month} · Неделя ${week?.week || 1} · ${dayLabel(day)}`),
    text('h2', 'learning-focus-head__title', day?.title || month.title),
    text('p', 'learning-muted', `${month.title} · ${week?.title || month.focus}`),
  );

  const actions = document.createElement('div');
  actions.className = 'learning-focus-head__actions';
  actions.append(
    routeButton('Предыдущий день', prevHref, !prevHref),
    routeButton('Следующий день', nextHref, !nextHref, true),
  );
  head.append(copy, actions);
  return head;
}

function monthSummary(month) {
  const wrap = document.createElement('div');
  const meta = document.createElement('div');
  meta.className = 'learning-month__meta';
  meta.append(
    smallStat('Артефакт', month.artifact || 'Портфолио-результат'),
    smallStat('Навыки', (month.skills || []).join(', ')),
  );
  wrap.append(text('p', 'learning-muted', month.focus), meta);
  return wrap;
}

function sprintCard(sprint, selectedWeek) {
  const box = card('learning-sprint');
  if ((sprint.weeks || []).includes(selectedWeek?.week)) box.classList.add('is-current');
  box.append(
    text('span', 'learning-month__badge', `Спринт ${sprint.sprint}`),
    text('strong', '', sprint.title),
    text('p', 'learning-muted', `Недели: ${(sprint.weeks || []).join(', ')}`),
    text('p', 'learning-muted', `Definition of done: ${sprint.definitionOfDone}`),
  );
  return box;
}

function weekCard(week, month, selectedDay, days) {
  const box = card('learning-week');
  if (!week) {
    box.append(text('p', 'learning-empty', 'Неделя не найдена.'));
    return box;
  }
  box.append(
    text('strong', '', `Неделя ${week.week}: ${week.title}`),
    text('p', 'learning-muted', selectedDay ? `${dayLabel(selectedDay)} · ${selectedDay.title}` : week.title),
  );

  const dayGrid = document.createElement('div');
  dayGrid.className = 'learning-day-grid';
  for (const day of days) {
    const dayLink = document.createElement('a');
    dayLink.href = planHref(month.month, week.week, day.day);
    dayLink.className = 'learning-day-pill';
    if (day.day === selectedDay?.day) {
      dayLink.classList.add('is-current');
      dayLink.setAttribute('aria-current', 'true');
    }
    dayLink.append(
      text('span', '', dayLabel(day)),
      text('strong', '', day.title),
    );
    dayGrid.append(dayLink);
  }
  box.append(dayGrid);
  return box;
}

function segmentedGroup(label) {
  const group = document.createElement('section');
  group.className = 'learning-plan-picker';
  group.append(text('h3', 'learning-subtitle', label));
  const links = document.createElement('div');
  links.className = 'learning-segmented';
  group.append(links);
  return group;
}

function segmentLink(label, href, active) {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = label;
  if (active) {
    link.className = 'is-current';
    link.setAttribute('aria-current', 'true');
  }
  return link;
}

function planHref(month, week, day) {
  const params = new URLSearchParams();
  if (Number.isInteger(Number(month))) params.set('month', String(month));
  if (Number.isInteger(Number(week))) params.set('week', String(week));
  if (Number.isInteger(Number(day))) params.set('day', String(day));
  const query = params.toString();
  return `#/learning/plan${query ? `?${query}` : ''}`;
}

function adjacentDayHref(months, month, week, day, direction) {
  const route = [];
  for (const planMonth of months || []) {
    for (const planWeek of planMonth.weeks || []) {
      for (const planDay of buildWeekDays(planWeek, planMonth)) {
        route.push({ month: planMonth.month, week: planWeek.week, day: planDay.day });
      }
    }
  }
  const index = route.findIndex((item) => (
    item.month === month?.month
    && item.week === week?.week
    && item.day === day?.day
  ));
  const next = route[index + direction];
  return next ? planHref(next.month, next.week, next.day) : '';
}

function routeButton(label, href, disabled, primary = false) {
  const link = document.createElement('a');
  link.className = `learning-button${primary ? ' learning-button--primary' : ''}`;
  link.textContent = label;
  if (disabled) {
    link.classList.add('is-disabled');
    link.setAttribute('aria-disabled', 'true');
    link.tabIndex = -1;
    link.href = '#/learning/plan';
  } else {
    link.href = href;
  }
  return link;
}

function disclosurePanel(title, open = false, className = '') {
  const details = document.createElement('details');
  details.className = `learning-disclosure${className ? ` ${className}` : ''}`;
  details.open = Boolean(open);
  const summary = document.createElement('summary');
  summary.append(text('span', '', title));
  details.append(summary);
  return details;
}

function readBoundedNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(Math.max(number, min), max);
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
