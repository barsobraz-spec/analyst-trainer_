// core/db.js — слой хранилища прогресса на IndexedDB (T0.2).
//
// Единственная точка истины по версионированию/миграциям — PRD §4
// («Версионирование и миграции хранилища»). Здесь реализовано:
//   • схема v1 базового тренажера и v2 learning stores (T0.2.1);
//   • фреймворк последовательных миграций (addStore / addField /
//     renameField / transformRecords) в хуке onupgradeneeded;
//   • запрет «миграции вниз» (версия данных > версии приложения);
//   • откат транзакции при ошибке миграции + предложение «сырого» бэкапа;
//   • публичный CRUD-API для всех модулей.
//
// ES-модуль, импортируется как `import * as db from './core/db.js'`.

// --- Идентификация и версия хранилища ---------------------------------------

export const DB_NAME = 'analyst-trainer';

// Текущая версия схемы приложения. Увеличивается на 1 при каждом новом наборе
// миграций ниже. IndexedDB сам сравнивает её с версией данных в браузере.
export const APP_SCHEMA_VERSION = 5;

export const LEARNING_STORE_NAMES = Object.freeze([
  'learningSettings',
  'dailyProgress',
  'journalEntries',
  'taskProgress',
  'projectProgress',
  'careerApplications',
  'mockInterviewRuns',
  'monthlyExamProgress',
  'learningReminders',
  'learningMeta',
]);

export const RESERVED_LEARNING_STORE_NAMES = Object.freeze([]);

export const LEARNING_META_KEYS = Object.freeze({
  schemaVersion: 'learningSchemaVersion',
  contentVersion: 'learningContentVersion',
  lastOpenedSection: 'lastOpenedSection',
  lastBackupAt: 'lastBackupAt',
});

export const LEARNING_STATE_VERSION = 4;
export const DEFAULT_LEARNING_SETTINGS_KEY = 'current';

// --- Типизированная ошибка хранилища ----------------------------------------
// `code` — машинно-читаемый повод, `offerRawBackup` — нужно ли предлагать
// пользователю выгрузить «сырой» бэкап (PRD §4).

export class StorageError extends Error {
  constructor(code, message, { offerRawBackup = false, cause } = {}) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.offerRawBackup = offerRawBackup;
    if (cause) this.cause = cause;
  }
}

// --- Определение миграций ----------------------------------------------------
// Упорядоченный список. Каждый элемент — { version, steps }, где steps
// применяются последовательно при переходе на эту версию. Чтобы изменить
// схему — НЕ редактируем старые версии, а добавляем новую запись и поднимаем
// APP_SCHEMA_VERSION.
//
// Типы шагов:
//   { type:'addStore', name, options?, indexes?[] } — создать object store;
//   { type:'addField', store, field, default }       — добавить поле со
//                                                       значением по умолчанию;
//   { type:'renameField', store, from, to }           — переименовать поле;
//   { type:'transformRecords', store, fn }            — произвольное преобразование
//                                                       (fn(record) → record).

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
];

// --- Внутреннее: применение одного шага миграции ----------------------------
// addStore — синхронный DDL. Остальные шаги проходят по записям курсором
// внутри той же versionchange-транзакции. Любая брошенная ошибка всплывает
// наверх и приводит к abort() транзакции (откат, данные целы).

// `onError(err)` вызывается, если шаг падает АСИНХРОННО (внутри курсора): тогда
// синхронный try/catch в onupgradeneeded его уже не поймает, поэтому ошибку надо
// зарегистрировать здесь — иначе пользователь получит generic 'open_failed' вместо
// 'migration_failed' с предложением «сырого» бэкапа.
function applyMigrationStep(db, tx, step, onError) {
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

// Проходит курсором по всем записям store в рамках versionchange-транзакции,
// заменяя каждую результатом fn(record). Ошибка в fn или в самом запросе курсора →
// регистрируем через onError и откатываем транзакцию (версия данных не меняется).
// Запросы держат транзакцию открытой до завершения обхода.
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
      // Регистрируем ошибку и откатываем — версия данных не меняется.
      if (onError) onError(err);
      try { tx.abort(); } catch { /* уже завершается */ }
      return;
    }
    if (updated !== undefined) cursor.update(updated);
    cursor.continue();
  };
}

// --- Открытие БД с миграциями (T0.2.2, T0.2.3) ------------------------------

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, APP_SCHEMA_VERSION);
    } catch (err) {
      // Синхронно бросается VersionError, если версия данных выше требуемой.
      dbPromise = null;
      reject(classifyOpenError(err));
      return;
    }

    let migrationError = null;
    // Классифицирует и запоминает первую ошибку миграции — синхронную (из тела
    // onupgradeneeded) или асинхронную (из курсора transformEachRecord). Без этого
    // async-сбой дошёл бы до request.onerror как generic 'open_failed'.
    const failMigration = (err) => {
      if (migrationError) return; // первая ошибка важнее последующих каскадных
      migrationError = err instanceof StorageError
        ? err
        : new StorageError('migration_failed',
            'Не удалось обновить структуру данных. Исходные данные сохранены.',
            { offerRawBackup: true, cause: err });
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const tx = event.target.transaction; // versionchange-транзакция
      const oldVersion = event.oldVersion;
      try {
        for (const migration of MIGRATIONS) {
          if (migration.version > oldVersion && migration.version <= APP_SCHEMA_VERSION) {
            for (const step of migration.steps) applyMigrationStep(db, tx, step, failMigration);
          }
        }
      } catch (err) {
        failMigration(err);
        try { tx.abort(); } catch { /* уже завершается */ }
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Если кто-то параллельно попросит апгрейд — закрываемся, чтобы не блокировать.
      db.onversionchange = () => db.close();
      // Фиксируем версию схемы как данные (нужно экспорту/импорту, T2.1).
      persistSchemaVersion(db)
        .then(() => resolve(db))
        .catch(() => resolve(db)); // запись метаданных не критична для открытия
    };

    request.onerror = () => {
      dbPromise = null;
      if (migrationError) { reject(migrationError); return; }
      reject(classifyOpenError(request.error));
    };

    request.onblocked = () => {
      dbPromise = null;
      reject(new StorageError('open_blocked',
        'База занята другой вкладкой приложения. Закройте лишние вкладки и обновите страницу.'));
    };
  });

  return dbPromise;
}

function classifyOpenError(err) {
  if (err && err.name === 'VersionError') {
    return new StorageError('downgrade_blocked',
      'Данные сохранены более новой версией приложения. Обновите приложение — ' +
      'понижение версии не выполняется, чтобы не повредить данные.',
      { offerRawBackup: true, cause: err });
  }
  return new StorageError('open_failed',
    'Не удалось открыть локальное хранилище прогресса.',
    { cause: err });
}

function persistSchemaVersion(db) {
  const stores = Array.from(db.objectStoreNames);
  const txStores = stores.includes('learningMeta') ? ['meta', 'learningMeta'] : ['meta'];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(txStores, 'readwrite');
    tx.objectStore('meta').put({ key: 'schemaVersion', value: APP_SCHEMA_VERSION });
    if (txStores.includes('learningMeta')) {
      tx.objectStore('learningMeta').put({
        key: LEARNING_META_KEYS.schemaVersion,
        value: LEARNING_STATE_VERSION,
        updatedAt: Date.now(),
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new StorageError('tx_aborted', 'Транзакция отменена.'));
  });
}

// --- Низкоуровневые помощники над транзакциями ------------------------------

// Промисификация одиночного IDBRequest.
function runRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Выполнить операцию над store; резолвится по завершении транзакции (для
// readwrite это гарантирует, что данные записаны на диск).
async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new StorageError('tx_aborted', 'Транзакция отменена.'));
  });
}

// --- Публичный CRUD-API (T0.2.4) --------------------------------------------

// События прохождения (раздел 4 PRD). Ключ — eventId, пишется ровно один раз.
export function saveEvent(event) {
  if (!event || !event.eventId) {
    throw new StorageError('bad_input', 'Событие должно содержать eventId.');
  }
  return withStore('events', 'readwrite', (store) => runRequest(store.put(event)));
}

// Возвращает события, отсортированные по finishedAt по убыванию (свежие сверху).
// Фильтры module/caseId применяются через индексы; limit берёт первые N.
export async function getEvents({ module, caseId, limit } = {}) {
  const events = await withStore('events', 'readonly', (store) => {
    if (caseId !== undefined) return runRequest(store.index('caseId').getAll(caseId));
    if (module !== undefined) return runRequest(store.index('module').getAll(module));
    return runRequest(store.getAll());
  });

  // Если заданы оба фильтра — досеиваем второй в памяти.
  let rows = events;
  if (caseId !== undefined && module !== undefined) {
    rows = rows.filter((e) => e.module === module);
  }
  rows.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  return typeof limit === 'number' ? rows.slice(0, limit) : rows;
}

// Последнее (по времени завершения) событие по кейсу — для статуса/последнего score.
export async function getLastEvent(caseId) {
  const [last] = await getEvents({ caseId, limit: 1 });
  return last ?? null;
}

// Заметка-рефлексия по кейсу. Одна актуальная заметка на кейс (перезаписывается).
export function saveNote(caseId, text) {
  if (!caseId) throw new StorageError('bad_input', 'saveNote требует caseId.');
  const record = { caseId, text: String(text ?? ''), updatedAt: Date.now() };
  return withStore('notes', 'readwrite', (store) => runRequest(store.put(record)));
}

export async function getNote(caseId) {
  return (await withStore('notes', 'readonly', (store) => runRequest(store.get(caseId)))) ?? null;
}

// Пользовательский кейс (модуль 5.7). Ключ — caseId.
export function saveUserCase(obj) {
  if (!obj || !obj.caseId) {
    throw new StorageError('bad_input', 'Пользовательский кейс должен содержать caseId.');
  }
  return withStore('userCases', 'readwrite', (store) => runRequest(store.put(obj)));
}

export function getUserCases() {
  return withStore('userCases', 'readonly', (store) => runRequest(store.getAll()));
}

// Черновик незавершённого состояния кейса (статус «в процессе»). Один на кейс.
export function saveDraftState(caseId, state) {
  if (!caseId) throw new StorageError('bad_input', 'saveDraftState требует caseId.');
  const record = { caseId, state, updatedAt: Date.now() };
  return withStore('draftStates', 'readwrite', (store) => runRequest(store.put(record)));
}

export async function getDraftState(caseId) {
  const record = await withStore('draftStates', 'readonly', (store) => runRequest(store.get(caseId)));
  return record ? record.state : null;
}

// Все черновики разом — для навигатора курса (Sidebar) и сводки прогресса
// (core/progress.js), чтобы не делать по запросу на каждый кейс. Возвращает массив
// записей `{ caseId, state, updatedAt }`.
export function getAllDraftStates() {
  return withStore('draftStates', 'readonly', (store) => runRequest(store.getAll()));
}

// Удаление черновика — после финальной записи события кейс перестаёт быть «в процессе».
export function deleteDraftState(caseId) {
  return withStore('draftStates', 'readwrite', (store) => runRequest(store.delete(caseId)));
}

// --- Учебная система Data Analyst: пользовательское состояние (T0.2, T1.1) ---
//
// JSON из learning-plan/data остается источником контента. Здесь храним только
// состояние пользователя поверх этого контента: дату старта, отметки дня,
// дневник, статусы задач, проекты и карьерные отклики.

function now() {
  return Date.now();
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StorageError('bad_input', `${label} должен быть объектом.`);
  }
}

function assertId(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StorageError('bad_input', `${label} должен быть непустой строкой.`);
  }
}

function normalizeStatus(status, fallback = 'not_started') {
  return typeof status === 'string' && status.trim() ? status : fallback;
}

function makeId(prefix) {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function saveLearningSettings(settings) {
  assertObject(settings, 'Настройки обучения');
  const record = {
    key: settings.key || DEFAULT_LEARNING_SETTINGS_KEY,
    startDate: settings.startDate || '',
    scheduleMode: settings.scheduleMode || 'regular',
    dayMode: settings.dayMode || 'regular',
    skipStrategy: settings.skipStrategy || 'continue',
    preferences: settings.preferences && typeof settings.preferences === 'object'
      ? settings.preferences
      : {},
    updatedAt: now(),
  };
  return withStore('learningSettings', 'readwrite', (store) => runRequest(store.put(record)));
}

export async function getLearningSettings(key = DEFAULT_LEARNING_SETTINGS_KEY) {
  const record = await withStore('learningSettings', 'readonly', (store) => runRequest(store.get(key)));
  return record ?? null;
}

export function saveDailyProgress(dayProgress) {
  assertObject(dayProgress, 'Прогресс учебного дня');
  assertId(dayProgress.dayKey, 'dayKey');
  const record = {
    dayKey: dayProgress.dayKey,
    studyDay: Number.isFinite(dayProgress.studyDay) ? dayProgress.studyDay : null,
    mode: dayProgress.mode || 'regular',
    items: dayProgress.items && typeof dayProgress.items === 'object' ? dayProgress.items : {},
    skipStrategy: dayProgress.skipStrategy || null,
    completedAt: dayProgress.completedAt || null,
    updatedAt: now(),
  };
  return withStore('dailyProgress', 'readwrite', (store) => runRequest(store.put(record)));
}

export async function getDailyProgress(dayKey) {
  assertId(dayKey, 'dayKey');
  return (await withStore('dailyProgress', 'readonly', (store) => runRequest(store.get(dayKey)))) ?? null;
}

export function getAllDailyProgress() {
  return withStore('dailyProgress', 'readonly', (store) => runRequest(store.getAll()));
}

export function saveJournalEntry(entry) {
  assertObject(entry, 'Запись дневника');
  assertId(entry.dayKey, 'dayKey');
  const record = {
    dayKey: entry.dayKey,
    studyDay: Number.isFinite(entry.studyDay) ? entry.studyDay : null,
    did: String(entry.did ?? ''),
    learned: String(entry.learned ?? ''),
    stuck: String(entry.stuck ?? ''),
    updatedAt: now(),
  };
  return withStore('journalEntries', 'readwrite', (store) => runRequest(store.put(record)));
}

export async function getJournalEntry(dayKey) {
  assertId(dayKey, 'dayKey');
  return (await withStore('journalEntries', 'readonly', (store) => runRequest(store.get(dayKey)))) ?? null;
}

export function getAllJournalEntries() {
  return withStore('journalEntries', 'readonly', (store) => runRequest(store.getAll()));
}

export function saveTaskProgress(progress) {
  assertObject(progress, 'Прогресс задачи');
  assertId(progress.taskId, 'taskId');
  const record = {
    taskId: progress.taskId,
    status: normalizeStatus(progress.status),
    month: Number.isFinite(progress.month) ? progress.month : null,
    skill: progress.skill || null,
    notes: String(progress.notes ?? ''),
    updatedAt: now(),
  };
  return withStore('taskProgress', 'readwrite', (store) => runRequest(store.put(record)));
}

export async function getTaskProgress(taskId) {
  assertId(taskId, 'taskId');
  return (await withStore('taskProgress', 'readonly', (store) => runRequest(store.get(taskId)))) ?? null;
}

export function getAllTaskProgress() {
  return withStore('taskProgress', 'readonly', (store) => runRequest(store.getAll()));
}

export function getTaskProgressByStatus(status) {
  assertId(status, 'status');
  return withStore('taskProgress', 'readonly', (store) => runRequest(store.index('status').getAll(status)));
}

export function saveProjectProgress(progress) {
  assertObject(progress, 'Прогресс проекта');
  assertId(progress.projectId, 'projectId');
  const record = {
    projectId: progress.projectId,
    month: Number.isFinite(progress.month) ? progress.month : null,
    status: normalizeStatus(progress.status),
    githubUrl: String(progress.githubUrl ?? ''),
    readmeReady: Boolean(progress.readmeReady),
    screenshotsReady: Boolean(progress.screenshotsReady),
    videoDemoReady: Boolean(progress.videoDemoReady),
    notes: String(progress.notes ?? ''),
    qualityChecklist: progress.qualityChecklist && typeof progress.qualityChecklist === 'object'
      ? progress.qualityChecklist
      : {},
    updatedAt: now(),
  };
  return withStore('projectProgress', 'readwrite', (store) => runRequest(store.put(record)));
}

export async function getProjectProgress(projectId) {
  assertId(projectId, 'projectId');
  return (await withStore('projectProgress', 'readonly', (store) => runRequest(store.get(projectId)))) ?? null;
}

export function getAllProjectProgress() {
  return withStore('projectProgress', 'readonly', (store) => runRequest(store.getAll()));
}

export function saveCareerApplication(application) {
  assertObject(application, 'Отклик');
  const timestamp = now();
  const record = {
    applicationId: application.applicationId || makeId('application'),
    company: String(application.company ?? ''),
    role: String(application.role ?? application.vacancy ?? ''),
    vacancyUrl: String(application.vacancyUrl ?? ''),
    appliedAt: application.appliedAt || new Date(timestamp).toISOString().slice(0, 10),
    status: normalizeStatus(application.status, 'saved'),
    hasTestTask: Boolean(application.hasTestTask),
    feedback: String(application.feedback ?? ''),
    notes: String(application.notes ?? ''),
    createdAt: application.createdAt || timestamp,
    updatedAt: timestamp,
  };
  return withStore('careerApplications', 'readwrite', (store) => runRequest(store.put(record)))
    .then(() => record);
}

export async function updateCareerApplication(applicationId, patch) {
  assertId(applicationId, 'applicationId');
  assertObject(patch, 'Изменения отклика');
  const current = await getCareerApplication(applicationId);
  if (!current) {
    throw new StorageError('not_found', 'Отклик не найден.');
  }
  return saveCareerApplication({ ...current, ...patch, applicationId, createdAt: current.createdAt });
}

export async function getCareerApplication(applicationId) {
  assertId(applicationId, 'applicationId');
  return (await withStore('careerApplications', 'readonly', (store) => runRequest(store.get(applicationId)))) ?? null;
}

export function getAllCareerApplications() {
  return withStore('careerApplications', 'readonly', (store) => runRequest(store.getAll()));
}

export function deleteCareerApplication(applicationId) {
  assertId(applicationId, 'applicationId');
  return withStore('careerApplications', 'readwrite', (store) => runRequest(store.delete(applicationId)));
}

export function saveMockInterviewRun(run) {
  assertObject(run, 'Mock-интервью');
  const timestamp = now();
  const record = {
    runId: run.runId || makeId('mock'),
    date: run.date || new Date(timestamp).toISOString().slice(0, 10),
    result: normalizeStatus(run.result, 'planned'),
    durationMinutes: Number.isFinite(run.durationMinutes) ? run.durationMinutes : 60,
    sectionScores: run.sectionScores && typeof run.sectionScores === 'object'
      ? run.sectionScores
      : {},
    sectionNotes: run.sectionNotes && typeof run.sectionNotes === 'object'
      ? run.sectionNotes
      : {},
    rubricChecks: run.rubricChecks && typeof run.rubricChecks === 'object'
      ? run.rubricChecks
      : {},
    mistakesNotes: String(run.mistakesNotes ?? ''),
    actionPlan: String(run.actionPlan ?? ''),
    createdAt: run.createdAt || timestamp,
    updatedAt: timestamp,
  };
  return withStore('mockInterviewRuns', 'readwrite', (store) => runRequest(store.put(record)))
    .then(() => record);
}

export async function updateMockInterviewRun(runId, patch) {
  assertId(runId, 'runId');
  assertObject(patch, 'Изменения mock-интервью');
  const current = await getMockInterviewRun(runId);
  if (!current) {
    throw new StorageError('not_found', 'Запись mock-интервью не найдена.');
  }
  return saveMockInterviewRun({ ...current, ...patch, runId, createdAt: current.createdAt });
}

export async function getMockInterviewRun(runId) {
  assertId(runId, 'runId');
  return (await withStore('mockInterviewRuns', 'readonly', (store) => runRequest(store.get(runId)))) ?? null;
}

export function getAllMockInterviewRuns() {
  return withStore('mockInterviewRuns', 'readonly', (store) => runRequest(store.getAll()));
}

export function deleteMockInterviewRun(runId) {
  assertId(runId, 'runId');
  return withStore('mockInterviewRuns', 'readwrite', (store) => runRequest(store.delete(runId)));
}

export function saveLearningReminder(reminder) {
  assertObject(reminder, 'Напоминание');
  const timestamp = now();
  const record = {
    reminderId: reminder.reminderId || makeId('reminder'),
    scope: normalizeStatus(reminder.scope, 'today'),
    type: normalizeStatus(reminder.type, 'custom'),
    sourceId: String(reminder.sourceId ?? ''),
    title: String(reminder.title ?? '').trim(),
    detail: String(reminder.detail ?? '').trim(),
    href: String(reminder.href ?? ''),
    status: normalizeStatus(reminder.status, 'active'),
    createdAt: reminder.createdAt || timestamp,
    dismissedAt: reminder.dismissedAt || null,
    updatedAt: timestamp,
  };
  if (!record.title) {
    throw new StorageError('bad_input', 'У напоминания должен быть заголовок.');
  }
  return withStore('learningReminders', 'readwrite', (store) => runRequest(store.put(record)))
    .then(() => record);
}

export async function getLearningReminder(reminderId) {
  assertId(reminderId, 'reminderId');
  return (await withStore('learningReminders', 'readonly', (store) => runRequest(store.get(reminderId)))) ?? null;
}

export function getAllLearningReminders() {
  return withStore('learningReminders', 'readonly', (store) => runRequest(store.getAll()));
}

export function getLearningRemindersByStatus(status) {
  assertId(status, 'status');
  return withStore('learningReminders', 'readonly', (store) => runRequest(store.index('status').getAll(status)));
}

export async function dismissLearningReminder(reminderId) {
  assertId(reminderId, 'reminderId');
  const current = await getLearningReminder(reminderId);
  if (!current) {
    throw new StorageError('not_found', 'Напоминание не найдено.');
  }
  return saveLearningReminder({
    ...current,
    reminderId,
    status: 'dismissed',
    dismissedAt: now(),
    createdAt: current.createdAt,
  });
}

export function deleteLearningReminder(reminderId) {
  assertId(reminderId, 'reminderId');
  return withStore('learningReminders', 'readwrite', (store) => runRequest(store.delete(reminderId)));
}

export function saveMonthlyExamProgress(progress) {
  assertObject(progress, 'Прогресс экзамена месяца');
  const month = Number(progress.month);
  if (!Number.isInteger(month) || month < 1) {
    throw new StorageError('bad_input', 'month должен быть положительным номером месяца.');
  }
  const checks = progress.checks && typeof progress.checks === 'object'
    ? progress.checks
    : {};
  const record = {
    month,
    checks: Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, Boolean(value)])),
    notes: String(progress.notes ?? ''),
    completedAt: progress.completedAt || null,
    updatedAt: now(),
  };
  return withStore('monthlyExamProgress', 'readwrite', (store) => runRequest(store.put(record)))
    .then(() => record);
}

export async function getMonthlyExamProgress(month) {
  const key = Number(month);
  if (!Number.isInteger(key) || key < 1) {
    throw new StorageError('bad_input', 'month должен быть положительным номером месяца.');
  }
  return (await withStore('monthlyExamProgress', 'readonly', (store) => runRequest(store.get(key)))) ?? null;
}

export function getAllMonthlyExamProgress() {
  return withStore('monthlyExamProgress', 'readonly', (store) => runRequest(store.getAll()));
}

export function saveLearningMeta(key, value) {
  assertId(key, 'key');
  const record = { key, value, updatedAt: now() };
  return withStore('learningMeta', 'readwrite', (store) => runRequest(store.put(record)));
}

export async function getLearningMeta(key) {
  assertId(key, 'key');
  return (await withStore('learningMeta', 'readonly', (store) => runRequest(store.get(key)))) ?? null;
}

export function getAllLearningMeta() {
  return withStore('learningMeta', 'readonly', (store) => runRequest(store.getAll()));
}

// --- «Сырой» бэкап на случай несовместимой/сломанной миграции (PRD §4) ------
// Открывает БД в её ТЕКУЩЕЙ версии (без апгрейда) и выгружает все store как есть.
// Работает даже когда обычное открытие отклонено downgrade-блокировкой.

export function exportRawBackup() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME); // без версии — без onupgradeneeded
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const storeNames = Array.from(db.objectStoreNames);
      if (storeNames.length === 0) {
        db.close();
        resolve({ dbName: DB_NAME, version: db.version, stores: {} });
        return;
      }
      const tx = db.transaction(storeNames, 'readonly');
      const dump = { dbName: DB_NAME, version: db.version, stores: {} };
      let pending = storeNames.length;
      for (const name of storeNames) {
        const getAll = tx.objectStore(name).getAll();
        getAll.onsuccess = () => {
          dump.stores[name] = getAll.result;
          if (--pending === 0) { db.close(); resolve(dump); }
        };
        getAll.onerror = () => { db.close(); reject(getAll.error); };
      }
    };
  });
}

// --- Smoke-check для консоли (T0.2.5) ---------------------------------------
// Запускается вручную: import('./core/db.js').then(m => m.smokeTest())
// или через ?smoke=db (см. main.js). Пишет → читает → сверяет результат.

export async function smokeTest() {
  const caseId = `__smoke_${Date.now()}`;
  const event = {
    eventId: crypto.randomUUID(),
    module: '5.1',
    caseId,
    attemptNo: 1,
    startedAt: Date.now() - 1000,
    finishedAt: Date.now(),
    durationSec: 1,
    score: 87,
    skillTags: ['analytical-thinking'],
    selfAssessment: { accuracy: 90 },
    hintsUsed: 0,
    notes: 'smoke',
  };

  await saveEvent(event);
  await saveNote(caseId, 'заметка smoke');
  await saveDraftState(caseId, { step: 2, chain: ['a', 'b'] });
  await saveLearningSettings({ startDate: '2026-01-01', scheduleMode: 'regular' });
  await saveDailyProgress({
    dayKey: caseId,
    studyDay: 1,
    items: { task: true, journal: false },
  });
  await saveJournalEntry({
    dayKey: caseId,
    studyDay: 1,
    did: 'smoke',
    learned: 'storage',
    stuck: '',
  });
  await saveTaskProgress({
    taskId: caseId,
    status: 'repeat',
    month: 1,
    skill: 'sql',
  });
  await saveProjectProgress({
    projectId: caseId,
    month: 5,
    status: 'in_progress',
    githubUrl: 'https://example.test/repo',
    readmeReady: true,
    qualityChecklist: { business: true },
  });
  const application = await saveCareerApplication({
    applicationId: caseId,
    company: 'Smoke Inc',
    role: 'Data Analyst',
    status: 'applied',
  });
  const mock = await saveMockInterviewRun({
    runId: caseId,
    date: '2026-01-03',
    result: 'passed',
    durationMinutes: 75,
    sectionScores: { sql: 4 },
    sectionNotes: { sql: 'smoke' },
    rubricChecks: { plan: true },
    mistakesNotes: 'smoke',
  });
  const reminder = await saveLearningReminder({
    reminderId: caseId,
    scope: 'today',
    type: 'daily',
    title: 'Smoke reminder',
    detail: 'Вернуться к учебному дню',
    href: '#/learning/today',
  });
  const monthlyExam = await saveMonthlyExamProgress({
    month: 99,
    checks: { artifact: true, 'skill-sql': true },
    notes: 'smoke',
  });
  await saveLearningMeta('__smoke_meta', 'ok');

  const last = await getLastEvent(caseId);
  const draft = await getDraftState(caseId);
  const note = await getNote(caseId);
  const settings = await getLearningSettings();
  const day = await getDailyProgress(caseId);
  const journal = await getJournalEntry(caseId);
  const task = await getTaskProgress(caseId);
  const project = await getProjectProgress(caseId);
  const savedApplication = await getCareerApplication(application.applicationId);
  const savedMock = await getMockInterviewRun(mock.runId);
  const savedReminder = await getLearningReminder(reminder.reminderId);
  const savedMonthlyExam = await getMonthlyExamProgress(monthlyExam.month);
  const meta = await getLearningMeta('__smoke_meta');

  const ok = last?.eventId === event.eventId
    && last?.score === 87
    && draft?.step === 2
    && note?.text === 'заметка smoke'
    && settings?.startDate === '2026-01-01'
    && day?.items?.task === true
    && journal?.learned === 'storage'
    && task?.status === 'repeat'
    && project?.githubUrl.includes('example.test')
    && savedApplication?.company === 'Smoke Inc'
    && savedMock?.result === 'passed'
    && savedReminder?.status === 'active'
    && savedMonthlyExam?.checks?.artifact === true
    && meta?.value === 'ok';

  // Подчищаем тестовые записи.
  await withStore('events', 'readwrite', (s) => runRequest(s.delete(event.eventId)));
  await withStore('notes', 'readwrite', (s) => runRequest(s.delete(caseId)));
  await deleteDraftState(caseId);
  await withStore('learningSettings', 'readwrite', (s) => runRequest(s.delete(DEFAULT_LEARNING_SETTINGS_KEY)));
  await withStore('dailyProgress', 'readwrite', (s) => runRequest(s.delete(caseId)));
  await withStore('journalEntries', 'readwrite', (s) => runRequest(s.delete(caseId)));
  await withStore('taskProgress', 'readwrite', (s) => runRequest(s.delete(caseId)));
  await withStore('projectProgress', 'readwrite', (s) => runRequest(s.delete(caseId)));
  await deleteCareerApplication(caseId);
  await deleteMockInterviewRun(caseId);
  await deleteLearningReminder(caseId);
  await withStore('monthlyExamProgress', 'readwrite', (s) => runRequest(s.delete(monthlyExam.month)));
  await withStore('learningMeta', 'readwrite', (s) => runRequest(s.delete('__smoke_meta')));

  console[ok ? 'info' : 'error'](
    `[db.smokeTest] ${ok ? 'OK — запись/чтение работают' : 'FAIL — результат не совпал'}`,
    { last, draft, note, settings, day, journal, task, project, savedApplication, savedMock, savedReminder, savedMonthlyExam, meta },
  );
  return ok;
}
