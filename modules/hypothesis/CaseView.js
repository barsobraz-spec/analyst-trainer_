// modules/hypothesis/CaseView.js — экран кейса модуля 5.2 Hypothesis Trainer (T3.2).
//
// Собирает функции модуля из PRD §5.2:
//   проблема — сценарий, факты-данные, главный вопрос;
//   Ф1–Ф3 — конструктор гипотез (HypothesisForm): 5 полей, шаблоны, чек-лист качества;
//   Ф4 — матрица приоритизации (PrioritizationMatrix), синхронизируется с формой;
//   Ф5 — эталонный набор гипотез (ReferenceBreakdown), открывается после отправки;
//   Ф6 — самооценка (SelfAssessment) по критериям модуля; событие пишется ровно один
//        раз через saveAndFinalize. Модуль 5.2 — чистая самооценка (autoFraction:null),
//        подсказок нет (PRD §5.2 не содержит Ф подсказок).
//
// Черновик ведёт экран (а не форма): один запис `{ hypotheses, matrix }` на caseId —
// поэтому форма монтируется с autosave:false, а сохранение/гейтинг отправки централизованы
// здесь (паттерн как у DetectiveCaseView ↔ ReasoningChain). До финализации уход с экрана
// сохраняет прогресс как «в процессе»; saveAndFinalize удаляет черновик.
//
// Принимает уже загруженный и провалидированный кейс (caseData) и номер попытки —
// загрузкой/диспетчеризацией занимается modules/caseHost.js.
//
// ES-модуль: `import { HypothesisCaseView } from './modules/hypothesis/CaseView.js'`.

import { CaseHeader } from '../../core/components/CaseHeader.js';
import { ReferenceBreakdown } from '../../core/components/ReferenceBreakdown.js';
import { textBlock, factsBlock, mountSelfAssessment } from '../../core/components/caseScaffold.js';
import { HypothesisForm } from './HypothesisForm.js';
import { PrioritizationMatrix } from './PrioritizationMatrix.js';
import { saveDraftState, getDraftState } from '../../core/db.js';

// Критерии самооценки модуля 5.2 (PRD §5.2 Ф6: «на основе чек-листов качества гипотез
// и сравнения с эталоном»). Обе — шкала 0–100, авто-части нет.
const SELF_CRITERIA = [
  { id: 'quality', label: 'Качество гипотез (по чек-листам)', type: 'score' },
  { id: 'reference', label: 'Соответствие эталонному набору', type: 'score' },
];

const DRAFT_DEBOUNCE_MS = 600;

export async function HypothesisCaseView({ caseData, attemptNo } = {}) {
  const payload = caseData.payload || {};
  const caseId = caseData.caseId;

  const root = document.createElement('section');
  root.className = 'case-view screen';

  // Восстанавливаем незавершённый черновик: гипотезы (форма) + размещение (матрица).
  let draft = null;
  try {
    draft = await getDraftState(caseId);
  } catch (err) {
    console.error('[hypothesis] не удалось прочитать черновик', caseId, err);
  }

  // --- Шапка: заголовок, сложность, номер попытки, таймер ---------------------
  const header = CaseHeader({
    title: caseData.title || 'Кейс',
    difficulty: caseData.difficulty,
    attemptNo,
  });
  root.append(header.element);

  // --- Проблемная ситуация с данными (PRD §5.2 «Состав кейса») ----------------
  if (payload.scenario) {
    root.append(textBlock('case-view__scenario', payload.scenario));
  }
  if (Array.isArray(payload.facts) && payload.facts.length > 0) {
    root.append(factsBlock(payload.facts));
  }
  if (payload.question) {
    const q = document.createElement('p');
    q.className = 'case-view__question';
    q.textContent = payload.question;
    root.append(q);
  }

  // --- Ф1–Ф3: конструктор гипотез (черновик ведёт экран → autosave:false) ------
  const form = await HypothesisForm({
    payload,
    caseId,
    initialHypotheses: draft?.hypotheses,
    autosave: false,
    onChange: () => { syncMatrix(); scheduleDraftSave(); refreshSubmitState(); },
  });
  root.append(form.element);

  // --- Ф4: матрица приоритизации (берёт заполненные гипотезы из формы) ---------
  const matrix = PrioritizationMatrix({
    items: form.getItems().filter((it) => it.filled),
    initialPlacement: draft?.matrix,
    onChange: scheduleDraftSave,
  });
  root.append(matrix.element);

  function syncMatrix() {
    matrix.setItems(form.getItems().filter((it) => it.filled));
  }

  // --- Кнопка «Сверить с эталоном» (открывает Ф5 + Ф6) ------------------------
  const submitBar = document.createElement('div');
  submitBar.className = 'case-view__submit-bar';
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'case-view__submit';
  submit.textContent = 'Сверить с эталоном';
  const submitHint = document.createElement('span');
  submitHint.className = 'case-view__submit-hint';
  submitBar.append(submit, submitHint);
  root.append(submitBar);

  // --- Ф5: эталонный набор гипотез (скрыт до отправки) ------------------------
  const reference = buildReference(payload.reference);
  root.append(reference.element);

  // Контейнер самооценки заполняется только после раскрытия эталона.
  const selfHost = document.createElement('div');
  selfHost.className = 'case-view__self-host';
  root.append(selfHost);

  // --- Гейтинг отправки: нужно требуемое число полностью заполненных гипотез ---
  function refreshSubmitState() {
    if (submitted) return;
    const ready = form.isReady();
    submit.disabled = !ready;
    submitHint.textContent = ready
      ? ''
      : `Заполните все поля как минимум для ${form.requiredCount} гипотез.`;
  }

  // --- Черновик (статус «в процессе»): гипотезы + размещение в матрице ---------
  let draftTimer = null;
  function scheduleDraftSave() {
    if (submitted) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, DRAFT_DEBOUNCE_MS);
  }
  async function saveDraft() {
    try {
      await saveDraftState(caseId, {
        hypotheses: form.getRawHypotheses(),
        matrix: matrix.getPlacement(),
      });
    } catch (err) {
      console.error('[hypothesis] не удалось сохранить черновик', caseId, err);
    }
  }

  // --- Отправка: зафиксировать ввод, раскрыть эталон, включить самооценку ------
  let submitted = false;
  submit.addEventListener('click', () => {
    if (submitted || !form.isReady()) return;
    submitted = true;
    clearTimeout(draftTimer);

    // После показа эталона править нельзя (честность динамики, PRD §4).
    form.lock();
    matrix.lock();
    submit.disabled = true;
    submit.hidden = true;
    submitHint.textContent = '';

    reference.reveal();

    // Ф6: самооценка. 5.2 — чистая самооценка (autoFraction:null), подсказок нет.
    mountSelfAssessment(selfHost, {
      caseData,
      header,
      criteria: SELF_CRITERIA,
      getNotes: () => summarizeHypotheses(form.getHypotheses()),
    });
  });

  refreshSubmitState();
  // unmount-хук роутера: останавливаем таймер шапки при уходе с кейса (идемпотентно).
  return { element: root, destroy: () => { header.stop(); } };
}

// --- Ф5: эталонный набор гипотез ---------------------------------------------
// Предпочитаем структурированный payload.reference.hypotheses [{ statement|поля, why }];
// поддерживаем и общий формат sections/ text, и запасной текст, если эталон не задан.
function buildReference(reference) {
  const title = 'Эталонный набор гипотез';
  if (reference && Array.isArray(reference.hypotheses) && reference.hypotheses.length > 0) {
    const sections = reference.hypotheses.map((h, i) => ({
      heading: `Эталонная гипотеза ${i + 1}`,
      body: referenceBody(h),
    }));
    if (reference.note) {
      sections.push({ heading: 'Почему эти гипотезы сильные', body: reference.note });
    }
    return ReferenceBreakdown({ title, sections });
  }
  if (reference && Array.isArray(reference.sections) && reference.sections.length > 0) {
    return ReferenceBreakdown({ title, sections: reference.sections });
  }
  if (reference && (reference.text || typeof reference === 'string')) {
    return ReferenceBreakdown({ title, content: reference.text || reference });
  }
  return ReferenceBreakdown({
    title,
    content: 'Эталонный набор для этого кейса ещё не задан — сверьтесь со своими гипотезами и оцените себя честно.',
  });
}

// Текст одной эталонной гипотезы: готовая формулировка statement либо собранная из
// полей «Если/То/Потому что» + способ проверки и метрика; «почему проверяема» отдельно.
function referenceBody(h) {
  if (h == null) return '';
  const lines = [];
  if (h.statement) {
    lines.push(String(h.statement));
  } else {
    const head = [];
    if (h.if) head.push(`Если ${h.if}`);
    if (h.then) head.push(`то ${h.then}`);
    if (h.because) head.push(`потому что ${h.because}`);
    if (head.length) lines.push(`${head.join(', ')}.`);
    if (h.test) lines.push(`Проверка: ${h.test}.`);
    if (h.metric) lines.push(`Метрика: ${h.metric}.`);
  }
  if (h.why) lines.push(`Почему проверяема: ${h.why}`);
  return lines.join('\n\n');
}

// Краткое текстовое описание гипотез пользователя — пишется в notes события, чтобы
// журнал рефлексии (5.8) показывал, что именно было сформулировано.
function summarizeHypotheses(list) {
  return list
    .map((h, i) => {
      const head = [];
      if (h.if) head.push(`Если ${h.if}`);
      if (h.then) head.push(`то ${h.then}`);
      if (h.because) head.push(`потому что ${h.because}`);
      let s = `Гипотеза ${i + 1}: ${head.join(', ')}`;
      if (h.test) s += `. Проверка: ${h.test}`;
      if (h.metric) s += `. Метрика: ${h.metric}`;
      return s;
    })
    .join('\n');
}
