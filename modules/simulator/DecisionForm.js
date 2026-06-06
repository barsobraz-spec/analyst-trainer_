// modules/simulator/DecisionForm.js — форма принятия решения (T7.2.2, PRD §5.6 Ф2, Ф4).
//
// На каждом раунде пользователь: выбирает вариант (choice) и/или вводит числовой
// параметр (number) с валидацией по диапазону [min, max] из кейса (Ф2), и ОБЯЗАН
// обосновать решение в текстовом поле ДО просмотра последствий (Ф4 — защита решения).
//
// Конфиг решений берётся из round.decisions:
//   { id, label, type: 'number' | 'choice', help?,
//     number:  min?, max?, step?, default?, suffix?
//     choice:  options: [{ value, label, desc?, params?: { имя: число } }] }
//
// Числовой ввод даёт в скоуп модели переменную с именем id. Выбор варианта
// подмешивает в скоуп объект option.params (имя→число), описанный в кейсе, —
// так формулы остаются чисто числовыми (PRD §5.6 Ф3), а «канал/стратегия»
// выражается через числовые эффекты.
//
// Контроллер: { element, getDecision(), isValid(), getInvalidReason(), lock(),
//               getSummary() }. CaseView гейтит кнопку «Применить решение» по
//               isValid() и читает решение через getDecision() при применении раунда.
//
// ES-модуль: `import { DecisionForm } from './DecisionForm.js'`.

import { validateInRange } from '../../core/simulationEngine.js';

export function DecisionForm({ round = {}, roundIndex = 0, onChange } = {}) {
  const decisions = Array.isArray(round.decisions) ? round.decisions : [];

  const root = document.createElement('form');
  root.className = 'decision-form';
  root.addEventListener('submit', (e) => e.preventDefault());

  // Заголовок и условие раунда (Ф2: «на каждом шаге доступны…»).
  if (round.title) {
    const h3 = document.createElement('h3');
    h3.className = 'decision-form__title';
    h3.textContent = round.title;
    root.append(h3);
  }
  if (round.prompt) {
    const p = document.createElement('p');
    p.className = 'decision-form__prompt';
    p.textContent = round.prompt;
    root.append(p);
  }

  // Состояние ввода: для number — текущее число (или NaN), для choice — value.
  const controls = []; // { decision, type, read(), markInvalid(msg), inputEl }

  for (const decision of decisions) {
    if (decision.type === 'choice') {
      controls.push(buildChoice(decision, root, emitChange));
    } else {
      controls.push(buildNumber(decision, root, emitChange));
    }
  }

  // Ф4: обоснование решения (обязательно до применения).
  const justWrap = document.createElement('div');
  justWrap.className = 'decision-form__field decision-form__justification';
  const justLabel = document.createElement('label');
  justLabel.className = 'decision-form__label';
  const justId = `decision-just-${roundIndex}`;
  justLabel.htmlFor = justId;
  justLabel.textContent = 'Обоснуйте решение (до просмотра последствий)';
  const justArea = document.createElement('textarea');
  justArea.id = justId;
  justArea.className = 'decision-form__textarea';
  justArea.rows = 3;
  justArea.placeholder = 'Почему вы выбрали именно это? На какие данные опираетесь?';
  justArea.addEventListener('input', emitChange);
  justWrap.append(justLabel, justArea);
  root.append(justWrap);

  function emitChange() {
    onChange?.();
  }

  // --- Чтение решения --------------------------------------------------------
  // Возвращает { params, choices, inputs, justification }. params — то, что
  // подмешивается в скоуп модели (числовые входы по id + params выбранных опций).
  function getDecision() {
    const params = {};
    const choices = {};
    const inputs = {};
    const labels = []; // человекочитаемое описание для notes/разбора

    for (const c of controls) {
      if (c.type === 'number') {
        const value = c.read();
        inputs[c.decision.id] = value;
        params[c.decision.id] = value;
        labels.push(`${c.decision.label}: ${Number.isFinite(value) ? value : '—'}`);
      } else {
        const option = c.read();
        choices[c.decision.id] = option ? option.value : null;
        if (option && option.params && typeof option.params === 'object') {
          Object.assign(params, option.params);
        }
        labels.push(`${c.decision.label}: ${option ? option.label : '—'}`);
      }
    }

    return {
      params,
      choices,
      inputs,
      justification: justArea.value.trim(),
      summary: labels.join('; '),
    };
  }

  // --- Валидация (Ф2 диапазон + Ф4 обоснование) ------------------------------
  function getInvalidReason() {
    for (const c of controls) {
      const reason = c.validate();
      if (reason) return reason;
    }
    if (justArea.value.trim() === '') {
      return 'Обоснуйте решение перед применением раунда.';
    }
    return null;
  }

  function isValid() {
    return getInvalidReason() === null;
  }

  function lock() {
    for (const c of controls) c.disableAll();
    justArea.disabled = true;
  }

  return { element: root, getDecision, isValid, getInvalidReason, lock };
}

// --- Числовой ввод с валидацией по диапазону ---------------------------------
function buildNumber(decision, root, emitChange) {
  const wrap = document.createElement('div');
  wrap.className = 'decision-form__field';

  const label = document.createElement('label');
  label.className = 'decision-form__label';
  const inputId = `decision-${decision.id}`;
  label.htmlFor = inputId;
  label.textContent = decision.label || decision.id;
  wrap.append(label);

  if (decision.help) {
    const help = document.createElement('p');
    help.className = 'decision-form__help';
    help.textContent = decision.help;
    wrap.append(help);
  }

  const row = document.createElement('div');
  row.className = 'decision-form__number-row';
  const input = document.createElement('input');
  input.type = 'number';
  input.id = inputId;
  input.className = 'decision-form__number';
  if (decision.min != null) input.min = String(decision.min);
  if (decision.max != null) input.max = String(decision.max);
  if (decision.step != null) input.step = String(decision.step);
  input.value = decision.default != null ? String(decision.default) : '';
  row.append(input);

  // Подпись диапазона и суффикс единиц.
  const hint = document.createElement('span');
  hint.className = 'decision-form__range-hint';
  const parts = [];
  if (decision.suffix) parts.push(decision.suffix);
  if (decision.min != null || decision.max != null) {
    parts.push(`допустимо ${decision.min ?? '−∞'}…${decision.max ?? '+∞'}`);
  }
  hint.textContent = parts.join(', ');
  row.append(hint);
  wrap.append(row);

  const error = document.createElement('p');
  error.className = 'decision-form__error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  wrap.append(error);

  input.addEventListener('input', () => {
    // Чистим ошибку при правке; полная валидация — по запросу CaseView.
    if (validate() === null) {
      error.hidden = true;
      input.classList.remove('decision-form__number--invalid');
    }
    emitChange();
  });

  root.append(wrap);

  function read() {
    return input.value.trim() === '' ? NaN : Number(input.value);
  }

  function validate() {
    const value = read();
    if (!Number.isFinite(value)) {
      return `Введите число для «${decision.label || decision.id}».`;
    }
    if (!validateInRange(value, decision.min, decision.max)) {
      const reason = `«${decision.label || decision.id}»: значение вне диапазона ${decision.min ?? '−∞'}…${decision.max ?? '+∞'}.`;
      error.textContent = reason;
      error.hidden = false;
      input.classList.add('decision-form__number--invalid');
      return reason;
    }
    return null;
  }

  return {
    type: 'number',
    decision,
    inputEl: input,
    read,
    validate,
    disableAll: () => { input.disabled = true; },
  };
}

// --- Выбор варианта (радио-группа с описаниями) ------------------------------
function buildChoice(decision, root, emitChange) {
  const options = Array.isArray(decision.options) ? decision.options : [];

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'decision-form__field decision-form__choice';
  const legend = document.createElement('legend');
  legend.className = 'decision-form__label';
  legend.textContent = decision.label || decision.id;
  fieldset.append(legend);

  if (decision.help) {
    const help = document.createElement('p');
    help.className = 'decision-form__help';
    help.textContent = decision.help;
    fieldset.append(help);
  }

  const name = `decision-${decision.id}`;
  const radios = [];
  options.forEach((option, i) => {
    const optionEl = document.createElement('label');
    optionEl.className = 'decision-form__option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.value = option.value;
    radio.addEventListener('change', emitChange);
    radios.push({ radio, option });

    const text = document.createElement('span');
    text.className = 'decision-form__option-text';
    const strong = document.createElement('strong');
    strong.textContent = option.label || option.value;
    text.append(strong);
    if (option.desc) {
      const desc = document.createElement('span');
      desc.className = 'decision-form__option-desc';
      desc.textContent = option.desc;
      text.append(desc);
    }
    optionEl.append(radio, text);
    fieldset.append(optionEl);
  });

  const error = document.createElement('p');
  error.className = 'decision-form__error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  fieldset.append(error);

  root.append(fieldset);

  function read() {
    const checked = radios.find((r) => r.radio.checked);
    return checked ? checked.option : null;
  }

  function validate() {
    if (!read()) {
      const reason = `Выберите вариант для «${decision.label || decision.id}».`;
      error.textContent = reason;
      error.hidden = false;
      return reason;
    }
    error.hidden = true;
    return null;
  }

  return {
    type: 'choice',
    decision,
    inputEl: fieldset,
    read,
    validate,
    disableAll: () => { radios.forEach((r) => { r.radio.disabled = true; }); },
  };
}
