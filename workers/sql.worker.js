// workers/sql.worker.js — исполнение SQL на sql.js в отдельном потоке (T6.1).
//
// PRD §5.5 Ф1 / §2 принцип 3: запросы выполняются на встроенной БД SQLite
// (sql.js, WASM без SharedArrayBuffer — COOP/COEP не требуются), В ВОРКЕРЕ, чтобы
// тяжёлый запрос не блокировал UI. БД пересоздаётся из датасета при открытии кейса;
// модификации существуют только в памяти воркера (между кейсами не сохраняются).
//
// Это КЛАССИЧЕСКИЙ воркер (importScripts) — sql-wasm.js кладёт глобал initSqlJs.
//
// Протокол сообщений (главный поток ↔ воркер):
//   → { type:'init', dataset }            создать БД из датасета
//   ← { type:'ready', schema }            БД готова, schema = [{name, columns:[{name,type}]}]
//   ← { type:'error', phase:'init', message }
//   → { type:'exec', id, sql }            выполнить запрос
//   ← { type:'result', id, columns, rows }
//   ← { type:'error', id, message }       ошибка SQL — воркер продолжает работать
//
// Таймаут запроса реализован НА ГЛАВНОМ ПОТОКЕ (setTimeout + worker.terminate):
// синхронный exec sql.js нельзя прервать изнутри воркера, поэтому при зависании
// главный поток просто завершает воркер и поднимает новый (см. SqlEngine.js, T6.1.4).

/* eslint-env worker */

// sql-wasm.js лежит рядом в vendor/; путь резолвим относительно расположения воркера.
importScripts(new URL('../vendor/sql.js/sql-wasm.js', self.location).href);

let dbPromise = null; // Promise<Database> — общая БД кейса

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === 'init') {
    try {
      const schema = await initDatabase(msg.dataset);
      self.postMessage({ type: 'ready', schema });
    } catch (err) {
      self.postMessage({ type: 'error', phase: 'init', message: String(err && err.message || err) });
    }
    return;
  }

  if (msg.type === 'exec') {
    const { id, sql } = msg;
    try {
      const db = await dbPromise;
      if (!db) throw new Error('База данных не инициализирована.');
      const { columns, rows } = execQuery(db, sql);
      self.postMessage({ type: 'result', id, columns, rows });
    } catch (err) {
      // Ошибка SQL не валит воркер — возвращаем сообщение, БД остаётся живой.
      self.postMessage({ type: 'error', id, message: String(err && err.message || err) });
    }
  }
};

// --- Инициализация БД из датасета (T6.1.2) -----------------------------------
// dataset = { tables: [ { name, columns:[{name,type}], rows: [[…]] | [{col:val}] } ] }
async function initDatabase(dataset) {
  const SQL = await initSqlJs({
    locateFile: (file) => new URL('../vendor/sql.js/' + file, self.location).href,
  });

  const db = new SQL.Database();
  const tables = Array.isArray(dataset && dataset.tables) ? dataset.tables : [];
  if (tables.length === 0) throw new Error('В датасете нет таблиц.');

  db.run('BEGIN;');
  try {
    for (const table of tables) {
      buildTable(db, table);
    }
    db.run('COMMIT;');
  } catch (err) {
    db.run('ROLLBACK;');
    throw err;
  }

  dbPromise = Promise.resolve(db);
  return describeSchema(tables);
}

function buildTable(db, table) {
  const name = table && table.name;
  const columns = Array.isArray(table && table.columns) ? table.columns : [];
  if (!name || columns.length === 0) throw new Error('Описание таблицы неполное (нет имени или столбцов).');

  const colDefs = columns
    .map((c) => `${quoteId(c.name)} ${sqlType(c.type)}`)
    .join(', ');
  db.run(`CREATE TABLE ${quoteId(name)} (${colDefs});`);

  const rows = Array.isArray(table.rows) ? table.rows : [];
  if (rows.length === 0) return;

  const placeholders = columns.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO ${quoteId(name)} VALUES (${placeholders});`);
  try {
    for (const row of rows) {
      stmt.run(rowValues(row, columns));
    }
  } finally {
    stmt.free();
  }
}

// Строка может быть массивом (по порядку столбцов) или объектом (по именам).
function rowValues(row, columns) {
  if (Array.isArray(row)) return columns.map((_, i) => normalizeValue(row[i]));
  return columns.map((c) => normalizeValue(row[c.name]));
}

// sql.js принимает null/number/string/Uint8Array; undefined → null, прочее → строка.
function normalizeValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return String(v);
}

// --- Выполнение запроса (T6.1.3) ---------------------------------------------
// db.exec возвращает массив результатов (по одному на SELECT-стейтмент). Берём
// ПОСЛЕДНИЙ результат с данными — это естественно для многооператорного ввода.
function execQuery(db, sql) {
  const results = db.exec(sql);
  if (!results || results.length === 0) {
    return { columns: [], rows: [] }; // например, запрос без выборки
  }
  const last = results[results.length - 1];
  return { columns: last.columns || [], rows: last.values || [] };
}

// --- Описание схемы для панели (T6.2.2) --------------------------------------
function describeSchema(tables) {
  return tables.map((t) => ({
    name: t.name,
    columns: (t.columns || []).map((c) => ({ name: c.name, type: sqlType(c.type) })),
  }));
}

// --- Помощники ---------------------------------------------------------------
// Приводим объявленный тип к одному из аффинных типов SQLite.
function sqlType(type) {
  const t = String(type || '').toUpperCase();
  if (t.includes('INT')) return 'INTEGER';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB') || t.includes('NUM') || t.includes('DEC')) return 'REAL';
  if (t.includes('DATE') || t.includes('TIME')) return 'TEXT';
  return 'TEXT';
}

// Экранируем идентификатор в двойных кавычках (защита от пробелов/ключевых слов).
function quoteId(id) {
  return '"' + String(id).replace(/"/g, '""') + '"';
}
