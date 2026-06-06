// modules/detective/CaseView.js — экран кейса модуля 5.1 Data Detective (T1.6).
//
// Собирает все функции модуля из PRD §5.1:
//   Ф1 — сценарий, таблица данных (сортировка кликом по заголовку), метрики;
//   Ф2 — цепочка рассуждений (ReasoningChain) + сохранение черновика в IndexedDB;
//   Ф3 — отдельное поле финального ответа; «Сверить с эталоном» блокируется, пока
//        цепочка рассуждений пуста;
//   Ф4 — подсказки по запросу (HintsPanel), hintsUsed фиксируется;
//   Ф5 — эталонный разбор (ReferenceBreakdown), открывается после отправки ответа;
//   Ф6 — самооценка (SelfAssessment) по критериям модуля; событие пишется
//        ровно один раз через saveAndFinalize.
//
// Поток: пользователь читает кейс, заполняет цепочку и вывод (черновик пишется в
// фоне → статус «в процессе»), при желании открывает подсказки. По кнопке «Сверить
// с эталоном» цепочка/ответ блокируются, открывается эталонный разбор и активируется
// самооценка. «Завершить попытку» внутри SelfAssessment пишет событие и удаляет
// черновик. До этого момента уход с экрана сохраняет прогресс как незавершённый.
//
// Принимает уже загруженный и провалидированный кейс (caseData) и номер попытки —
// загрузкой/диспетчеризацией занимается modules/caseHost.js.
//
// ES-модуль: `import { DetectiveCaseView } from './modules/detective/CaseView.js'`.

import { CaseHeader } from '../../core/components/CaseHeader.js';
import { HintsPanel } from '../../core/components/HintsPanel.js';
import { ReferenceBreakdown } from '../../core/components/ReferenceBreakdown.js';
import { textBlock, mountSelfAssessment } from '../../core/components/caseScaffold.js';
import { ReasoningChain } from './ReasoningChain.js';
import { saveDraftState, getDraftState } from '../../core/db.js';

// Критерии самооценки модуля 5.1 (PRD §5.1 Ф6). Все — шкала 0–100, авто-части нет.
const SELF_CRITERIA = [
  { id: 'accuracy', label: 'Точность вывода', type: 'score' },
  { id: 'completeness', label: 'Полнота наблюдений', type: 'score' },
  { id: 'noFalseCauses', label: 'Отсутствие ложных причин', type: 'score' },
];

const DRAFT_DEBOUNCE_MS = 600;

export async function DetectiveCaseView({ caseData, attemptNo } = {}) {
  const payload = caseData.payload || {};
  const caseId = caseData.caseId;

  const root = document.createElement('section');
  root.className = 'case-view screen';

  // Восстанавливаем незавершённый черновик (Ф2): цепочка + финальный ответ.
  let draft = null;
  try {
    draft = await getDraftState(caseId);
  } catch (err) {
    console.error('[detective] не удалось прочитать черновик', caseId, err);
  }

  // --- Шапка с таймером, сложностью и номером попытки (T1.5.1) ----------------
  const header = CaseHeader({
    title: caseData.title || 'Кейс',
    difficulty: caseData.difficulty,
    attemptNo,
  });
  root.append(header.element);

  // --- Ф1: сценарий, таблица, метрики ----------------------------------------
  if (payload.scenario) {
    root.append(textBlock('case-view__scenario', payload.scenario));
  }
  if (payload.table) {
    root.append(buildDataTable(payload.table));
  }
  if (Array.isArray(payload.metrics) && payload.metrics.length > 0) {
    root.append(buildMetrics(payload.metrics));
  }
  if (payload.question) {
    const q = document.createElement('p');
    q.className = 'case-view__question';
    q.textContent = payload.question;
    root.append(q);
  }

  // --- Ф2: цепочка рассуждений + черновик -------------------------------------
  const chain = ReasoningChain({
    initialSteps: draft?.chain,
    prompts: payload.reasoning?.stepPrompts,
    onChange: () => { scheduleDraftSave(); refreshSubmitState(); },
  });
  root.append(chain.element);

  // --- Ф3: финальный ответ ----------------------------------------------------
  const answerWrap = document.createElement('div');
  answerWrap.className = 'case-view__answer';
  const answerLabel = document.createElement('label');
  answerLabel.className = 'case-view__answer-label';
  answerLabel.htmlFor = 'final-answer';
  answerLabel.textContent = 'Финальный ответ на главный вопрос';
  const answer = document.createElement('textarea');
  answer.id = 'final-answer';
  answer.className = 'case-view__answer-input';
  answer.rows = 3;
  answer.placeholder = 'Итоговый вывод по расследованию…';
  answer.value = draft?.finalAnswer || '';
  answer.addEventListener('input', scheduleDraftSave);
  answerWrap.append(answerLabel, answer);
  root.append(answerWrap);

  // --- Ф4: подсказки ----------------------------------------------------------
  const hints = HintsPanel({ hints: payload.hints || [] });
  root.append(hints.element);

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

  // --- Ф5: эталонный разбор (скрыт до отправки) -------------------------------
  const reference = buildReference(payload.reference);
  root.append(reference.element);

  // Контейнер самооценки заполняется только после раскрытия эталона.
  const selfHost = document.createElement('div');
  selfHost.className = 'case-view__self-host';
  root.append(selfHost);

  // --- Блокировка отправки, пока цепочка пуста (Ф3) ---------------------------
  function refreshSubmitState() {
    if (submitted) return;
    const empty = chain.isEmpty();
    submit.disabled = empty;
    submitHint.textContent = empty
      ? 'Заполните хотя бы один шаг цепочки рассуждений.'
      : '';
  }

  // --- Сохранение черновика (Ф2: статус «в процессе») -------------------------
  let draftTimer = null;
  function scheduleDraftSave() {
    if (submitted) return; // после финализации черновик не нужен
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, DRAFT_DEBOUNCE_MS);
  }
  async function saveDraft() {
    try {
      await saveDraftState(caseId, {
        chain: chain.getRawSteps(),
        finalAnswer: answer.value,
      });
    } catch (err) {
      console.error('[detective] не удалось сохранить черновик', caseId, err);
    }
  }

  // --- Отправка ответа: раскрыть эталон + активировать самооценку -------------
  let submitted = false;
  submit.addEventListener('click', () => {
    if (submitted || chain.isEmpty()) return;
    submitted = true;
    clearTimeout(draftTimer);

    // Фиксируем ответ: после показа эталона править нельзя (честность динамики).
    chain.lock();
    answer.disabled = true;
    disablePanel(hints.element); // hintsUsed заморожен на момент сверки
    submit.disabled = true;
    submit.hidden = true;
    submitHint.textContent = '';

    reference.reveal();

    // Самооценка (Ф6). 5.1 — только самооценка (autoFraction:null).
    mountSelfAssessment(selfHost, {
      caseData,
      header,
      criteria: SELF_CRITERIA,
      hintsUsed: hints.getHintsUsed(),
      hintsTotal: (payload.hints || []).length,
      getNotes: () => answer.value.trim(),
    });
  });

  refreshSubmitState();
  // unmount-хук роутера: останавливаем таймер шапки при уходе с кейса (идемпотентно).
  return { element: root, destroy: () => { header.stop(); } };
}

// --- Ф1: таблица данных с сортировкой по столбцам ----------------------------
// table = { columns: [{ key, label, numeric? }], rows: [{ [key]: value }] }.
// Клик по заголовку сортирует по столбцу (toggle asc/desc). Числовые столбцы
// сравниваются как числа, остальные — как строки (локаль ru).
function buildDataTable(table) {
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const rows = Array.isArray(table.rows) ? [...table.rows] : [];

  const wrap = document.createElement('div');
  wrap.className = 'case-view__table-wrap';

  const el = document.createElement('table');
  el.className = 'case-view__table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');

  // sortState: { key, dir: 'asc' | 'desc' } | null
  let sortState = null;

  function renderBody() {
    const sorted = [...rows];
    if (sortState) {
      const col = columns.find((c) => c.key === sortState.key);
      const numeric = col?.numeric;
      sorted.sort((a, b) => {
        const av = a[sortState.key];
        const bv = b[sortState.key];
        let cmp;
        if (numeric) {
          cmp = (Number(av) || 0) - (Number(bv) || 0);
        } else {
          cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'ru');
        }
        return sortState.dir === 'asc' ? cmp : -cmp;
      });
    }
    tbody.replaceChildren();
    for (const r of sorted) {
      const tr = document.createElement('tr');
      for (const c of columns) {
        const td = document.createElement('td');
        if (c.numeric) td.classList.add('case-view__cell--num');
        td.textContent = r[c.key] ?? '';
        tr.append(td);
      }
      tbody.append(tr);
    }
  }

  for (const c of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'case-view__sort';
    btn.textContent = c.label || c.key;
    const arrow = document.createElement('span');
    arrow.className = 'case-view__sort-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    btn.append(arrow);
    btn.addEventListener('click', () => {
      if (sortState && sortState.key === c.key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState = { key: c.key, dir: 'asc' };
      }
      // Обновляем индикаторы сортировки и aria-sort на всех заголовках.
      for (const h of headRow.children) {
        const hk = h.dataset.key;
        const a = h.querySelector('.case-view__sort-arrow');
        if (hk === sortState.key) {
          h.setAttribute('aria-sort', sortState.dir === 'asc' ? 'ascending' : 'descending');
          a.textContent = sortState.dir === 'asc' ? ' ▲' : ' ▼';
        } else {
          h.removeAttribute('aria-sort');
          a.textContent = '';
        }
      }
      renderBody();
    });
    th.dataset.key = c.key;
    th.append(btn);
    headRow.append(th);
  }

  thead.append(headRow);
  const tbody = document.createElement('tbody');
  el.append(thead, tbody);
  renderBody();

  wrap.append(el);
  return wrap;
}

// --- Ф1: набор метрик --------------------------------------------------------
function buildMetrics(metrics) {
  const dl = document.createElement('dl');
  dl.className = 'case-view__metrics';
  for (const m of metrics) {
    const dt = document.createElement('dt');
    dt.textContent = m.label ?? '';
    const dd = document.createElement('dd');
    dd.textContent = m.value ?? '';
    dl.append(dt, dd);
  }
  return dl;
}

// --- Ф5: эталонный разбор (с запасным текстом, если кейс его не задал) --------
function buildReference(reference) {
  if (reference && Array.isArray(reference.sections) && reference.sections.length > 0) {
    return ReferenceBreakdown({ sections: reference.sections });
  }
  if (reference && (reference.text || typeof reference === 'string')) {
    return ReferenceBreakdown({ content: reference.text || reference });
  }
  return ReferenceBreakdown({
    content: 'Эталонный разбор для этого кейса ещё не задан — сверьтесь со своими наблюдениями и оцените себя честно.',
  });
}

// --- Мелкие помощники --------------------------------------------------------
function disablePanel(panelEl) {
  for (const el of panelEl.querySelectorAll('button, input, textarea')) el.disabled = true;
}
