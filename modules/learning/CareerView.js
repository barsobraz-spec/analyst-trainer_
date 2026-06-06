// modules/learning/CareerView.js — карьерные действия и локальный CRM-трекер (T5.2-T5.4).

import {
  deleteCareerApplication,
  getAllCareerApplications,
  saveCareerApplication,
  updateCareerApplication,
} from '../../core/db.js';
import { navigate } from '../../core/router.js';
import {
  APPLICATION_STATUS_LABELS,
  LearningSearchPanel,
  button,
  card,
  emptyPanel,
  field,
  learningHeader,
  readQueryParam,
  screen,
  statusSelect,
  text,
  withLearningContent,
} from './learningUi.js';
import { LearningRemindersPanel, REMINDER_SUGGESTIONS } from './LearningReminders.js';

const ACTIVE_STATUSES = new Set(['saved', 'applied', 'screening', 'test_task', 'interview']);

export function LearningCareerView() {
  return withLearningContent(renderCareer);
}

async function renderCareer(content) {
  const section = screen('learning learning-career');
  section.append(
    learningHeader('Карьера', 'Подготовка, активные отклики с месяца 4 и простой локальный трекер вакансий.'),
    LearningSearchPanel(content),
    monthlyActions(content),
  );
  const applications = await getAllCareerApplications().catch(() => []);
  applications.sort((a, b) => String(b.appliedAt || '').localeCompare(String(a.appliedAt || '')) || (b.updatedAt || 0) - (a.updatedAt || 0));
  section.append(
    await LearningRemindersPanel({
      title: 'Напоминания по карьере',
      scopes: ['career'],
      suggestions: [REMINDER_SUGGESTIONS.career],
      emptyText: 'Активных карьерных напоминаний нет.',
    }),
    stats(applications),
    applicationForm(content, applications),
    applicationsTable(content, applications),
  );
  return section;
}

function monthlyActions(content) {
  const selected = Number(readQueryParam('month'));
  const box = card('learning-career-actions');
  box.append(text('h2', 'learning-card__title', 'Действия по месяцам'));
  const grid = document.createElement('div');
  grid.className = 'learning-career-months';
  for (const month of content.career.monthlyActions || []) {
    const item = card('learning-career-month');
    if (selected === month.month) item.classList.add('is-highlighted');
    item.append(
      text('span', 'learning-month__badge', month.month >= content.career.activeApplicationsStartMonth ? 'Активный поиск' : 'Подготовка'),
      text('h3', 'learning-subtitle', `Месяц ${month.month}: ${month.phase}`),
      text('p', 'learning-muted', month.applicationTarget),
      text('p', 'learning-muted', month.networkingTarget),
    );
    const list = document.createElement('ul');
    list.className = 'learning-list';
    for (const action of month.actions || []) {
      const li = document.createElement('li');
      li.textContent = action;
      list.append(li);
    }
    item.append(list);
    grid.append(item);
  }
  box.append(grid);
  return box;
}

function stats(applications) {
  const total = applications.length;
  const active = applications.filter((item) => ACTIVE_STATUSES.has(item.status)).length;
  const tests = applications.filter((item) => item.hasTestTask || item.status === 'test_task').length;
  const interviews = applications.filter((item) => ['interview', 'offer'].includes(item.status)).length;
  const box = document.createElement('div');
  box.className = 'learning-summary learning-summary--compact';
  box.append(
    stat('Всего откликов', total),
    stat('Активные процессы', active),
    stat('Тестовые', tests),
    stat('Собеседования', interviews),
  );
  return box;
}

function stat(label, value) {
  const box = card('learning-summary__stat');
  box.append(text('span', 'learning-stat__label', label), text('strong', 'learning-stat__value', value));
  return box;
}

function applicationForm(content, applications) {
  const editId = readQueryParam('edit');
  const editing = applications.find((item) => item.applicationId === editId) || null;
  const box = card('learning-application-form');
  box.append(text('h2', 'learning-card__title', editing ? 'Редактировать отклик' : 'Новый отклик'));

  const form = document.createElement('form');
  form.className = 'learning-form-grid';
  const company = input('text', editing?.company || '', 'Компания');
  const role = input('text', editing?.role || '', 'Data Analyst');
  const vacancyUrl = input('url', editing?.vacancyUrl || '', 'https://...');
  const appliedAt = input('date', editing?.appliedAt || new Date().toISOString().slice(0, 10));
  const status = statusSelect(content.career.applicationTracker?.statuses || Object.keys(APPLICATION_STATUS_LABELS), APPLICATION_STATUS_LABELS, editing?.status || 'saved');
  const hasTestTask = checkbox(Boolean(editing?.hasTestTask));
  const feedback = textarea(editing?.feedback || '');
  const notes = textarea(editing?.notes || '');
  const message = text('p', 'learning-muted', 'Отклики сохраняются локально и попадут в общий экспорт прогресса.');

  form.append(
    field('Компания', company),
    field('Вакансия', role),
    field('Ссылка', vacancyUrl),
    field('Дата отклика', appliedAt),
    field('Статус', status),
    checkboxField('Есть тестовое', hasTestTask),
    field('Фидбэк', feedback),
    field('Заметки', notes),
  );
  const actions = document.createElement('div');
  actions.className = 'learning-actions';
  const save = button(editing ? 'Сохранить изменения' : 'Добавить отклик', 'learning-button--primary');
  save.type = 'submit';
  actions.append(save);
  if (editing) {
    const cancel = document.createElement('a');
    cancel.className = 'learning-button';
    cancel.href = '#/learning/career';
    cancel.textContent = 'Отмена';
    actions.append(cancel);
  }
  form.append(actions, message);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      company: company.value.trim(),
      role: role.value.trim(),
      vacancyUrl: vacancyUrl.value.trim(),
      appliedAt: appliedAt.value,
      status: status.value,
      hasTestTask: hasTestTask.checked,
      feedback: feedback.value,
      notes: notes.value,
    };
    if (!payload.company || !payload.role) {
      message.dataset.kind = 'error';
      message.textContent = 'Компания и вакансия обязательны.';
      return;
    }
    if (editing) await updateCareerApplication(editing.applicationId, payload);
    else await saveCareerApplication(payload);
    navigate('/learning/career');
  });
  box.append(form);
  return box;
}

function applicationsTable(content, applications) {
  const box = card('learning-applications');
  box.append(text('h2', 'learning-card__title', 'Трекер откликов'));
  if (applications.length === 0) {
    box.append(emptyPanel('Откликов пока нет. Добавьте первую компанию, чтобы видеть воронку поиска.'));
    return box;
  }
  const table = document.createElement('table');
  table.className = 'learning-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Компания</th><th>Вакансия</th><th>Дата</th><th>Статус</th><th>Тестовое</th><th></th></tr>';
  const tbody = document.createElement('tbody');
  for (const app of applications) {
    const tr = document.createElement('tr');
    tr.append(
      cell(app.company),
      cell(app.role),
      cell(app.appliedAt || ''),
      cell(APPLICATION_STATUS_LABELS[app.status] || app.status),
      cell(app.hasTestTask ? 'Да' : 'Нет'),
      actionsCell(app.applicationId),
    );
    tbody.append(tr);
  }
  table.append(thead, tbody);
  box.append(table);
  return box;
}

function actionsCell(applicationId) {
  const td = document.createElement('td');
  td.className = 'learning-table__actions';
  const edit = document.createElement('a');
  edit.className = 'learning-button learning-button--small';
  edit.href = `#/learning/career?edit=${encodeURIComponent(applicationId)}`;
  edit.textContent = 'Изменить';
  const del = button('Удалить', 'learning-button--small');
  del.addEventListener('click', async () => {
    await deleteCareerApplication(applicationId);
    navigate('/learning/career');
  });
  td.append(edit, del);
  return td;
}

function cell(value) {
  const td = document.createElement('td');
  td.textContent = String(value ?? '');
  return td;
}

function input(type, value, placeholder = '') {
  const el = document.createElement('input');
  el.type = type;
  el.value = value;
  el.placeholder = placeholder;
  return el;
}

function textarea(value) {
  const el = document.createElement('textarea');
  el.rows = 3;
  el.value = value;
  return el;
}

function checkbox(checked) {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = checked;
  return el;
}

function checkboxField(label, control) {
  const wrap = document.createElement('label');
  wrap.className = 'learning-check learning-check--wide';
  wrap.append(control, text('span', '', label));
  return wrap;
}
