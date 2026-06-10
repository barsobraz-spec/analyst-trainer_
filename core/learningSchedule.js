// core/learningSchedule.js — календарная модель и состав дня (T3.1/T3.2).
//
// Модель MVP из PRD: 7 месяцев, 4 недели в месяце, 6 учебных дней в неделю,
// 7-й день — отдых или свободное повторение. Модуль не трогает DOM и IndexedDB.

export const LEARNING_MONTHS = 7;
export const WEEKS_PER_MONTH = 4;
export const STUDY_DAYS_PER_WEEK = 6;
export const CALENDAR_DAYS_PER_WEEK = 7;
export const TOTAL_STUDY_DAYS = LEARNING_MONTHS * WEEKS_PER_MONTH * STUDY_DAYS_PER_WEEK;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function todayISO(date = new Date()) {
  return toLocalISODate(date);
}

export function calculateStudyPosition(startDateISO, currentDate = new Date()) {
  if (!startDateISO) {
    return { status: 'not_configured', studyDay: 0, dayKey: 'learning-day-0' };
  }

  const start = parseLocalDate(startDateISO);
  if (!start) {
    return { status: 'invalid_start', studyDay: 0, dayKey: 'learning-day-0' };
  }

  const current = parseLocalDate(toLocalISODate(currentDate));
  const calendarOffset = Math.floor((current.getTime() - start.getTime()) / MS_PER_DAY);
  if (calendarOffset < 0) {
    return {
      status: 'before_start',
      startDate: startDateISO,
      daysUntilStart: Math.abs(calendarOffset),
      studyDay: 0,
      dayKey: 'learning-day-0',
    };
  }

  const weekIndex = Math.floor(calendarOffset / CALENDAR_DAYS_PER_WEEK);
  const dayOfWeek = (calendarOffset % CALENDAR_DAYS_PER_WEEK) + 1;
  const restDay = dayOfWeek === CALENDAR_DAYS_PER_WEEK;

  if (weekIndex >= LEARNING_MONTHS * WEEKS_PER_MONTH) {
    return {
      status: 'completed',
      startDate: startDateISO,
      studyDay: TOTAL_STUDY_DAYS,
      dayKey: `learning-day-${TOTAL_STUDY_DAYS}`,
      calendarDay: calendarOffset + 1,
      restDay,
    };
  }

  const month = Math.floor(weekIndex / WEEKS_PER_MONTH) + 1;
  const weekOfMonth = (weekIndex % WEEKS_PER_MONTH) + 1;
  const studyDayInWeek = Math.min(dayOfWeek, STUDY_DAYS_PER_WEEK);
  const dayInMonth = (weekOfMonth - 1) * STUDY_DAYS_PER_WEEK + studyDayInWeek;
  const studyDay = weekIndex * STUDY_DAYS_PER_WEEK + studyDayInWeek;
  const dayKey = restDay
    ? restDayKeyForWeek(weekIndex + 1)
    : dayKeyForStudyDay(studyDay);

  return {
    status: restDay ? 'rest' : 'active',
    startDate: startDateISO,
    studyDay,
    dayKey,
    calendarDay: calendarOffset + 1,
    month,
    weekOfMonth,
    dayOfWeek,
    dayInMonth,
    restDay,
  };
}

export function buildDailyPlan(content, position, mode = 'regular') {
  if (!content || !position || !position.month) return { items: [], tasks: [] };

  const month = content.monthsByNumber.get(position.month);
  const week = month?.weeks?.[position.weekOfMonth - 1] || null;
  const topics = Array.isArray(week?.topics) ? week.topics : [];
  const studyDayOfWeek = Math.min(Math.max(position.dayOfWeek || 1, 1), STUDY_DAYS_PER_WEEK);
  const isRestDay = Boolean(position.restDay);
  const detailedDay = pickDetailedDay(week, position);
  const topic = detailedDay?.title || (topics.length > 0
    ? topics[(studyDayOfWeek - 1) % topics.length]
    : week?.title || month?.focus || 'Учебная тема дня');
  const topicDetail = detailedDay?.summary || (isRestDay
    ? 'Закройте хвосты, повторите слабые места или просто восстановите ресурс.'
    : week?.title || month?.title);

  const monthTasks = content.allTasks
    .filter((task) => task.month === position.month)
    .sort((a, b) => (a.number || 9999) - (b.number || 9999) || a.id.localeCompare(b.id));
  const desiredTaskCount = isRestDay ? 0 : (mode === 'minimal' ? 1 : 3);
  const tasks = pickDailyTasks(monthTasks, position.dayInMonth || 1, desiredTaskCount);

  const practiceModules = unique([
    ...(tasks.flatMap((task) => task.trainerModules || [])),
    ...(month?.trainerLinks || []).map((link) => link.module),
  ]);

  const project = pickForDay(month?.projects || [], position.dayInMonth || 1);
  const careerSource = content.careerActionsByMonth.get(position.month);
  const careerActions = Array.isArray(careerSource?.actions) && careerSource.actions.length > 0
    ? careerSource.actions
    : month?.careerActions || [];
  const careerAction = pickForDay(careerActions, position.dayInMonth || 1);

  const items = [
    {
      id: 'topic',
      type: 'topic',
      title: topic,
      detail: topicDetail,
      active: true,
    },
    ...tasks.map((task) => ({
      id: `task:${task.id}`,
      type: 'task',
      title: task.title,
      detail: skillTitle(content, task.skill),
      taskId: task.id,
      active: true,
    })),
    {
      id: 'practice',
      type: 'practice',
      title: practiceTitle(mode, isRestDay),
      detail: practiceDetail(practiceModules, isRestDay),
      trainerModules: practiceModules,
      active: true,
    },
    {
      id: 'project',
      type: 'project',
      title: project?.title ? `Проект: ${project.title}` : 'Проектное действие',
      detail: project?.businessQuestion || month?.artifact || 'Продвиньте портфолио на один заметный шаг.',
      active: !isRestDay && mode !== 'minimal' && Boolean(project || month?.artifact),
    },
    {
      id: 'career',
      type: 'career',
      title: 'Карьерный шаг',
      detail: typeof careerAction === 'string' ? careerAction : careerAction?.title || '',
      active: !isRestDay && mode !== 'minimal' && Boolean(careerAction),
    },
    {
      id: 'journal',
      type: 'journal',
      title: 'Дневник аналитика',
      detail: 'Зафиксируйте, что сделали, что поняли и где застряли.',
      active: true,
    },
  ].filter((item) => item.active !== false);

  return { month, week, topic, detailedDay, tasks, practiceModules, project, careerAction, items };
}

export function dayKeyForStudyDay(studyDay) {
  return `learning-day-${Math.max(0, Number(studyDay) || 0)}`;
}

export function restDayKeyForWeek(weekNumber) {
  return `learning-rest-week-${Math.max(0, Number(weekNumber) || 0)}`;
}

function pickDetailedDay(week, position) {
  if (!week) return null;
  if (position.restDay) return week.restDay || null;
  if (!Array.isArray(week.days)) return null;
  const dayOfWeek = Math.min(Math.max(position.dayOfWeek || 1, 1), STUDY_DAYS_PER_WEEK);
  return week.days.find((day) => day.day === dayOfWeek) || week.days[dayOfWeek - 1] || null;
}

function pickDailyTasks(tasks, dayInMonth, count) {
  if (!tasks.length || count <= 0) return [];
  const offset = ((Math.max(dayInMonth, 1) - 1) * count) % tasks.length;
  return Array.from({ length: Math.min(count, tasks.length) }, (_, i) => tasks[(offset + i) % tasks.length]);
}

function pickForDay(items, dayInMonth) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[(Math.max(dayInMonth, 1) - 1) % items.length];
}

function practiceTitle(mode, isRestDay) {
  if (isRestDay) return 'Свободное повторение';
  return mode === 'minimal' ? 'Короткая практика руками' : 'Практическое действие';
}

function practiceDetail(practiceModules, isRestDay) {
  if (isRestDay) {
    return 'Повторите слабые места, завершите хвосты или восстановитесь без новых обязательств.';
  }
  if (practiceModules.length > 0) {
    return `Перейдите в ${practiceModules[0]} и закрепите тему на кейсе.`;
  }
  return 'Сделайте маленький артефакт: запрос, таблицу, график или вывод.';
}

function skillTitle(content, skillId) {
  return content.skillsById.get(skillId)?.title || skillId || 'Навык';
}

function parseLocalDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toLocalISODate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
