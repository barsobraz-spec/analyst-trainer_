import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dataDir = path.join(root, 'data');
const sourceDir = path.join(root, 'source');

const KNOWN_MODULES = new Set(['5.1', '5.2', '5.3', '5.4', '5.5', '5.6', '5.7', '5.8']);
const MAIN_SECTIONS = ['Сегодня', 'План', 'Задачи', 'Проекты', 'Карьера'];
const TASK_STATUSES = ['not_started', 'in_progress', 'done', 'repeat'];
const PROJECT_STATUS_FIELDS = ['status', 'githubUrl', 'readmeReady', 'screenshotsReady', 'videoDemoReady', 'notes'];
const CAREER_REQUIRED_FIELDS = ['company', 'role', 'status'];

const problems = [];
const warnings = [];

function fail(message) {
  problems.push(message);
}

function warn(message) {
  warnings.push(message);
}

function expect(condition, message) {
  if (!condition) fail(message);
}

async function readJson(name) {
  const file = path.join(dataDir, name);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    fail(`${name}: не читается как JSON (${err.message})`);
    return null;
  }
}

async function importBrowserModule(relativePath) {
  const file = path.join(root, '..', relativePath);
  const source = await readFile(file, 'utf8');
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasNonEmptyString(obj, key) {
  return typeof obj?.[key] === 'string' && obj[key].trim().length > 0;
}

function uniqueValues(values) {
  return new Set(values).size === values.length;
}

function validatePlanDay(fileName, context, day, { minDay, maxDay }) {
  expect(Number.isInteger(day?.day) && day.day >= minDay && day.day <= maxDay, `${fileName}: ${context}: некорректный day ${day?.day}`);
  expect(hasNonEmptyString(day, 'title'), `${fileName}: ${context}: день без title`);
  if (day.monthDay !== undefined) {
    expect(Number.isInteger(day.monthDay) && day.monthDay >= 1 && day.monthDay <= 28, `${fileName}: ${context}: некорректный monthDay ${day.monthDay}`);
  }
  if (day.summary !== undefined) {
    expect(typeof day.summary === 'string', `${fileName}: ${context}: summary должен быть строкой`);
  }
  if (day.topics !== undefined) {
    expect(Array.isArray(day.topics) && day.topics.length > 0, `${fileName}: ${context}: topics должен быть непустым массивом`);
  }
  if (day.blocks !== undefined) {
    expect(Array.isArray(day.blocks), `${fileName}: ${context}: blocks должен быть массивом`);
    for (const [index, block] of (day.blocks || []).entries()) {
      expect(hasNonEmptyString(block, 'title'), `${fileName}: ${context}: block ${index + 1} без title`);
      if (block.durationMinutes !== undefined) {
        expect(Number.isInteger(block.durationMinutes) && block.durationMinutes > 0, `${fileName}: ${context}: block ${index + 1} содержит некорректный durationMinutes`);
      }
      expect(Array.isArray(block.items) && block.items.length > 0, `${fileName}: ${context}: block ${index + 1} должен иметь items`);
    }
  }
  for (const key of ['controlQuestions', 'checklist', 'completionCriteria', 'commonMistakes']) {
    if (day[key] !== undefined) {
      expect(Array.isArray(day[key]), `${fileName}: ${context}: ${key} должен быть массивом`);
    }
  }
}

function assertSourceDocuments(fileName, doc) {
  expect(Array.isArray(doc?.sourceDocuments), `${fileName}: нет sourceDocuments`);
  for (const source of doc?.sourceDocuments || []) {
    expect(typeof source === 'string' && source.endsWith('.docx'), `${fileName}: sourceDocuments должен ссылаться на .docx`);
  }
}

function assertModuleLinks(fileName, owner, modules) {
  expect(Array.isArray(modules), `${fileName}: ${owner} должен иметь массив trainerModules/trainerLinks`);
  for (const moduleId of modules || []) {
    expect(KNOWN_MODULES.has(moduleId), `${fileName}: ${owner} ссылается на неизвестный модуль ${moduleId}`);
  }
}

function assertOptionalIdList(fileName, owner, obj, key, knownIds, label) {
  if (obj?.[key] === undefined) return;
  expect(Array.isArray(obj[key]), `${fileName}: ${owner}: ${key} должен быть массивом`);
  for (const id of obj[key] || []) {
    expect(typeof id === 'string' && id.trim().length > 0, `${fileName}: ${owner}: ${key} содержит пустой ID`);
    expect(knownIds.has(id), `${fileName}: ${owner}: ${key} ссылается на неизвестный ${label} ${id}`);
  }
}

function validatePlan(plan, refs = {}) {
  if (!plan) return;
  expect(plan.schemaVersion === 1, 'plan.json: schemaVersion должен быть 1');
  assertSourceDocuments('plan.json', plan);
  expect(plan.durationMonths === 7, 'plan.json: durationMonths должен быть 7');
  expect(Array.isArray(plan.months) && plan.months.length === 7, 'plan.json: должен содержать 7 месяцев');

  const monthNumbers = [];
  let sprintCount = 0;
  let weekCount = 0;

  for (const month of plan.months || []) {
    monthNumbers.push(month.month);
    expect(Number.isInteger(month.month) && month.month >= 1 && month.month <= 7, `plan.json: некорректный номер месяца ${month.month}`);
    expect(hasNonEmptyString(month, 'title'), `plan.json: месяц ${month.month} без title`);
    expect(hasNonEmptyString(month, 'focus'), `plan.json: месяц ${month.month} без focus`);
    expect(Array.isArray(month.sprints) && month.sprints.length === 2, `plan.json: месяц ${month.month} должен иметь 2 спринта`);
    expect(Array.isArray(month.weeks) && month.weeks.length === 4, `plan.json: месяц ${month.month} должен иметь 4 недели`);
    expect(Array.isArray(month.projects) && month.projects.length > 0, `plan.json: месяц ${month.month} должен иметь проекты`);
    expect(Array.isArray(month.careerActions) && month.careerActions.length > 0, `plan.json: месяц ${month.month} должен иметь карьерные действия`);

    sprintCount += month.sprints?.length || 0;
    weekCount += month.weeks?.length || 0;

    for (const week of month.weeks || []) {
      expect(Number.isInteger(week.week), `plan.json: месяц ${month.month} содержит неделю без номера`);
      expect(hasNonEmptyString(week, 'title'), `plan.json: месяц ${month.month}, неделя ${week.week} без title`);
      expect(Array.isArray(week.topics) && week.topics.length > 0, `plan.json: месяц ${month.month}, неделя ${week.week} без тем`);
      if (month.month >= 2 && (!Array.isArray(week.days) || week.days.length < 6)) {
        warn(`plan.json: месяц ${month.month}, неделя ${week.week}: подробные days неполные или отсутствуют; UI должен использовать fallback.`);
      }
      if (week.days !== undefined) {
        expect(Array.isArray(week.days), `plan.json: месяц ${month.month}, неделя ${week.week}: days должен быть массивом`);
        expect(week.days.length > 0 && week.days.length <= 6, `plan.json: месяц ${month.month}, неделя ${week.week}: days должен содержать от 1 до 6 дней`);
        const dayNumbers = [];
        for (const day of week.days || []) {
          dayNumbers.push(day.day);
          validatePlanDay('plan.json', `месяц ${month.month}, неделя ${week.week}, день ${day.day}`, day, { minDay: 1, maxDay: 6 });
          if (day.id !== undefined) expect(hasNonEmptyString(day, 'id'), `plan.json: месяц ${month.month}, неделя ${week.week}, день ${day.day}: id должен быть строкой`);
          assertOptionalIdList('plan.json', `месяц ${month.month}, неделя ${week.week}, день ${day.day}`, day, 'taskIds', refs.taskIds || new Set(), 'taskId');
          assertOptionalIdList('plan.json', `месяц ${month.month}, неделя ${week.week}, день ${day.day}`, day, 'practiceIds', refs.practiceIds || new Set(), 'practiceId');
          assertOptionalIdList('plan.json', `месяц ${month.month}, неделя ${week.week}, день ${day.day}`, day, 'caseIds', refs.caseIds || new Set(), 'caseId');
        }
        expect(uniqueValues(dayNumbers), `plan.json: месяц ${month.month}, неделя ${week.week}: номера дней должны быть уникальными`);
      }
      if (week.restDay !== undefined) {
        validatePlanDay('plan.json', `месяц ${month.month}, неделя ${week.week}, restDay`, week.restDay, { minDay: 7, maxDay: 7 });
        if (week.restDay.id !== undefined) expect(hasNonEmptyString(week.restDay, 'id'), `plan.json: месяц ${month.month}, неделя ${week.week}, restDay: id должен быть строкой`);
        assertOptionalIdList('plan.json', `месяц ${month.month}, неделя ${week.week}, restDay`, week.restDay, 'taskIds', refs.taskIds || new Set(), 'taskId');
        assertOptionalIdList('plan.json', `месяц ${month.month}, неделя ${week.week}, restDay`, week.restDay, 'practiceIds', refs.practiceIds || new Set(), 'practiceId');
        assertOptionalIdList('plan.json', `месяц ${month.month}, неделя ${week.week}, restDay`, week.restDay, 'caseIds', refs.caseIds || new Set(), 'caseId');
      }
    }

    const trainerLinks = (month.trainerLinks || []).map((link) => link.module);
    assertModuleLinks('plan.json', `месяц ${month.month}`, trainerLinks);
  }

  expect(uniqueValues(monthNumbers), 'plan.json: номера месяцев должны быть уникальными');
  expect(sprintCount === 14, `plan.json: должно быть 14 спринтов, сейчас ${sprintCount}`);
  expect(weekCount === 28, `plan.json: должно быть 28 недель, сейчас ${weekCount}`);
}

function validateTasks(tasksDoc, plan) {
  if (!tasksDoc) return;
  expect(tasksDoc.schemaVersion === 1, 'tasks.json: schemaVersion должен быть 1');
  assertSourceDocuments('tasks.json', tasksDoc);
  expect(JSON.stringify(tasksDoc.statuses) === JSON.stringify(TASK_STATUSES), 'tasks.json: статусы задач не совпадают с MVP-контрактом');
  expect(Array.isArray(tasksDoc.skills) && tasksDoc.skills.length > 0, 'tasks.json: должен содержать skills');
  expect(Array.isArray(tasksDoc.tasks) && tasksDoc.tasks.length === 100, `tasks.json: основных задач должно быть 100, сейчас ${tasksDoc.tasks?.length}`);
  expect(Array.isArray(tasksDoc.supplementalTasks), 'tasks.json: supplementalTasks должен быть массивом');

  const planMonths = new Set((plan?.months || []).map((month) => month.month));
  const taskMonths = new Set();
  const ids = [];
  const numbers = [];
  const skillIds = new Set((tasksDoc.skills || []).map((skill) => skill.id));

  for (const skill of tasksDoc.skills || []) {
    expect(hasNonEmptyString(skill, 'id'), 'tasks.json: skill без id');
    expect(hasNonEmptyString(skill, 'title'), `tasks.json: skill ${skill.id} без title`);
    expect(planMonths.has(skill.month), `tasks.json: skill ${skill.id} ссылается на неизвестный месяц ${skill.month}`);
    expect(Array.isArray(skill.range) && skill.range.length === 2, `tasks.json: skill ${skill.id} должен иметь range`);
    assertModuleLinks('tasks.json', `skill ${skill.id}`, skill.trainerModules || []);
  }

  for (const task of tasksDoc.tasks || []) {
    ids.push(task.id);
    numbers.push(task.number);
    taskMonths.add(task.month);
    expect(hasNonEmptyString(task, 'id'), 'tasks.json: задача без id');
    expect(Number.isInteger(task.number), `tasks.json: ${task.id} без числового number`);
    expect(skillIds.has(task.skill), `tasks.json: ${task.id} ссылается на неизвестный skill ${task.skill}`);
    expect(planMonths.has(task.month), `tasks.json: ${task.id} ссылается на неизвестный месяц ${task.month}`);
    expect(hasNonEmptyString(task, 'title'), `tasks.json: ${task.id} без title`);
    assertModuleLinks('tasks.json', task.id, task.trainerModules || []);
  }

  for (const task of tasksDoc.supplementalTasks || []) {
    ids.push(task.id);
    expect(hasNonEmptyString(task, 'id'), 'tasks.json: дополнительная задача без id');
    expect(skillIds.has(task.skill), `tasks.json: ${task.id} ссылается на неизвестный skill ${task.skill}`);
    expect(planMonths.has(task.month), `tasks.json: ${task.id} ссылается на неизвестный месяц ${task.month}`);
    expect(hasNonEmptyString(task, 'title'), `tasks.json: ${task.id} без title`);
  }

  expect(uniqueValues(ids), 'tasks.json: id задач должны быть уникальными');
  expect(uniqueValues(numbers), 'tasks.json: numbers основных задач должны быть уникальными');
  expect(numbers.every((number, index) => number === index + 1), 'tasks.json: основные задачи должны иметь номера 1-100 по порядку');
  for (const month of planMonths) {
    expect(taskMonths.has(month), `tasks.json: месяц ${month} не покрыт обязательными задачами`);
  }
}

function collectTaskIds(tasksDoc) {
  return new Set([
    ...(tasksDoc?.tasks || []).map((task) => task.id),
    ...(tasksDoc?.supplementalTasks || []).map((task) => task.id),
  ].filter(Boolean));
}

function collectPracticeIds(practiceDoc) {
  return new Set((practiceDoc?.items || []).map((item, index) => (
    item.id || `practice-${item.taskId || index + 1}`
  )).filter(Boolean));
}

async function collectCaseIds() {
  try {
    const file = path.join(root, '..', 'cases', 'index.json');
    const index = JSON.parse(await readFile(file, 'utf8'));
    return new Set((index.cases || index.entries || []).map((item) => item.caseId).filter(Boolean));
  } catch (err) {
    fail(`cases/index.json: не читается для проверки ссылок (${err.message})`);
    return new Set();
  }
}

function validatePracticeContent(practiceDoc, tasksDoc) {
  if (!practiceDoc) return;
  expect(practiceDoc.schemaVersion === 1, 'practiceContent.json: schemaVersion должен быть 1');
  expect(Array.isArray(practiceDoc.items), 'practiceContent.json: items должен быть массивом');
  const taskIds = collectTaskIds(tasksDoc);
  const ids = [];

  for (const [index, item] of (practiceDoc.items || []).entries()) {
    const owner = `item ${index + 1}`;
    const practiceId = item.id || `practice-${item.taskId || index + 1}`;
    ids.push(practiceId);
    if (item.id !== undefined) expect(hasNonEmptyString(item, 'id'), `practiceContent.json: ${owner}: id должен быть строкой`);
    expect(hasNonEmptyString(item, 'taskId'), `practiceContent.json: ${owner}: нет taskId`);
    if (item.taskId) expect(taskIds.has(item.taskId), `practiceContent.json: ${owner}: taskId ${item.taskId} не найден в tasks.json`);
    if (item.taskIds !== undefined) {
      assertOptionalIdList('practiceContent.json', owner, item, 'taskIds', taskIds, 'taskId');
    }
    const modules = item.trainerModules || item.moduleIds || item.modules?.map((module) => module.id) || [];
    assertModuleLinks('practiceContent.json', owner, modules);
    if (item.autoCheck !== undefined) expect(isPlainObject(item.autoCheck), `practiceContent.json: ${owner}: autoCheck должен быть объектом`);
    if (item.rubric !== undefined) expect(Array.isArray(item.rubric), `practiceContent.json: ${owner}: rubric должен быть массивом`);
    if (item.submissionSchema !== undefined) expect(isPlainObject(item.submissionSchema), `practiceContent.json: ${owner}: submissionSchema должен быть объектом`);
  }

  expect(uniqueValues(ids), 'practiceContent.json: id практик должны быть уникальными');
}

function validateProjects(projectsDoc) {
  if (!projectsDoc) return;
  expect(projectsDoc.schemaVersion === 1, 'projects.json: schemaVersion должен быть 1');
  assertSourceDocuments('projects.json', projectsDoc);
  expect(Array.isArray(projectsDoc.projects) && projectsDoc.projects.length === 3, `projects.json: должно быть 3 якорных проекта, сейчас ${projectsDoc.projects?.length}`);
  expect(Array.isArray(projectsDoc.globalQualityChecklist) && projectsDoc.globalQualityChecklist.length > 0, 'projects.json: нет globalQualityChecklist');

  const ids = [];
  for (const project of projectsDoc.projects || []) {
    ids.push(project.id);
    expect(hasNonEmptyString(project, 'id'), 'projects.json: проект без id');
    expect(hasNonEmptyString(project, 'title'), `projects.json: ${project.id} без title`);
    expect(Number.isInteger(project.month) && project.month >= 1 && project.month <= 7, `projects.json: ${project.id} с некорректным month`);
    expect(Array.isArray(project.qualityChecklist) && project.qualityChecklist.length > 0, `projects.json: ${project.id} без qualityChecklist`);
    expect(Array.isArray(project.deliverables) && project.deliverables.length > 0, `projects.json: ${project.id} без deliverables`);
    expect(isPlainObject(project.statusFields), `projects.json: ${project.id} должен иметь statusFields как дефолтную UI-форму`);
    for (const field of PROJECT_STATUS_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(project.statusFields || {}, field), `projects.json: ${project.id} statusFields без ${field}`);
    }
    assertModuleLinks('projects.json', project.id, project.trainerModules || []);
  }
  expect(uniqueValues(ids), 'projects.json: id проектов должны быть уникальными');
}

function validateCareer(career) {
  if (!career) return;
  expect(career.schemaVersion === 1, 'career.json: schemaVersion должен быть 1');
  assertSourceDocuments('career.json', career);
  expect(career.activeApplicationsStartMonth === 4, 'career.json: activeApplicationsStartMonth должен быть 4');
  expect(Array.isArray(career.monthlyActions) && career.monthlyActions.length === 7, 'career.json: должно быть 7 monthlyActions');

  const months = new Set();
  for (const action of career.monthlyActions || []) {
    months.add(action.month);
    expect(Number.isInteger(action.month) && action.month >= 1 && action.month <= 7, `career.json: некорректный month ${action.month}`);
    expect(hasNonEmptyString(action, 'phase'), `career.json: month ${action.month} без phase`);
    expect(Array.isArray(action.actions) && action.actions.length > 0, `career.json: month ${action.month} без actions`);
  }
  expect(months.size === 7, 'career.json: monthlyActions должны покрывать 7 месяцев');

  expect(isPlainObject(career.applicationTracker), 'career.json: нет applicationTracker');
  expect(Array.isArray(career.applicationTracker?.statuses) && career.applicationTracker.statuses.length > 0, 'career.json: нет статусов откликов');
  expect(Array.isArray(career.applicationTracker?.fields) && career.applicationTracker.fields.length > 0, 'career.json: нет полей трекера откликов');
  const fieldIds = new Set((career.applicationTracker?.fields || []).map((field) => field.id));
  for (const field of CAREER_REQUIRED_FIELDS) {
    expect(fieldIds.has(field), `career.json: applicationTracker.fields без ${field}`);
  }
}

async function validateReadme() {
  let readme = '';
  try {
    readme = await readFile(path.join(root, 'README.md'), 'utf8');
  } catch (err) {
    fail(`learning-plan/README.md: не читается (${err.message})`);
    return;
  }

  for (const section of MAIN_SECTIONS) {
    expect(readme.includes(section), `learning-plan/README.md: не описан MVP-раздел "${section}"`);
  }
  expect(readme.includes('IndexedDB'), 'learning-plan/README.md: должен объяснять роль IndexedDB');
  expect(readme.includes('не читает `.docx`'), 'learning-plan/README.md: должен явно запретить чтение .docx в приложении');

  for (const source of [
    'План_Data_Analyst_7_месяцев_UPDATED.docx',
    'enhancement_pack.docx',
  ]) {
    try {
      await readFile(path.join(sourceDir, source));
    } catch {
      fail(`learning-plan/source: отсутствует ${source}`);
    }
  }
}

async function validateScheduleModel() {
  let schedule;
  try {
    schedule = await importBrowserModule('core/learningSchedule.js');
  } catch (err) {
    fail(`core/learningSchedule.js: не удалось импортировать модель расписания (${err.message})`);
    return;
  }

  const start = '2026-01-05';
  const day6 = schedule.calculateStudyPosition(start, new Date(2026, 0, 10));
  const rest = schedule.calculateStudyPosition(start, new Date(2026, 0, 11));
  const day7 = schedule.calculateStudyPosition(start, new Date(2026, 0, 12));

  expect(day6.status === 'active' && day6.studyDay === 6, 'learningSchedule: шестой календарный день должен быть учебным днём 6');
  expect(rest.status === 'rest' && rest.studyDay === 6, 'learningSchedule: седьмой календарный день должен быть отдыхом после учебного дня 6');
  expect(day7.status === 'active' && day7.studyDay === 7, 'learningSchedule: после дня отдыха должен начаться учебный день 7');
  expect(day6.dayKey === schedule.dayKeyForStudyDay(6), 'learningSchedule: учебный день 6 должен использовать стандартный dayKey');
  expect(typeof rest.dayKey === 'string' && rest.dayKey.startsWith('learning-rest-week-'), 'learningSchedule: день отдыха должен иметь отдельный rest dayKey');
  expect(day6.dayKey !== rest.dayKey && rest.dayKey !== day7.dayKey, 'learningSchedule: день отдыха не должен перезаписывать прогресс соседних учебных дней');

  const firstTwoWeeks = new Set();
  for (let offset = 0; offset < 14; offset += 1) {
    firstTwoWeeks.add(schedule.calculateStudyPosition(start, new Date(2026, 0, 5 + offset)).dayKey);
  }
  expect(firstTwoWeeks.size === 14, `learningSchedule: первые 14 календарных дней должны иметь 14 уникальных ключей, сейчас ${firstTwoWeeks.size}`);
}

const plan = await readJson('plan.json');
const tasks = await readJson('tasks.json');
const practiceContent = await readJson('practiceContent.json');
const projects = await readJson('projects.json');
const career = await readJson('career.json');
const caseIds = await collectCaseIds();

validateTasks(tasks, plan);
validatePracticeContent(practiceContent, tasks);
validatePlan(plan, {
  taskIds: collectTaskIds(tasks),
  practiceIds: collectPracticeIds(practiceContent),
  caseIds,
});
validateProjects(projects);
validateCareer(career);
await validateReadme();
await validateScheduleModel();

if (problems.length > 0) {
  console.error('Learning data validation failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn('Learning data validation warnings:');
  for (const warning of warnings) console.warn(`- ${warning}`);
}

console.log('Learning data validation passed.');
