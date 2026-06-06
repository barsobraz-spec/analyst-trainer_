// modules/hypothesis/HypothesisForm.js — конструктор гипотез модуля 5.2 (T3.1).
//
// PRD §5.2:
//   Ф1 — структурный конструктор: пять обязательных полей «Если / То / Потому что /
//        Как проверю / Метрика» на каждую гипотезу;
//   Ф2 — шаблоны-подсказки: кнопка «Вставить пример» заполняет пустые поля заготовкой
//        из payload, текст затем редактируется;
//   Ф3 — чек-лист качества по каждой гипотезе (QualityChecklist).
//   Требуемое число гипотез задаётся кейсом (payload.count, по умолчанию 3); интерфейс
//   поддерживает произвольное N — гипотезы можно добавлять и удалять (минимум одна
//   карточка, чтобы экран не «схлопывался»).
//
// Персистентность (T3.1.4, PRD «Статусы кейса»: 5.2 хранит «черновики гипотез»):
// по умолчанию форма сама пишет черновик в IndexedDB —
// saveDraftState(caseId, { hypotheses }) с дебаунсом — и восстанавливает его при
// монтировании. Это делает компонент самодостаточным уже в T3.1. Запись идёт
// слиянием (`{ ...текущий черновик, hypotheses }`), чтобы не затирать другие срезы
// того же черновика — в T3.2 туда же ляжет матрица приоритизации.
//
// Контракт для экрана кейса (T3.2): чтобы централизовать сохранение и объединить
// гипотезы с матрицей в одном черновике, экран передаёт autosave:false,
// initialHypotheses (из ранее прочитанного черновика) и onChange — и сам пишет
// черновик/гейтит отправку, читая getRawHypotheses()/isReady(); getItems() отдаёт
// матрице список { id, label, filled } (паттерн как у DetectiveCaseView ↔ ReasoningChain).
//
// ES-модуль: `import { HypothesisForm } from './modules/hypothesis/HypothesisForm.js'`.

import { QualityChecklist } from './QualityChecklist.js';
import { saveDraftState, getDraftState } from '../../core/db.js';

// Поля гипотезы (PRD §5.2 Ф1). Порядок и состав фиксированы — это и есть «структура».
const FIELDS = [
  { id: 'if',      label: 'Если',        placeholder: 'причина или изменение' },
  { id: 'then',    label: 'То',          placeholder: 'ожидаемое следствие' },
  { id: 'because', label: 'Потому что',  placeholder: 'механизм: почему так произойдёт' },
  { id: 'test',    label: 'Как проверю', placeholder: 'метод и данные для проверки' },
  { id: 'metric',  label: 'Метрика',     placeholder: 'что именно измеряю' },
];

const DEFAULT_COUNT = 3;          // PRD §5.2: «например, 3»
const MAX_COUNT = 10;             // разумный потолок для требуемого числа гипотез
const DRAFT_DEBOUNCE_MS = 600;    // как в ReasoningChain — не писать на каждый символ

// Сквозной счётчик id полей: id привязываются к карточке, а не к её позиции, чтобы
// при добавлении/удалении гипотез label[for] не «съезжал» на чужой input.
let uidSeq = 0;

export async function HypothesisForm({
  payload = {},
  caseId,
  initialHypotheses,
  autosave = true,
  onChange,
} = {}) {
  const requiredCount = clampCount(payload.count ?? payload.hypothesesCount ?? DEFAULT_COUNT);
  const templates = payload.templates; // объект-заготовка для всех карточек или массив по слотам

  // Восстановление набора гипотез. Приоритет — у явно переданного initialHypotheses
  // (так экран кейса в T3.2 централизует персистентность); иначе авто-чтение черновика.
  let seed = Array.isArray(initialHypotheses) ? initialHypotheses : null;
  if (!seed && autosave && caseId) {
    try {
      const draft = await getDraftState(caseId);
      if (draft && Array.isArray(draft.hypotheses)) seed = draft.hypotheses;
    } catch (err) {
      console.error('[hypothesis] не удалось прочитать черновик', caseId, err);
    }
  }

  const root = document.createElement('section');
  root.className = 'hypothesis-form';

  const title = document.createElement('h2');
  title.className = 'hypothesis-form__title';
  title.textContent = 'Конструктор гипотез';
  root.append(title);

  const intro = document.createElement('p');
  intro.className = 'hypothesis-form__intro';
  intro.textContent = `Требуется гипотез: ${requiredCount}. Сформулируйте каждую в структуре `
    + `«Если → То → Потому что», укажите способ проверки и метрику, затем отметьте её качество по чек-листу.`;
  root.append(intro);

  const list = document.createElement('ol');
  list.className = 'hypothesis-form__list';
  root.append(list);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'hypothesis-form__add';
  addBtn.textContent = '+ Добавить гипотезу';
  addBtn.addEventListener('click', () => {
    addCard();
    renumber();
    handleChange();
  });
  root.append(addBtn);

  const cardMap = new Map(); // li -> { fields: {id: textarea}, quality: контроллер }
  let locked = false;
  let draftTimer = null;

  // Засев: сохранённый набор либо requiredCount пустых карточек.
  const initial = seed && seed.length > 0
    ? seed
    : Array.from({ length: requiredCount }, () => ({}));
  for (const h of initial) addCard(h);
  renumber();

  // --- Построение одной карточки гипотезы ------------------------------------
  function addCard(data = {}) {
    // Стабильный id карточки: восстановленный из черновика либо новый. По нему
    // матрица приоритизации (T3.2) держит привязку «гипотеза → квадрант», поэтому
    // id не зависит от позиции и переживает удаление/добавление соседних карточек.
    const cardId = (data && data.id) || makeId();
    const slotIndex = list.children.length; // позиция при создании — для выбора шаблона

    const li = document.createElement('li');
    li.className = 'hypothesis-form__card';

    // Поля (Ф1). Заводим раньше шапки, чтобы кнопка «Вставить пример» их видела.
    const fieldsWrap = document.createElement('div');
    fieldsWrap.className = 'hypothesis-form__fields';
    const fields = {};
    for (const f of FIELDS) {
      const field = document.createElement('div');
      field.className = 'hypothesis-form__field';

      const label = document.createElement('label');
      label.className = 'hypothesis-form__field-label';
      label.htmlFor = `hyp-${cardId}-${f.id}`;
      label.textContent = f.label;

      const input = document.createElement('textarea');
      input.id = `hyp-${cardId}-${f.id}`;
      input.className = 'hypothesis-form__field-input';
      input.rows = 2;
      input.placeholder = f.placeholder;
      input.value = data && data[f.id] != null ? String(data[f.id]) : '';
      input.addEventListener('input', handleChange);

      field.append(label, input);
      fieldsWrap.append(field);
      fields[f.id] = input;
    }

    // Шапка карточки: заголовок + «Вставить пример» (Ф2) + «Удалить».
    const head = document.createElement('div');
    head.className = 'hypothesis-form__card-head';

    const cardTitle = document.createElement('h3');
    cardTitle.className = 'hypothesis-form__card-title';
    head.append(cardTitle);

    const actions = document.createElement('div');
    actions.className = 'hypothesis-form__card-actions';

    const tpl = templateFor(slotIndex);
    if (tpl) {
      const insert = document.createElement('button');
      insert.type = 'button';
      insert.className = 'hypothesis-form__insert';
      insert.textContent = 'Вставить пример';
      insert.addEventListener('click', () => {
        fillTemplate(fields, tpl);
        handleChange();
      });
      actions.append(insert);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'hypothesis-form__remove';
    remove.textContent = 'Удалить';
    remove.setAttribute('aria-label', 'Удалить гипотезу');
    remove.addEventListener('click', () => {
      if (locked) return;
      // Минимум одна карточка: последнюю не удаляем, а очищаем.
      if (list.children.length <= 1) {
        for (const f of FIELDS) fields[f.id].value = '';
      } else {
        cardMap.delete(li);
        li.remove();
      }
      renumber();
      handleChange();
    });
    actions.append(remove);
    head.append(actions);

    // Чек-лист качества (Ф3).
    const quality = QualityChecklist({
      initialState: data && data.quality,
      onChange: handleChange,
    });

    li.append(head, fieldsWrap, quality.element);
    list.append(li);
    cardMap.set(li, { id: cardId, fields, quality });
  }

  // Перенумеровать заголовки «Гипотеза N» по текущему порядку карточек.
  function renumber() {
    const titles = list.querySelectorAll('.hypothesis-form__card-title');
    titles.forEach((t, i) => { t.textContent = `Гипотеза ${i + 1}`; });
  }

  // Заготовка для слота: общий объект на все карточки или массив по индексам.
  function templateFor(index) {
    if (!templates) return null;
    if (Array.isArray(templates)) return templates[index] || templates[templates.length - 1] || null;
    return templates;
  }

  // «Вставить пример» заполняет только пустые поля — чтобы не затереть набранное (Ф2).
  function fillTemplate(fields, tpl) {
    for (const f of FIELDS) {
      const value = tpl && tpl[f.id] != null ? String(tpl[f.id]) : '';
      if (value && fields[f.id].value.trim() === '') fields[f.id].value = value;
    }
  }

  // --- Чтение состояния -------------------------------------------------------
  function readCards() {
    return [...list.children].map((li) => cardMap.get(li)).filter(Boolean);
  }

  // Сырой снимок всех карточек (в порядке экрана) — основа черновика. Каждый
  // элемент несёт стабильный id (нужен матрице приоритизации) и состояние чек-листа.
  function getRawHypotheses() {
    return readCards().map((c) => {
      const h = { id: c.id };
      for (const f of FIELDS) h[f.id] = c.fields[f.id].value;
      h.quality = c.quality.getState();
      return h;
    });
  }

  // Заполненные гипотезы с подрезанными полями — для экрана кейса/эталона (T3.2).
  function getHypotheses() {
    return getRawHypotheses()
      .map(trimHypothesis)
      .filter((h) => FIELDS.some((f) => h[f.id].length > 0));
  }

  // Лёгкий список для матрицы приоритизации (T3.2): { id, label, filled } в порядке
  // экрана. label = «Гипотеза N» по позиции карточки; filled — есть ли хоть что-то.
  // Экран кейса отдаёт в матрицу только заполненные (filled) — пустые приоритизировать
  // нечего.
  function getItems() {
    return readCards().map((c, i) => ({
      id: c.id,
      label: `Гипотеза ${i + 1}`,
      filled: FIELDS.some((f) => c.fields[f.id].value.trim().length > 0),
    }));
  }

  function completeCount() {
    return getRawHypotheses().filter(isComplete).length;
  }

  // Достаточно ли проработанных гипотез для отправки (все 5 полей заполнены).
  function isReady() {
    return completeCount() >= requiredCount;
  }

  function lock() {
    locked = true;
    clearTimeout(draftTimer);
    for (const el of root.querySelectorAll('textarea, button')) el.disabled = true;
    for (const c of readCards()) c.quality.lock();
  }

  // --- Черновик (Ф статус «в процессе») ---------------------------------------
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
      // Слияние: не затираем чужие срезы черновика (в T3.2 здесь будет и матрица).
      let current = {};
      try { current = (await getDraftState(caseId)) || {}; } catch { current = {}; }
      await saveDraftState(caseId, { ...current, hypotheses: getRawHypotheses() });
    } catch (err) {
      console.error('[hypothesis] не удалось сохранить черновик', caseId, err);
    }
  }

  return {
    element: root,
    getRawHypotheses,
    getHypotheses,
    getItems,
    getState: getRawHypotheses, // черновик = сырой снимок карточек
    requiredCount,
    completeCount,
    isReady,
    lock,
  };
}

// --- Чистые помощники ---------------------------------------------------------

// Гипотеза «проработана», если заполнены все пять полей (PRD §5.2 Ф1: «обязательные»).
function isComplete(h) {
  return FIELDS.every((f) => String(h[f.id] ?? '').trim().length > 0);
}

function trimHypothesis(h) {
  const t = { id: h.id };
  for (const f of FIELDS) t[f.id] = String(h[f.id] ?? '').trim();
  t.quality = h.quality;
  return t;
}

// Стабильный id карточки. crypto.randomUUID доступен в защищённом контексте
// (localhost — защищённый); запасной вариант на случай его отсутствия.
function makeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `h-${++uidSeq}-${Date.now()}`;
}

function clampCount(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return DEFAULT_COUNT;
  return Math.min(v, MAX_COUNT);
}
