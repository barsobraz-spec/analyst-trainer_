// modules/sql/ResultTable.js — таблица результата запроса (T6.2.4).
//
// PRD §5.5 Ф1: результат запроса отображается таблицей. Показ ограничен
// SQL_MAX_DISPLAY_ROWS строк (защита UI от огромных выборок — сравнение с эталоном
// при этом идёт по ПОЛНОМУ результату, ограничен лишь рендер). Пустая выборка и
// «запрос без результата» (например, PRAGMA) показываются понятным сообщением.
//
// ES-модуль: `import { renderResultTable } from './ResultTable.js'`.

import { SQL_MAX_DISPLAY_ROWS } from '../../config.js';

// result = { columns: string[], rows: any[][] }
export function renderResultTable(result, { maxRows = SQL_MAX_DISPLAY_ROWS } = {}) {
  const root = document.createElement('div');
  root.className = 'result-table';

  const columns = (result && result.columns) || [];
  const rows = (result && result.rows) || [];

  if (columns.length === 0) {
    const note = document.createElement('p');
    note.className = 'result-table__note';
    note.textContent = 'Запрос выполнен. Этот запрос не возвращает строк.';
    root.append(note);
    return root;
  }

  const meta = document.createElement('p');
  meta.className = 'result-table__meta';
  meta.textContent = `Строк: ${rows.length}` + (rows.length > maxRows ? ` (показаны первые ${maxRows})` : '');
  root.append(meta);

  const scroll = document.createElement('div');
  scroll.className = 'result-table__scroll';

  const table = document.createElement('table');
  table.className = 'result-table__table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = col;
    headRow.append(th);
  }
  thead.append(headRow);

  const tbody = document.createElement('tbody');
  for (const row of rows.slice(0, maxRows)) {
    const tr = document.createElement('tr');
    for (let i = 0; i < columns.length; i++) {
      const td = document.createElement('td');
      const v = row[i];
      td.textContent = v === null || v === undefined ? '' : String(v);
      if (v === null || v === undefined) td.classList.add('result-table__cell--null');
      tr.append(td);
    }
    tbody.append(tr);
  }

  table.append(thead, tbody);
  scroll.append(table);
  root.append(scroll);

  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'result-table__note';
    empty.textContent = 'Выборка пуста — ни одной строки не подошло.';
    root.append(empty);
  }

  return root;
}
