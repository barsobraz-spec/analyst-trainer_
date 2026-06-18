// core/learningContent.js — загрузка JSON-контента учебной системы (T2.2).
//
// Единственная точка чтения learning-plan/data для UI. Word-источники остаются
// первоисточником в репозитории, но браузер во время работы читает только JSON.
//
// Загрузка разбита на два уровня (Этап 6):
//   • Базовый (быстрый): plan + tasks + projects + career (~300 КБ)
//   • Ленивый: practiceContent грузится по навыку через loadPracticeSlice(skillId)
//     или весь сразу через loadAllPracticeContent() — только когда экран это требует.

import { APP_CACHE_VERSION } from '../config.js';

// Добавляет к пути данных версию кэша приложения, чтобы при обновлении контента
// (bump APP_CACHE_VERSION) браузер гарантированно перечитывал свежий JSON, а не
// отдавал устаревшую копию из HTTP-кэша.
function withVersion(path) {
  return `${path}${path.includes('?') ? '&' : '?'}v=${APP_CACHE_VERSION}`;
}

const CONTENT_PATHS = Object.freeze({
  plan: './learning-plan/data/plan.json',
  tasks: './learning-plan/data/tasks.json',
  // practiceContent (~1 МБ) убрана из базовой загрузки — используй loadPracticeSlice()
  projects: './learning-plan/data/projects.json',
  career: './learning-plan/data/career.json',
});

const PRACTICE_INDEX_PATH = './learning-plan/data/practice-index.json';
const PRACTICE_CHUNK_BASE = './learning-plan/data/chunks/';

let contentPromise = null;
let practiceIndexPromise = null;
const practiceSlicePromises = new Map();

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
    const response = await fetch(withVersion(path));
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

  // practiceContent не грузится в базовой загрузке — пустые структуры до явного
  // вызова enrichContentWithPractice() или loadAllPracticeContent().
  return {
    plan,
    tasks,
    practiceContent: { items: [] },
    projects,
    career,
    allTasks,
    practiceItems: [],
    skillsById,
    practicesByTaskId: new Map(),
    practicesById: new Map(),
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

// --- Ленивая загрузка практики (Этап 6) --------------------------------------

// Загрузить индекс чанков практики (2.5 КБ). Кешируется на весь сеанс.
export function loadPracticeIndex() {
  if (!practiceIndexPromise) {
    practiceIndexPromise = fetch(withVersion(PRACTICE_INDEX_PATH))
      .then((r) => {
        if (!r.ok) throw new LearningContentError(`Индекс практики недоступен (HTTP ${r.status})`);
        return r.json();
      })
      .catch((err) => {
        practiceIndexPromise = null;
        return { chunks: [] };
      });
  }
  return practiceIndexPromise;
}

// Загрузить практику для одного навыка по его id (например 'excel').
// Результат кешируется на весь сеанс — повторные вызовы возвращают тот же промис.
export function loadPracticeSlice(skillId) {
  if (!practiceSlicePromises.has(skillId)) {
    const path = `${PRACTICE_CHUNK_BASE}practice-${skillId}.json`;
    const promise = fetch(withVersion(path))
      .then((r) => {
        if (!r.ok) throw new LearningContentError(`Чанк практики '${skillId}' недоступен (HTTP ${r.status})`);
        return r.json();
      })
      .then((data) => (Array.isArray(data.items) ? data.items : []))
      .catch((err) => {
        practiceSlicePromises.delete(skillId);
        throw err instanceof LearningContentError ? err
          : new LearningContentError(`Не удалось загрузить практику для '${skillId}'.`, { cause: err });
      });
    practiceSlicePromises.set(skillId, promise);
  }
  return practiceSlicePromises.get(skillId);
}

// Загрузить всю практику (все навыки) параллельно.
// Используется PracticeView — грузится только при открытии этого экрана.
export async function loadAllPracticeContent() {
  const index = await loadPracticeIndex();
  const skillIds = (index.chunks || []).map((c) => c.skill).filter(Boolean);
  if (skillIds.length === 0) return [];
  const slices = await Promise.all(skillIds.map((id) => loadPracticeSlice(id).catch(() => [])));
  return slices.flat();
}

// Добавить загруженные items практики к уже нормализованному объекту контента.
// Не мутирует исходный объект — возвращает новый.
export function enrichContentWithPractice(content, rawItems = []) {
  const practiceItems = normalizePracticeItems(rawItems);
  const practicesByTaskId = new Map();
  const practicesById = new Map();
  for (const item of practiceItems) {
    practicesById.set(item.id, item);
    for (const taskId of item.taskIds) {
      if (taskId && !practicesByTaskId.has(taskId)) practicesByTaskId.set(taskId, item);
    }
  }
  return { ...content, practiceItems, practicesById, practicesByTaskId };
}

function normalizePracticeItems(rawItems = []) {
  return rawItems.map((item, index) => ({
    ...item,
    id: item.id || `practice-${item.taskId || index + 1}`,
    taskIds: normalizeStringList(item.taskIds || [item.taskId]),
    moduleIds: normalizeStringList(item.moduleIds || item.trainerModules || item.modules?.map((m) => m.id)),
  }));
}
