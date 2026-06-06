// modules/rca/CauseTree.js — интерактивное дерево причин модуля 5.4 (T4.2.2, T4.2.3).
//
// PRD §5.4 Ф3: «Интерактивная схема в интерфейсе: узлы можно добавлять, переименовывать,
// удалять, сворачивать.» И Ф4: «Пользователь помечает один или несколько узлов как
// корневую причину.» Это переиспользуемый движок дерева — на нём строится метод Fishbone
// (Fishbone.js сеет в него проблему + категории). Чистый UI + состояние, БЕЗ обращения к
// хранилищу: персистентностью занимается владелец (Fishbone / CauseAnalysis) через onChange.
//
// Узел состояния — чистые данные (без ссылок на DOM): { id, label, collapsed, root, children[] }.
// DOM каждый раз строится из состояния в render(); обработчики замыкаются на объекты-узлы и
// меняют их поля, поэтому getNodes() = structuredClone(state) безопасно сериализуется в черновик.
//
// Конфигурация:
//   nodes            — стартовый лес узлов (Fishbone передаёт [проблема → категории → …]);
//   protectedIds     — узлы, которые нельзя удалить или переименовать (проблема, категории);
//   fixedChildrenIds — узлы, чей набор детей фиксирован (нельзя добавить ребёнка) — для
//                      Fishbone это проблема: категории заданы кейсом и не достраиваются;
//   onChange         — вызывается после любой мутации (владелец дебаунсит и пишет черновик).
//
// Контроллер: { element, getNodes, getRootCauseIds, getRootCauses, markRootCause,
//               countUserNodes, lock }.
//
// ES-модуль: `import { CauseTree } from './modules/rca/CauseTree.js'`.

const makeId = () =>
  (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
    ? globalThis.crypto.randomUUID()
    : `n-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function CauseTree({
  nodes,
  protectedIds = [],
  fixedChildrenIds = [],
  onChange,
} = {}) {
  const protectedSet = new Set(protectedIds);
  const fixedChildrenSet = new Set(fixedChildrenIds);
  const state = normalizeNodes(nodes); // чистые данные, отдельно от DOM
  let locked = false;

  const root = document.createElement('div');
  root.className = 'cause-tree';
  render();

  // --- Рендер из состояния ----------------------------------------------------
  function render() {
    root.replaceChildren(buildList(state));
  }

  function buildList(arr) {
    const ul = document.createElement('ul');
    ul.className = 'cause-tree__list';
    for (const node of arr) ul.append(buildNode(node));
    return ul;
  }

  function buildNode(node) {
    const li = document.createElement('li');
    li.className = 'cause-tree__node';
    li.dataset.nodeId = node.id;
    if (node.root) li.classList.add('cause-tree__node--root');

    const row = document.createElement('div');
    row.className = 'cause-tree__row';

    const hasChildren = node.children.length > 0;
    const isProtected = protectedSet.has(node.id);
    const canAddChild = !fixedChildrenSet.has(node.id);

    // Свернуть/развернуть (collapsed — часть состояния, поэтому notify, чтобы сохранить).
    if (hasChildren) {
      const toggle = btn(node.collapsed ? '▸' : '▾', 'cause-tree__toggle', () => {
        node.collapsed = !node.collapsed;
        render();
        notify();
      });
      toggle.setAttribute('aria-label', node.collapsed ? 'Развернуть' : 'Свернуть');
      toggle.setAttribute('aria-expanded', String(!node.collapsed));
      row.append(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'cause-tree__toggle cause-tree__toggle--leaf';
      spacer.setAttribute('aria-hidden', 'true');
      row.append(spacer);
    }

    // Метка узла: защищённые (проблема/категории) — статичный текст, остальные — поле ввода.
    if (isProtected) {
      const label = document.createElement('span');
      label.className = 'cause-tree__label cause-tree__label--fixed';
      label.textContent = node.label;
      row.append(label);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cause-tree__label-input';
      input.value = node.label;
      input.placeholder = 'Причина…';
      input.disabled = locked;
      input.setAttribute('aria-label', 'Название причины');
      input.addEventListener('input', () => {
        node.label = input.value;
        notify(); // без render — поле само источник значения, не теряем фокус
      });
      row.append(input);
    }

    // Отметка корневой причины (Ф4) — несколько узлов допускаются.
    const rootBtn = btn(node.root ? '★ корневая' : '☆ корневая', 'cause-tree__root', () => {
      node.root = !node.root;
      render();
      notify();
    });
    rootBtn.classList.toggle('is-on', !!node.root);
    rootBtn.setAttribute('aria-pressed', String(!!node.root));
    rootBtn.title = 'Отметить узел как корневую причину';
    if (locked) rootBtn.disabled = true;
    row.append(rootBtn);

    // Добавить подпричину.
    if (canAddChild) {
      const add = btn('+', 'cause-tree__add', () => {
        const child = makeNode('');
        node.children.push(child);
        node.collapsed = false;
        render();
        focusNode(child.id);
        notify();
      });
      add.setAttribute('aria-label', 'Добавить подпричину');
      if (locked) add.disabled = true;
      row.append(add);
    }

    // Удалить узел (с поддеревом). Защищённые узлы не удаляются.
    if (!isProtected) {
      const del = btn('✕', 'cause-tree__delete', () => {
        removeFrom(state, node.id);
        render();
        notify();
      });
      del.setAttribute('aria-label', 'Удалить причину');
      if (locked) del.disabled = true;
      row.append(del);
    }

    li.append(row);
    if (hasChildren && !node.collapsed) li.append(buildList(node.children));
    return li;
  }

  function btn(text, className, handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    b.addEventListener('click', () => {
      if (locked) return;
      handler();
    });
    return b;
  }

  function focusNode(id) {
    const input = root.querySelector(`[data-node-id="${id}"] .cause-tree__label-input`);
    if (input) input.focus();
  }

  function notify() {
    if (onChange && !locked) onChange();
  }

  // --- Публичное состояние ----------------------------------------------------
  function getNodes() {
    return structuredClone(state);
  }

  function getRootCauseIds() {
    const ids = [];
    walk(state, (n) => { if (n.root) ids.push(n.id); });
    return ids;
  }

  function getRootCauses() {
    const out = [];
    walk(state, (n) => { if (n.root) out.push({ id: n.id, label: n.label.trim() }); });
    return out;
  }

  // Программная отметка корневых причин (T4.2.3 markRootCause(nodeId[])).
  function markRootCause(ids) {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    walk(state, (n) => { if (set.has(n.id)) n.root = true; });
    render();
    notify();
  }

  // Сколько узлов добавил пользователь (всё, кроме защищённого каркаса) — для isEmpty.
  function countUserNodes() {
    let n = 0;
    walk(state, (node) => { if (!protectedSet.has(node.id)) n += 1; });
    return n;
  }

  function lock() {
    locked = true;
    for (const el of root.querySelectorAll('input, button')) el.disabled = true;
  }

  return {
    element: root,
    getNodes,
    getRootCauseIds,
    getRootCauses,
    markRootCause,
    countUserNodes,
    lock,
  };
}

// --- Чистые помощники над данными --------------------------------------------

function makeNode(label) {
  return { id: makeId(), label: label == null ? '' : String(label), collapsed: false, root: false, children: [] };
}

function normalizeNodes(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeNode).filter(Boolean);
}

function normalizeNode(n) {
  if (!n || typeof n !== 'object') return null;
  return {
    id: typeof n.id === 'string' && n.id ? n.id : makeId(),
    label: n.label == null ? '' : String(n.label),
    collapsed: !!n.collapsed,
    root: !!n.root,
    children: normalizeNodes(n.children),
  };
}

// Удаляет узел по id из дерева (вместе с поддеревом). Возвращает true, если нашёл.
function removeFrom(arr, id) {
  const i = arr.findIndex((n) => n.id === id);
  if (i >= 0) { arr.splice(i, 1); return true; }
  for (const n of arr) if (removeFrom(n.children, id)) return true;
  return false;
}

function walk(arr, fn) {
  for (const n of arr) {
    fn(n);
    walk(n.children, fn);
  }
}

// Реэкспорт для владельцев (Fishbone строит стартовый лес из этих же кирпичей).
export { makeNode, makeId };
