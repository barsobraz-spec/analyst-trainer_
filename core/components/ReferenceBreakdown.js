// core/components/ReferenceBreakdown.js — контейнер эталонного разбора (T1.5.3).
//
// PRD §5 Ф5: эталонный разбор открывается ТОЛЬКО после отправки ответа. Этот
// компонент даёт общий, скрытый до отправки контейнер; конкретное содержимое
// (правильная цепочка рассуждений, ключевые наблюдения, эталонный запрос и т.п.)
// зависит от модуля и передаётся вызывающим как готовая разметка.
//
// Возвращает контроллер { element, reveal, isRevealed }, потому что экран кейса
// держит контейнер скрытым и раскрывает его в момент финализации ответа.
//
// Содержимое (content) принимается гибко: строка, DOM-узел, массив узлов или
// функция-билдер () => Node — чтобы модуль мог отдать как простой текст, так и
// сложную структуру. Дополнительно поддержаны секции [{ heading, body }] для
// типового разбора «наблюдения / вывод / типичные ошибки».
//
// ES-модуль: `import { ReferenceBreakdown } from './core/components/ReferenceBreakdown.js'`.

export function ReferenceBreakdown({
  title = 'Эталонный разбор',
  content,
  sections,
} = {}) {
  const root = document.createElement('section');
  root.className = 'reference-breakdown';
  root.hidden = true; // скрыт до отправки ответа (PRD §5 Ф5)

  const h2 = document.createElement('h2');
  h2.className = 'reference-breakdown__title';
  h2.textContent = title;
  root.append(h2);

  const body = document.createElement('div');
  body.className = 'reference-breakdown__body';
  root.append(body);

  // Структурированные секции имеют приоритет, если переданы.
  if (Array.isArray(sections) && sections.length > 0) {
    for (const s of sections) {
      body.append(buildSection(s));
    }
  } else {
    appendContent(body, content);
  }

  let revealed = false;

  function reveal() {
    if (revealed) return;
    revealed = true;
    root.hidden = false;
    // Уводим фокус на разбор, чтобы он сразу зачитался скринридером.
    root.setAttribute('tabindex', '-1');
    root.focus({ preventScroll: false });
  }

  return {
    element: root,
    reveal,
    isRevealed: () => revealed,
  };
}

function buildSection({ heading, body } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'reference-breakdown__section';
  if (heading) {
    const h3 = document.createElement('h3');
    h3.className = 'reference-breakdown__heading';
    h3.textContent = heading;
    wrap.append(h3);
  }
  appendContent(wrap, body);
  return wrap;
}

// Добавляет в контейнер контент произвольного вида (строка / узел / массив /
// функция). Строки разбиваются на абзацы по пустым строкам — чтобы текстовый
// эталон читался как текст, а не как одна простыня.
function appendContent(container, content) {
  const value = typeof content === 'function' ? content() : content;
  if (value == null) return;

  if (Array.isArray(value)) {
    for (const part of value) appendContent(container, part);
    return;
  }

  if (value instanceof Node) {
    container.append(value);
    return;
  }

  const text = String(value).trim();
  if (!text) return;
  for (const para of text.split(/\n\s*\n/)) {
    const p = document.createElement('p');
    p.className = 'reference-breakdown__text';
    p.textContent = para.trim();
    container.append(p);
  }
}
