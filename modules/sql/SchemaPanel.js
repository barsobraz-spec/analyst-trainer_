// modules/sql/SchemaPanel.js — постоянная панель схемы БД (T6.2.2).
//
// PRD §5.5 Ф2: постоянно видимый список таблиц, столбцов и типов данных текущего
// кейса. Схему отдаёт SQL-воркер при инициализации БД (describeSchema): массив
// `[{ name, columns:[{name, type}] }]`. Каждая таблица — раскрывающийся блок
// (<details>), первая открыта по умолчанию.
//
// ES-модуль: `import { SchemaPanel } from './SchemaPanel.js'`.

export function SchemaPanel({ schema } = {}) {
  const root = document.createElement('aside');
  root.className = 'schema-panel';
  root.setAttribute('aria-label', 'Схема базы данных');

  const h2 = document.createElement('h2');
  h2.className = 'schema-panel__title';
  h2.textContent = 'Схема данных';
  root.append(h2);

  const tables = Array.isArray(schema) ? schema : [];
  if (tables.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'schema-panel__empty';
    empty.textContent = 'Схема недоступна.';
    root.append(empty);
    return root;
  }

  tables.forEach((table, i) => {
    const details = document.createElement('details');
    details.className = 'schema-panel__table';
    if (i === 0) details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'schema-panel__table-name';
    summary.textContent = table.name;
    details.append(summary);

    const ul = document.createElement('ul');
    ul.className = 'schema-panel__columns';
    for (const col of table.columns || []) {
      const li = document.createElement('li');
      li.className = 'schema-panel__column';
      const name = document.createElement('span');
      name.className = 'schema-panel__column-name';
      name.textContent = col.name;
      const type = document.createElement('span');
      type.className = 'schema-panel__column-type';
      type.textContent = col.type;
      li.append(name, type);
      ul.append(li);
    }
    details.append(ul);
    root.append(details);
  });

  return root;
}
