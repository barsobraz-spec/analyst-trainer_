// modules/learning/MockInterviewView.js — V1 mock-интервью аналитика (T7.1).

import {
  deleteMockInterviewRun,
  getAllMockInterviewRuns,
  saveMockInterviewRun,
  updateMockInterviewRun,
} from '../../core/db.js';
import { AiMentor } from '../../core/components/AiMentor.js';
import { buildMockInterviewReviewContext, isSubstantialStudentAnswer, MENTOR_MODES } from '../../core/mentorContext.js';
import { navigate } from '../../core/router.js';
import {
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

const MOCK_RESULT_LABELS = Object.freeze({
  planned: 'Запланировано',
  passed: 'Пройдено',
  needs_repeat: 'Повторить',
});

const SCORE_LABELS = Object.freeze({
  1: '1 — слабое место',
  2: '2 — нестабильно',
  3: '3 — рабочий уровень',
  4: '4 — уверенно',
  5: '5 — интервью-ready',
});

export function LearningMockInterviewView() {
  return withLearningContent(renderMockInterview);
}

async function renderMockInterview(content) {
  const mock = content.career.mockInterview || {};
  const runs = await getAllMockInterviewRuns().catch(() => []);
  runs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.updatedAt || 0) - (a.updatedAt || 0));

  const section = screen('learning learning-mock');
  section.append(
    learningHeader('Mock-интервью', 'SQL, pandas, статистика, продуктовый кейс и рассказ о проекте в одном тренировочном прогоне.'),
    LearningSearchPanel(content),
    summary(runs, mock),
    sectionsPanel(mock),
    protocolPanel(mock),
    runForm(mock, runs),
    historyPanel(runs),
  );
  return section;
}

function summary(runs, mock) {
  const completed = runs.filter((run) => run.result !== 'planned').length;
  const last = runs[0] || null;
  const avg = averageRunScore(last);
  const box = document.createElement('div');
  box.className = 'learning-summary learning-summary--compact';
  box.append(
    stat('Всего прогонов', runs.length),
    stat('Завершено', completed),
    stat('Последний результат', last ? (MOCK_RESULT_LABELS[last.result] || last.result) : 'Нет'),
    stat('Средняя оценка', avg === null ? 'Нет' : `${avg}/5`),
    stat('Секций в mock', (mock.sections || []).length),
  );
  return box;
}

function stat(label, value) {
  const box = card('learning-summary__stat');
  box.append(text('span', 'learning-stat__label', label), text('strong', 'learning-stat__value', value));
  return box;
}

function sectionsPanel(mock) {
  const box = card('learning-mock-sections');
  box.append(text('h2', 'learning-card__title', mock.title || 'Секции mock-интервью'));
  const sections = mock.sections || [];
  if (sections.length === 0) {
    box.append(emptyPanel('В career.json пока нет секций mock-интервью.'));
    return box;
  }
  const list = document.createElement('div');
  list.className = 'learning-mock-grid';
  for (const section of sections) {
    const item = document.createElement('article');
    item.className = 'learning-mock-mini';
    item.append(
      text('h3', 'learning-subtitle', section.title),
      text('p', 'learning-muted', section.format),
      skillList(section.skills || []),
    );
    list.append(item);
  }
  box.append(list);
  return box;
}

function protocolPanel(mock) {
  const box = card('learning-mock-protocol');
  box.append(text('h2', 'learning-card__title', '7-дневная подготовка'));
  const protocol = mock.sevenDayProtocol || [];
  if (protocol.length === 0) {
    box.append(emptyPanel('Протокол подготовки не найден в career.json.'));
    return box;
  }
  const list = document.createElement('ol');
  list.className = 'learning-mock-protocol__list';
  for (const step of protocol) {
    const li = document.createElement('li');
    li.append(
      text('span', 'learning-mock-protocol__day', `День ${step.day}`),
      text('strong', '', step.title),
      text('span', 'learning-muted', step.task),
    );
    list.append(li);
  }
  box.append(list);
  return box;
}

function runForm(mock, runs) {
  const editId = readQueryParam('edit');
  const editing = runs.find((item) => item.runId === editId) || null;
  const sections = mock.sections || [];
  const rubric = mock.selfAssessmentRubric || [];

  const box = card('learning-mock-form-card');
  box.append(text('h2', 'learning-card__title', editing ? 'Редактировать прогон' : 'Новый прогон'));

  const form = document.createElement('form');
  form.className = 'learning-mock-form';
  const top = document.createElement('div');
  top.className = 'learning-form-grid';
  const date = input('date', editing?.date || new Date().toISOString().slice(0, 10));
  const result = statusSelect(Object.keys(MOCK_RESULT_LABELS), MOCK_RESULT_LABELS, editing?.result || 'planned');
  const duration = input('number', String(editing?.durationMinutes || 60), '60');
  duration.min = '15';
  duration.max = '240';
  duration.step = '5';
  top.append(
    field('Дата', date),
    field('Результат', result),
    field('Длительность, минут', duration),
  );

  const sectionControls = sectionAssessment(sections, editing);
  const rubricControls = rubricAssessment(rubric, editing);
  const commonFailures = failuresPanel(mock.commonFailures || []);
  const mistakesNotes = textarea(editing?.mistakesNotes || '', 4);
  const actionPlan = textarea(editing?.actionPlan || '', 3);
  const message = text('p', 'learning-muted', 'Результат сохраняется локально и попадет в общий экспорт прогресса.');

  form.append(
    top,
    sectionControls.element,
    rubricControls.element,
    commonFailures,
    field('Заметки по ошибкам', mistakesNotes),
    field('План следующего повтора', actionPlan),
  );

  const actions = document.createElement('div');
  actions.className = 'learning-actions';
  const save = button(editing ? 'Сохранить изменения' : 'Сохранить прогон', 'learning-button--primary');
  save.type = 'submit';
  actions.append(save);
  if (editing) {
    const cancel = document.createElement('a');
    cancel.className = 'learning-button';
    cancel.href = '#/learning/mock-interview';
    cancel.textContent = 'Отмена';
    actions.append(cancel);
  }
  form.append(actions, message);

  const readCurrentRun = () => readMockRunFormState({
    date,
    result,
    duration,
    sectionControls,
    rubricControls,
    mistakesNotes,
    actionPlan,
  });
  const readMentorAnswer = () => buildMockInterviewStudentAnswer(mock, readCurrentRun());

  let mentorControl = null;
  const refreshMentor = () => mentorControl?.refreshPreview?.();
  form.addEventListener('input', refreshMentor);
  form.addEventListener('change', refreshMentor);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = readCurrentRun();
    if (!payload.date || !Number.isFinite(payload.durationMinutes) || payload.durationMinutes <= 0) {
      message.dataset.kind = 'error';
      message.textContent = 'Укажите дату и корректную длительность.';
      return;
    }
    if (editing) await updateMockInterviewRun(editing.runId, payload);
    else await saveMockInterviewRun(payload);
    navigate('/learning/mock-interview');
  });

  box.append(form);
  mentorControl = AiMentor({
    title: 'AI-разбор mock-интервью',
    description: 'Оценит заметки по прогону, найдет слабые секции и задаст следующий вопрос как интервьюер.',
    modes: [MENTOR_MODES.mockInterview],
    defaultMode: MENTOR_MODES.mockInterview,
    buildContext: () => buildMockInterviewReviewContext({
      mock,
      run: readCurrentRun(),
      studentAnswer: readMentorAnswer(),
    }),
    getStudentAnswer: readMentorAnswer,
    onFocusAnswer: () => mistakesNotes.focus(),
    resolveModeState: () => {
      const currentRun = readCurrentRun();
      const hasEnoughNotes = hasMockRunSignal(mock, currentRun) && isSubstantialStudentAnswer(readMentorAnswer());
      return {
        disabled: !hasEnoughNotes,
        disabledMessage: 'Добавьте оценки секций, заметки по ошибкам или план повтора, чтобы AI смог разобрать mock-интервью.',
        submitLabel: 'Разобрать mock',
      };
    },
    historyScope: {
      caseId: 'learning:mock-interview',
      module: 'career',
      caseTitle: mock.title || 'Mock-интервью аналитика',
    },
  });
  box.append(mentorControl.element);
  return box;
}

function readMockRunFormState({ date, result, duration, sectionControls, rubricControls, mistakesNotes, actionPlan }) {
  return {
    date: date.value,
    result: result.value,
    durationMinutes: Number(duration.value),
    sectionScores: sectionControls.readScores(),
    sectionNotes: sectionControls.readNotes(),
    rubricChecks: rubricControls.readChecks(),
    mistakesNotes: mistakesNotes.value,
    actionPlan: actionPlan.value,
  };
}

function sectionAssessment(sections, editing) {
  const wrap = document.createElement('div');
  wrap.className = 'learning-mock-assessment';
  wrap.append(text('h3', 'learning-subtitle', 'Оценка по секциям'));
  if (sections.length === 0) {
    wrap.append(emptyPanel('Секции не настроены.'));
    return { element: wrap, readScores: () => ({}), readNotes: () => ({}) };
  }

  const controls = [];
  for (const section of sections) {
    const row = document.createElement('div');
    row.className = 'learning-mock-section-row';
    const score = scoreSelect(editing?.sectionScores?.[section.id] ?? '');
    const notes = textarea(editing?.sectionNotes?.[section.id] || '', 2);
    row.append(
      text('strong', 'learning-mock-section-row__title', section.title),
      field('Оценка', score),
      field('Заметка', notes),
    );
    wrap.append(row);
    controls.push({ id: section.id, score, notes });
  }

  return {
    element: wrap,
    readScores: () => Object.fromEntries(controls
      .filter((control) => control.score.value)
      .map((control) => [control.id, Number(control.score.value)])),
    readNotes: () => Object.fromEntries(controls
      .filter((control) => control.notes.value.trim())
      .map((control) => [control.id, control.notes.value])),
  };
}

function rubricAssessment(rubric, editing) {
  const wrap = document.createElement('fieldset');
  wrap.className = 'learning-mock-rubric';
  const legend = document.createElement('legend');
  legend.textContent = 'Самооценка';
  wrap.append(legend);
  const controls = [];
  for (const [index, item] of rubric.entries()) {
    const id = `rubric-${index + 1}`;
    const control = checkbox(Boolean(editing?.rubricChecks?.[id]));
    const label = document.createElement('label');
    label.className = 'learning-check learning-check--wide';
    label.append(control, text('span', '', item));
    wrap.append(label);
    controls.push({ id, control });
  }
  if (controls.length === 0) wrap.append(emptyPanel('Рубрика самооценки не настроена.'));
  return {
    element: wrap,
    readChecks: () => Object.fromEntries(controls.map(({ id, control }) => [id, control.checked])),
  };
}

function failuresPanel(failures) {
  const details = document.createElement('details');
  details.className = 'learning-details';
  const summary = document.createElement('summary');
  summary.textContent = 'Типичные провалы для проверки';
  details.append(summary);
  if (failures.length === 0) {
    details.append(emptyPanel('Список типичных ошибок не найден.'));
    return details;
  }
  const list = document.createElement('ul');
  list.className = 'learning-list';
  for (const failure of failures) {
    const li = document.createElement('li');
    li.textContent = failure;
    list.append(li);
  }
  details.append(list);
  return details;
}

function historyPanel(runs) {
  const box = card('learning-mock-history');
  box.append(text('h2', 'learning-card__title', 'История mock-интервью'));
  if (runs.length === 0) {
    box.append(emptyPanel('Прогонов пока нет. Проведите первый mock и зафиксируйте ошибки.'));
    return box;
  }
  const table = document.createElement('table');
  table.className = 'learning-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Дата</th><th>Результат</th><th>Длительность</th><th>Средняя оценка</th><th>Ошибки</th><th></th></tr>';
  const tbody = document.createElement('tbody');
  for (const run of runs) {
    const tr = document.createElement('tr');
    tr.append(
      cell(run.date || ''),
      cell(MOCK_RESULT_LABELS[run.result] || run.result),
      cell(`${run.durationMinutes || 0} мин`),
      cell(averageRunScore(run) === null ? 'Нет' : `${averageRunScore(run)}/5`),
      cell(run.mistakesNotes || ''),
      actionsCell(run.runId),
    );
    tbody.append(tr);
  }
  table.append(thead, tbody);
  box.append(table);
  return box;
}

function actionsCell(runId) {
  const td = document.createElement('td');
  td.className = 'learning-table__actions';
  const edit = document.createElement('a');
  edit.className = 'learning-button learning-button--small';
  edit.href = `#/learning/mock-interview?edit=${encodeURIComponent(runId)}`;
  edit.textContent = 'Изменить';
  const del = button('Удалить', 'learning-button--small');
  del.addEventListener('click', async () => {
    await deleteMockInterviewRun(runId);
    navigate('/learning/mock-interview');
  });
  td.append(edit, del);
  return td;
}

function skillList(skills) {
  const wrap = document.createElement('div');
  wrap.className = 'learning-mock-skills';
  for (const skill of skills) wrap.append(text('span', '', skill));
  return wrap;
}

function averageRunScore(run) {
  const scores = Object.values(run?.sectionScores || {}).filter((score) => Number.isFinite(score));
  if (scores.length === 0) return null;
  const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.round(avg * 10) / 10;
}

function buildMockInterviewStudentAnswer(mock, run) {
  if (!hasMockRunSignal(mock, run)) return '';
  const parts = [];
  const resultLabel = MOCK_RESULT_LABELS[run.result] || run.result || 'не указан';
  parts.push(`Прогон: ${run.date || 'без даты'}, результат ${resultLabel}, длительность ${run.durationMinutes || 0} минут.`);

  const sections = mock.sections || [];
  const sectionNotes = [];
  for (const section of sections) {
    const score = run.sectionScores?.[section.id];
    const note = run.sectionNotes?.[section.id];
    if (score || note) {
      sectionNotes.push(`${section.title}: ${score ? `${score}/5` : 'без оценки'}${note ? `, ${note}` : ''}`);
    }
  }
  if (sectionNotes.length) parts.push(`Секции: ${sectionNotes.join('; ')}.`);

  const rubric = mock.selfAssessmentRubric || [];
  const checked = rubric
    .map((item, index) => ({ item, checked: Boolean(run.rubricChecks?.[`rubric-${index + 1}`]) }))
    .filter((item) => item.checked)
    .map((item) => item.item);
  const missed = rubric
    .map((item, index) => ({ item, checked: Boolean(run.rubricChecks?.[`rubric-${index + 1}`]) }))
    .filter((item) => !item.checked)
    .map((item) => item.item);
  if (checked.length) parts.push(`Получилось: ${checked.join('; ')}.`);
  if (missed.length && (checked.length || run.mistakesNotes || run.actionPlan)) {
    parts.push(`Не отмечено: ${missed.join('; ')}.`);
  }
  if (run.mistakesNotes) parts.push(`Ошибки и наблюдения: ${run.mistakesNotes}`);
  if (run.actionPlan) parts.push(`План повтора: ${run.actionPlan}`);
  return parts.join('\n');
}

function hasMockRunSignal(mock, run) {
  if (run.mistakesNotes?.trim() || run.actionPlan?.trim()) return true;
  if (Object.keys(run.sectionScores || {}).length > 0) return true;
  if (Object.keys(run.sectionNotes || {}).length > 0) return true;
  const rubric = mock.selfAssessmentRubric || [];
  return rubric.some((_, index) => Boolean(run.rubricChecks?.[`rubric-${index + 1}`]));
}

function scoreSelect(value) {
  const select = document.createElement('select');
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Не оценивал';
  select.append(empty);
  for (const [score, label] of Object.entries(SCORE_LABELS)) {
    const option = document.createElement('option');
    option.value = score;
    option.textContent = label;
    if (Number(value) === Number(score)) option.selected = true;
    select.append(option);
  }
  return select;
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

function textarea(value, rows = 3) {
  const el = document.createElement('textarea');
  el.rows = rows;
  el.value = value;
  return el;
}

function checkbox(checked) {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = checked;
  return el;
}
