// core/caseLoader.js — загрузка манифеста и кейсов с валидацией (T0.3.2).
//
// Реализует PRD §6 Ф6 (манифест cases/index.json) и Ф7 (валидация при загрузке).
// Ключевой инвариант: ОДИН плохой кейс не ломает каталог. Любая ошибка (сеть,
// размер, парсинг, схема) превращается в объект-ошибку через markCaseError —
// исключения наружу не пробрасываются.
//
// Размер файла проверяется ДО парсинга (PRD §3, лимит датасетов): сначала читаем
// тело как Blob и сверяем blob.size с MAX_DATASET_BYTES, и только потом JSON.parse.
//
// ES-модуль: `import { loadAllCases, loadCase } from './core/caseLoader.js'`.

import { MAX_DATASET_BYTES } from '../config.js';
import { validateCase, markCaseError, ERROR_CODES } from './caseValidator.js';

// Путь манифеста относительно корня приложения (там же, где index.html).
export const INDEX_PATH = 'cases/index.json';

// --- Манифест кейсов (PRD §6 Ф6) ---------------------------------------------
// Читает cases/index.json и возвращает массив записей-метаданных. Допускает оба
// формата верхнего уровня: массив записей или объект `{ cases: [...] }`.
// Записи без обязательных метаданных помечаются ошибкой, но не отбрасываются —
// чтобы каталог показал их как «битый кейс», а не молча пропустил.
export async function loadIndex() {
  let raw;
  try {
    const resp = await fetch(INDEX_PATH, { cache: 'no-cache' });
    if (!resp.ok) {
      return { entries: [], error: `Не удалось загрузить манифест кейсов (HTTP ${resp.status}).` };
    }
    raw = await resp.json();
  } catch (err) {
    return { entries: [], error: `Манифест кейсов недоступен или повреждён: ${err.message}` };
  }

  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.cases) ? raw.cases : null;
  if (!list) {
    return { entries: [], error: 'Манифест кейсов имеет неверную структуру (ожидается массив записей).' };
  }

  const entries = list.map(normalizeIndexEntry);
  return { entries, error: null };
}

// Проверяет запись манифеста на наличие { caseId, module, path, title, difficulty }.
// Возвращает либо валидную запись, либо объект-ошибку (для отображения в каталоге).
function normalizeIndexEntry(entry) {
  const required = ['caseId', 'module', 'path', 'title', 'difficulty'];
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return markCaseError({}, ERROR_CODES.SCHEMA_INVALID, 'Запись манифеста не является объектом.');
  }
  const missing = required.filter((f) => typeof entry[f] !== 'string' || entry[f].trim() === '');
  if (missing.length > 0) {
    return markCaseError(entry, ERROR_CODES.SCHEMA_INVALID,
      `в записи манифеста отсутствуют поля: ${missing.join(', ')}`);
  }
  return entry;
}

// --- Загрузка одного кейса по пути (T0.3.2) ----------------------------------
// Возвращает:
//   • при успехе — `{ ok: true, case }` (полный объект кейса);
//   • при ошибке — `{ ok: false, errorCode, errorDetail }`.
// `meta` (запись манифеста) пробрасывается в валидатор для сверки caseId.
export async function loadCase(path, meta = {}) {
  let blob;
  try {
    const resp = await fetch(path, { cache: 'no-cache' });
    if (!resp.ok) {
      return validatorFail(ERROR_CODES.LOAD_FAILED, `файл кейса недоступен (HTTP ${resp.status})`);
    }
    blob = await resp.blob();
  } catch (err) {
    return validatorFail(ERROR_CODES.LOAD_FAILED, `не удалось загрузить файл кейса: ${err.message}`);
  }

  // Проверка размера ДО парсинга (PRD §3): защищаем вкладку от гигантских файлов.
  if (blob.size > MAX_DATASET_BYTES) {
    return validatorFail(ERROR_CODES.DATASET_TOO_LARGE,
      `размер файла ${blob.size} Б превышает лимит ${MAX_DATASET_BYTES} Б`);
  }

  let raw;
  try {
    raw = JSON.parse(await blob.text());
  } catch (err) {
    return validatorFail(ERROR_CODES.SCHEMA_INVALID, `файл кейса не является корректным JSON: ${err.message}`);
  }

  return validateCase(raw, meta);
}

// --- Загрузка датасета кейса (T6.3.3, для модуля 5.5 SQL) ---------------------
// Датасет SQL-кейса лежит отдельным файлом (cases/datasets/…). Грузим его так же
// бережно, как кейс: проверяем размер ДО парсинга (PRD §3/§5.5 — большой датасет
// помечается ошибкой контента, а не «вешает» вкладку). Возвращает
// `{ ok:true, dataset }` либо `{ ok:false, errorCode, errorDetail }`.
export async function loadDataset(path) {
  let blob;
  try {
    const resp = await fetch(path, { cache: 'no-cache' });
    if (!resp.ok) {
      return validatorFail(ERROR_CODES.LOAD_FAILED, `датасет недоступен (HTTP ${resp.status})`);
    }
    blob = await resp.blob();
  } catch (err) {
    return validatorFail(ERROR_CODES.LOAD_FAILED, `не удалось загрузить датасет: ${err.message}`);
  }

  if (blob.size > MAX_DATASET_BYTES) {
    return validatorFail(ERROR_CODES.DATASET_TOO_LARGE,
      `размер датасета ${blob.size} Б превышает лимит ${MAX_DATASET_BYTES} Б`);
  }

  try {
    return { ok: true, dataset: JSON.parse(await blob.text()) };
  } catch (err) {
    return validatorFail(ERROR_CODES.SCHEMA_INVALID, `датасет не является корректным JSON: ${err.message}`);
  }
}

// --- Загрузка всего каталога (PRD §6 Ф6/Ф7) ----------------------------------
// Читает манифест и загружает каждый кейс параллельно. Возвращает массив записей
// для каталога, где каждый элемент — либо успешно провалидированный кейс со
// `status: 'ok'`, либо объект-ошибка со `status: 'error'`. Метаданные манифеста
// (caseId, module, path, title, difficulty) сохраняются в обоих случаях, чтобы
// ошибочный кейс всё равно был виден в списке с понятной причиной.
//
// Опция `module` (например '5.1') ограничивает выборку кейсами одного модуля —
// список кейсов модуля (T1.2) не должен грузить файлы остальных модулей.
export async function loadAllCases({ module } = {}) {
  const { entries: allEntries, error: indexError } = await loadIndex();

  const entries = module === undefined
    ? allEntries
    : allEntries.filter((entry) => entry.module === module);

  const cases = await Promise.all(entries.map(async (entry) => {
    // Запись манифеста уже помечена ошибкой (неполные метаданные) — не грузим файл.
    if (entry.status === 'error') return entry;

    const result = await loadCase(entry.path, entry);
    if (result.ok) {
      // Метаданные манифеста + полный кейс; status:'ok' для единообразия каталога.
      return { ...entry, ...result.case, status: 'ok' };
    }
    return markCaseError(entry, result.errorCode, result.errorDetail);
  }));

  return { cases, indexError };
}

function validatorFail(errorCode, errorDetail) {
  return { ok: false, errorCode, errorDetail };
}

// --- Smoke-check для консоли (по аналогии с db.smokeTest) --------------------
// Запуск: открыть страницу с ?smoke=cases (см. main.js). Грузит каталог и
// проверяет, что валидный кейс получает status:'ok', а битый — status:'error'
// с ожидаемым errorCode.
export async function smokeTest() {
  const { cases, indexError } = await loadAllCases();
  if (indexError) {
    console.error('[caseLoader.smokeTest] FAIL — манифест не загрузился:', indexError);
    return false;
  }

  const ok = cases.find((c) => c.caseId === 'detective-001');
  const broken = cases.find((c) => c.caseId === '_test-broken');

  const pass =
    !!ok && ok.status === 'ok' &&
    !!broken && broken.status === 'error' && broken.errorCode === ERROR_CODES.INVALID_TAG;

  console[pass ? 'info' : 'error'](
    `[caseLoader.smokeTest] ${pass ? 'OK — валидный кейс загружен, битый помечен' : 'FAIL — результат не совпал'}`,
    { total: cases.length, ok, broken },
  );
  return pass;
}
