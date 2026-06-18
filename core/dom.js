// Булевы атрибуты, которые нужно ставить через DOM-свойство, а не setAttribute.
const BOOL_PROPS = new Set([
  'disabled', 'checked', 'hidden', 'readOnly', 'required',
  'selected', 'multiple', 'open', 'defaultChecked',
]);

/**
 * h(tag, props, ...children) → HTMLElement
 *
 * props: { className, id, onClick, disabled, ... }
 *   — on* → addEventListener
 *   — булевы (disabled, hidden, ...) → DOM-свойство
 *   — остальные → setAttribute
 *
 * children: строки, Node, false/null/undefined (пропускаются), массивы.
 *
 * SVG: не поддерживается — используйте createElementNS напрямую.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);

  for (const [key, val] of Object.entries(props ?? {})) {
    if (val == null) continue;
    if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (BOOL_PROPS.has(key)) {
      el[key] = Boolean(val);
    } else if (key === 'className') {
      el.className = val;
    } else {
      el.setAttribute(key, val);
    }
  }

  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return el;
}

export function smokeTest() {
  // Базовые атрибуты
  const btn = h('button', { className: 'btn', disabled: true, 'data-x': '1' }, 'OK');
  console.assert(btn.disabled === true,          '[dom.h] disabled должен быть true');
  console.assert(btn.className === 'btn',        '[dom.h] className');
  console.assert(btn.dataset.x === '1',          '[dom.h] data-атрибут');
  console.assert(btn.textContent === 'OK',       '[dom.h] textContent');

  // Снятие disabled через false
  const btn2 = h('button', { disabled: false }, 'X');
  console.assert(btn2.disabled === false,        '[dom.h] disabled:false не ставит атрибут');

  // Обработчик события
  let clicked = false;
  const b = h('button', { onClick: () => { clicked = true; } });
  b.click();
  console.assert(clicked,                        '[dom.h] onClick сработал');

  // Falsy-дети пропускаются
  const d = h('div', {}, false, null, undefined, 'text', 0);
  console.assert(d.childNodes.length === 2,      '[dom.h] falsy-дети пропущены (text + "0")');

  // Вложенные массивы
  const ul = h('ul', {}, ['a', 'b'].map(t => h('li', {}, t)));
  console.assert(ul.children.length === 2,       '[dom.h] вложенный массив children');

  // hidden
  const span = h('span', { hidden: true });
  console.assert(span.hidden === true,           '[dom.h] hidden');

  console.info('[dom.smokeTest] OK — все проверки пройдены');
}
