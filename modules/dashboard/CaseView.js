// modules/dashboard/CaseView.js — экран кейса модуля 5.3 Dashboard Analysis (T5.3).
//
// Собирает функции модуля из PRD §5.3:
//   Ф1 — интерактивный дашборд (ChartRenderer): line/bar/pie, tooltip, периоды;
//   Ф2 — вопросы с автопроверкой (QuestionChecker): mcq + numeric с tolerance;
//   Ф3 — «Найди аномалию» (AnomalyMarker): отметка периода с позиционным допуском;
//   Ф4 — «Напиши инсайт»: текстовое поле, активно ПОСЛЕ авто-задач (вопросы + аномалия);
//   Ф5 — эталонная интерпретация (ReferenceBreakdown): разбор каждого графика +
//        объяснение аномалии + образец инсайта, открывается после отправки;
//   Ф6 — самооценка инсайта + автосчёт: итог = normalizeScore(autoFraction, selfFraction)
//        по правилам §4 (комбинированный балл, веса W_AUTO/W_SELF из config.js).
//
// autoFraction (T5.2.3) агрегируется здесь по ВСЕМ авто-задачам кейса: верные
// вопросы + верная аномалия / общее число авто-задач. Если авто-задач нет — null
// (тогда score = только самооценка).
//
// PRD §4 прямо допускает, что у 5.3 НЕТ статуса «в процессе» — поэтому черновик
// не ведём (в отличие от 5.1/5.2/5.4). Событие пишется ровно один раз через
// SelfAssessment → saveAndFinalize.
//
// Принимает уже загруженный и провалидированный кейс (caseData) и номер попытки —
// загрузкой/диспетчеризацией занимается modules/caseHost.js.
//
// ES-модуль: `import { DashboardCaseView } from './modules/dashboard/CaseView.js'`.

import { CaseHeader } from '../../core/components/CaseHeader.js';
import { ReferenceBreakdown } from '../../core/components/ReferenceBreakdown.js';
import { mountCaseAiMentor } from '../../core/components/caseAiMentor.js';
import { textBlock, mountSelfAssessment } from '../../core/components/caseScaffold.js';
import { MENTOR_MODES } from '../../core/mentorContext.js';
import { ChartRenderer } from './ChartRenderer.js';
import { QuestionChecker } from './QuestionChecker.js';
import { AnomalyMarker } from './AnomalyMarker.js';

// Критерии самооценки инсайта (PRD §5.3 Ф4/Ф6). Шкала 0–100, комбинируется с авто-частью.
const SELF_CRITERIA = [
  { id: 'whatHappened', label: 'Инсайт точно описывает, что произошло', type: 'score' },
  { id: 'soWhat',       label: 'Понятно, что с этим делать (вывод-действие)', type: 'score' },
  { id: 'grounded',     label: 'Вывод опирается на данные дашборда', type: 'score' },
];

export async function DashboardCaseView({ caseData, attemptNo } = {}) {
  const payload = caseData.payload || {};
  const caseId = caseData.caseId;

  const root = document.createElement('section');
  root.className = 'case-view screen';

  // --- Шапка: заголовок, сложность, номер попытки, таймер ---------------------
  const header = CaseHeader({
    title: caseData.title || 'Кейс',
    difficulty: caseData.difficulty,
    attemptNo,
  });
  root.append(header.element);

  // --- Постановка задачи ------------------------------------------------------
  if (payload.scenario) root.append(textBlock('case-view__scenario', payload.scenario));
  if (payload.question) {
    const q = document.createElement('p');
    q.className = 'case-view__question';
    q.textContent = payload.question;
    root.append(q);
  }

  // --- Ф1: интерактивный дашборд ----------------------------------------------
  const dashboard = await ChartRenderer({ charts: payload.charts });
  root.append(dashboard.element);

  // --- Ф2: вопросы с автопроверкой --------------------------------------------
  let aiMentor = null;
  const questions = QuestionChecker({
    questions: payload.questions,
    onChange: () => { refreshInsightState(); refreshSubmitState(); aiMentor?.refreshPreview?.(); },
  });
  root.append(questions.element);

  // --- Ф3: найди аномалию (если задана в кейсе) -------------------------------
  let anomaly = null;
  if (payload.anomaly && typeof payload.anomaly === 'object') {
    const refChart = (payload.charts || []).find((c) => c.id === payload.anomaly.chartId)
      || (payload.charts || [])[0];
    anomaly = AnomalyMarker({ anomaly: payload.anomaly, labels: refChart?.labels });
    // Аномалия меняет состояние авто-задач — пересчитываем гейтинг по клику.
    anomaly.element.addEventListener('click', () => {
      // клик отрабатывает после обработчика кнопки → состояние уже обновлено
      setTimeout(() => { refreshInsightState(); refreshSubmitState(); aiMentor?.refreshPreview?.(); }, 0);
    });
    root.append(anomaly.element);
  }

  // --- Ф4: инсайт (активен после авто-задач) ----------------------------------
  const insightWrap = document.createElement('div');
  insightWrap.className = 'case-view__answer';
  const insightLabel = document.createElement('label');
  insightLabel.className = 'case-view__answer-label';
  insightLabel.htmlFor = 'insight';
  insightLabel.textContent = 'Инсайт: что произошло и что с этим делать';
  const insight = document.createElement('textarea');
  insight.id = 'insight';
  insight.className = 'case-view__answer-input';
  insight.rows = 3;
  insight.placeholder = 'Сформулируйте вывод уровня «что произошло и какое действие из этого следует»…';
  insight.disabled = true;
  insight.addEventListener('input', () => { refreshSubmitState(); aiMentor?.refreshPreview?.(); });
  const insightHint = document.createElement('p');
  insightHint.className = 'case-view__answer-hint';
  insightHint.textContent = 'Поле откроется после ответа на вопросы и отметки аномалии.';
  insightWrap.append(insightLabel, insight, insightHint);
  root.append(insightWrap);
  let submitted = false;

  aiMentor = await mountCaseAiMentor({
    caseData,
    modes: [
      MENTOR_MODES.hint,
      MENTOR_MODES.businessReview,
      MENTOR_MODES.referenceCheck,
      MENTOR_MODES.explainError,
      MENTOR_MODES.nextStep,
    ],
    defaultMode: MENTOR_MODES.hint,
    getStudentAnswer: () => insight.value,
    getStudentArtifacts: () => ({
      dashboardChecks: questions.getResults(),
      anomaly: anomaly?.getResult?.() || null,
    }),
    getProgressSummary: () => ({
      autoFraction: computeAutoFraction(),
      autoTasksDone: autoTasksDone(),
    }),
    isSubmitted: () => submitted,
    isReadyForReference: () => autoTasksDone() && insight.value.trim() !== '',
    onFocusAnswer: () => {
      if (!submitted && !insight.disabled) insight.focus();
    },
    onBeforeReferenceCheck: () => submitAnswerAndRevealReference(),
  });
  root.append(aiMentor.element);

  // --- Кнопка «Сверить с эталоном» --------------------------------------------
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

  // --- Ф5: эталонная интерпретация (скрыта до отправки) -----------------------
  const reference = buildReference(payload.reference, payload);
  root.append(reference.element);

  const selfHost = document.createElement('div');
  selfHost.className = 'case-view__self-host';
  root.append(selfHost);

  // --- Гейтинг: инсайт открывается после всех авто-задач ----------------------
  function autoTasksDone() {
    if (!questions.allAnswered()) return false;
    if (anomaly && !anomaly.isAnswered()) return false;
    return true;
  }

  function refreshInsightState() {
    if (submitted) return;
    const done = autoTasksDone();
    if (done && insight.disabled) {
      insight.disabled = false;
      insightHint.hidden = true;
      insight.focus();
    }
  }

  function refreshSubmitState() {
    if (submitted) return;
    const ready = autoTasksDone() && insight.value.trim() !== '';
    submit.disabled = !ready;
    submitHint.textContent = ready
      ? ''
      : !autoTasksDone()
        ? 'Ответьте на все вопросы и отметьте аномалию.'
        : 'Напишите инсайт, чтобы сверить его с эталоном.';
  }

  // --- autoFraction по всем авто-задачам (T5.2.3) -----------------------------
  function computeAutoFraction() {
    let total = questions.getTotal();
    let correct = questions.getCorrectCount();
    if (anomaly) {
      total += 1;
      if (anomaly.isCorrect()) correct += 1;
    }
    return total > 0 ? correct / total : null;
  }

  // --- Отправка: зафиксировать, раскрыть эталон, включить самооценку ----------
  submit.addEventListener('click', () => {
    submitAnswerAndRevealReference();
  });

  function submitAnswerAndRevealReference() {
    if (submitted) return true;
    if (!autoTasksDone() || insight.value.trim() === '') {
      refreshSubmitState();
      throw new Error(!autoTasksDone()
        ? 'Сначала ответьте на все вопросы и отметьте аномалию.'
        : 'Напишите инсайт перед проверкой по эталону.');
    }
    submitted = true;

    questions.lock();
    anomaly?.lock();
    insight.disabled = true;
    submit.disabled = true;
    submit.hidden = true;
    submitHint.textContent = '';

    reference.reveal();
    aiMentor.refreshPreview();

    const autoFraction = computeAutoFraction();

    // Ф6: самооценка инсайта + автосчёт. Итог = normalizeScore(autoFraction,
    // selfFraction) — SelfAssessment сам комбинирует с авто-частью (веса из config).
    mountSelfAssessment(selfHost, {
      caseData,
      header,
      criteria: SELF_CRITERIA,
      autoFraction,            // ← комбинированный балл (5.3, PRD §4)
      getNotes: () => insight.value.trim(),
      // освободить инстансы Chart.js перед записью (нет unmount-хука у роутера).
      beforeFinalize: () => dashboard.destroy(),
    });
    return true;
  }

  refreshInsightState();
  refreshSubmitState();
  // unmount-хук роутера: при уходе с кейса гасим таймер шапки и освобождаем
  // инстансы Chart.js (на пути финализации dashboard.destroy уже вызван — оба
  // вызова идемпотентны).
  return {
    element: root,
    destroy: () => { header.stop(); dashboard.destroy(); },
  };
}

// --- Ф5: эталонная интерпретация ---------------------------------------------
// reference = { charts:[{title,text}], anomaly:'…', insightSample:'…' }.
// Строим секции: разбор каждого графика + объяснение аномалии + образец инсайта.
function buildReference(reference, payload) {
  const title = 'Эталонная интерпретация';
  const sections = [];

  const chartBreakdowns = Array.isArray(reference?.charts) ? reference.charts : [];
  for (const c of chartBreakdowns) {
    if (!c) continue;
    sections.push({ heading: c.title || 'График', body: c.text || '' });
  }
  if (reference?.anomaly) {
    sections.push({ heading: 'Аномалия', body: reference.anomaly });
  }
  if (reference?.insightSample) {
    sections.push({ heading: 'Образец инсайта', body: reference.insightSample });
  }

  if (sections.length === 0) {
    return ReferenceBreakdown({
      title,
      content: 'Эталонная интерпретация для этого кейса ещё не задана — сверьтесь со своими наблюдениями и оцените себя честно.',
    });
  }
  return ReferenceBreakdown({ title, sections });
}
