// modules/automation/ProcessBuilder.js — конструктор схемы процесса (T8.1.1).
//
// PRD §5.7 Ф1: построение схемы «Триггер → Шаги → Результат». Пользователь
// добавляет узлы (триггер, действие, условие, итог), связывает их в
// последовательность (порядок = последовательность; перестановка ↑/↓) и удаляет
// лишние. Каждый узел — карточка шага (StepCard.js) с полями вход/выход/исполнитель
// (Ф2). Между карточками рисуется коннектор «↓», чтобы схема читалась как поток.
//
// Конструктор держит состояние `{ nodes }` и перерисовывает список при изменении
// структуры (добавить/удалить/переставить/сменить тип). Правки полей карточек
// структуру не меняют — карточка мутирует свой узел по ссылке и зовёт onChange,
// поэтому фокус в поле не теряется. onChange уведомляет экран кейса, который
// дебаунсит сохранение черновика (T8.1.3) и обновляет чек-лист готовности.
//
// Контроллер: { element, getState, isReady, lock }. getState() возвращает схему
// `{ nodes:[{ type, title, input, output, actor }] }` — её сохраняет черновик и
// принимают артефакты/чек-лист. Восстановление из черновика — через initialState.
//
// ES-модуль: `import { ProcessBuilder } from './modules/automation/ProcessBuilder.js'`.

import { NODE_TYPE_LABELS } from '../../core/automationArtifacts.js';
import { StepCard } from './StepCard.js';

// Кнопки добавления узлов (Ф1). Иконки совпадают со StepCard для узнаваемости.
const ADD_BUTTONS = [
  { type: 'trigger', icon: '⚡' },
  { type: 'action', icon: '⚙' },
  { type: 'condition', icon: '◆' },
  { type: 'outcome', icon: '✓' },
];

let nodeSeq = 0;
function newNode(type) {
  return { id: `n${++nodeSeq}`, type, title: '', input: '', output: '', actor: '' };
}

// Стартовый каркас для нового кейса (без черновика): триггер → действие → итог.
// Показывает форму схемы и сразу задаёт направление «Триггер → Шаги → Результат».
function seedNodes() {
  return [newNode('trigger'), newNode('action'), newNode('outcome')];
}

export function ProcessBuilder({ initialState, onChange } = {}) {
  const root = document.createElement('section');
  root.className = 'process-builder';

  const title = document.createElement('h2');
  title.className = 'process-builder__title';
  title.textContent = 'Схема процесса';
  root.append(title);

  const intro = document.createElement('p');
  intro.className = 'process-builder__intro';
  intro.textContent = 'Соберите поток «Триггер → Шаги → Результат»: добавляйте узлы, заполняйте карточки и упорядочивайте их стрелками.';
  root.append(intro);

  // Состояние схемы. Восстанавливаем узлы из черновика, если он есть и валиден.
  let nodes = restoreNodes(initialState);
  let locked = false;

  // Контейнер списка карточек (перерисовывается при изменении структуры).
  const list = document.createElement('ol');
  list.className = 'process-builder__list';
  root.append(list);

  // Панель добавления узлов.
  const adder = document.createElement('div');
  adder.className = 'process-builder__adder';
  adder.setAttribute('role', 'group');
  adder.setAttribute('aria-label', 'Добавить узел');
  for (const b of ADD_BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'process-builder__add';
    btn.textContent = `+ ${b.icon} ${NODE_TYPE_LABELS[b.type]}`;
    btn.addEventListener('click', () => {
      if (locked) return;
      nodes.push(newNode(b.type));
      renderList();
      change();
    });
    adder.append(btn);
  }
  root.append(adder);

  // --- Перерисовка списка карточек + коннекторов ------------------------------
  function renderList() {
    list.replaceChildren();

    if (nodes.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'process-builder__empty';
      empty.textContent = 'Узлов пока нет — добавьте триггер, чтобы начать схему.';
      list.append(empty);
      return;
    }

    nodes.forEach((node, i) => {
      const card = StepCard({
        node,
        position: i,
        total: nodes.length,
        onChange: change,
        onRemove: () => { removeAt(i); },
        onMoveUp: () => { moveNode(i, i - 1); },
        onMoveDown: () => { moveNode(i, i + 1); },
      });
      if (locked) card.lock();
      list.append(card.element);

      // Коннектор между шагами — визуальная связь последовательности.
      if (i < nodes.length - 1) {
        const link = document.createElement('li');
        link.className = 'process-builder__connector';
        link.setAttribute('aria-hidden', 'true');
        link.textContent = '↓';
        list.append(link);
      }
    });
  }

  function removeAt(i) {
    if (locked) return;
    nodes.splice(i, 1);
    renderList();
    change();
  }

  function moveNode(from, to) {
    if (locked || to < 0 || to >= nodes.length) return;
    const [moved] = nodes.splice(from, 1);
    nodes.splice(to, 0, moved);
    renderList();
    change();
  }

  function change() {
    onChange?.();
  }

  // --- Публичное состояние/готовность -----------------------------------------
  // Схема для черновика, артефактов и чек-листа. id узлов сохраняем — они нужны
  // только конструктору, артефакты/чек-лист их игнорируют.
  function getState() {
    return {
      nodes: nodes.map((n) => ({
        type: n.type,
        title: n.title || '',
        input: n.input || '',
        output: n.output || '',
        actor: n.actor || '',
      })),
    };
  }

  // Минимальная готовность к отправке: есть заполненный триггер, хотя бы один
  // шаг (действие/условие) с названием и заполненный итог. Детальная оценка —
  // в чек-листе готовности (ReadinessChecklist).
  function isReady() {
    const has = (type) => nodes.some((n) => n.type === type && (n.title || '').trim());
    const hasStep = nodes.some(
      (n) => (n.type === 'action' || n.type === 'condition') && (n.title || '').trim(),
    );
    return has('trigger') && hasStep && has('outcome');
  }

  function lock() {
    locked = true;
    renderList();
    for (const btn of adder.querySelectorAll('button')) btn.disabled = true;
  }

  renderList();
  return { element: root, getState, isReady, lock };
}

// Восстанавливает узлы из черновика: принимает { nodes:[...] } либо массив,
// присваивает свежие id и нормализует поля. Если черновика нет — стартовый каркас.
function restoreNodes(initialState) {
  const raw = Array.isArray(initialState)
    ? initialState
    : Array.isArray(initialState?.nodes)
      ? initialState.nodes
      : null;
  if (!raw || raw.length === 0) return seedNodes();

  return raw
    .filter((n) => n && typeof n === 'object' && NODE_TYPE_LABELS[n.type])
    .map((n) => ({
      id: `n${++nodeSeq}`,
      type: n.type,
      title: typeof n.title === 'string' ? n.title : '',
      input: typeof n.input === 'string' ? n.input : '',
      output: typeof n.output === 'string' ? n.output : '',
      actor: typeof n.actor === 'string' ? n.actor : '',
    }));
}
