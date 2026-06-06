// core/learningProgress.js — единые формулы прогресса учебной системы (T0.3).
//
// Модуль не знает о DOM и IndexedDB: получает контент из JSON и пользовательское
// состояние из db.js, возвращает простые агрегаты для экранов "Сегодня",
// "Задачи", "Проекты" и "Слабые места".

export const TASK_STATUS = Object.freeze({
  notStarted: 'not_started',
  inProgress: 'in_progress',
  done: 'done',
  repeat: 'repeat',
});

const DONE_STATUSES = new Set(['done', 'completed', true]);
const CAREER_ACTIVE_STATUSES = new Set(['saved', 'applied', 'screening', 'test_task', 'interview']);
const CAREER_INTERVIEW_STATUSES = new Set(['interview', 'offer']);

export const READINESS_LEVELS = Object.freeze([
  {
    id: 'novice',
    title: 'Новичок',
    minPercent: 0,
    description: 'Фундамент только собирается: важнее стабильный ритм, чем скорость.',
  },
  {
    id: 'junior_ready',
    title: 'Junior Ready',
    minPercent: 35,
    description: 'База уже видна: пора укреплять проекты и закрывать пробелы задачами.',
  },
  {
    id: 'interview_ready',
    title: 'Interview Ready',
    minPercent: 60,
    description: 'Навыки и портфолио достаточно крепкие для регулярной подготовки к интервью.',
  },
  {
    id: 'job_search_mode',
    title: 'Job Search Mode',
    minPercent: 80,
    description: 'Пора держать активную воронку откликов и дорабатывать точечные слабые места.',
  },
]);

export function isCompletedStatus(status) {
  return DONE_STATUSES.has(status);
}

export function calculateDayProgress(dayItems = []) {
  const items = normalizeItems(dayItems).filter((item) => item.active !== false);
  const total = items.length;
  const completed = items.filter((item) => isCompletedItem(item)).length;
  return progressResult(completed, total);
}

export function calculateChecklistProgress(tasks = [], taskProgress = []) {
  const progressByTaskId = toProgressMap(taskProgress, 'taskId');
  const total = Array.isArray(tasks) ? tasks.length : 0;
  let completed = 0;

  for (const task of tasks || []) {
    const status = progressByTaskId.get(task.id)?.status ?? TASK_STATUS.notStarted;
    if (status === TASK_STATUS.done) completed += 1;
  }

  return progressResult(completed, total);
}

export function calculateProjectProgress(project = {}, projectProgress = {}, globalQualityChecklist = []) {
  const state = projectProgress || {};
  const checklist = Array.isArray(project.qualityChecklist) && project.qualityChecklist.length > 0
    ? project.qualityChecklist
    : globalQualityChecklist;
  const checks = [
    state.status && state.status !== TASK_STATUS.notStarted,
    Boolean(state.githubUrl),
    Boolean(state.readmeReady),
    Boolean(state.screenshotsReady),
    Boolean(state.videoDemoReady),
  ];

  const qualityState = state.qualityChecklist || {};
  for (const [index, item] of (checklist || []).entries()) {
    const id = qualityItemId(item, index);
    if (id) checks.push(Boolean(qualityState[id]));
  }

  const completed = checks.filter(Boolean).length;
  return progressResult(completed, checks.length);
}

export function buildMonthlyExamChecklist(month = {}) {
  const checks = [];
  const seen = new Set();
  const add = (id, title, description = '', kind = 'check') => {
    if (!id || !title || seen.has(id)) return;
    seen.add(id);
    checks.push({ id, title, description, kind });
  };

  for (const skill of month.skills || []) {
    add(
      `skill-${slugify(skill)}`,
      `Навык: ${skill}`,
      'Могу объяснить навык и применить его на практической задаче месяца.',
      'skill',
    );
  }

  if (month.artifact) {
    add(
      'artifact',
      `Артефакт: ${month.artifact}`,
      'Артефакт месяца готов к показу: есть результат, выводы и понятная структура.',
      'artifact',
    );
  }

  for (const [index, sprint] of (month.sprints || []).entries()) {
    add(
      `sprint-${sprint.sprint || index + 1}`,
      `Definition of done: ${sprint.title || `спринт ${index + 1}`}`,
      sprint.definitionOfDone || '',
      'definition-of-done',
    );
  }

  for (const project of month.projects || []) {
    add(
      `project-${project.id || slugify(project.title)}`,
      `Проект: ${project.title}`,
      project.businessQuestion || 'Проект связан с бизнес-вопросом месяца.',
      'project',
    );
  }

  return checks;
}

export function calculateMonthlyExamProgress(checklist = [], examProgress = {}) {
  const checks = examProgress?.checks && typeof examProgress.checks === 'object'
    ? examProgress.checks
    : {};
  const total = Array.isArray(checklist) ? checklist.length : 0;
  const completed = (checklist || []).filter((item) => Boolean(checks[item.id])).length;
  return progressResult(completed, total);
}

export function calculatePlanProgress(months = [], monthlyExamProgress = []) {
  const progressByMonth = toProgressMap(monthlyExamProgress, 'month');
  const monthRows = Array.isArray(months) ? months : [];
  if (monthRows.length === 0) return progressResult(0, 0);

  const ratios = monthRows.map((month) => {
    const checklist = buildMonthlyExamChecklist(month);
    return calculateMonthlyExamProgress(checklist, progressByMonth.get(month.month)).ratio;
  });
  const completedRatio = ratios.reduce((sum, ratio) => sum + ratio, 0);
  return {
    completed: Math.round(completedRatio * 100),
    total: monthRows.length * 100,
    ratio: completedRatio / monthRows.length,
    percent: Math.round((completedRatio / monthRows.length) * 100),
  };
}

export function calculateProjectsReadiness(projects = [], projectProgress = [], globalQualityChecklist = []) {
  const progressByProjectId = toProgressMap(projectProgress, 'projectId');
  const projectRows = Array.isArray(projects) ? projects : [];
  if (projectRows.length === 0) return progressResult(0, 0);

  const ratios = projectRows.map((project) =>
    calculateProjectProgress(project, progressByProjectId.get(project.id), globalQualityChecklist).ratio);
  const completedRatio = ratios.reduce((sum, ratio) => sum + ratio, 0);
  return {
    completed: Math.round(completedRatio * 100),
    total: projectRows.length * 100,
    ratio: completedRatio / projectRows.length,
    percent: Math.round((completedRatio / projectRows.length) * 100),
  };
}

export function calculateCareerReadiness(applications = []) {
  const rows = Array.isArray(applications) ? applications : [];
  const active = rows.filter((item) => CAREER_ACTIVE_STATUSES.has(item.status)).length;
  const tests = rows.filter((item) => item.hasTestTask || item.status === 'test_task').length;
  const interviews = rows.filter((item) => CAREER_INTERVIEW_STATUSES.has(item.status)).length;
  const ratio = clamp01(
    Math.min(rows.length / 10, 1) * 0.35
    + Math.min(active / 3, 1) * 0.20
    + Math.min(tests / 2, 1) * 0.20
    + Math.min(interviews / 1, 1) * 0.25,
  );
  return {
    completed: Math.round(ratio * 100),
    total: 100,
    ratio,
    percent: Math.round(ratio * 100),
    stats: { total: rows.length, active, tests, interviews },
  };
}

export function calculateReadinessLevel({
  tasks = [],
  taskProgress = [],
  projects = [],
  projectProgress = [],
  globalQualityChecklist = [],
  months = [],
  monthlyExamProgress = [],
  careerApplications = [],
} = {}) {
  const checklist = calculateChecklistProgress(tasks, taskProgress);
  const project = calculateProjectsReadiness(projects, projectProgress, globalQualityChecklist);
  const plan = calculatePlanProgress(months, monthlyExamProgress);
  const career = calculateCareerReadiness(careerApplications);
  const components = [
    { id: 'checklist', title: 'Чек-лист', weight: 0.40, progress: checklist },
    { id: 'projects', title: 'Проекты', weight: 0.25, progress: project },
    { id: 'plan', title: 'План', weight: 0.20, progress: plan },
    { id: 'career', title: 'Карьера', weight: 0.15, progress: career },
  ];
  const percent = Math.round(components.reduce(
    (sum, item) => sum + item.progress.ratio * item.weight * 100,
    0,
  ));
  const level = [...READINESS_LEVELS]
    .reverse()
    .find((item) => percent >= item.minPercent) || READINESS_LEVELS[0];
  const nextLevel = READINESS_LEVELS.find((item) => item.minPercent > percent) || null;

  return {
    percent,
    ratio: percent / 100,
    level,
    nextLevel,
    components,
  };
}

export function qualityItemId(item, index = 0) {
  if (item && typeof item === 'object') return item.id || `quality-${index + 1}`;
  if (typeof item === 'string' && item.trim()) return `quality-${index + 1}`;
  return null;
}

export function groupWeakSpots(tasks = [], taskProgress = [], skills = []) {
  const progressByTaskId = toProgressMap(taskProgress, 'taskId');
  const skillsById = new Map((skills || []).map((skill) => [skill.id, skill]));
  const grouped = new Map();

  for (const task of tasks || []) {
    const progress = progressByTaskId.get(task.id);
    if (progress?.status !== TASK_STATUS.repeat) continue;

    const skillId = task.skill || progress.skill || 'unknown';
    const skill = skillsById.get(skillId);
    if (!grouped.has(skillId)) {
      grouped.set(skillId, {
        skill: skillId,
        title: skill?.title || skillId,
        count: 0,
        tasks: [],
      });
    }
    const bucket = grouped.get(skillId);
    bucket.count += 1;
    bucket.tasks.push(task);
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'ru'));
}

function normalizeItems(items) {
  if (Array.isArray(items)) return items;
  if (items && typeof items === 'object') {
    return Object.entries(items).map(([id, value]) => {
      if (value && typeof value === 'object') return { id, ...value };
      return { id, completed: Boolean(value) };
    });
  }
  return [];
}

function isCompletedItem(item) {
  if (item === true) return true;
  if (!item || typeof item !== 'object') return false;
  if (item.completed === true) return true;
  return isCompletedStatus(item.status);
}

function toProgressMap(progress, key) {
  if (progress instanceof Map) return progress;
  if (Array.isArray(progress)) {
    return new Map(progress.filter((item) => item?.[key]).map((item) => [item[key], item]));
  }
  if (progress && typeof progress === 'object') {
    return new Map(Object.entries(progress).map(([id, value]) => {
      if (value && typeof value === 'object') return [id, { [key]: id, ...value }];
      return [id, { [key]: id, status: value }];
    }));
  }
  return new Map();
}

function progressResult(completed, total) {
  const safeCompleted = Math.max(0, completed);
  const safeTotal = Math.max(0, total);
  return {
    completed: safeCompleted,
    total: safeTotal,
    ratio: safeTotal === 0 ? 0 : safeCompleted / safeTotal,
    percent: safeTotal === 0 ? 0 : Math.round((safeCompleted / safeTotal) * 100),
  };
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

export function smokeTest() {
  const day = calculateDayProgress([
    { id: 'task', status: TASK_STATUS.done },
    { id: 'practice', status: TASK_STATUS.inProgress },
    { id: 'journal', completed: true },
    { id: 'career', active: false },
  ]);
  const checklist = calculateChecklistProgress(
    [{ id: 'task-1' }, { id: 'task-2' }, { id: 'task-3' }],
    [
      { taskId: 'task-1', status: TASK_STATUS.done },
      { taskId: 'task-2', status: TASK_STATUS.repeat },
    ],
  );
  const project = calculateProjectProgress(
    { qualityChecklist: [{ id: 'business' }, { id: 'readme' }] },
    {
      status: 'in_progress',
      githubUrl: 'https://example.test/repo',
      readmeReady: true,
      screenshotsReady: false,
      videoDemoReady: false,
      qualityChecklist: { business: true },
    },
  );
  const weak = groupWeakSpots(
    [
      { id: 'task-1', skill: 'sql', title: 'SQL joins' },
      { id: 'task-2', skill: 'excel', title: 'Pivot table' },
      { id: 'task-3', skill: 'sql', title: 'Window functions' },
    ],
    [
      { taskId: 'task-1', status: TASK_STATUS.repeat },
      { taskId: 'task-3', status: TASK_STATUS.repeat },
    ],
    [{ id: 'sql', title: 'SQL' }],
  );
  const examChecklist = buildMonthlyExamChecklist({
    skills: ['sql', 'window functions'],
    artifact: 'SQL-проект',
    sprints: [{ sprint: 1, title: 'SQL basics', definitionOfDone: 'Easy задачи решаются.' }],
    projects: [{ id: 'sql-project', title: 'SQL-анализ', businessQuestion: 'Найти точки роста.' }],
  });
  const exam = calculateMonthlyExamProgress(examChecklist, {
    checks: {
      'skill-sql': true,
      artifact: true,
      'project-sql-project': true,
    },
  });
  const emptyLevel = calculateReadinessLevel();
  const fullLevel = calculateReadinessLevel({
    tasks: [{ id: 'task-1' }, { id: 'task-2' }],
    taskProgress: [
      { taskId: 'task-1', status: TASK_STATUS.done },
      { taskId: 'task-2', status: TASK_STATUS.done },
    ],
    projects: [{
      id: 'project-1',
      qualityChecklist: [{ id: 'business' }],
    }],
    projectProgress: [{
      projectId: 'project-1',
      status: TASK_STATUS.done,
      githubUrl: 'https://example.test/repo',
      readmeReady: true,
      screenshotsReady: true,
      videoDemoReady: true,
      qualityChecklist: { business: true },
    }],
    months: [{
      month: 1,
      skills: ['sql'],
      artifact: 'SQL-проект',
      sprints: [{ sprint: 1, definitionOfDone: 'Готово.' }],
    }],
    monthlyExamProgress: [{
      month: 1,
      checks: {
        'skill-sql': true,
        artifact: true,
        'sprint-1': true,
      },
    }],
    careerApplications: [
      { status: 'applied', hasTestTask: true },
      { status: 'screening', hasTestTask: false },
      { status: 'test_task', hasTestTask: true },
      { status: 'interview', hasTestTask: false },
      { status: 'offer', hasTestTask: false },
      { status: 'rejected', hasTestTask: false },
      { status: 'no_response', hasTestTask: false },
      { status: 'withdrawn', hasTestTask: false },
      { status: 'applied', hasTestTask: false },
      { status: 'saved', hasTestTask: false },
    ],
  });

  const ok = day.completed === 2 && day.total === 3 && day.percent === 67
    && checklist.completed === 1 && checklist.percent === 33
    && project.completed === 4 && project.total === 7 && project.percent === 57
    && weak.length === 1 && weak[0].skill === 'sql' && weak[0].count === 2
    && examChecklist.length === 5 && exam.completed === 3 && exam.percent === 60
    && emptyLevel.percent === 0 && emptyLevel.level.id === 'novice'
    && fullLevel.percent === 100 && fullLevel.level.id === 'job_search_mode';

  console[ok ? 'info' : 'error'](
    `[learningProgress.smokeTest] ${ok ? 'OK — формулы совпали' : 'FAIL — формулы расходятся'}`,
    { day, checklist, project, weak, exam, emptyLevel, fullLevel },
  );
  return ok;
}
