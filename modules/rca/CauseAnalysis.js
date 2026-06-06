// modules/rca/CauseAnalysis.js — выбор метода и рабочая область RCA (модуль 5.4, T4.2).
//
// PRD §5.4: «Пользователь выбирает метод (5 Whys или Fishbone) в начале кейса.» Этот
// координатор отвечает за выбор метода и держит оба инструмента — FiveWhys (T4.1) и Fishbone
// (T4.2) — переключая видимость. Оба остаются смонтированными, поэтому переключение метода
// НЕ теряет наработки другого: пользователь может вернуться к прежнему методу и продолжить.
//
// Он же — единственный владелец общего черновика RCA `{ method, fiveWhys, fishbone }`
// (контракт, зафиксированный в FiveWhys.js): сабкомпоненты работают в deferred-режиме
// (autosave:false) и сообщают об изменениях через onChange, а запись/слияние идёт здесь —
// так нет гонок нескольких писателей по одному ключу черновика.
//
// По умолчанию (autosave:true) самодостаточен: читает и пишет черновик сам, поэтому T4.2
// проверяется без экрана кейса. Контракт для T4.3 (RcaCaseView): экран передаёт
// autosave:false + initialState (прочитанный черновик) + onChange и сам ведёт черновик/
// гейтинг, читая getResult()/isReady() (паттерн как у DetectiveCaseView ↔ ReasoningChain).
//
// Контроллер: { element, getMethod, getResult, isEmpty, isReady, lock }.
//
// ES-модуль: `import { CauseAnalysis } from './modules/rca/CauseAnalysis.js'`.

import { FiveWhys } from './FiveWhys.js';
import { Fishbone } from './Fishbone.js';
import { saveDraftState, getDraftState } from '../../core/db.js';

const METHODS = [
  { id: 'fivewhys', label: '5 Whys', hint: 'Линейная цепочка «Почему?» до корневой причины.' },
  { id: 'fishbone', label: 'Fishbone', hint: 'Причины по категориям (диаграмма Исикавы).' },
];
const DRAFT_DEBOUNCE_MS = 600;

export async function CauseAnalysis({
  payload = {},
  caseId,
  initialState,
  autosave = true,
  onChange,
} = {}) {
  // Чтение общего черновика. Приоритет — у явного initialState (deferred-режим, T4.3).
  let state = initialState && typeof initialState === 'object' ? initialState : null;
  if (!state && autosave && caseId) {
    try { state = await getDraftState(caseId); } catch (err) {
      console.error('[rca] не удалось прочитать черновик RCA', caseId, err);
    }
  }
  state = state || {};
  let method = isMethod(state.method) ? state.method : defaultMethod(payload);

  let locked = false;
  let draftTimer = null;

  const root = document.createElement('section');
  root.className = 'cause-analysis';

  // --- Выбор метода (radiogroup) ---------------------------------------------
  const picker = document.createElement('fieldset');
  picker.className = 'method-picker';
  const legend = document.createElement('legend');
  legend.className = 'method-picker__legend';
  legend.textContent = 'Метод анализа';
  picker.append(legend);

  const radios = new Map();
  const radioName = `rca-method-${caseId || Math.random().toString(36).slice(2)}`;
  for (const m of METHODS) {
    const option = document.createElement('label');
    option.className = 'method-picker__option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = radioName;
    radio.value = m.id;
    radio.checked = m.id === method;
    radio.addEventListener('change', () => { if (radio.checked) selectMethod(m.id); });

    const text = document.createElement('span');
    text.className = 'method-picker__text';
    const name = document.createElement('span');
    name.className = 'method-picker__name';
    name.textContent = m.label;
    const hint = document.createElement('span');
    hint.className = 'method-picker__hint';
    hint.textContent = m.hint;
    text.append(name, hint);

    option.append(radio, text);
    picker.append(option);
    radios.set(m.id, radio);
  }
  root.append(picker);

  // --- Инструменты обоих методов (монтируются сразу, скрывается неактивный) ---
  const five = await FiveWhys({
    problem: payload.problem,
    caseId,
    initialLevels: Array.isArray(state.fiveWhys) ? state.fiveWhys : undefined,
    autosave: false,
    onChange: handleChange,
  });
  const fish = await Fishbone({
    payload,
    caseId,
    initialTree: Array.isArray(state.fishbone) ? state.fishbone : undefined,
    autosave: false,
    onChange: handleChange,
  });

  const panels = document.createElement('div');
  panels.className = 'cause-analysis__panels';
  panels.append(five.element, fish.element);
  root.append(panels);

  applyVisibility();

  // --- Переключение метода ----------------------------------------------------
  function selectMethod(next) {
    if (locked || !isMethod(next)) return;
    method = next;
    applyVisibility();
    handleChange();
  }

  function applyVisibility() {
    five.element.hidden = method !== 'fivewhys';
    fish.element.hidden = method !== 'fishbone';
    for (const [id, radio] of radios) radio.checked = id === method;
  }

  // --- Черновик (единый владелец) --------------------------------------------
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
      await saveDraftState(caseId, { ...current, ...buildState() });
    } catch (err) {
      console.error('[rca] не удалось сохранить черновик RCA', caseId, err);
    }
  }

  // Полный срез состояния RCA для черновика. Единый источник формы записи — им
  // пользуются и автосейв (persistDraft), и экран кейса в deferred-режиме (getState).
  function buildState() {
    return { method, fiveWhys: five.getRawLevels(), fishbone: fish.getTree() };
  }

  // --- Результат и состояние для экрана кейса (T4.3) --------------------------
  function getMethod() {
    return method;
  }

  // Снимок наработки активного метода — основа записи события и сверки с эталоном.
  function getResult() {
    if (method === 'fishbone') {
      return { method, tree: fish.getTree(), rootCauses: fish.getRootCauses() };
    }
    return { method, levels: five.getLevels() };
  }

  // Пусто, если в активном методе нет содержательной работы (гейтинг отправки).
  function isEmpty() {
    return method === 'fishbone' ? fish.isEmpty() : five.isEmpty();
  }

  function isReady() {
    return !isEmpty();
  }

  function lock() {
    locked = true;
    clearTimeout(draftTimer);
    five.lock();
    fish.lock();
    for (const radio of radios.values()) radio.disabled = true;
  }

  return { element: root, getMethod, getResult, getState: buildState, isEmpty, isReady, lock };
}

// --- Чистые помощники ---------------------------------------------------------

function isMethod(m) {
  return m === 'fivewhys' || m === 'fishbone';
}

// По умолчанию — Fishbone, если кейс задал категории, иначе 5 Whys (он не требует данных).
function defaultMethod(payload) {
  const cats = payload && Array.isArray(payload.categories) ? payload.categories.length : 0;
  return cats >= 4 ? 'fishbone' : 'fivewhys';
}
