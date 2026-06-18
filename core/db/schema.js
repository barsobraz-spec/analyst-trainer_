// core/db/schema.js — константы схемы и типизированная ошибка хранилища.
// Импортируется db.js (фасад) и db/migrations.js.

export const DB_NAME = 'analyst-trainer';

// Текущая версия схемы приложения. Увеличивается на 1 при каждом новом наборе
// миграций. IndexedDB сам сравнивает её с версией данных в браузере.
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
