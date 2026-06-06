// modules/automation/CaseView.js — экран кейса модуля 5.7 Automation Designer (T8.1–T8.3).
//
// Собирает функции модуля из PRD §5.7:
//   проблема — бизнес-задача на автоматизацию (сценарий + главный вопрос);
//   Ф1 — конструктор процесса (ProcessBuilder): схема «Триггер → Шаги → Результат»;
//   Ф2 — карточки шагов (StepCard): что происходит, вход, выход, исполнитель;
//   Ф3 — чек-лист готовности (ReadinessChecklist): авто-оценка схемы → балл;
//   Ф4 — итоговые артефакты (core/automationArtifacts): описание процесса + чек-лист
//        внедрения, формируются из текущей схемы по кнопке;
//   Ф5 — эталонная схема (ReferenceBreakdown), открывается после отправки — только
//        для встроенных кейсов;
//   Ф6 — самооценка (SelfAssessment) для встроенных кейсов; событие пишется ровно
//        один раз через saveAndFinalize.
//
// Два режима по признаку caseData.isUserCase:
//   • встроенный кейс — есть эталон: «Сверить с эталоном» → эталонная схема +
//     самооценка 0–100 (autoFraction:null), как у 5.1/5.2/5.4;
//   • свой кейс (Ф5) — эталона нет: «Завершить» → score = балл чек-листа готовности
//     (PRD §5.7 Ф6), событие пишется напрямую, без самооценки.
//
// Черновик (статус «в процессе», T8.1.3): экран сохраняет схему ProcessBuilder через
// saveDraftState с дебаунсом и восстанавливает её при возврате; saveAndFinalize
// удаляет черновик.
//
// ES-модуль: `import { AutomationCaseView } from './modules/automation/CaseView.js'`.

import { CaseHeader } from '../../core/components/CaseHeader.js';
import { ReferenceBreakdown } from '../../core/components/ReferenceBreakdown.js';
import { SelfAssessment } from '../../core/components/SelfAssessment.js';
import { HintsPanel } from '../../core/components/HintsPanel.js';
import { textBlock, doneNotice } from '../../core/components/caseScaffold.js';
import { saveDraftState, getDraftState } from '../../core/db.js';
import { saveAndFinalize } from '../../core/event.js';
import {
  generateProcessDescription,
  generateImplementationChecklist,
  NODE_TYPE_LABELS,
} from '../../core/automationArtifacts.js';
import { ProcessBuilder } from './ProcessBuilder.js';
import { ReadinessChecklist } from './ReadinessChecklist.js';

// Критерии самооценки встроенного кейса 5.7 (PRD §5.7 Ф6: сравнение с эталоном).
const SELF_CRITERIA = [
  { id: 'coverage', label: 'Схема покрывает ключевые шаги эталона', type: 'score' },
  { id: 'cards', label: 'Карточки шагов заполнены: вход, выход, исполнитель', type: 'score' },
  { id: 'result', label: 'Учтены исключения и измеримый результат', type: 'score' },
];

const DRAFT_DEBOUNCE_MS = 600;

export async function AutomationCaseView({ caseData, attemptNo } = {}) {
  const payload = caseData.payload || {};
  const caseId = caseData.caseId;
  const isUserCase = !!caseData.isUserCase;

  const root = document.createElement('section');
  root.className = 'case-view automation-case screen';

  // Восстанавливаем незавершённый черновик схемы `{ nodes }`.
  let draft = null;
  try {
    draft = await getDraftState(caseId);
  } catch (err) {
    console.error('[automation] не удалось прочитать черновик', caseId, err);
  }

  // --- Шапка: заголовок, сложность, номер попытки, таймер ---------------------
  const header = CaseHeader({
    title: caseData.title || 'Кейс',
    difficulty: caseData.difficulty,
    attemptNo,
  });
  root.append(header.element);

  // --- Бизнес-задача: сценарий + главный вопрос -------------------------------
  if (payload.scenario) {
    root.append(textBlock('case-view__scenario', payload.scenario));
  }
  if (payload.question) {
    const q = document.createElement('p');
    q.className = 'case-view__question';
    q.textContent = payload.question;
    root.append(q);
  }

  // --- Подсказки (Ф4 общего раздела §5) — только если заданы в кейсе ----------
  const hintItems = Array.isArray(payload.hints) ? payload.hints : [];
  const hints = hintItems.length > 0 ? HintsPanel({ hints: hintItems }) : null;
  if (hints) root.append(hints.element);

  // --- Ф1/Ф2: конструктор процесса и карточки шагов ---------------------------
  const builder = ProcessBuilder({
    initialState: draft,
    onChange: () => { scheduleDraftSave(); checklist.refresh(builder.getState()); refreshSubmitState(); },
  });
  root.append(builder.element);

  // --- Ф3: чек-лист готовности (авто-оценка по схеме) --------------------------
  const checklist = ReadinessChecklist({ initialSchema: builder.getState() });
  root.append(checklist.element);

  // --- Ф4: итоговые артефакты (по кнопке, из текущей схемы) --------------------
  root.append(buildArtifactsPanel(() => builder.getState()));

  // --- Кнопка отправки --------------------------------------------------------
  const submitBar = document.createElement('div');
  submitBar.className = 'case-view__submit-bar';
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'case-view__submit';
  submit.textContent = isUserCase ? 'Завершить попытку' : 'Сверить с эталоном';
  const submitHint = document.createElement('span');
  submitHint.className = 'case-view__submit-hint';
  submitBar.append(submit, submitHint);
  root.append(submitBar);

  // --- Ф5: эталонная схема (только встроенные кейсы; скрыта до отправки) -------
  const reference = isUserCase ? null : buildSolutionReference(payload.solution);
  if (reference) root.append(reference.element);

  // Контейнер для самооценки / финального сообщения после отправки.
  const afterHost = document.createElement('div');
  afterHost.className = 'case-view__self-host';
  root.append(afterHost);

  let submitted = false;

  // --- Гейтинг отправки -------------------------------------------------------
  function refreshSubmitState() {
    if (submitted) return;
    const ready = builder.isReady();
    submit.disabled = !ready;
    submitHint.textContent = ready
      ? ''
      : 'Постройте схему: заполните триггер, хотя бы один шаг и итог.';
  }

  // --- Черновик (статус «в процессе») -----------------------------------------
  let draftTimer = null;
  function scheduleDraftSave() {
    if (submitted) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, DRAFT_DEBOUNCE_MS);
  }
  async function saveDraft() {
    try {
      await saveDraftState(caseId, builder.getState());
    } catch (err) {
      console.error('[automation] не удалось сохранить черновик', caseId, err);
    }
  }

  // --- Отправка ---------------------------------------------------------------
  submit.addEventListener('click', () => {
    if (submitted || !builder.isReady()) return;
    submitted = true;
    clearTimeout(draftTimer);

    builder.lock();
    checklist.refresh(builder.getState());
    checklist.lock();
    submit.disabled = true;
    submit.hidden = true;
    submitHint.textContent = '';

    if (isUserCase) {
      finalizeUserCase();
    } else {
      reference.reveal();
      mountSelfAssessment();
    }
  });

  // Свой кейс (Ф6): эталона нет → score = балл чек-листа готовности. Событие
  // пишется напрямую, без самооценки.
  async function finalizeUserCase() {
    const status = document.createElement('p');
    status.className = 'self-assessment__status';
    status.setAttribute('role', 'status');
    status.textContent = 'Записываем результат…';
    afterHost.append(status);

    try {
      const { finishedAt } = header.stop();
      await saveAndFinalize({
        module: caseData.module,
        caseId,
        startedAt: header.startedAt,
        finishedAt,
        score: checklist.getScore(),
        selfAssessment: null,
        skillTags: caseData.skillTags || [],
        hintsUsed: 0,
        notes: summarize(builder.getState(), checklist),
      });
      status.classList.add('self-assessment__status--done');
      status.textContent = `Попытка записана. Балл по чек-листу готовности: ${checklist.getScore()} / 100.`;
      afterHost.append(doneNotice(caseData.module));
    } catch (err) {
      console.error('[automation] не удалось записать попытку своего кейса', err);
      status.classList.add('self-assessment__status--error');
      status.textContent = 'Не удалось сохранить результат. Проверьте хранилище и попробуйте ещё раз.';
      submitted = false;
      submit.hidden = false;
      submit.disabled = false;
    }
  }

  // Встроенный кейс (Ф6): самооценка 0–100 после показа эталона.
  function mountSelfAssessment() {
    const self = SelfAssessment({
      criteria: SELF_CRITERIA,
      hintsUsed: hints ? hints.getHintsUsed() : 0,
      hintsTotal: hintItems.length,
      autoFraction: null,
      getEventParams: () => {
        const { finishedAt } = header.stop();
        return {
          module: caseData.module,
          caseId,
          startedAt: header.startedAt,
          finishedAt,
          skillTags: caseData.skillTags || [],
          notes: summarize(builder.getState(), checklist),
        };
      },
      onFinalized: () => { afterHost.append(doneNotice(caseData.module)); },
    });
    afterHost.append(self);
    self.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  refreshSubmitState();
  // unmount-хук роутера: останавливаем таймер шапки при уходе с кейса (идемпотентно).
  return { element: root, destroy: () => { header.stop(); } };
}

// --- Ф4: панель итоговых артефактов ------------------------------------------
// Кнопка формирует из текущей схемы текстовое описание процесса и markdown-чек-лист
// внедрения; каждый артефакт можно скопировать в буфер обмена.
function buildArtifactsPanel(getSchema) {
  const panel = document.createElement('section');
  panel.className = 'artifacts';

  const title = document.createElement('h2');
  title.className = 'artifacts__title';
  title.textContent = 'Итоговые артефакты';
  panel.append(title);

  const intro = document.createElement('p');
  intro.className = 'artifacts__intro';
  intro.textContent = 'Сформируйте текстовое описание процесса и чек-лист внедрения из вашей схемы.';
  panel.append(intro);

  const genBtn = document.createElement('button');
  genBtn.type = 'button';
  genBtn.className = 'artifacts__generate';
  genBtn.textContent = 'Сформировать артефакты';
  panel.append(genBtn);

  const output = document.createElement('div');
  output.className = 'artifacts__output';
  output.hidden = true;
  panel.append(output);

  const description = buildArtifactBlock('Описание процесса');
  const checklist = buildArtifactBlock('Чек-лист внедрения');
  output.append(description.element, checklist.element);

  genBtn.addEventListener('click', () => {
    const schema = getSchema();
    description.set(generateProcessDescription(schema));
    checklist.set(generateImplementationChecklist(schema));
    output.hidden = false;
    genBtn.textContent = 'Обновить артефакты';
  });

  return panel;
}

function buildArtifactBlock(heading) {
  const wrap = document.createElement('div');
  wrap.className = 'artifacts__block';

  const head = document.createElement('div');
  head.className = 'artifacts__block-head';
  const h3 = document.createElement('h3');
  h3.className = 'artifacts__block-title';
  h3.textContent = heading;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'artifacts__copy';
  copy.textContent = 'Копировать';
  head.append(h3, copy);

  const pre = document.createElement('pre');
  pre.className = 'artifacts__pre';

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.textContent || '');
      copy.textContent = 'Скопировано';
      setTimeout(() => { copy.textContent = 'Копировать'; }, 1500);
    } catch {
      // Буфер обмена недоступен (например, без https) — выделяем текст руками.
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      copy.textContent = 'Выделено — скопируйте вручную';
      setTimeout(() => { copy.textContent = 'Копировать'; }, 2500);
    }
  });

  wrap.append(head, pre);
  return { element: wrap, set: (text) => { pre.textContent = text; } };
}

// --- Ф5: эталонная схема (read-only) -----------------------------------------
// payload.solution: { nodes:[{type,title,input,output,actor}], note:'…' }.
function buildSolutionReference(solution) {
  const title = 'Эталонная схема процесса';

  if (!solution || (!Array.isArray(solution.nodes) && !solution.note)) {
    return ReferenceBreakdown({
      title,
      content: 'Эталонная схема для этого кейса ещё не задана — сверьтесь со своей схемой и оцените себя честно.',
    });
  }

  const container = document.createElement('div');

  if (Array.isArray(solution.nodes) && solution.nodes.length > 0) {
    container.append(renderSolutionFlow(solution.nodes));
  }
  if (solution.note) {
    const note = document.createElement('div');
    note.className = 'reference-breakdown__section';
    const h3 = document.createElement('h3');
    h3.className = 'reference-breakdown__heading';
    h3.textContent = 'Почему схема устроена так';
    note.append(h3);
    for (const para of String(solution.note).split(/\n\s*\n/)) {
      const p = document.createElement('p');
      p.className = 'reference-breakdown__text';
      p.textContent = para.trim();
      note.append(p);
    }
    container.append(note);
  }

  return ReferenceBreakdown({ title, content: container });
}

// Статичный поток эталонных узлов в той же визуализации, что и конструктор.
function renderSolutionFlow(nodes) {
  const flow = document.createElement('ol');
  flow.className = 'solution-flow';
  nodes.forEach((node, i) => {
    const li = document.createElement('li');
    li.className = `solution-flow__node solution-flow__node--${node.type}`;

    const head = document.createElement('div');
    head.className = 'solution-flow__head';
    const type = document.createElement('span');
    type.className = 'solution-flow__type';
    type.textContent = NODE_TYPE_LABELS[node.type] || 'Шаг';
    const name = document.createElement('span');
    name.className = 'solution-flow__name';
    name.textContent = node.title || '';
    head.append(type, name);
    li.append(head);

    const meta = solutionMeta(node);
    if (meta) li.append(meta);

    flow.append(li);
    if (i < nodes.length - 1) {
      const link = document.createElement('li');
      link.className = 'solution-flow__connector';
      link.setAttribute('aria-hidden', 'true');
      link.textContent = '↓';
      flow.append(link);
    }
  });
  return flow;
}

function solutionMeta(node) {
  const rows = [
    ['Вход', node.input],
    ['Выход', node.output],
    ['Исполнитель', node.actor],
  ].filter(([, v]) => typeof v === 'string' && v.trim());
  if (rows.length === 0) return null;
  const dl = document.createElement('dl');
  dl.className = 'solution-flow__meta';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  return dl;
}

// Краткое описание построенной схемы — в notes события (журнал рефлексии 5.8).
function summarize(schema, checklist) {
  const desc = generateProcessDescription(schema);
  return `${desc}\n\nГотовность: ${checklist.getScore()} / 100.`;
}
