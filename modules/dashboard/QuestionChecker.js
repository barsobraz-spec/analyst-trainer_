// modules/dashboard/QuestionChecker.js — автопроверка вопросов по графику (T5.2).
//
// PRD §5.3 Ф2: список вопросов с АВТОМАТИЧЕСКОЙ проверкой. Два типа:
//   • mcq     — выбор варианта, проверяется немедленно при выборе;
//   • numeric — числовой ответ, считываемый с графика, сверяется с эталоном
//               по допуску tolerance (|ответ − эталон| ≤ tolerance).
// Каждый вопрос засчитывается или нет; после ответа вопрос фиксируется (нельзя
// переоткрыть и подобрать — иначе авто-балл теряет смысл), показывается ✓/✗ и,
// если задано, пояснение.
//
// Доля верно решённых (getFraction) идёт в общий autoFraction кейса (агрегацию по
// всем авто-задачам ведёт CaseView, T5.2.3), а тот — в normalizeScore (PRD §4).
//
// JSON-схема (элемент payload.questions):
//   {
//     "id": "q1",
//     "type": "mcq" | "numeric",
//     "prompt": "В каком месяце выручка была максимальной?",
//     "options": ["Окт","Ноя","Дек"],   // только для mcq
//     "answerIndex": 2,                   // только для mcq
//     "answer": 1820,                     // только для numeric
//     "tolerance": 50,                    // только для numeric (по умолчанию 0)
//     "unit": " тыс ₽",                   // опц. подпись к числовому полю
//     "explanation": "…"                  // опц. пояснение после ответа
//   }
//
// Контроллер: { element, getResults, getCorrectCount, getTotal, getFraction,
//               allAnswered, lock }.
//
// ES-модуль: `import { QuestionChecker } from './QuestionChecker.js'`.

export function QuestionChecker({ questions, onChange } = {}) {
  const list = Array.isArray(questions) ? questions : [];

  const root = document.createElement('section');
  root.className = 'questions';
  root.setAttribute('aria-label', 'Вопросы по графику');

  if (list.length === 0) {
    // Кейс может состоять только из аномалии/инсайта — это не ошибка.
    return makeEmptyController(root);
  }

  const h2 = document.createElement('h2');
  h2.className = 'questions__title';
  h2.textContent = 'Вопросы по дашборду';
  root.append(h2);

  // Состояние по каждому вопросу: { answered, correct }.
  const state = list.map(() => ({ answered: false, correct: false }));
  let locked = false;

  list.forEach((q, i) => {
    root.append(buildQuestion(q, i, state, () => {
      onChange && onChange();
    }, () => locked));
  });

  function lock() {
    locked = true;
    for (const el of root.querySelectorAll('input, button')) el.disabled = true;
  }

  return {
    element: root,
    getResults: () => list.map((q, i) => ({ id: q.id || `q${i + 1}`, ...state[i] })),
    getCorrectCount: () => state.filter((s) => s.correct).length,
    getTotal: () => list.length,
    getFraction: () => (list.length ? state.filter((s) => s.correct).length / list.length : null),
    allAnswered: () => state.every((s) => s.answered),
    lock,
  };
}

// --- Один вопрос (mcq или numeric) -------------------------------------------
function buildQuestion(q, index, state, notify, isLocked) {
  const wrap = document.createElement('div');
  wrap.className = 'questions__item';

  const prompt = document.createElement('p');
  prompt.className = 'questions__prompt';
  prompt.textContent = `${index + 1}. ${q.prompt || ''}`;
  wrap.append(prompt);

  const feedback = document.createElement('p');
  feedback.className = 'questions__feedback';
  feedback.setAttribute('role', 'status');

  // Засчитать вопрос ровно один раз и зафиксировать его.
  function settle(correct, controlsToDisable) {
    if (state[index].answered) return;
    state[index] = { answered: true, correct };
    for (const el of controlsToDisable) el.disabled = true;
    feedback.classList.add(correct ? 'questions__feedback--ok' : 'questions__feedback--no');
    const verdict = correct ? '✓ Верно.' : '✗ Неверно.';
    feedback.textContent = q.explanation ? `${verdict} ${q.explanation}` : verdict;
    notify();
  }

  if (q.type === 'numeric') {
    wrap.append(buildNumeric(q, settle, isLocked));
  } else {
    wrap.append(buildMcq(q, settle, isLocked));
  }
  wrap.append(feedback);
  return wrap;
}

function buildMcq(q, settle, isLocked) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'questions__options';
  const name = `q-${q.id || Math.random().toString(36).slice(2)}`;
  const options = Array.isArray(q.options) ? q.options : [];

  const inputs = [];
  options.forEach((opt, oi) => {
    const id = `${name}-${oi}`;
    const label = document.createElement('label');
    label.className = 'questions__option';
    label.htmlFor = id;

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.id = id;
    input.value = String(oi);
    input.addEventListener('change', () => {
      if (isLocked()) return;
      // PRD Ф2: проверяется немедленно при выборе.
      settle(oi === q.answerIndex, inputs);
    });
    inputs.push(input);

    label.append(input, document.createTextNode(' ' + opt));
    fieldset.append(label);
  });
  return fieldset;
}

function buildNumeric(q, settle, isLocked) {
  const row = document.createElement('div');
  row.className = 'questions__numeric';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'questions__numeric-input';
  input.inputMode = 'decimal';
  input.step = 'any';
  input.setAttribute('aria-label', q.prompt || 'Числовой ответ');
  if (q.unit) input.placeholder = q.unit.trim();

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'questions__check';
  check.textContent = 'Проверить';
  check.addEventListener('click', () => {
    if (isLocked()) return;
    const raw = input.value.trim();
    if (raw === '' || !Number.isFinite(Number(raw))) {
      input.focus();
      return; // пустой/некорректный ввод — вопрос не засчитываем и не фиксируем
    }
    const tolerance = Number.isFinite(q.tolerance) ? Math.abs(q.tolerance) : 0;
    const correct = Math.abs(Number(raw) - Number(q.answer)) <= tolerance;
    settle(correct, [input, check]);
  });

  row.append(input, check);
  if (q.unit) {
    const unit = document.createElement('span');
    unit.className = 'questions__unit';
    unit.textContent = q.unit;
    row.append(unit);
  }
  return row;
}

function makeEmptyController(root) {
  return {
    element: root,
    getResults: () => [],
    getCorrectCount: () => 0,
    getTotal: () => 0,
    getFraction: () => null, // нет авто-вопросов — не вносим вклад в autoFraction
    allAnswered: () => true,
    lock() {},
  };
}
