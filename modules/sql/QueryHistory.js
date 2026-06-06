// modules/sql/QueryHistory.js — история запросов сессии (T6.2.3).
//
// PRD §5.5 Ф6: список выполненных в рамках кейса запросов с возможностью повторного
// запуска. История живёт только в памяти сессии (не в IndexedDB) — она привязана к
// открытому кейсу и обнуляется при уходе. Клик по записи отдаёт SQL наружу
// (onPick) — экран вставляет его в редактор и выполняет.
//
// Контроллер: { element, add(sql) }. Новые запросы добавляются сверху; дубликат
// подряд идущего запроса не плодит запись.
//
// ES-модуль: `import { QueryHistory } from './QueryHistory.js'`.

export function QueryHistory({ onPick } = {}) {
  const root = document.createElement('section');
  root.className = 'query-history';
  root.setAttribute('aria-label', 'История запросов');

  const h2 = document.createElement('h2');
  h2.className = 'query-history__title';
  h2.textContent = 'История запросов';
  root.append(h2);

  const empty = document.createElement('p');
  empty.className = 'query-history__empty';
  empty.textContent = 'Пока пусто — выполненные запросы появятся здесь.';
  root.append(empty);

  const list = document.createElement('ol');
  list.className = 'query-history__list';
  root.append(list);

  let lastAdded = null;

  function add(sql) {
    const text = String(sql || '').trim();
    if (!text || text === lastAdded) return;
    lastAdded = text;
    empty.hidden = true;

    const li = document.createElement('li');
    li.className = 'query-history__item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'query-history__run';
    btn.title = 'Вставить в редактор и выполнить';
    // Одна строка в превью — многострочный запрос сворачиваем в одну строку.
    btn.textContent = text.replace(/\s+/g, ' ');
    btn.addEventListener('click', () => onPick && onPick(text));
    li.append(btn);
    list.prepend(li);
  }

  return { element: root, add };
}
