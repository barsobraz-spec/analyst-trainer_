// modules/learning/TodayView.js — ежедневный экран учебной системы (T3).

import {
  getLearningSettings,
  saveLearningSettings,
  getDailyProgress,
  saveDailyProgress,
  getAllDailyProgress,
  getJournalEntry,
  saveJournalEntry,
  getAllTaskProgress,
  saveTaskProgress,
} from '../../core/db.js';
import { calculateDayProgress, TASK_STATUS } from '../../core/learningProgress.js';
import {
  buildDailyPlan,
  calculateStudyPosition,
  dayKeyForStudyDay,
  todayISO,
  TOTAL_STUDY_DAYS,
} from '../../core/learningSchedule.js';
import { moduleButton } from '../../core/learningLinks.js';
import { navigate } from '../../core/router.js';
import { LearningRemindersPanel, REMINDER_SUGGESTIONS } from './LearningReminders.js';
import { ReadinessLevelPanel } from './ReadinessLevelPanel.js';
import {
  LearningSearchPanel,
  TASK_STATUS_LABELS,
  button,
  card,
  debounce,
  emptyPanel,
  field,
  learningHeader,
  progressBar,
  screen,
  statusSelect,
  text,
  toProgressMap,
  withLearningContent,
} from './learningUi.js';

export function LearningTodayView() {
  return withLearningContent(renderToday);
}

async function renderToday(content) {
  const section = screen('learning learning-today');
  section.append(
    learningHeader('Сегодня', 'Рабочий день строится из даты старта, текущей недели плана, задач, проекта и карьерного шага.'),
    LearningSearchPanel(content),
  );
  section.append(await ReadinessLevelPanel(content));
  section.append(await LearningRemindersPanel({
    title: 'Внутренние напоминания',
    suggestions: [
      REMINDER_SUGGESTIONS.today,
      REMINDER_SUGGESTIONS.projects,
      REMINDER_SUGGESTIONS.weakSpots,
      REMINDER_SUGGESTIONS.career,
    ],
  }));

  const settings = await getLearningSettings().catch(() => null);
  const startDate = settings?.startDate || '';
  const mode = settings?.dayMode || 'regular';
  const position = calculateStudyPosition(startDate);

  section.append(settingsCard(settings, position));

  if (position.status === 'not_configured' || position.status === 'invalid_start') {
    section.append(emptyPanel('Укажите дату старта, чтобы приложение рассчитало текущий учебный день.'));
    return section;
  }

  if (position.status === 'before_start') {
    section.append(infoCard('Старт впереди', `До начала маршрута: ${position.daysUntilStart} дн. Можно подготовить GitHub, LinkedIn и рабочую папку.`));
    return section;
  }

  if (position.status === 'completed') {
    section.append(completedCard());
    return section;
  }

  const [dayState, journal, taskProgressRows, allDays] = await Promise.all([
    getDailyProgress(position.dayKey).catch(() => null),
    getJournalEntry(position.dayKey).catch(() => null),
    getAllTaskProgress().catch(() => []),
    getAllDailyProgress().catch(() => []),
  ]);
  const taskProgress = toProgressMap(taskProgressRows);
  const dailyPlan = buildDailyPlan(content, position, mode);
  const progressItems = dailyPlan.items
    .filter(isTrackableDayItem)
    .map((item) => itemForProgress(item, dayState, journal, taskProgress));
  const progress = calculateDayProgress(progressItems);

  section.append(summaryGrid(content, position, dailyPlan, progress, mode));

  const previousMissing = position.studyDay > 1
    && !allDays.some((day) => day.dayKey === dayKeyForStudyDay(previousRequiredStudyDay(position)));
  if (previousMissing) section.append(skipStrategyCard(position, settings));

  section.append(actionsCard(content, position, dailyPlan, dayState, journal, taskProgress));
  section.append(journalCard(position, journal));
  return section;
}

function settingsCard(settings, position) {
  const box = card('learning-settings');
  const title = text('h2', 'learning-card__title', 'Настройки маршрута');
  const form = document.createElement('form');
  form.className = 'learning-settings__form';

  const startInput = document.createElement('input');
  startInput.type = 'date';
  startInput.value = settings?.startDate || todayISO();

  const modeSelect = document.createElement('select');
  for (const [value, label] of [['regular', 'Обычный день'], ['minimal', 'Минимальный день']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if ((settings?.dayMode || 'regular') === value) option.selected = true;
    modeSelect.append(option);
  }

  const save = button('Сохранить', 'learning-button--primary');
  save.type = 'submit';
  form.append(field('Дата старта', startInput), field('Режим дня', modeSelect), save);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveLearningSettings({
      ...(settings || {}),
      startDate: startInput.value,
      dayMode: modeSelect.value,
    });
    navigate('/learning/today');
  });

  const meta = document.createElement('p');
  meta.className = 'learning-settings__meta';
  meta.textContent = routeMetaText(position);

  box.append(title, form, meta);
  return box;
}

function routeMetaText(position) {
  if (!position.studyDay) return 'После сохранения появится текущий учебный день.';
  if (position.restDay) {
    return `Сегодня день отдыха / повторения после учебного дня ${position.studyDay} из ${TOTAL_STUDY_DAYS}.`;
  }
  return `Сейчас учебный день ${position.studyDay} из ${TOTAL_STUDY_DAYS}.`;
}

function summaryGrid(content, position, dailyPlan, progress, mode) {
  const wrap = document.createElement('div');
  wrap.className = 'learning-summary';
  const month = content.monthsByNumber.get(position.month);
  wrap.append(
    stat('Учебный день', String(position.studyDay), position.restDay ? 'День отдыха / повторения' : `День ${position.dayOfWeek} недели`),
    stat('Период', `М${position.month} · Н${position.weekOfMonth}`, month?.title || ''),
    stat('Режим', mode === 'minimal' ? 'Минимальный' : 'Обычный', mode === 'minimal' ? '30-60 минут' : 'Полный учебный блок'),
    (() => {
      const box = card('learning-summary__progress');
      box.append(progressBar(progress, 'Прогресс дня'));
      return box;
    })(),
  );
  const theme = card('learning-topic');
  theme.append(
    text('h2', 'learning-card__title', position.restDay ? 'Свободное повторение' : 'Тема дня'),
    text('p', 'learning-topic__main', dailyPlan.topic || month?.focus || ''),
    text('p', 'learning-muted', dailyPlan.week?.title || month?.focus || ''),
  );
  wrap.append(theme);
  return wrap;
}

function stat(label, value, hint) {
  const box = card('learning-summary__stat');
  box.append(text('span', 'learning-stat__label', label), text('strong', 'learning-stat__value', value));
  if (hint) box.append(text('span', 'learning-stat__hint', hint));
  return box;
}

function actionsCard(content, position, dailyPlan, dayState, journal, taskProgress) {
  const box = card('learning-actions-card');
  box.append(text('h2', 'learning-card__title', 'Состав дня'));
  const list = document.createElement('div');
  list.className = 'learning-day-list';

  for (const item of dailyPlan.items.filter(isTrackableDayItem)) {
    const row = document.createElement('div');
    row.className = `learning-day-item learning-day-item--${item.type}`;
    const body = document.createElement('div');
    body.className = 'learning-day-item__body';
    body.append(text('strong', 'learning-day-item__title', item.title), text('span', 'learning-day-item__detail', item.detail || ''));

    const controls = document.createElement('div');
    controls.className = 'learning-day-item__controls';

    if (item.type === 'task') {
      const progress = taskProgress.get(item.taskId);
      const select = statusSelect(
        Object.keys(TASK_STATUS_LABELS),
        TASK_STATUS_LABELS,
        progress?.status || TASK_STATUS.notStarted,
      );
      select.addEventListener('change', async () => {
        const task = content.allTasks.find((candidate) => candidate.id === item.taskId);
        await saveTaskProgress({
          taskId: item.taskId,
          status: select.value,
          month: task?.month,
          skill: task?.skill,
          notes: progress?.notes || '',
        });
        navigate('/learning/today');
      });
      controls.append(select);
    } else if (item.type === 'practice') {
      for (const moduleId of item.trainerModules || []) controls.append(moduleButton(moduleId));
      controls.prepend(dayCheckbox(position, item, dayState));
    } else if (item.type !== 'journal') {
      controls.append(dayCheckbox(position, item, dayState));
    } else {
      const done = Boolean(journal?.did || journal?.learned || journal?.stuck);
      controls.append(text('span', done ? 'learning-done' : 'learning-muted', done ? 'Заполнено' : 'Ждёт записи'));
    }

    row.append(body, controls);
    list.append(row);
  }

  box.append(list);
  return box;
}

function dayCheckbox(position, item, dayState) {
  const label = document.createElement('label');
  label.className = 'learning-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(dayState?.items?.[item.id]?.completed || dayState?.items?.[item.id] === true);
  input.addEventListener('change', async () => {
    await saveDailyProgress({
      dayKey: position.dayKey,
      studyDay: position.studyDay,
      items: {
        ...(dayState?.items || {}),
        [item.id]: { completed: input.checked },
      },
    });
    navigate('/learning/today');
  });
  label.append(input, text('span', '', 'Готово'));
  return label;
}

function journalCard(position, journal) {
  const box = card('learning-journal');
  box.append(text('h2', 'learning-card__title', 'Дневник аналитика'));
  const form = document.createElement('form');
  form.className = 'learning-journal__form';
  const did = textarea(journal?.did || '');
  const learned = textarea(journal?.learned || '');
  const stuck = textarea(journal?.stuck || '');
  const status = text('p', 'learning-muted', 'Запись сохраняется локально по текущему учебному дню.');

  const save = debounce(async () => {
    await saveJournalEntry({
      dayKey: position.dayKey,
      studyDay: position.studyDay,
      did: did.value,
      learned: learned.value,
      stuck: stuck.value,
    });
    status.textContent = 'Сохранено локально.';
  }, 450);
  for (const control of [did, learned, stuck]) control.addEventListener('input', save);

  form.append(field('Что сделал', did), field('Что понял', learned), field('Где застрял', stuck), status);
  box.append(form);
  return box;
}

function skipStrategyCard(position, settings) {
  const box = card('learning-skip');
  box.append(
    text('h2', 'learning-card__title', 'Есть пропущенный день'),
    text('p', 'learning-muted', 'В MVP план не сдвигается автоматически. Выберите явную стратегию на сегодня.'),
  );
  const actions = document.createElement('div');
  actions.className = 'learning-actions';
  for (const [value, label] of [
    ['continue', 'Продолжить с текущего дня'],
    ['shift', 'Сдвинуть план вручную'],
    ['catch_up', 'Догнать коротким списком'],
  ]) {
    const btn = button(label);
    btn.addEventListener('click', async () => {
      await saveLearningSettings({ ...(settings || {}), skipStrategy: value });
      await saveDailyProgress({ dayKey: position.dayKey, studyDay: position.studyDay, skipStrategy: value, items: {} });
      navigate('/learning/today');
    });
    actions.append(btn);
  }
  box.append(actions);
  return box;
}

function itemForProgress(item, dayState, journal, taskProgress) {
  if (item.type === 'task') {
    return { id: item.id, status: taskProgress.get(item.taskId)?.status || TASK_STATUS.notStarted };
  }
  if (item.type === 'journal') {
    return { id: item.id, completed: Boolean(journal?.did || journal?.learned || journal?.stuck) };
  }
  const value = dayState?.items?.[item.id];
  return value && typeof value === 'object' ? { id: item.id, ...value } : { id: item.id, completed: Boolean(value) };
}

function isTrackableDayItem(item) {
  return item?.type !== 'topic';
}

function previousRequiredStudyDay(position) {
  return position.restDay ? position.studyDay : position.studyDay - 1;
}

function completedCard() {
  const box = card('learning-completed');
  box.append(
    text('h2', 'learning-card__title', 'Маршрут завершён'),
    text('p', 'learning-muted', 'Семь месяцев пройдены. Самое полезное сейчас — повторить слабые места, довести проекты и держать карьерную воронку.'),
  );
  const actions = document.createElement('div');
  actions.className = 'learning-actions';
  for (const [href, label] of [['#/learning/tasks', 'Повторить задачи'], ['#/learning/projects', 'Проекты'], ['#/learning/career', 'Карьера']]) {
    const a = document.createElement('a');
    a.className = 'learning-button';
    a.href = href;
    a.textContent = label;
    actions.append(a);
  }
  box.append(actions);
  return box;
}

function infoCard(title, message) {
  const box = card();
  box.append(text('h2', 'learning-card__title', title), text('p', 'learning-muted', message));
  return box;
}

function textarea(value) {
  const area = document.createElement('textarea');
  area.rows = 3;
  area.value = value;
  return area;
}
