// modules/simulator/CaseView.js — экран кейса модуля 5.6 Business Simulator (T7.3).
//
// Собирает функции модуля из PRD §5.6:
//   Ф1 — панель состояния (StatePanel): метрики и динамика по раундам;
//   Ф2 — принятие решения (DecisionForm): выбор варианта и/или числовой ввод с
//        валидацией по диапазону;
//   Ф3 — числовой движок (core/simulationEngine): применяет формулы кейса к решению
//        безопасным парсером expr-eval, пересчитывает метрики; NaN/Infinity/деление
//        на ноль → раунд не применяется, кейс помечается ошибочным, показывается
//        сообщение;
//   Ф4 — защита решения (обоснование в DecisionForm до показа последствий);
//   Ф5 — итог симуляции (FinalResult): финальные метрики vs цель, балл, эталон;
//   Ф6 — разбор последствий после каждого раунда (RoundResult) + эталонная стратегия
//        в конце.
//
// Балл 5.6 — процент достижения целевого показателя (computeSimulationScore), без
// текстовой самооценки (PRD §4 «5.6»). Событие пишется ровно один раз через
// saveAndFinalize сразу после показа итога.
//
// Прогресс раундов — статус «в процессе»: экран ведёт черновик { decisions, history }
// (применённые решения + снимки состояния), сохраняет после каждого раунда и
// восстанавливает при возврате; saveAndFinalize удаляет черновик.
//
// Принимает уже загруженный/провалидированный кейс и номер попытки — загрузкой и
// диспетчеризацией занимается modules/caseHost.js.
//
// ES-модуль: `import { SimulatorCaseView } from './modules/simulator/CaseView.js'`.

import { CaseHeader } from '../../core/components/CaseHeader.js';
import { textBlock, doneNotice } from '../../core/components/caseScaffold.js';
import { saveDraftState, getDraftState } from '../../core/db.js';
import { saveAndFinalize } from '../../core/event.js';
import {
  createSimulationEngine,
  computeSimulationScore,
  SimulationError,
} from '../../core/simulationEngine.js';
import { StatePanel } from './StatePanel.js';
import { DecisionForm } from './DecisionForm.js';
import { renderRoundResult } from './RoundResult.js';
import { renderFinalResult } from './FinalResult.js';

export async function SimulatorCaseView({ caseData, attemptNo } = {}) {
  const payload = caseData.payload || {};
  const caseId = caseData.caseId;
  const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
  const rounds = Array.isArray(payload.rounds) ? payload.rounds : [];
  const target = payload.target || {};

  const root = document.createElement('section');
  root.className = 'case-view simulator-case screen';

  // --- Шапка: заголовок, сложность, номер попытки, таймер ---------------------
  const header = CaseHeader({
    title: caseData.title || 'Кейс',
    difficulty: caseData.difficulty,
    attemptNo,
  });
  root.append(header.element);

  // --- Базовая проверка контента (Ф3: ошибочный кейс не запускаем) ------------
  const startState = buildStartState(metrics, payload.startState);
  if (metrics.length === 0 || rounds.length === 0 || !target.metric) {
    return contentError(root, header,
      'Кейс симуляции некорректен: отсутствуют метрики, раунды или целевой показатель.');
  }

  // --- Безопасный движок формул (expr-eval) -----------------------------------
  let engine;
  try {
    engine = await createSimulationEngine();
  } catch (err) {
    console.error('[simulator] не удалось инициализировать движок формул', err);
    return contentError(root, header,
      'Не удалось загрузить числовой движок симуляции. Попробуйте перезагрузить страницу.');
  }

  // --- Сценарий и главный вопрос ----------------------------------------------
  if (payload.scenario) root.append(textBlock('case-view__scenario', payload.scenario));
  if (payload.question) {
    const q = document.createElement('p');
    q.className = 'case-view__question';
    q.textContent = payload.question;
    root.append(q);
  }

  // --- Ф1: панель состояния ---------------------------------------------------
  const panel = StatePanel({ metrics });
  root.append(panel.element);

  // Журнал последствий раундов (Ф6) и активная область (форма решения / итог).
  const log = document.createElement('div');
  log.className = 'simulator-case__log';
  root.append(log);

  const stage = document.createElement('div');
  stage.className = 'simulator-case__stage';
  root.append(stage);

  // --- Состояние прохождения --------------------------------------------------
  // history: [startState, послеР1, …]; decisions: применённые решения по раундам.
  let history = [startState];
  let decisions = [];
  let finalized = false;
  let halted = false; // ошибка контента остановила симуляцию

  // Восстанавливаем черновик «в процессе» (применённые раунды + снимки).
  try {
    const draft = await getDraftState(caseId);
    if (draft && Array.isArray(draft.history) && draft.history.length > 0 && Array.isArray(draft.decisions)) {
      history = draft.history;
      decisions = draft.decisions;
    }
  } catch (err) {
    console.error('[simulator] не удалось прочитать черновик', caseId, err);
  }

  // Перерисовываем журнал применённых раундов (после восстановления и по ходу игры).
  function renderLog() {
    log.replaceChildren();
    decisions.forEach((decision, i) => {
      const round = rounds[i] || {};
      log.append(renderRoundResult({
        roundIndex: i,
        title: round.title,
        decision,
        before: history[i],
        after: history[i + 1],
        metrics,
        explanation: round.explanation,
      }));
    });
  }

  function currentState() {
    return history[history.length - 1];
  }

  // --- Сохранение черновика (статус «в процессе») -----------------------------
  async function saveDraft() {
    try {
      await saveDraftState(caseId, { decisions, history });
    } catch (err) {
      console.error('[simulator] не удалось сохранить черновик', caseId, err);
    }
  }

  // --- Активная область: форма следующего раунда либо итог --------------------
  function renderStage() {
    stage.replaceChildren();
    panel.update(history);

    if (halted) return;

    const idx = decisions.length;
    if (idx >= rounds.length) {
      renderFinal();
      return;
    }
    renderDecision(idx);
  }

  function renderDecision(idx) {
    const round = rounds[idx];
    const form = DecisionForm({ round, roundIndex: idx, onChange: refreshApply });
    stage.append(form.element);

    const bar = document.createElement('div');
    bar.className = 'case-view__submit-bar';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'case-view__submit';
    apply.textContent = idx === rounds.length - 1 ? 'Применить и завершить' : 'Применить решение';
    const hint = document.createElement('span');
    hint.className = 'case-view__submit-hint';
    bar.append(apply, hint);
    stage.append(bar);

    function refreshApply() {
      const reason = form.getInvalidReason();
      apply.disabled = reason !== null;
      hint.textContent = reason || '';
    }

    apply.addEventListener('click', () => {
      if (form.getInvalidReason() !== null) return;
      applyRound(idx, form);
    });

    refreshApply();
  }

  // --- Ф3: применить решение через безопасный движок --------------------------
  function applyRound(idx, form) {
    const round = rounds[idx];
    const decision = form.getDecision();
    const before = currentState();
    const scope = { ...before, ...decision.params };

    let nextScope;
    try {
      nextScope = engine.applyModel(round.model || [], scope);
    } catch (err) {
      // NaN / Infinity / деление на ноль или битая формула — дефект JSON кейса.
      if (err instanceof SimulationError) {
        haltWithContentError(round, err);
        return;
      }
      throw err;
    }

    // Новое состояние = значения метрик из пересчитанного скоупа.
    const nextState = {};
    for (const m of metrics) {
      nextState[m.key] = Number.isFinite(nextScope[m.key]) ? nextScope[m.key] : before[m.key];
    }

    form.lock();
    history.push(nextState);
    decisions.push({
      summary: decision.summary,
      justification: decision.justification,
      choices: decision.choices,
      inputs: decision.inputs,
    });

    renderLog();
    renderStage();
    saveDraft();
  }

  function haltWithContentError(round, err) {
    halted = true;
    console.error('[simulator] ошибка формул кейса (помечаем контент ошибочным)', caseId, round?.title, err);
    stage.replaceChildren();
    const box = document.createElement('div');
    box.className = 'case-view__content-error';
    const h = document.createElement('h3');
    h.textContent = 'Ошибка в данных кейса';
    const p = document.createElement('p');
    p.textContent = 'Формула этого раунда вернула некорректное значение, поэтому раунд не применён. '
      + 'Это дефект содержимого кейса, а не вашего решения.';
    box.append(h, p);
    stage.append(box);
  }

  // --- Ф5: итог симуляции + запись события ------------------------------------
  function renderFinal() {
    if (finalized) return;
    finalized = true;

    const finalState = currentState();
    const score = computeSimulationScore(finalState, target);

    const final = renderFinalResult({
      finalState,
      metrics,
      target,
      score,
      reference: payload.reference,
    });
    stage.append(final.element);

    // Событие пишется ровно один раз (PRD §4). У 5.6 нет текстовой самооценки —
    // балл целиком определяется достижением цели (computeSimulationScore).
    const { finishedAt } = header.stop();
    saveAndFinalize({
      module: caseData.module,
      caseId,
      attemptNo,
      startedAt: header.startedAt,
      finishedAt,
      score,
      skillTags: caseData.skillTags || [],
      selfAssessment: null,
      hintsUsed: 0,
      notes: summarizeDecisions(decisions, rounds),
    }).then(() => {
      stage.append(doneNotice(caseData.module));
    }).catch((err) => {
      console.error('[simulator] не удалось записать событие', caseId, err);
      const fail = document.createElement('p');
      fail.className = 'case-view__error';
      fail.setAttribute('role', 'alert');
      fail.textContent = 'Не удалось сохранить результат. Прогресс этой попытки может не отобразиться.';
      stage.append(fail);
    });
  }

  renderLog();
  renderStage();
  // unmount-хук роутера: останавливаем таймер шапки при уходе с кейса (идемпотентно).
  // Движок симуляции — чистый JS без воркера, отдельной очистки не требует.
  return { element: root, destroy: () => { header.stop(); } };
}

// --- Стартовое состояние: из payload.startState, иначе из metric.initial ------
function buildStartState(metrics, startState) {
  const src = startState && typeof startState === 'object' ? startState : {};
  const state = {};
  for (const m of metrics) {
    const value = Number.isFinite(src[m.key]) ? src[m.key]
      : (Number.isFinite(m.initial) ? m.initial : 0);
    state[m.key] = value;
  }
  return state;
}

// --- Краткая выжимка решений для notes события (журнал рефлексии 5.8) ---------
function summarizeDecisions(decisions, rounds) {
  if (!decisions.length) return 'Симуляция: решения не приняты.';
  const lines = decisions.map((d, i) => {
    const title = rounds[i]?.title || `Раунд ${i + 1}`;
    return `${title}: ${d.summary || '—'}`;
  });
  return lines.join('\n');
}

// --- Экран ошибки контента (некорректный кейс, Ф3) ---------------------------
function contentError(root, header, message) {
  const box = document.createElement('div');
  box.className = 'case-view__content-error';
  const h = document.createElement('h2');
  h.textContent = 'Кейс недоступен';
  const p = document.createElement('p');
  p.textContent = message;
  box.append(h, p);
  root.append(box);
  return root;
}

