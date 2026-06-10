// core/caseValidator.js — валидация общей части кейса (T0.3.3, T0.3.5).
//
// Единая точка истины по «ошибке контента» — PRD §6 Ф7. Валидируется ТОЛЬКО
// общий каркас кейса (PRD §4, «JSON-схема кейса»); модуль-специфичный `payload`
// проверяют сами модули при открытии. Валидатор НИКОГДА не бросает исключение
// на данных кейса — он возвращает либо «ок», либо объект-ошибку, чтобы один
// плохой кейс не ломал каталог.
//
// ES-модуль: `import { validateCase, markCaseError, ERROR_CODES } from './core/caseValidator.js'`.

import { isKnownTag } from './skillTags.js';
import { CASE_MODULES } from './modules.js';

// --- Машинно-читаемые коды ошибок контента (PRD §6 Ф7, T0.3) -----------------
export const ERROR_CODES = Object.freeze({
  SCHEMA_INVALID: 'schema_invalid',      // битая структура / отсутствуют поля / неверные типы
  UNKNOWN_MODULE: 'unknown_module',      // module не из списка обучающих модулей
  INVALID_TAG: 'invalid_tag',            // тег вне закрытого словаря skillTags
  DATASET_TOO_LARGE: 'dataset_too_large',// размер файла кейса > MAX_DATASET_BYTES (ставит loader)
  LOAD_FAILED: 'load_failed',            // не удалось получить файл (404/сеть/битый JSON)
});

// Производится из реестра modules.js: hasCases:true → допустимый module в кейсе.
// Добавление нового модуля в MODULES автоматически расширяет этот набор.
const KNOWN_CASE_MODULES = new Set(CASE_MODULES.map((m) => m.id));

const DIFFICULTIES = new Set(['basic', 'intermediate', 'advanced']);

// --- Построение объекта-ошибки кейса (T0.3.5) --------------------------------
// Возвращает запись для каталога: метаданные кейса + признак ошибки. `meta` —
// запись манифеста (`{ caseId, module, path, title, difficulty }`) либо то, что
// удалось распарсить из самого файла. Каталог по этому объекту покажет кейс как
// ошибочный (с причиной), но не даст его открыть (PRD §6 Ф2/Ф7).
export function markCaseError(meta, code, detail) {
  return {
    ...(meta || {}),
    status: 'error',
    errorCode: code,
    errorDetail: detail,
  };
}

// --- Валидация общей части кейса (T0.3.3) ------------------------------------
// Принимает уже распарсенный объект `raw` и опциональные `meta` из манифеста
// (для подмешивания в объект-ошибку и сверки caseId). Возвращает:
//   • при успехе — `{ ok: true, case: raw }`;
//   • при ошибке — `{ ok: false, errorCode, errorDetail }`.
// Размер датасета (dataset_too_large) проверяется раньше, в caseLoader, до парсинга.
export function validateCase(raw, meta = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail(ERROR_CODES.SCHEMA_INVALID, 'Кейс не является JSON-объектом.');
  }

  // 1. Обязательные поля и их типы (PRD §4, «JSON-схема кейса»).
  const problems = [];
  checkType(problems, raw, 'caseId', 'string');
  checkType(problems, raw, 'module', 'string');
  checkType(problems, raw, 'schemaVersion', 'number');
  checkType(problems, raw, 'title', 'string');
  checkType(problems, raw, 'difficulty', 'string');
  if (!Array.isArray(raw.skillTags)) {
    problems.push('поле «skillTags» отсутствует или не является массивом');
  }
  if (raw.payload === null || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) {
    problems.push('поле «payload» отсутствует или не является объектом');
  }
  if (problems.length > 0) {
    return fail(ERROR_CODES.SCHEMA_INVALID, problems.join('; '));
  }

  // 2. difficulty — из закрытого перечня (PRD §4 / §6 Ф3).
  if (!DIFFICULTIES.has(raw.difficulty)) {
    return fail(ERROR_CODES.SCHEMA_INVALID,
      `неизвестная сложность «${raw.difficulty}» (ожидается basic/intermediate/advanced)`);
  }

  // 3. caseId должен совпадать с записью в манифесте (PRD §4: «совпадает с index.json»).
  if (meta.caseId !== undefined && raw.caseId !== meta.caseId) {
    return fail(ERROR_CODES.SCHEMA_INVALID,
      `caseId в файле («${raw.caseId}») не совпадает с записью в index.json («${meta.caseId}»)`);
  }

  // 4. module — из списка обучающих модулей (PRD §5).
  if (!KNOWN_CASE_MODULES.has(raw.module)) {
    return fail(ERROR_CODES.UNKNOWN_MODULE, `неизвестный модуль «${raw.module}»`);
  }

  // 5. Все skillTags — из закрытого словаря (PRD §4).
  const unknownTags = raw.skillTags.filter((t) => !isKnownTag(t));
  if (unknownTags.length > 0) {
    return fail(ERROR_CODES.INVALID_TAG, `неизвестные теги навыков: ${unknownTags.join(', ')}`);
  }
  if (raw.skillTags.length === 0) {
    return fail(ERROR_CODES.SCHEMA_INVALID, 'поле «skillTags» не должно быть пустым');
  }

  return { ok: true, case: raw };
}

// --- Внутренние помощники ----------------------------------------------------

function fail(errorCode, errorDetail) {
  return { ok: false, errorCode, errorDetail };
}

// Проверяет, что поле присутствует и имеет нужный примитивный тип; для строк
// дополнительно требует непустое значение (пустой title/caseId — тоже дефект).
function checkType(problems, obj, field, type) {
  const value = obj[field];
  if (value === undefined || value === null) {
    problems.push(`поле «${field}» отсутствует`);
    return;
  }
  if (typeof value !== type) {
    problems.push(`поле «${field}» имеет неверный тип (ожидается ${type})`);
    return;
  }
  if (type === 'string' && value.trim() === '') {
    problems.push(`поле «${field}» пустое`);
    return;
  }
  if (type === 'number' && !Number.isFinite(value)) {
    problems.push(`поле «${field}» не является конечным числом`);
  }
}
