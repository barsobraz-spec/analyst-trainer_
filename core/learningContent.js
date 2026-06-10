// core/learningContent.js — загрузка JSON-контента учебной системы (T2.2).
//
// Единственная точка чтения learning-plan/data для UI. Word-источники остаются
// первоисточником в репозитории, но браузер во время работы читает только JSON.

const CONTENT_PATHS = Object.freeze({
  plan: './learning-plan/data/plan.json',
  tasks: './learning-plan/data/tasks.json',
  practiceContent: './learning-plan/data/practiceContent.json',
  projects: './learning-plan/data/projects.json',
  career: './learning-plan/data/career.json',
});

let contentPromise = null;

export class LearningContentError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'LearningContentError';
    if (cause) this.cause = cause;
  }
}

export function loadLearningContent() {
  if (contentPromise) return contentPromise;
  contentPromise = Promise.all(Object.entries(CONTENT_PATHS).map(async ([key, path]) => {
    const response = await fetch(path);
    if (!response.ok) {
      throw new LearningContentError(`Не удалось загрузить ${path}: HTTP ${response.status}`);
    }
    try {
      return [key, await response.json()];
    } catch (err) {
      throw new LearningContentError(`Файл ${path} повреждён или не является JSON.`, { cause: err });
    }
  }))
    .then((entries) => normalizeContent(Object.fromEntries(entries)))
    .catch((err) => {
      contentPromise = null;
      throw err instanceof LearningContentError
        ? err
        : new LearningContentError('Не удалось загрузить учебный контент.', { cause: err });
    });
  return contentPromise;
}

function normalizeContent(raw) {
  const plan = raw.plan || {};
  const tasks = raw.tasks || {};
  const practiceContent = raw.practiceContent || {};
  const projects = raw.projects || {};
  const career = raw.career || {};

  const allTasks = [
    ...(Array.isArray(tasks.tasks) ? tasks.tasks : []),
    ...(Array.isArray(tasks.supplementalTasks) ? tasks.supplementalTasks : []),
  ].map((task, index) => ({
    ...task,
    number: Number.isFinite(task.number) ? task.number : index + 1,
    source: task.source || 'plan',
  }));

  const skillsById = new Map((tasks.skills || []).map((skill) => [skill.id, skill]));
  const practiceItems = (practiceContent.items || []).map((item, index) => ({
    ...item,
    id: item.id || `practice-${item.taskId || index + 1}`,
    taskIds: normalizeStringList(item.taskIds || [item.taskId]),
    moduleIds: normalizeStringList(item.moduleIds || item.trainerModules || item.modules?.map((module) => module.id)),
  }));
  const practicesByTaskId = new Map();
  const practicesById = new Map();
  for (const item of practiceItems) {
    practicesById.set(item.id, item);
    for (const taskId of item.taskIds) {
      if (taskId && !practicesByTaskId.has(taskId)) practicesByTaskId.set(taskId, item);
    }
  }
  const monthsByNumber = new Map((plan.months || []).map((month) => [month.month, month]));
  const careerActionsByMonth = new Map((career.monthlyActions || []).map((item) => [item.month, item]));
  const projectsById = new Map((projects.projects || []).map((project) => [project.id, project]));
  const daysById = new Map();
  for (const month of plan.months || []) {
    for (const week of month.weeks || []) {
      for (const day of normalizeWeekDays(week, month)) {
        if (day.id) daysById.set(day.id, day);
      }
    }
  }

  return {
    plan,
    tasks,
    practiceContent: { ...practiceContent, items: practiceItems },
    projects,
    career,
    allTasks,
    practiceItems,
    skillsById,
    practicesByTaskId,
    practicesById,
    daysById,
    monthsByNumber,
    careerActionsByMonth,
    projectsById,
  };
}

function normalizeWeekDays(week, month) {
  const rows = [];
  const sourceDays = Array.isArray(week.days) ? week.days : [];
  for (const [index, day] of sourceDays.entries()) {
    const dayNumber = Number.isInteger(day?.day) ? day.day : index + 1;
    rows.push(normalizePlanDay(day, month, week, dayNumber));
  }
  if (week.restDay) rows.push(normalizePlanDay(week.restDay, month, week, 7));
  return rows;
}

function normalizePlanDay(day, month, week, fallbackDay) {
  return {
    ...day,
    id: day?.id || `m${month.month}-w${week.week}-d${fallbackDay}`,
    month: day?.month || month.month,
    week: day?.week || week.week,
    day: day?.day || fallbackDay,
    taskIds: normalizeStringList(day?.taskIds),
    practiceIds: normalizeStringList(day?.practiceIds),
    caseIds: normalizeStringList(day?.caseIds),
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

export function safeContentFallback(error) {
  return {
    title: 'Учебный контент недоступен',
    message: error?.message || 'Проверьте локальный HTTP-сервер и файлы learning-plan/data.',
  };
}
