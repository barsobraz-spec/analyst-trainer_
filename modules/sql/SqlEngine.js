// modules/sql/SqlEngine.js — клиент к SQL-воркеру на главном потоке (T6.1.3/T6.1.4).
//
// Владеет Web Worker'ом (workers/sql.worker.js), где живёт sql.js. Прячет протокол
// сообщений за промис-API:
//   • createSqlEngine({ dataset }) → engine
//   • engine.ready()  → Promise<schema>  (БД построена из датасета)
//   • engine.exec(sql) → Promise<{ columns, rows }>  (ошибка SQL → reject с message)
//   • engine.destroy() — завершить воркер (вызывает экран кейса при финализации;
//     у роутера нет unmount-хука — известное ограничение, см. T1.6).
//
// ТАЙМАУТ (PRD §2 принцип 3, §5.5): синхронный exec sql.js нельзя прервать изнутри
// воркера, поэтому при зависании запроса главный поток ЗАВЕРШАЕТ воркер (terminate)
// и поднимает новый, переинициализируя его тем же датасетом. Зависший exec и все
// другие ожидающие запросы отклоняются понятной ошибкой, но движок остаётся рабочим.
//
// ES-модуль: `import { createSqlEngine } from './SqlEngine.js'`.

import { SQL_QUERY_TIMEOUT_MS } from '../../config.js';

export function createSqlEngine({ dataset, timeoutMs = SQL_QUERY_TIMEOUT_MS } = {}) {
  let worker = null;
  let schema = [];
  let readyPromise = null;
  let pending = new Map(); // id → { resolve, reject, timer }
  let nextId = 1;
  let destroyed = false;

  const workerUrl = new URL('../../workers/sql.worker.js', import.meta.url);

  function spawn() {
    worker = new Worker(workerUrl, { type: 'classic' });
    readyPromise = new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const msg = e.data || {};
        if (msg.type === 'ready') {
          schema = msg.schema || [];
          resolve(schema);
        } else if (msg.type === 'error' && msg.phase === 'init') {
          reject(new Error(msg.message || 'Не удалось создать БД из датасета.'));
        } else if (msg.type === 'result') {
          settle(msg.id, (p) => p.resolve({ columns: msg.columns || [], rows: msg.rows || [] }));
        } else if (msg.type === 'error') {
          settle(msg.id, (p) => p.reject(new Error(msg.message || 'Ошибка выполнения запроса.')));
        }
      };
      worker.onerror = (err) => {
        reject(new Error('Сбой SQL-воркера: ' + (err.message || 'неизвестная ошибка')));
      };
    });
    worker.postMessage({ type: 'init', dataset });
  }

  function settle(id, apply) {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    apply(p);
  }

  // Аварийное пересоздание воркера: отклоняем все ожидающие запросы и поднимаем
  // новый воркер, переинициализируя его тем же датасетом.
  function recycle(reasonError) {
    try { worker && worker.terminate(); } catch { /* уже мёртв */ }
    const toReject = [...pending.values()];
    pending.clear();
    for (const p of toReject) {
      clearTimeout(p.timer);
      p.reject(reasonError);
    }
    if (!destroyed) spawn();
  }

  spawn();

  return {
    ready: () => readyPromise,
    getSchema: () => schema,

    async exec(sql) {
      if (destroyed) throw new Error('Движок остановлен.');
      await readyPromise; // дождаться (пере)инициализации БД
      if (destroyed) throw new Error('Движок остановлен.');

      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          // Запрос завис: завершаем воркер и поднимаем новый (T6.1.4).
          recycle(new Error(
            `Запрос выполнялся дольше ${Math.round(timeoutMs / 1000)} с и был прерван. ` +
            'Упростите запрос (например, избегайте соединений без условия).',
          ));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ type: 'exec', id, sql });
      });
    },

    destroy() {
      destroyed = true;
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Движок остановлен.'));
      }
      pending.clear();
      try { worker && worker.terminate(); } catch { /* уже мёртв */ }
      worker = null;
    },
  };
}
