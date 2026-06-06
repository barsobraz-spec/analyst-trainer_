// modules/automation/StepCard.js — карточка одного узла схемы процесса (T8.1.2).
//
// PRD §5.7 Ф2: для каждого шага описываются «что происходит», данные на входе,
// данные на выходе и кто/что исполняет (роль или инструмент — без конкретного API).
// Карточка также позволяет выбрать тип узла (триггер/действие/условие/итог),
// удалить шаг и переставить его выше/ниже — этим конструктор (ProcessBuilder.js)
// собирает узлы в последовательность (Ф1).
//
// Карточка мутирует переданный объект-узел ПО ССЫЛКЕ (node.title и т.п.) и зовёт
// onChange — конструктор по этому сигналу пересчитывает чек-лист готовности и
// дебаунсит сохранение черновика, не перерисовывая карточку (чтобы не терять фокус
// в полях ввода). Перестановка/удаление/смена типа меняют структуру списка —
// их обрабатывает конструктор (он перерисует список целиком).
//
// ES-модуль: `import { StepCard } from './modules/automation/StepCard.js'`.

import { NODE_TYPE_LABELS, NODE_TYPE_ORDER } from '../../core/automationArtifacts.js';

// Иконка и пояснение для каждого типа узла (подписи — из единого словаря ядра).
const NODE_TYPE_META = {
  trigger: { icon: '⚡', hint: 'С чего начинается процесс' },
  action: { icon: '⚙', hint: 'Шаг обработки данных' },
  condition: { icon: '◆', hint: 'Развилка или проверка исключения' },
  outcome: { icon: '✓', hint: 'Чем измеримо заканчивается процесс' },
};

// Поля карточки шага (PRD §5.7 Ф2). title — однострочное, остальное — многострочное.
const STEP_FIELDS = [
  { key: 'title', label: 'Что происходит', multiline: false, placeholder: 'Кратко опишите шаг' },
  { key: 'input', label: 'Вход (данные)', multiline: true, placeholder: 'Какие данные поступают на шаг' },
  { key: 'output', label: 'Выход (данные)', multiline: true, placeholder: 'Что шаг отдаёт дальше' },
  { key: 'actor', label: 'Исполнитель (роль / инструмент)', multiline: false, placeholder: 'Кто или что выполняет шаг' },
];

let cardSeq = 0;

export function StepCard({
  node,
  position = 0,
  total = 1,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
} = {}) {
  const prefix = `step-${++cardSeq}`;

  const card = document.createElement('li');
  card.className = `step-card step-card--${node.type}`;

  // --- Шапка карточки: номер, тип (select), кнопки порядка/удаления -----------
  const head = document.createElement('div');
  head.className = 'step-card__head';

  const badge = document.createElement('span');
  badge.className = 'step-card__badge';

  const number = document.createElement('span');
  number.className = 'step-card__number';
  number.textContent = `Шаг ${position + 1}`;

  // Выбор типа узла (Ф1: типы trigger/action/condition/outcome).
  const typeSelect = document.createElement('select');
  typeSelect.className = 'step-card__type';
  typeSelect.setAttribute('aria-label', 'Тип узла');
  for (const type of NODE_TYPE_ORDER) {
    const opt = document.createElement('option');
    opt.value = type;
    const meta = NODE_TYPE_META[type];
    opt.textContent = `${meta ? meta.icon + ' ' : ''}${NODE_TYPE_LABELS[type]}`;
    typeSelect.append(opt);
  }
  typeSelect.value = node.type;
  typeSelect.addEventListener('change', () => {
    node.type = typeSelect.value;
    card.className = `step-card step-card--${node.type}`;
    refreshBadge();
    onChange?.();
  });

  function refreshBadge() {
    const meta = NODE_TYPE_META[node.type];
    badge.textContent = meta ? meta.icon : '•';
    badge.title = NODE_TYPE_LABELS[node.type] || 'Шаг';
  }
  refreshBadge();

  const actions = document.createElement('div');
  actions.className = 'step-card__actions';

  const up = iconButton('↑', 'Переместить выше', () => onMoveUp?.());
  up.disabled = position === 0;
  const down = iconButton('↓', 'Переместить ниже', () => onMoveDown?.());
  down.disabled = position === total - 1;
  const remove = iconButton('✕', 'Удалить шаг', () => onRemove?.());
  remove.classList.add('step-card__delete');
  actions.append(up, down, remove);

  head.append(badge, number, typeSelect, actions);
  card.append(head);

  // --- Поля шага (что / вход / выход / исполнитель) ---------------------------
  const fields = document.createElement('div');
  fields.className = 'step-card__fields';

  for (const f of STEP_FIELDS) {
    const wrap = document.createElement('div');
    wrap.className = 'step-card__field';
    if (f.multiline) wrap.classList.add('step-card__field--wide');

    const inputId = `${prefix}-${f.key}`;
    const label = document.createElement('label');
    label.className = 'step-card__field-label';
    label.htmlFor = inputId;
    label.textContent = f.label;

    const input = f.multiline
      ? document.createElement('textarea')
      : document.createElement('input');
    if (!f.multiline) input.type = 'text';
    if (f.multiline) input.rows = 2;
    input.id = inputId;
    input.className = 'step-card__input';
    input.placeholder = f.placeholder;
    input.value = node[f.key] || '';
    input.addEventListener('input', () => {
      node[f.key] = input.value;
      onChange?.();
    });

    wrap.append(label, input);
    fields.append(wrap);
  }

  card.append(fields);

  // Блокировка карточки после отправки (PRD §4: без правок задним числом).
  function lock() {
    for (const el of card.querySelectorAll('input, textarea, select, button')) {
      el.disabled = true;
    }
  }

  return { element: card, lock };
}

function iconButton(symbol, title, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'step-card__btn';
  btn.textContent = symbol;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.addEventListener('click', onClick);
  return btn;
}
