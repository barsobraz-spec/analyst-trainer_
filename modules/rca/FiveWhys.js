// modules/rca/FiveWhys.js — метод «5 Whys» модуля 5.4 (T4.1).
//
// PRD §5.4 Ф1: линейная цепочка «Почему?» с фиксированной глубиной (до 5 уровней),
// каждый ответ — отдельный узел, ведущий к следующему «Почему?». В отличие от
// цепочки рассуждений 5.1 (ReasoningChain), здесь уровни строго последовательны:
//   проблема → Почему? → ответ¹ → Почему (ответ¹)? → ответ² → … (макс. 5).
// Поэтому:
//   • следующий уровень добавляется ТОЛЬКО после заполнения текущего
//     (T4.1: «следующий уровень добавляется только после заполнения текущего»);
//   • убрать можно лишь последний уровень — удалять середину линейной цепочки
//     нельзя, иначе оставшиеся «Почему?» повисают без своей причины;
//   • вопрос каждого уровня показывает, про ЧТО спрашиваем «почему» (проблема для
//     уровня 1, ответ предыдущего уровня дальше) и обновляется по мере ввода.
//
// Персистентность (T4.1.2, PRD «Статусы кейса»: 5.4 хранит «дерево причин»):
// по умолчанию компонент сам пишет черновик в IndexedDB —
// saveDraftState(caseId, { fiveWhys: [...ответы] }) с дебаунсом — и восстанавливает
// его при монтировании, поэтому уже в T4.1 он самодостаточен и проверяем без экрана
// кейса. Запись идёт СЛИЯНИЕМ (`{ ...текущий, fiveWhys }`), чтобы не затирать
// соседние срезы того же черновика: в T4.2 туда же лягут выбор метода и дерево
// Fishbone (`{ method, fiveWhys, fishbone }`).
//
// Контракт для экрана кейса (T4.2/T4.3): чтобы вести один общий черновик метода и
// гейтить отправку, экран передаёт autosave:false, initialLevels (из ранее
// прочитанного черновика) и onChange — и сам пишет черновик / читает getRawLevels()
// и isEmpty() (паттерн как у DetectiveCaseView ↔ ReasoningChain и HypothesisCaseView
// ↔ HypothesisForm).
//
// Возвращает контроллер { element, getLevels, getRawLevels, getState, isEmpty,
// depth, lock }.
//
// ES-модуль: `import { FiveWhys } from './modules/rca/FiveWhys.js'`.

import { saveDraftState, getDraftState } from '../../core/db.js';

const MAX_LEVELS = 5;          // PRD §5.4 Ф1: «до 5 уровней»
const DRAFT_DEBOUNCE_MS = 600; // как в ReasoningChain / HypothesisForm — не писать на каждый символ

export async function FiveWhys({
  problem,
  caseId,
  initialLevels,
  autosave = true,
  onChange,
} = {}) {
  const problemText = problem == null ? '' : String(problem).trim();

  // Восстановление цепочки. Приоритет — у явно переданного initialLevels (так экран
  // кейса в T4.2/T4.3 централизует персистентность); иначе авто-чтение черновика.
  let seed = Array.isArray(initialLevels) ? initialLevels.slice() : null;
  if (!seed && autosave && caseId) {
    try {
      const draft = await getDraftState(caseId);
      if (draft && Array.isArray(draft.fiveWhys)) seed = draft.fiveWhys;
    } catch (err) {
      console.error('[rca] не удалось прочитать черновик', caseId, err);
    }
  }

  const root = document.createElement('section');
  root.className = 'five-whys';

  const title = document.createElement('h2');
  title.className = 'five-whys__title';
  title.textContent = 'Метод «5 Whys»';
  root.append(title);

  const hint = document.createElement('p');
  hint.className = 'five-whys__hint';
  hint.textContent = 'Спрашивайте «Почему?» к каждому предыдущему ответу, спускаясь '
    + 'к корневой причине. Следующий уровень открывается, когда заполнен текущий (до 5 уровней).';
  root.append(hint);

  // Баннер проблемы — отправная точка первого «Почему?» (если задан кейсом).
  if (problemText) {
    const banner = document.createElement('p');
    banner.className = 'five-whys__problem';
    banner.textContent = `Проблема: ${problemText}`;
    root.append(banner);
  }

  const list = document.createElement('ol');
  list.className = 'five-whys__list';
  root.append(list);

  // Панель управления глубиной: добавить следующий уровень / убрать последний.
  const controls = document.createElement('div');
  controls.className = 'five-whys__controls';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'five-whys__add';
  addBtn.textContent = '+ Добавить «Почему?»';
  addBtn.addEventListener('click', () => {
    addLevel('');
    updateContexts();
    refresh();
    // Фокус на новый уровень — удобнее продолжать цепочку с клавиатуры.
    levels[levels.length - 1].input.focus();
    handleChange();
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'five-whys__remove';
  removeBtn.textContent = 'Убрать последний';
  removeBtn.addEventListener('click', removeLastLevel);

  controls.append(addBtn, removeBtn);
  root.append(controls);

  // Подсказка-статус, почему «Добавить» сейчас недоступно (гейтинг глубины).
  const status = document.createElement('p');
  status.className = 'five-whys__status';
  status.setAttribute('aria-live', 'polite');
  root.append(status);

  const levels = []; // { li, contextEl, input }
  let locked = false;
  let draftTimer = null;

  // Засев: сохранённая цепочка (обрезанная до потолка) либо один пустой уровень.
  const initial = seed && seed.length > 0 ? seed.slice(0, MAX_LEVELS) : [''];
  for (const value of initial) addLevel(value);
  updateContexts();
  refresh();

  // --- Построение одного уровня «Почему?» ------------------------------------
  function addLevel(value = '') {
    if (levels.length >= MAX_LEVELS) return;
    const index = levels.length;

    const li = document.createElement('li');
    li.className = 'five-whys__level';

    // Контекст уровня: про что спрашиваем «почему». Обновляется в updateContexts().
    const contextEl = document.createElement('p');
    contextEl.className = 'five-whys__context';

    const input = document.createElement('textarea');
    input.className = 'five-whys__input';
    input.rows = 2;
    input.value = value == null ? '' : String(value);
    input.placeholder = 'Ответ: потому что…';
    input.setAttribute('aria-label', `Ответ на «Почему?» уровня ${index + 1}`);
    input.addEventListener('input', () => {
      updateContexts();
      refresh();
      handleChange();
    });

    li.append(contextEl, input);
    list.append(li);
    levels.push({ li, contextEl, input });
  }

  // Убрать последний уровень (минимум один — иначе цепочка «схлопывается»).
  function removeLastLevel() {
    if (locked) return;
    if (levels.length <= 1) {
      levels[0].input.value = '';
    } else {
      const last = levels.pop();
      last.li.remove();
    }
    updateContexts();
    refresh();
    handleChange();
  }

  // Текст вопроса каждого уровня: уровень 1 спрашивает про проблему, дальше — про
  // ответ предыдущего уровня. Обновляется при вводе, делая видимым «ответ ведёт к
  // следующему почему» (PRD §5.4 Ф1).
  function updateContexts() {
    levels.forEach((level, i) => {
      if (i === 0) {
        level.contextEl.textContent = problemText
          ? `Почему возникает проблема: «${problemText}»?`
          : 'Почему это происходит?';
        return;
      }
      const prev = levels[i - 1].input.value.trim();
      level.contextEl.textContent = prev
        ? `Почему: «${prev}»?`
        : 'Почему? (сначала заполните предыдущий ответ)';
    });
  }

  // Доступность кнопок и текст статуса по текущему состоянию цепочки.
  function refresh() {
    const lastFilled = levels.length > 0
      && levels[levels.length - 1].input.value.trim().length > 0;
    const atMax = levels.length >= MAX_LEVELS;

    addBtn.disabled = locked || atMax || !lastFilled;
    removeBtn.disabled = locked || levels.length <= 1;

    if (locked) {
      status.textContent = '';
    } else if (atMax) {
      status.textContent = `Достигнута максимальная глубина: ${MAX_LEVELS} уровней.`;
    } else if (!lastFilled) {
      status.textContent = 'Заполните ответ, чтобы открыть следующий уровень «Почему?».';
    } else {
      status.textContent = '';
    }
  }

  // --- Чтение состояния -------------------------------------------------------
  // Сырые ответы по уровням (включая пустые) — основа черновика.
  function getRawLevels() {
    return levels.map((l) => l.input.value);
  }

  // Заполненные ответы с подрезкой — для записи события и сверки с эталоном (T4.3).
  function getLevels() {
    return getRawLevels().map((s) => s.trim()).filter((s) => s.length > 0);
  }

  function isEmpty() {
    return getLevels().length === 0;
  }

  function depth() {
    return levels.length;
  }

  function lock() {
    locked = true;
    clearTimeout(draftTimer);
    for (const el of root.querySelectorAll('textarea, button')) el.disabled = true;
  }

  // --- Черновик (статус «в процессе», PRD §5.4 Ф3) ---------------------------
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
      // Слияние: не затираем чужие срезы черновика (в T4.2 здесь будут method/fishbone).
      let current = {};
      try { current = (await getDraftState(caseId)) || {}; } catch { current = {}; }
      await saveDraftState(caseId, { ...current, fiveWhys: getRawLevels() });
    } catch (err) {
      console.error('[rca] не удалось сохранить черновик', caseId, err);
    }
  }

  return {
    element: root,
    getLevels,
    getRawLevels,
    getState: getRawLevels, // черновик = сырой снимок уровней
    isEmpty,
    depth,
    lock,
  };
}
