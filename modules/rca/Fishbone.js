// modules/rca/Fishbone.js — метод «Fishbone» (диаграмма Исикавы) модуля 5.4 (T4.2.1).
//
// PRD §5.4 Ф2: «Древовидная структура с категориями причин; пользователь добавляет ветви
// и подпричины.» Fishbone — это конфигурация дерева причин (CauseTree): корень = проблема,
// его дети = ≥4 фиксированные категории из кейса; пользователь дописывает подпричины внутрь
// каждой категории (и глубже). Категории и сама проблема защищены: их нельзя удалить или
// переименовать, а к проблеме нельзя добавить новую категорию — набор категорий задаёт кейс.
//
// Рендер — не SVG-«рыбий скелет», а вложенный HTML-список (CauseTree): доступно, тестируемо
// и работает на узких экранах (тот же выбор, что и матрица 5.2 — селект вместо drag-and-drop).
//
// Персистентность (T4.2.4, PRD «Статусы кейса»: 5.4 хранит «дерево причин»): как FiveWhys —
// по умолчанию сам пишет срез `fishbone` черновика дебаунсом СЛИЯНИЕМ (не затирая соседние
// срезы method/fiveWhys) и восстанавливает его при монтировании; либо deferred-режим
// (autosave:false + initialTree + onChange), когда черновик ведёт координатор CauseAnalysis.
//
// Контроллер: { element, getTree, getRootCauseIds, getRootCauses, isEmpty, lock }.
//
// ES-модуль: `import { Fishbone } from './modules/rca/Fishbone.js'`.

import { CauseTree, makeNode } from './CauseTree.js';
import { saveDraftState, getDraftState } from '../../core/db.js';

// Классический запасной набор категорий, если кейс их не задал (PRD просит ≥4 из payload —
// это страховка для устойчивости/самопроверки, кейс обычно передаёт свои).
const DEFAULT_CATEGORIES = ['Люди', 'Процессы', 'Инструменты и системы', 'Данные', 'Внешние факторы'];
const MIN_CATEGORIES = 4;
const MAX_CATEGORIES = 8;
const DRAFT_DEBOUNCE_MS = 600;

export async function Fishbone({
  payload = {},
  caseId,
  initialTree,
  autosave = true,
  onChange,
} = {}) {
  const problemText = normalizeText(payload.problem) || 'Проблема';
  const categories = resolveCategories(payload.categories);

  // Восстановление дерева. Приоритет — у явно переданного initialTree (deferred-режим,
  // черновик ведёт CauseAnalysis); иначе авто-чтение среза `fishbone`.
  let seed = Array.isArray(initialTree) ? initialTree : null;
  if (!seed && autosave && caseId) {
    try {
      const draft = await getDraftState(caseId);
      if (draft && Array.isArray(draft.fishbone) && draft.fishbone.length > 0) seed = draft.fishbone;
    } catch (err) {
      console.error('[rca] не удалось прочитать черновик Fishbone', caseId, err);
    }
  }
  if (!seed) seed = [buildSeed(problemText, categories)];

  // Каркас, который пользователь не меняет: проблема (корень) + её прямые дети (категории).
  const rootNode = seed[0] || buildSeed(problemText, categories);
  const protectedIds = [rootNode.id, ...(rootNode.children || []).map((c) => c.id)];
  const fixedChildrenIds = [rootNode.id]; // категории заданы кейсом — к проблеме не добавляем новые

  const root = document.createElement('section');
  root.className = 'fishbone';

  const title = document.createElement('h2');
  title.className = 'fishbone__title';
  title.textContent = 'Диаграмма Fishbone (Исикавы)';
  root.append(title);

  const intro = document.createElement('p');
  intro.className = 'fishbone__intro';
  intro.textContent = 'Для каждой категории добавьте возможные причины (кнопкой «+»), '
    + 'углубляйтесь подпричинами и отметьте узлы-кандидаты как корневую причину (★).';
  root.append(intro);

  let locked = false;
  let draftTimer = null;

  const tree = CauseTree({
    nodes: seed,
    protectedIds,
    fixedChildrenIds,
    onChange: handleChange,
  });
  root.append(tree.element);

  // --- Черновик ---------------------------------------------------------------
  function handleChange() {
    scheduleDraftSave();
    if (onChange) onChange();
  }

  function scheduleDraftSave() {
    if (!autosave || !caseId || locked) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistDraft, DRAFT_DEBOUNCE_MS);
  }

  async function persistDraft() {
    try {
      let current = {};
      try { current = (await getDraftState(caseId)) || {}; } catch { current = {}; }
      await saveDraftState(caseId, { ...current, fishbone: tree.getNodes() });
    } catch (err) {
      console.error('[rca] не удалось сохранить черновик Fishbone', caseId, err);
    }
  }

  // Пусто, пока пользователь не добавил ни одной подпричины (есть только каркас).
  function isEmpty() {
    return tree.countUserNodes() === 0;
  }

  function lock() {
    locked = true;
    clearTimeout(draftTimer);
    tree.lock();
  }

  return {
    element: root,
    getTree: tree.getNodes,
    getRootCauseIds: tree.getRootCauseIds,
    getRootCauses: tree.getRootCauses,
    isEmpty,
    lock,
  };
}

// --- Чистые помощники ---------------------------------------------------------

function buildSeed(problemText, categories) {
  const node = makeNode(problemText);
  node.children = categories.map((c) => makeNode(c));
  return node;
}

// Категории из payload: массив строк или объектов {label}. Если кейс задал < MIN — запасной
// набор (страховка устойчивости). Обрезаем по разумному потолку.
function resolveCategories(raw) {
  const labels = Array.isArray(raw)
    ? raw.map((c) => normalizeText(typeof c === 'string' ? c : c && c.label)).filter(Boolean)
    : [];
  const list = labels.length >= MIN_CATEGORIES ? labels : DEFAULT_CATEGORIES;
  return list.slice(0, MAX_CATEGORIES);
}

function normalizeText(v) {
  return v == null ? '' : String(v).trim();
}
