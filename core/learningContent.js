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
  const practicesByTaskId = new Map((practiceContent.items || []).map((item) => [item.taskId, item]));
  const monthsByNumber = new Map((plan.months || []).map((month) => [month.month, month]));
  const careerActionsByMonth = new Map((career.monthlyActions || []).map((item) => [item.month, item]));
  const projectsById = new Map((projects.projects || []).map((project) => [project.id, project]));

  return {
    plan,
    tasks,
    practiceContent,
    projects,
    career,
    allTasks,
    skillsById,
    practicesByTaskId,
    monthsByNumber,
    careerActionsByMonth,
    projectsById,
  };
}

export function safeContentFallback(error) {
  return {
    title: 'Учебный контент недоступен',
    message: error?.message || 'Проверьте локальный HTTP-сервер и файлы learning-plan/data.',
  };
}
