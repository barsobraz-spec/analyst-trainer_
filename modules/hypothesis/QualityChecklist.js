// modules/hypothesis/QualityChecklist.js — чек-лист качества гипотезы (T3.1.3).
//
// PRD §5.2 Ф3: по каждой гипотезе пользователь отмечает соответствие критериям —
// проверяемость, измеримость, релевантность проблеме, фальсифицируемость. Чек-лист
// формирует балл гипотезы (доля отмеченных критериев). Напрямую на запись события
// он НЕ влияет: итог кейса выставляет самооценка (PRD §4, Ф6 — это T3.2). Здесь
// чек-лист служит структурированной опорой при самопроверке и даёт форме сигнал
// «гипотеза проработана».
//
// Возвращает контроллер { element, getState, getFraction, getScore, lock }, потому
// что конструктору гипотез нужно: читать отметки (для черновика), показывать балл и
// блокировать чек-лист после отправки. onChange уведомляет форму, которая дебаунсит
// сохранение черновика (паттерн как у ReasoningChain → CaseView в 5.1).
//
// ES-модуль: `import { QualityChecklist } from './modules/hypothesis/QualityChecklist.js'`.

// Критерии качества гипотезы (PRD §5.2 Ф3). Порядок фиксирован; подсказка поясняет,
// что именно проверяет пользователь, чтобы отметки были осмысленными.
export const QUALITY_CRITERIA = [
  { id: 'testable',    label: 'Проверяемость',          hint: 'Гипотезу можно подтвердить или опровергнуть имеющимися данными.' },
  { id: 'measurable',  label: 'Измеримость',            hint: 'Указана конкретная метрика и её ожидаемое изменение.' },
  { id: 'relevant',    label: 'Релевантность проблеме', hint: 'Гипотеза объясняет именно ту проблему, что описана в кейсе.' },
  { id: 'falsifiable', label: 'Фальсифицируемость',     hint: 'Есть исход, при котором гипотеза будет отвергнута.' },
];

// Уникальный префикс id чек-боксов: на одной странице может быть N гипотез,
// id должны не пересекаться (иначе label/for «склеит» чужие чек-боксы).
let qcSeq = 0;

export function QualityChecklist({ initialState, onChange } = {}) {
  const prefix = `qc-${++qcSeq}`;

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'quality-checklist';

  const legend = document.createElement('legend');
  legend.className = 'quality-checklist__legend';
  legend.textContent = 'Чек-лист качества';
  fieldset.append(legend);

  const list = document.createElement('div');
  list.className = 'quality-checklist__list';
  fieldset.append(list);

  const inputs = {};
  for (const crit of QUALITY_CRITERIA) {
    const row = document.createElement('div');
    row.className = 'quality-checklist__row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `${prefix}-${crit.id}`;
    input.className = 'quality-checklist__checkbox';
    if (initialState && initialState[crit.id]) input.checked = true;
    input.addEventListener('change', () => {
      refreshScore();
      if (onChange) onChange();
    });

    const label = document.createElement('label');
    label.className = 'quality-checklist__label';
    label.htmlFor = input.id;
    label.textContent = crit.label;

    const hint = document.createElement('span');
    hint.className = 'quality-checklist__hint';
    hint.textContent = crit.hint;

    const text = document.createElement('span');
    text.className = 'quality-checklist__text';
    text.append(label, hint);

    row.append(input, text);
    list.append(row);
    inputs[crit.id] = input;
  }

  const score = document.createElement('p');
  score.className = 'quality-checklist__score';
  fieldset.append(score);

  function checkedCount() {
    return QUALITY_CRITERIA.reduce((n, c) => n + (inputs[c.id].checked ? 1 : 0), 0);
  }

  function refreshScore() {
    score.textContent = `Качество: ${checkedCount()} из ${QUALITY_CRITERIA.length}`;
  }
  refreshScore();

  // Снимок отметок: { testable, measurable, relevant, falsifiable } — для черновика.
  function getState() {
    const state = {};
    for (const c of QUALITY_CRITERIA) state[c.id] = inputs[c.id].checked;
    return state;
  }

  // Доля 0..1 отмеченных критериев — «балл гипотезы» (PRD §5.2 Ф3).
  function getFraction() {
    return QUALITY_CRITERIA.length ? checkedCount() / QUALITY_CRITERIA.length : 0;
  }

  function getScore() {
    return Math.round(getFraction() * 100);
  }

  function lock() {
    for (const c of QUALITY_CRITERIA) inputs[c.id].disabled = true;
  }

  return { element: fieldset, getState, getFraction, getScore, lock };
}
