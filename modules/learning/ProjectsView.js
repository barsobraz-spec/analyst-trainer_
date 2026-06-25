// modules/learning/ProjectsView.js — трекер трёх якорных проектов (T5.1).

import { getAllProjectProgress, saveProjectProgress } from '../../core/db.js';
import { calculateProjectProgress } from '../../core/learningProgress.js';
import { AiMentor } from '../../core/components/AiMentor.js';
import { buildProjectReviewContext, isSubstantialStudentAnswer, MENTOR_MODES } from '../../core/mentorContext.js';
import { LearningRemindersPanel, REMINDER_SUGGESTIONS } from './LearningReminders.js';
import {
  LearningSearchPanel,
  PROJECT_STATUS_LABELS,
  card,
  field,
  learningHeader,
  moduleLinks,
  progressBar,
  readQueryParam,
  screen,
  statusSelect,
  text,
  withLearningContent,
} from './learningUi.js';

export function LearningProjectsView() {
  return withLearningContent(renderProjects);
}

async function renderProjects(content) {
  const section = screen('learning learning-projects');
  section.append(
    learningHeader('Проекты', 'Три якорных проекта портфолио: статус, GitHub, качество README, скриншоты, демо и заметки.'),
    LearningSearchPanel(content),
  );
  const progressRows = await getAllProjectProgress().catch(() => []);
  const progress = new Map(progressRows.map((row) => [row.projectId, row]));
  const selected = readQueryParam('project');
  section.append(await LearningRemindersPanel({
    title: 'Напоминания по проектам',
    scopes: ['projects'],
    suggestions: [REMINDER_SUGGESTIONS.projects],
    emptyText: 'Активных напоминаний по проектам нет.',
  }));

  const grid = document.createElement('div');
  grid.className = 'learning-projects-grid';
  for (const project of content.projects.projects || []) {
    grid.append(projectCard(content, project, progress.get(project.id), selected === project.id));
  }
  section.append(grid);
  return section;
}

function projectCard(content, project, saved, highlighted) {
  const state = {
    ...(project.statusFields || {}),
    ...(saved || {}),
    qualityChecklist: saved?.qualityChecklist || {},
  };
  const box = card('learning-project-card');
  box.id = project.id;
  if (highlighted) box.classList.add('is-highlighted');

  const progress = calculateProjectProgress(project, state, content.projects.globalQualityChecklist);
  box.append(
    text('span', 'learning-month__badge', `Месяц ${project.month}`),
    text('h2', 'learning-card__title', project.fullTitle || project.title),
    text('p', 'learning-muted', project.businessQuestion),
    progressBar(progress, 'Готовность проекта'),
    moduleLinks(project.trainerModules),
  );

  const form = document.createElement('form');
  form.className = 'learning-project-form';

  const status = statusSelect(content.projects.statuses || Object.keys(PROJECT_STATUS_LABELS), PROJECT_STATUS_LABELS, state.status || 'not_started');
  const github = input('url', state.githubUrl || '', 'https://github.com/...');
  const readmeDraft = textarea(state.readmeDraft || '', 8);
  const notes = textarea(state.notes || '');
  const readme = checkbox(state.readmeReady);
  const screenshots = checkbox(state.screenshotsReady);
  const video = checkbox(state.videoDemoReady);
  readme.dataset.field = 'readme';
  readmeDraft.dataset.field = 'readmeDraft';
  notes.dataset.field = 'notes';
  screenshots.dataset.field = 'screenshots';
  video.dataset.field = 'video';

  const readmeDraftField = field('README / описание проекта для AI-проверки', readmeDraft);
  readmeDraftField.classList.add('learning-field--wide');
  const notesField = field('Заметки', notes);
  notesField.classList.add('learning-field--wide');

  form.append(
    field('Статус', status),
    field('GitHub URL', github),
    readmeDraftField,
    checkboxField('README готов', readme),
    checkboxField('Скриншоты готовы', screenshots),
    checkboxField('Видео-демо готово', video),
    notesField,
  );

  const quality = document.createElement('div');
  quality.className = 'learning-quality';
  quality.append(text('h3', 'learning-subtitle', 'Чек-лист качества'));
  for (const item of normalizeQuality(project.qualityChecklist, content.projects.globalQualityChecklist)) {
    const control = checkbox(Boolean(state.qualityChecklist?.[item.id]));
    control.dataset.qualityId = item.id;
    quality.append(checkboxField(item.title, control, item.description));
  }
  form.append(quality);

  let mentorControl = null;
  const persistAndRefresh = () => {
    saveProject(project, form);
    mentorControl?.refreshPreview?.();
  };
  form.addEventListener('input', persistAndRefresh);
  form.addEventListener('change', persistAndRefresh);
  box.append(form);

  const details = document.createElement('details');
  details.className = 'learning-details';
  const summary = document.createElement('summary');
  summary.textContent = 'Deliverables и README-структура';
  details.append(summary, listBlock(project.deliverables), listBlock(project.readmeStructure));
  box.append(details);

  mentorControl = AiMentor({
    title: 'AI-проверка проекта',
    description: 'Проверит README или краткое описание как портфолио-проект Data Analyst.',
    modes: [MENTOR_MODES.readmeReview],
    defaultMode: MENTOR_MODES.readmeReview,
    buildContext: () => buildProjectReviewContext({
      project,
      progress: readProjectFormState(project, form),
      globalQualityChecklist: content.projects.globalQualityChecklist,
    }),
    getStudentAnswer: () => readmeDraft.value,
    onFocusAnswer: () => readmeDraft.focus(),
    resolveModeState: () => {
      const hasReadmeText = isSubstantialStudentAnswer(readmeDraft.value);
      return {
        disabled: !hasReadmeText,
        disabledMessage: 'Вставьте README или краткое описание проекта, чтобы AI смог проверить содержание.',
        submitLabel: 'Проверить README',
      };
    },
    historyScope: {
      caseId: `project:${project.id}`,
      module: 'portfolio',
      caseTitle: project.fullTitle || project.title,
    },
  });
  box.append(mentorControl.element);

  return box;
}

async function saveProject(project, form) {
  await saveProjectProgress(readProjectFormState(project, form));
}

function readProjectFormState(project, form) {
  const qualityChecklist = {};
  for (const inputEl of form.querySelectorAll('[data-quality-id]')) {
    qualityChecklist[inputEl.dataset.qualityId] = inputEl.checked;
  }
  return {
    projectId: project.id,
    month: project.month,
    status: form.querySelector('select')?.value || 'not_started',
    githubUrl: form.querySelector('input[type="url"]')?.value || '',
    readmeReady: form.querySelector('[data-field="readme"]')?.checked || false,
    screenshotsReady: form.querySelector('[data-field="screenshots"]')?.checked || false,
    videoDemoReady: form.querySelector('[data-field="video"]')?.checked || false,
    readmeDraft: form.querySelector('[data-field="readmeDraft"]')?.value || '',
    notes: form.querySelector('[data-field="notes"]')?.value || '',
    qualityChecklist,
  };
}

function normalizeQuality(projectChecklist = [], globalChecklist = []) {
  const source = Array.isArray(projectChecklist) && projectChecklist.length > 0
    ? projectChecklist
    : globalChecklist;
  return source.map((item, index) => {
    if (item && typeof item === 'object') {
      return {
        id: item.id || `quality-${index + 1}`,
        title: item.title || item.description || `Пункт ${index + 1}`,
        description: item.description || '',
      };
    }
    return { id: `quality-${index + 1}`, title: String(item), description: '' };
  });
}

function input(type, value, placeholder) {
  const el = document.createElement('input');
  el.type = type;
  el.value = value;
  el.placeholder = placeholder || '';
  return el;
}

function textarea(value, rows = 3) {
  const el = document.createElement('textarea');
  el.rows = rows;
  el.value = value;
  return el;
}

function checkbox(checked) {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = Boolean(checked);
  return el;
}

function checkboxField(label, control, hint = '') {
  const wrap = document.createElement('label');
  wrap.className = 'learning-check learning-check--wide';
  wrap.append(control, text('span', '', label));
  if (hint) wrap.append(text('small', 'learning-muted', hint));
  return wrap;
}

function listBlock(items = []) {
  const list = document.createElement('ul');
  list.className = 'learning-list';
  for (const item of items || []) {
    const li = document.createElement('li');
    li.textContent = item;
    list.append(li);
  }
  return list;
}
