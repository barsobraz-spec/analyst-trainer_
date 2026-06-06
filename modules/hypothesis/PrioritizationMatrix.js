// modules/hypothesis/PrioritizationMatrix.js — матрица приоритизации гипотез (T3.2.1).
//
// PRD §5.2 Ф4: пользователь ранжирует свои гипотезы по ожидаемому эффекту и
// стоимости проверки — матрица «эффект × усилия» (2×2). Размещение — кнопкой/селектом
// «переместить» (drag-and-drop в плане допустим как альтернатива; выбран селект — он
// доступнее и надёжнее на тач/клавиатуре и легко тестируется). На итоговый score
// матрица напрямую не влияет (PRD §5.2 Ф6 — score от чек-листов и сравнения с
// эталоном); это инструмент структурирования приоритетов.
//
// Источник списка гипотез — конструктор (HypothesisForm.getItems()): экран кейса
// передаёт сюда заполненные гипотезы и пере-синхронизирует через setItems() при
// изменении формы. Привязка «гипотеза → квадрант» хранится по стабильному id
// гипотезы, поэтому переживает добавление/удаление соседних карточек и перезагрузку
// (восстанавливается из черновика).
//
// Контроллер { element, getPlacement, setItems, lock }: экрану кейса нужно читать
// размещение для черновика, обновлять набор гипотез и блокировать после отправки.
//
// ES-модуль: `import { PrioritizationMatrix } from './modules/hypothesis/PrioritizationMatrix.js'`.

// Четыре квадранта матрицы «эффект × усилия». tag — короткая управленческая подпись
// квадранта (что делать с гипотезами, попавшими сюда).
export const QUADRANTS = [
  { id: 'high-low',  label: 'Высокий эффект · Низкие усилия',  tag: 'В первую очередь' },
  { id: 'high-high', label: 'Высокий эффект · Высокие усилия', tag: 'Запланировать' },
  { id: 'low-low',   label: 'Низкий эффект · Низкие усилия',   tag: 'Если останется время' },
  { id: 'low-high',  label: 'Низкий эффект · Высокие усилия',  tag: 'Можно отложить' },
];

const QUADRANT_IDS = new Set(QUADRANTS.map((q) => q.id));

export function PrioritizationMatrix({ items = [], initialPlacement = {}, onChange } = {}) {
  let currentItems = items.slice();
  let locked = false;

  // Привязка id гипотезы → id квадранта. Из черновика берём только валидные квадранты.
  const placement = {};
  for (const [id, q] of Object.entries(initialPlacement || {})) {
    if (QUADRANT_IDS.has(q)) placement[id] = q;
  }

  const root = document.createElement('section');
  root.className = 'prioritization';

  const title = document.createElement('h2');
  title.className = 'prioritization__title';
  title.textContent = 'Приоритизация гипотез';
  root.append(title);

  const hint = document.createElement('p');
  hint.className = 'prioritization__hint';
  hint.textContent = 'Оцените каждую гипотезу по ожидаемому эффекту и стоимости проверки '
    + 'и поместите её в нужную ячейку матрицы.';
  root.append(hint);

  // Сетка 3×3: угол + две подписи усилий сверху; слева — подписи эффекта.
  const grid = document.createElement('div');
  grid.className = 'prioritization__grid';
  const slotLists = {};

  grid.append(corner(), colHeader('Низкие усилия'), colHeader('Высокие усилия'));
  grid.append(rowHeader('Высокий эффект'), cell('high-low'), cell('high-high'));
  grid.append(rowHeader('Низкий эффект'), cell('low-low'), cell('low-high'));
  root.append(grid);

  // Лоток нераспределённых гипотез.
  const tray = document.createElement('div');
  tray.className = 'prioritization__tray';
  const trayTitle = document.createElement('h3');
  trayTitle.className = 'prioritization__tray-title';
  trayTitle.textContent = 'Не размещено';
  const trayList = document.createElement('ul');
  trayList.className = 'prioritization__slots';
  const trayEmpty = document.createElement('p');
  trayEmpty.className = 'prioritization__empty';
  tray.append(trayTitle, trayList, trayEmpty);
  root.append(tray);

  function corner() {
    const d = document.createElement('div');
    d.className = 'prioritization__corner';
    return d;
  }
  function colHeader(text) {
    const d = document.createElement('div');
    d.className = 'prioritization__col-header';
    d.textContent = text;
    return d;
  }
  function rowHeader(text) {
    const d = document.createElement('div');
    d.className = 'prioritization__row-header';
    d.textContent = text;
    return d;
  }
  function cell(qid) {
    const q = QUADRANTS.find((x) => x.id === qid);
    const c = document.createElement('div');
    c.className = 'prioritization__cell';
    const tag = document.createElement('span');
    tag.className = 'prioritization__cell-tag';
    tag.textContent = q.tag;
    const ul = document.createElement('ul');
    ul.className = 'prioritization__slots';
    c.append(tag, ul);
    slotLists[qid] = ul;
    return c;
  }

  // Фишка-гипотеза: название + селект выбора квадранта (или «не размещено»).
  function buildChip(item) {
    const li = document.createElement('li');
    li.className = 'prioritization__chip';

    const name = document.createElement('span');
    name.className = 'prioritization__chip-name';
    name.textContent = item.label;

    const select = document.createElement('select');
    select.className = 'prioritization__move';
    select.setAttribute('aria-label', `Куда поместить: ${item.label}`);
    select.disabled = locked;

    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— не размещено';
    select.append(none);
    for (const q of QUADRANTS) {
      const o = document.createElement('option');
      o.value = q.id;
      o.textContent = q.label;
      select.append(o);
    }
    select.value = placement[item.id] || '';

    select.addEventListener('change', () => {
      if (locked) return;
      if (select.value) placement[item.id] = select.value;
      else delete placement[item.id];
      render();
      if (onChange) onChange();
    });

    li.append(name, select);
    return li;
  }

  function render() {
    // Снимаем размещения для гипотез, которых больше нет в наборе.
    const ids = new Set(currentItems.map((i) => i.id));
    for (const id of Object.keys(placement)) {
      if (!ids.has(id)) delete placement[id];
    }

    trayList.replaceChildren();
    for (const q of QUADRANTS) slotLists[q.id].replaceChildren();

    let unplaced = 0;
    for (const item of currentItems) {
      const q = placement[item.id];
      (q ? slotLists[q] : trayList).append(buildChip(item));
      if (!q) unplaced += 1;
    }

    if (currentItems.length === 0) {
      trayEmpty.textContent = 'Сформулируйте гипотезы — они появятся здесь для приоритизации.';
      trayEmpty.hidden = false;
    } else if (unplaced === 0) {
      trayEmpty.textContent = 'Все гипотезы размещены.';
      trayEmpty.hidden = false;
    } else {
      trayEmpty.hidden = true;
    }
  }

  // Обновить набор гипотез (экран зовёт при изменении формы). Размещения по id
  // сохраняются для тех гипотез, что остались.
  function setItems(newItems) {
    currentItems = (newItems || []).slice();
    render();
  }

  // Текущее размещение { id → quadrantId } только для присутствующих и размещённых.
  function getPlacement() {
    const out = {};
    for (const item of currentItems) {
      if (placement[item.id]) out[item.id] = placement[item.id];
    }
    return out;
  }

  function lock() {
    locked = true;
    for (const s of root.querySelectorAll('select')) s.disabled = true;
  }

  render();
  return { element: root, getPlacement, setItems, lock };
}
