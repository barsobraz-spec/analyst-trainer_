// modules/rca/CaseView.js — экран кейса модуля 5.4 Root Cause Analysis (T4.3).
//
// Собирает функции модуля из PRD §5.4:
//   проблема — сценарий, факты-данные, главный вопрос;
//   Ф1–Ф4 — рабочая область поиска причин (CauseAnalysis): выбор метода
//            (5 Whys / Fishbone), интерактивное дерево, отметка корневой причины;
//   Ф5 — эталонное дерево причин (ReferenceBreakdown), открывается после отправки
//        и показывается в ТОЙ ЖЕ визуализации (дерево) + истинная корневая причина;
//   Ф6 — самооценка (SelfAssessment) по критериям модуля; событие пишется ровно один
//        раз через saveAndFinalize. Модуль 5.4 — чистая самооценка (autoFraction:null),
//        подсказок нет (PRD §5.4 не содержит Ф подсказок).
//
// Черновик ведёт экран: один запис `{ method, fiveWhys, fishbone }` на caseId —
// поэтому CauseAnalysis монтируется с autosave:false (initialState + onChange), а
// сохранение/гейтинг отправки централизованы здесь (паттерн как у HypothesisCaseView
// ↔ HypothesisForm). До финализации уход с экрана сохраняет прогресс как «в процессе»;
// saveAndFinalize удаляет черновик.
//
// Принимает уже загруженный и провалидированный кейс (caseData) и номер попытки —
// загрузкой/диспетчеризацией занимается modules/caseHost.js.
//
// ES-модуль: `import { RcaCaseView } from './modules/rca/CaseView.js'`.

import { CaseHeader } from '../../core/components/CaseHeader.js';
import { ReferenceBreakdown } from '../../core/components/ReferenceBreakdown.js';
import { textBlock, factsBlock, mountSelfAssessment } from '../../core/components/caseScaffold.js';
import { CauseAnalysis } from './CauseAnalysis.js';
import { saveDraftState, getDraftState } from '../../core/db.js';

// Критерии самооценки модуля 5.4 (PRD §5.4 Ф6). Все — шкала 0–100, авто-части нет.
const SELF_CRITERIA = [
  { id: 'rootCause',  label: 'Найдена корневая причина', type: 'score' },
  { id: 'noDeadEnds', label: 'Нет тупиковых (недоказуемых) ветвей', type: 'score' },
  { id: 'structure',  label: 'Корректная структура дерева причин', type: 'score' },
];

const DRAFT_DEBOUNCE_MS = 600;

export async function RcaCaseView({ caseData, attemptNo } = {}) {
  const payload = caseData.payload || {};
  const caseId = caseData.caseId;

  const root = document.createElement('section');
  root.className = 'case-view screen';

  // Восстанавливаем незавершённый черновик RCA `{ method, fiveWhys, fishbone }`.
  let draft = null;
  try {
    draft = await getDraftState(caseId);
  } catch (err) {
    console.error('[rca] не удалось прочитать черновик', caseId, err);
  }

  // --- Шапка: заголовок, сложность, номер попытки, таймер ---------------------
  const header = CaseHeader({
    title: caseData.title || 'Кейс',
    difficulty: caseData.difficulty,
    attemptNo,
  });
  root.append(header.element);

  // --- Проблемная ситуация с данными (PRD §5.4 «Состав кейса») ----------------
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

  // --- Ф1–Ф4: рабочая область (черновик ведёт экран → autosave:false) ---------
  const analysis = await CauseAnalysis({
    payload,
    caseId,
    initialState: draft,
    autosave: false,
    onChange: () => { scheduleDraftSave(); refreshSubmitState(); },
  });
  root.append(analysis.element);

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

  // --- Ф5: эталонное дерево причин (скрыто до отправки) -----------------------
  const reference = buildSolutionReference(payload.solution);
  root.append(reference.element);

  // Контейнер самооценки заполняется только после раскрытия эталона.
  const selfHost = document.createElement('div');
  selfHost.className = 'case-view__self-host';
  root.append(selfHost);

  // --- Гейтинг отправки: должна быть хоть одна причина в активном методе ------
  function refreshSubmitState() {
    if (submitted) return;
    const ready = analysis.isReady();
    submit.disabled = !ready;
    submitHint.textContent = ready
      ? ''
      : 'Постройте дерево причин: добавьте хотя бы одну причину (5 Whys — заполните первый ответ).';
  }

  // --- Черновик (статус «в процессе»): полный срез RCA ------------------------
  let draftTimer = null;
  function scheduleDraftSave() {
    if (submitted) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, DRAFT_DEBOUNCE_MS);
  }
  async function saveDraft() {
    try {
      await saveDraftState(caseId, analysis.getState());
    } catch (err) {
      console.error('[rca] не удалось сохранить черновик', caseId, err);
    }
  }

  // --- Отправка: зафиксировать ввод, раскрыть эталон, включить самооценку ------
  let submitted = false;
  submit.addEventListener('click', () => {
    if (submitted || !analysis.isReady()) return;
    submitted = true;
    clearTimeout(draftTimer);

    // После показа эталона править нельзя (честность динамики, PRD §4).
    analysis.lock();
    submit.disabled = true;
    submit.hidden = true;
    submitHint.textContent = '';

    reference.reveal();

    // Ф6: самооценка. 5.4 — чистая самооценка (autoFraction:null), подсказок нет.
    mountSelfAssessment(selfHost, {
      caseData,
      header,
      criteria: SELF_CRITERIA,
      getNotes: () => summarizeRca(analysis.getResult()),
    });
  });

  refreshSubmitState();
  // unmount-хук роутера: останавливаем таймер шапки при уходе с кейса (идемпотентно).
  return { element: root, destroy: () => { header.stop(); } };
}

// --- Ф5: эталонное дерево причин ----------------------------------------------
// Показываем образцовое дерево в ТОЙ ЖЕ визуализации (вложенный список со стилями
// cause-tree, только для чтения) + явную истинную корневую причину и пояснение.
// payload.solution: { tree:[{label, root?, children[]}], rootCause:'…', note:'…' }.
function buildSolutionReference(solution) {
  const title = 'Эталонное дерево причин';

  if (!solution || (!Array.isArray(solution.tree) && !solution.rootCause && !solution.note)) {
    return ReferenceBreakdown({
      title,
      content: 'Эталонное дерево для этого кейса ещё не задано — сверьтесь со своим деревом и оцените себя честно.',
    });
  }

  const container = document.createElement('div');
  container.className = 'rca-solution';

  if (Array.isArray(solution.tree) && solution.tree.length > 0) {
    container.append(renderSolutionTree(solution.tree));
  }
  if (solution.rootCause) {
    const rc = document.createElement('p');
    rc.className = 'rca-solution__root-cause';
    const strong = document.createElement('strong');
    strong.textContent = 'Истинная корневая причина: ';
    rc.append(strong, document.createTextNode(String(solution.rootCause)));
    container.append(rc);
  }

  // Пояснение — отдельной секцией под деревом (если задано).
  if (solution.note) {
    const note = document.createElement('div');
    note.className = 'reference-breakdown__section';
    const h3 = document.createElement('h3');
    h3.className = 'reference-breakdown__heading';
    h3.textContent = 'Пояснение';
    note.append(h3);
    for (const para of String(solution.note).split(/\n\s*\n/)) {
      const p = document.createElement('p');
      p.className = 'reference-breakdown__text';
      p.textContent = para.trim();
      note.append(p);
    }
    container.append(note);
  }

  // Дерево + корневая причина + пояснение идут единым готовым узлом content.
  return ReferenceBreakdown({ title, content: container });
}

// Статичный (только для чтения) рендер дерева причин в стилях cause-tree.
function renderSolutionTree(nodes) {
  const wrap = document.createElement('div');
  wrap.className = 'cause-tree cause-tree--readonly';
  wrap.append(buildSolutionList(nodes));
  return wrap;
}

function buildSolutionList(nodes) {
  const ul = document.createElement('ul');
  ul.className = 'cause-tree__list';
  for (const node of nodes) {
    const li = document.createElement('li');
    li.className = 'cause-tree__node';
    if (node && node.root) li.classList.add('cause-tree__node--root');

    const row = document.createElement('div');
    row.className = 'cause-tree__row';
    const label = document.createElement('span');
    label.className = 'cause-tree__label';
    label.textContent = node && node.label != null ? String(node.label) : '';
    row.append(label);
    if (node && node.root) {
      const badge = document.createElement('span');
      badge.className = 'cause-tree__root-badge';
      badge.textContent = '★ корневая';
      row.append(badge);
    }
    li.append(row);

    if (node && Array.isArray(node.children) && node.children.length > 0) {
      li.append(buildSolutionList(node.children));
    }
    ul.append(li);
  }
  return ul;
}

// Краткое текстовое описание работы пользователя — пишется в notes события, чтобы
// журнал рефлексии (5.8) показывал, что именно было построено.
function summarizeRca(result) {
  if (!result) return '';
  if (result.method === 'fivewhys') {
    const chain = (result.levels || []).filter(Boolean);
    return chain.length ? `Метод 5 Whys: ${chain.join(' → ')}` : 'Метод 5 Whys: цепочка не заполнена.';
  }
  // fishbone
  const lines = ['Метод Fishbone.'];
  const causes = [];
  walkTree(result.tree || [], (n, depth) => {
    if (depth >= 2 && n.label && n.label.trim()) causes.push(n.label.trim());
  });
  if (causes.length) lines.push(`Причины: ${causes.join('; ')}.`);
  const roots = (result.rootCauses || []).map((r) => r.label).filter(Boolean);
  if (roots.length) lines.push(`Корневая причина: ${roots.join('; ')}.`);
  return lines.join(' ');
}

function walkTree(nodes, fn, depth = 0) {
  for (const n of nodes) {
    fn(n, depth);
    if (Array.isArray(n.children)) walkTree(n.children, fn, depth + 1);
  }
}
