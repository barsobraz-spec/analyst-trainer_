// core/db/migrations.js — список миграций и фреймворк их применения.
//
// Чтобы изменить схему — НЕ редактируем старые версии, а добавляем новую
// запись в MIGRATIONS и поднимаем APP_SCHEMA_VERSION в schema.js.
//
// Типы шагов:
//   { type:'addStore', name, options?, indexes?[] } — создать object store;
//   { type:'addField', store, field, default }       — добавить поле;
//   { type:'renameField', store, from, to }           — переименовать поле;
//   { type:'transformRecords', store, fn }            — произвольное преобразование.
//
// Миграции синхронны внутри onupgradeneeded — async/await здесь недопустим.

import { StorageError } from './schema.js';

export const MIGRATIONS = [
  {
    version: 1,
    steps: [
      {
        type: 'addStore',
        name: 'events',
        options: { keyPath: 'eventId' },
        indexes: [
          { name: 'module', keyPath: 'module' },
          { name: 'caseId', keyPath: 'caseId' },
          { name: 'finishedAt', keyPath: 'finishedAt' },
        ],
      },
      { type: 'addStore', name: 'notes', options: { keyPath: 'caseId' } },
      { type: 'addStore', name: 'userCases', options: { keyPath: 'caseId' } },
      { type: 'addStore', name: 'datasetCache', options: { keyPath: 'key' } },
      { type: 'addStore', name: 'draftStates', options: { keyPath: 'caseId' } },
      { type: 'addStore', name: 'meta', options: { keyPath: 'key' } },
    ],
  },
  {
    version: 2,
    steps: [
      { type: 'addStore', name: 'learningSettings', options: { keyPath: 'key' } },
      {
        type: 'addStore',
        name: 'dailyProgress',
        options: { keyPath: 'dayKey' },
        indexes: [
          { name: 'studyDay', keyPath: 'studyDay' },
          { name: 'updatedAt', keyPath: 'updatedAt' },
        ],
      },
      {
        type: 'addStore',
        name: 'journalEntries',
        options: { keyPath: 'dayKey' },
        indexes: [
          { name: 'studyDay', keyPath: 'studyDay' },
          { name: 'updatedAt', keyPath: 'updatedAt' },
        ],
      },
      {
        type: 'addStore',
        name: 'taskProgress',
        options: { keyPath: 'taskId' },
        indexes: [
          { name: 'status', keyPath: 'status' },
          { name: 'month', keyPath: 'month' },
          { name: 'skill', keyPath: 'skill' },
          { name: 'updatedAt', keyPath: 'updatedAt' },
        ],
      },
      {
        type: 'addStore',
        name: 'projectProgress',
        options: { keyPath: 'projectId' },
        indexes: [
          { name: 'status', keyPath: 'status' },
          { name: 'month', keyPath: 'month' },
          { name: 'updatedAt', keyPath: 'updatedAt' },
        ],
      },
      {
        type: 'addStore',
        name: 'careerApplications',
        options: { keyPath: 'applicationId' },
        indexes: [
          { name: 'status', keyPath: 'status' },
          { name: 'appliedAt', keyPath: 'appliedAt' },
          { name: 'updatedAt', keyPath: 'updatedAt' },
        ],
      },
      { type: 'addStore', name: 'learningMeta', options: { keyPath: 'key' } },
    ],
  },
  {
    version: 3,
    steps: [
      {
        type: 'addStore',
        name: 'mockInterviewRuns',
        options: { keyPath: 'runId' },
        indexes: [
          { name: 'date', keyPath: 'date' },
          { name: 'result', keyPath: 'result' },
          { name: 'updatedAt', keyPath: 'updatedAt' },
        ],
      },
    ],
  },
  {
    version: 4,
    steps: [
      {
        type: 'addStore',
        name: 'monthlyExamProgress',
        options: { keyPath: 'month' },
        indexes: [
          { name: 'updatedAt', keyPath: 'updatedAt' },
          { name: 'completedAt', keyPath: 'completedAt' },
        ],
      },
    ],
  },
  {
    version: 5,
    steps: [
      {
        type: 'addStore',
        name: 'learningReminders',
        options: { keyPath: 'reminderId' },
        indexes: [
          { name: 'status', keyPath: 'status' },
          { name: 'scope', keyPath: 'scope' },
          { name: 'updatedAt', keyPath: 'updatedAt' },
        ],
      },
    ],
  },
  {
    version: 6,
    steps: [
      {
        type: 'addStore',
        name: 'aiMentorReviews',
        options: { keyPath: 'reviewId' },
        indexes: [
          { name: 'caseId', keyPath: 'caseId' },
          { name: 'mode', keyPath: 'mode' },
          { name: 'createdAt', keyPath: 'createdAt' },
        ],
      },
    ],
  },
];

// Проходит курсором по всем записям store в рамках versionchange-транзакции.
// Ошибка в fn или в запросе курсора → регистрируется через onError и транзакция
// откатывается (версия данных не меняется).
function transformEachRecord(tx, storeName, fn, onError) {
  const store = tx.objectStore(storeName);
  const cursorReq = store.openCursor();
  cursorReq.onerror = () => { if (onError) onError(cursorReq.error); };
  cursorReq.onsuccess = (event) => {
    const cursor = event.target.result;
    if (!cursor) return;
    let updated;
    try {
      updated = fn(cursor.value);
    } catch (err) {
      if (onError) onError(err);
      try { tx.abort(); } catch { /* уже завершается */ }
      return;
    }
    if (updated !== undefined) cursor.update(updated);
    cursor.continue();
  };
}

// Применяет один шаг миграции в рамках versionchange-транзакции.
// `onError` вызывается при асинхронных ошибках курсора — тогда синхронный
// try/catch в onupgradeneeded их уже не поймает.
export function applyMigrationStep(db, tx, step, onError) {
  switch (step.type) {
    case 'addStore': {
      if (db.objectStoreNames.contains(step.name)) return;
      const store = db.createObjectStore(step.name, step.options || {});
      for (const idx of step.indexes || []) {
        store.createIndex(idx.name, idx.keyPath, idx.options || {});
      }
      return;
    }
    case 'addField': {
      transformEachRecord(tx, step.store, (record) => {
        if (record[step.field] === undefined) {
          record[step.field] = structuredClone(step.default);
        }
        return record;
      }, onError);
      return;
    }
    case 'renameField': {
      transformEachRecord(tx, step.store, (record) => {
        if (Object.prototype.hasOwnProperty.call(record, step.from)) {
          record[step.to] = record[step.from];
          delete record[step.from];
        }
        return record;
      }, onError);
      return;
    }
    case 'transformRecords': {
      transformEachRecord(tx, step.store, step.fn, onError);
      return;
    }
    default:
      throw new StorageError('migration_failed', `Неизвестный тип шага миграции: ${step.type}`);
  }
}
