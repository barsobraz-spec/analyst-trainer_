// core/backup.js — экспорт и импорт всего прогресса одним JSON-файлом (T1.2/T1.3).
//
// Единственная реализация резервного копирования (PRD §6 Ф5): выгрузка всего
// хранилища IndexedDB в файл и загрузка обратно. Все прочие упоминания
// экспорта/импорта (5.7 «свои кейсы», 5.8 Ф6, раздел 3) опираются на эти функции.
//
// Версионирование и миграции — по единому определению из db.js (PRD §4):
//   • при импорте данные последовательно мигрируют от версии файла к версии
//     приложения теми же шагами (addStore / addField / renameField / transformRecords);
//   • файл новее приложения отклоняется (запрет «миграции вниз»), данные целы;
//   • запись идёт одной транзакцией: при любой ошибке — откат (исходные данные
//     не повреждаются), пользователю предлагается «сырой» бэкап.
//
// Слой данных, без DOM (кроме triggerDownload — единственная точка скачивания).
// ES-модуль: `import { exportAll, parseBackupFile, importAll } from './core/backup.js'`.

import {
  openDB,
  DB_NAME,
  APP_SCHEMA_VERSION,
  MIGRATIONS,
  StorageError,
  getEvents,
  LEARNING_STORE_NAMES,
  LEARNING_STATE_VERSION,
  LEARNING_META_KEYS,
} from './db.js';

// Маркеры формата файла — чтобы отличить нашу резервную копию от произвольного JSON.
const BACKUP_APP_ID = 'analyst-trainer';
const BACKUP_TYPE = 'progress-backup';
const BACKUP_FORMAT_VERSION = 1;

// =====================  ЭКСПОРТ  =====================

// Собирает объект бэкапа из всех object stores уже открытой (т.е. мигрированной
// до текущей версии) БД. Возвращается чистый объект — сериализацию/скачивание
// делает exportAll, чтобы buildBackup можно было использовать и для снимков в тестах.
export async function buildBackup() {
  const db = await openDB();
  const storeNames = Array.from(db.objectStoreNames);
  const stores = await readAllStores(db, storeNames);
  const exportedAt = new Date().toISOString();
  return {
    app: BACKUP_APP_ID,
    type: BACKUP_TYPE,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: APP_SCHEMA_VERSION,
    meta: {
      exportedAt,
      dbName: DB_NAME,
      appSchemaVersion: APP_SCHEMA_VERSION,
      learningStateVersion: LEARNING_STATE_VERSION,
    },
    learning: {
      schemaVersion: LEARNING_STATE_VERSION,
      stores: LEARNING_STORE_NAMES,
    },
    exportedAt,
    stores,
  };
}

// Читает все указанные stores в одной readonly-транзакции → { [store]: records[] }.
function readAllStores(db, storeNames) {
  if (storeNames.length === 0) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readonly');
    const out = {};
    let pending = storeNames.length;
    for (const name of storeNames) {
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => {
        out[name] = req.result;
        if (--pending === 0) resolve(out);
      };
      req.onerror = () => reject(req.error);
    }
    tx.onabort = () => reject(tx.error
      || new StorageError('export_failed', 'Не удалось прочитать данные для экспорта.'));
  });
}

// Имя файла резервной копии: analyst-trainer-backup-YYYY-MM-DD.json.
export function backupFilename(date = new Date()) {
  return `${DB_NAME}-backup-${date.toISOString().slice(0, 10)}.json`;
}

// Полный экспорт: собрать бэкап, сериализовать, скачать файлом. Возвращает
// собранный объект (для статуса в UI и проверок).
export async function exportAll() {
  const backup = await buildBackup();
  triggerDownload(JSON.stringify(backup, null, 2), backupFilename());
  return backup;
}

// Единственное место, где модуль трогает DOM: инициирует скачивание Blob.
function triggerDownload(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Освобождаем URL после старта скачивания.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// =====================  ИМПОРТ  =====================

// Читает выбранный пользователем файл и разбирает JSON. Бросает StorageError
// с понятным сообщением, если файл нечитаем или это не JSON.
export async function parseBackupFile(file) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    throw new StorageError('bad_backup', 'Не удалось прочитать файл резервной копии.', { cause: err });
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new StorageError('bad_backup', 'Файл повреждён или это не JSON-копия Analyst Trainer.', { cause: err });
  }
}

// Импортирует разобранный объект бэкапа: валидация → миграции → атомарная
// замена (очистка + запись). Возвращает сводку { fromVersion, toVersion, counts }.
// При любой ошибке бросает StorageError; текущие данные не повреждаются.
export async function importAll(backup) {
  // 1. Структура файла.
  if (backup === null || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new StorageError('bad_backup', 'Файл резервной копии имеет неверную структуру.');
  }
  if (backup.app !== BACKUP_APP_ID || backup.type !== BACKUP_TYPE) {
    throw new StorageError('bad_backup', 'Файл создан другим приложением — это не резервная копия Analyst Trainer.');
  }
  if (backup.stores === null || typeof backup.stores !== 'object' || Array.isArray(backup.stores)) {
    throw new StorageError('bad_backup', 'В файле нет данных для импорта (раздел «stores» отсутствует).');
  }
  const fromVersion = backup.schemaVersion;
  if (typeof fromVersion !== 'number' || !Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new StorageError('bad_backup', 'В файле не указана корректная версия данных (schemaVersion).');
  }
  if (backup.formatVersion !== undefined
      && (!Number.isInteger(backup.formatVersion) || backup.formatVersion < 1)) {
    throw new StorageError('bad_backup', 'В файле указана некорректная версия формата резервной копии.');
  }
  if (backup.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new StorageError('downgrade_blocked',
      `Файл создан более новой версией экспорта (${backup.formatVersion}, ` +
      `приложение поддерживает ${BACKUP_FORMAT_VERSION}). Обновите приложение — импорт ` +
      'не выполняется, чтобы не повредить данные.');
  }

  // 2. Запрет «миграции вниз» (PRD §4): файл новее приложения не импортируем.
  if (fromVersion > APP_SCHEMA_VERSION) {
    throw new StorageError('downgrade_blocked',
      `Файл создан более новой версией приложения (версия данных ${fromVersion}, ` +
      `приложение поддерживает ${APP_SCHEMA_VERSION}). Обновите приложение — загрузка более ` +
      'новой копии не выполняется, чтобы не повредить данные.');
  }
  validateLearningEnvelope(backup.learning);

  validateStoreArrays(backup.stores);

  // 3. Последовательные миграции данных В ПАМЯТИ (исходный файл не трогаем).
  let migrated;
  try {
    migrated = migrateStores(deepClone(backup.stores), fromVersion);
  } catch (err) {
    throw err instanceof StorageError ? err : new StorageError('migration_failed',
      'Не удалось обновить структуру данных из файла. Текущие данные сохранены.',
      { offerRawBackup: true, cause: err });
  }

  // 4. Атомарная замена: очистка всех stores + запись, одной транзакцией.
  //    Ошибка на любом шаге → abort → откат, текущие данные остаются как были.
  const db = await openDB();
  const targetStores = Array.from(db.objectStoreNames);
  ensureTargetStores(migrated, targetStores);
  const counts = await replaceAllStores(db, targetStores, migrated);

  return { fromVersion, toVersion: APP_SCHEMA_VERSION, counts };
}

// Применяет шаги миграций к простым массивам записей. Зеркало applyMigrationStep
// из db.js, но для данных импорта (PRD §4: миграции выполняются и при открытии
// БД, и при импорте — одним и тем же набором определений MIGRATIONS).
function migrateStores(stores, fromVersion) {
  for (const migration of MIGRATIONS) {
    if (migration.version > fromVersion && migration.version <= APP_SCHEMA_VERSION) {
      for (const step of migration.steps) applyImportStep(stores, step);
    }
  }
  return stores;
}

function applyImportStep(stores, step) {
  switch (step.type) {
    case 'addStore':
      if (!Array.isArray(stores[step.name])) stores[step.name] = [];
      return;
    case 'addField':
      for (const rec of stores[step.store] || []) {
        if (rec[step.field] === undefined) rec[step.field] = deepClone(step.default);
      }
      return;
    case 'renameField':
      for (const rec of stores[step.store] || []) {
        if (Object.prototype.hasOwnProperty.call(rec, step.from)) {
          rec[step.to] = rec[step.from];
          delete rec[step.from];
        }
      }
      return;
    case 'transformRecords':
      stores[step.store] = (stores[step.store] || []).map(step.fn);
      return;
    default:
      throw new StorageError('migration_failed', `Неизвестный тип шага миграции: ${step.type}`);
  }
}

function validateStoreArrays(stores) {
  for (const [name, records] of Object.entries(stores)) {
    if (!Array.isArray(records)) {
      throw new StorageError('bad_backup',
        `Раздел «stores.${name}» повреждён: ожидается массив записей.`);
    }
  }
}

function validateLearningEnvelope(learning) {
  if (learning === undefined) return;
  if (learning === null || typeof learning !== 'object' || Array.isArray(learning)) {
    throw new StorageError('bad_backup', 'Раздел «learning» должен быть объектом.');
  }

  const version = learning.schemaVersion;
  if (!Number.isInteger(version) || version < 1) {
    throw new StorageError('bad_backup', 'В разделе «learning» указана некорректная версия данных.');
  }
  if (version > LEARNING_STATE_VERSION) {
    throw new StorageError('downgrade_blocked',
      `Файл содержит учебные данные более новой версии (${version}, ` +
      `приложение поддерживает ${LEARNING_STATE_VERSION}). Обновите приложение — импорт ` +
      'не выполняется, чтобы не повредить данные.');
  }

  if (learning.stores !== undefined) {
    if (!Array.isArray(learning.stores) || learning.stores.some((name) => typeof name !== 'string')) {
      throw new StorageError('bad_backup', 'Раздел «learning.stores» должен быть массивом строк.');
    }
  }
}

function ensureTargetStores(stores, targetStores) {
  for (const name of targetStores) {
    if (stores[name] === undefined) stores[name] = [];
  }
}

// Очищает все целевые stores и записывает данные бэкапа одной readwrite-транзакцией.
// meta.schemaVersion принудительно ставится в текущую версию (после миграций данные
// уже приведены к ней). Промис реджектится при abort/onerror — вызывающий узнает об
// откате; данные при этом не повреждены.
function replaceAllStores(db, storeNames, stores) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    const counts = {};
    let failure = null;

    tx.oncomplete = () => resolve(counts);
    tx.onerror = () => {
      failure = failure || tx.error
        || new StorageError('import_failed', 'Не удалось записать импортируемые данные.', { offerRawBackup: true });
    };
    tx.onabort = () => reject(failure || tx.error
      || new StorageError('import_failed', 'Импорт отменён, исходные данные сохранены.', { offerRawBackup: true }));

    // put() с некорректной записью (например, без ключа keyPath) бросает DataError
    // СИНХРОННО и НЕ прерывает транзакцию автоматически — без явного abort() уже
    // выполненные clear() закоммитились бы и стёрли данные. Поэтому ловим синхронный
    // сбой и откатываем транзакцию: исходные данные остаются нетронутыми (PRD §4).
    try {
      for (const name of storeNames) {
        const store = tx.objectStore(name);
        store.clear();
        const records = Array.isArray(stores[name]) ? stores[name] : [];
        for (const rec of records) store.put(rec);
        counts[name] = records.length;
      }
      if (storeNames.includes('meta')) {
        tx.objectStore('meta').put({ key: 'schemaVersion', value: APP_SCHEMA_VERSION });
      }
      if (storeNames.includes('learningMeta')) {
        tx.objectStore('learningMeta').put({
          key: LEARNING_META_KEYS.schemaVersion,
          value: LEARNING_STATE_VERSION,
          updatedAt: Date.now(),
        });
      }
    } catch (err) {
      failure = err instanceof StorageError ? err : new StorageError('import_failed',
        'Импорт прерван: хранилище отклонило запись. Исходные данные сохранены.',
        { offerRawBackup: true, cause: err });
      try { tx.abort(); } catch { /* транзакция уже завершается */ }
    }
  });
}

function deepClone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

// =====================  SMOKE-CHECK  =====================
// Запуск: ?smoke=backup (см. main.js). БЕЗОПАСЕН: снимает текущее состояние,
// гоняет круг импорта на синтетических данных, проверяет запрет downgrade, затем
// ВОССТАНАВЛИВАЕТ исходные данные пользователя (в finally). Импорт заменяет всё
// хранилище, поэтому без восстановления тест уничтожил бы реальный прогресс.
export async function smokeTest() {
  const snapshot = await buildBackup();
  let ok = false;
  try {
    const probeId = `__smoke_backup_${Date.now()}`;
    const synthetic = {
      app: BACKUP_APP_ID,
      type: BACKUP_TYPE,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: APP_SCHEMA_VERSION,
      learning: {
        schemaVersion: LEARNING_STATE_VERSION,
        stores: LEARNING_STORE_NAMES,
      },
      exportedAt: new Date().toISOString(),
      stores: {
        events: [{
          eventId: probeId, module: '5.1', caseId: probeId, attemptNo: 1,
          startedAt: 0, finishedAt: 1000, durationSec: 1, score: 42,
          skillTags: ['analytical-thinking'], selfAssessment: {}, hintsUsed: 0, notes: 'smoke',
        }],
        learningSettings: [{
          key: 'current',
          startDate: '2026-01-01',
          scheduleMode: 'regular',
          dayMode: 'minimal',
          skipStrategy: 'continue',
          preferences: {},
          updatedAt: 1,
        }],
        dailyProgress: [{
          dayKey: probeId,
          studyDay: 3,
          mode: 'minimal',
          items: { task: true, journal: false },
          skipStrategy: null,
          completedAt: null,
          updatedAt: 1,
        }],
        journalEntries: [{
          dayKey: probeId,
          studyDay: 3,
          did: 'Сделал smoke-задачу',
          learned: 'Импорт восстанавливает дневник',
          stuck: '',
          updatedAt: 1,
        }],
        taskProgress: [{
          taskId: probeId,
          status: 'repeat',
          month: 1,
          skill: 'sql',
          notes: 'smoke',
          updatedAt: 1,
        }],
        projectProgress: [{
          projectId: probeId,
          month: 5,
          status: 'in_progress',
          githubUrl: 'https://example.test/repo',
          readmeReady: true,
          screenshotsReady: false,
          videoDemoReady: false,
          notes: 'smoke',
          qualityChecklist: { business: true },
          updatedAt: 1,
        }],
        careerApplications: [{
          applicationId: probeId,
          company: 'Smoke Inc',
          role: 'Data Analyst',
          vacancyUrl: '',
          appliedAt: '2026-01-02',
          status: 'interview',
          hasTestTask: true,
          feedback: '',
          notes: 'smoke',
          createdAt: 1,
          updatedAt: 1,
        }],
        mockInterviewRuns: [{
          runId: probeId,
          date: '2026-01-03',
          result: 'passed',
          durationMinutes: 75,
          sectionScores: { 'sql-live': 4 },
          sectionNotes: { 'sql-live': 'smoke' },
          rubricChecks: { 'rubric-1': true },
          mistakesNotes: 'smoke',
          actionPlan: 'Повторить SQL live.',
          createdAt: 1,
          updatedAt: 1,
        }],
        learningReminders: [{
          reminderId: probeId,
          scope: 'today',
          type: 'daily',
          sourceId: 'learning-today',
          title: 'Smoke reminder',
          detail: 'Вернуться к учебному дню',
          href: '#/learning/today',
          status: 'active',
          createdAt: 1,
          dismissedAt: null,
          updatedAt: 1,
        }],
        monthlyExamProgress: [{
          month: 1,
          checks: {
            'skill-sql': true,
            artifact: true,
          },
          notes: 'smoke',
          completedAt: null,
          updatedAt: 1,
        }],
        learningMeta: [{
          key: LEARNING_META_KEYS.contentVersion,
          value: 'smoke',
          updatedAt: 1,
        }],
      },
    };

    await importAll(synthetic);
    const got = await getEvents({ caseId: probeId });
    const replaced = got.length === 1 && got[0].score === 42;
    const restored = await buildBackup();
    const learningRestored = LEARNING_STORE_NAMES.every((storeName) => {
      const records = restored.stores[storeName];
      return Array.isArray(records) && records.length >= 1;
    });

    // Запрет downgrade: файл версии выше приложения/learning-слоя должен отклоняться.
    let appBlocked = false;
    try {
      await importAll({ ...synthetic, schemaVersion: APP_SCHEMA_VERSION + 1 });
    } catch (err) {
      appBlocked = err.code === 'downgrade_blocked';
    }

    let learningBlocked = false;
    try {
      await importAll({
        ...synthetic,
        learning: { ...synthetic.learning, schemaVersion: LEARNING_STATE_VERSION + 1 },
      });
    } catch (err) {
      learningBlocked = err.code === 'downgrade_blocked';
    }

    // Атомарность: ошибка записи не должна стереть уже существующий прогресс.
    let atomic = false;
    try {
      await importAll({
        ...synthetic,
        stores: { events: [{ module: '5.1', caseId: '__broken__' }] },
      });
    } catch (err) {
      const afterBrokenImport = await getEvents({ caseId: probeId });
      atomic = err.code === 'import_failed'
        && afterBrokenImport.length === 1
        && afterBrokenImport[0].score === 42;
    }

    ok = replaced && learningRestored && appBlocked && learningBlocked && atomic;
  } finally {
    // Возвращаем исходные данные пользователя при любом исходе.
    await importAll(snapshot).catch((err) => {
      console.error('[backup.smokeTest] не удалось восстановить исходные данные', err);
    });
  }

  console[ok ? 'info' : 'error'](
    `[backup.smokeTest] ${ok ? 'OK — импорт восстанавливает learning stores, downgrade блокируется, ошибка откатывается' : 'FAIL'}`,
  );
  return ok;
}
