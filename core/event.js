// core/event.js — модель события прохождения и финальная запись прогресса (T1.3).
//
// Единая точка истины по формату события — PRD §4 («Модель события прохождения»,
// «Нормализация score», «Политика повторного прохождения»). Здесь реализовано:
//   • createEvent(params)     — собрать полное событие со всеми полями;
//   • getAttemptNo(caseId)    — номер попытки = число прежних событий по кейсу + 1;
//   • normalizeScore(...)     — привести авто/самооценку к шкале 0–100;
//   • saveAndFinalize(params) — записать событие ровно один раз и снять статус
//                               «в процессе» (удалить черновик).
//
// Все модули (5.1–5.7) финализируют попытку через saveAndFinalize, поэтому формат
// события не расходится между ними, а Learning Analytics (5.8) агрегирует единый
// набор полей.
//
// ES-модуль: `import { createEvent, saveAndFinalize, getAttemptNo, normalizeScore }
//             from './core/event.js'`.

import { DURATION_CAP_SEC, W_AUTO, W_SELF } from '../config.js';
import { getEvents, saveEvent, deleteDraftState, openDB, StorageError } from './db.js';

// --- Номер попытки (T1.3.2) --------------------------------------------------
// Политика повторного прохождения (PRD §4): каждая попытка — отдельное событие;
// attemptNo нумеруется по этому кейсу с 1. Считаем по уже записанным событиям.
export async function getAttemptNo(caseId) {
  if (!caseId) throw new StorageError('bad_input', 'getAttemptNo требует caseId.');
  const prior = await getEvents({ caseId });
  return prior.length + 1;
}

// --- Нормализация score (T1.3.3, PRD §4 «Нормализация score») ----------------
// Приводит результат к целому 0–100. На вход — ДОЛИ в диапазоне 0..1:
//   • autoFraction — доля верно решённых авто-проверяемых подзадач (или null/undefined,
//     если авто-части нет — модули 5.1/5.2/5.4/5.7);
//   • selfFraction — самооценка текстовой части в долях (или null/undefined, если
//     текстовой части нет).
// Правила (PRD §4):
//   • нет авто-задач  → selfFraction · 100;
//   • нет текстовой части → autoFraction · 100;
//   • иначе → (w_auto · autoFraction + w_self · selfFraction) · 100.
// Веса по умолчанию берутся из config.js (W_AUTO = W_SELF = 0.5).
export function normalizeScore(autoFraction, selfFraction, weights = {}) {
  const wAuto = Number.isFinite(weights.wAuto) ? weights.wAuto : W_AUTO;
  const wSelf = Number.isFinite(weights.wSelf) ? weights.wSelf : W_SELF;

  const hasAuto = isFraction(autoFraction);
  const hasSelf = isFraction(selfFraction);

  let fraction;
  if (!hasAuto && !hasSelf) {
    fraction = 0; // нечего оценивать — защитный ноль, не NaN
  } else if (!hasAuto) {
    fraction = selfFraction;
  } else if (!hasSelf) {
    fraction = autoFraction;
  } else {
    fraction = wAuto * autoFraction + wSelf * selfFraction;
  }

  return clampScore(fraction * 100);
}

function isFraction(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Итог приводим к целому 0–100: события хранят score в этой шкале (PRD §4),
// статистика и Learning Analytics на это рассчитывают.
export function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

// --- Зачтённое время попытки (PRD §4) ----------------------------------------
// durationSec = min(finishedAt − startedAt, DURATION_CAP_SEC). Отрицательную
// разницу (рассинхрон часов/некорректный ввод) обрезаем нулём — защита статистики.
export function computeDurationSec(startedAt, finishedAt) {
  const elapsedMs = (finishedAt ?? 0) - (startedAt ?? 0);
  const elapsedSec = Math.max(0, Math.round(elapsedMs / 1000));
  return Math.min(elapsedSec, DURATION_CAP_SEC);
}

// --- Сборка события (T1.3.1) -------------------------------------------------
// Чистый билдер: собирает полное событие со всеми полями PRD §4. attemptNo
// передаётся снаружи (его считает getAttemptNo); если не передан — ставим 1,
// но saveAndFinalize всегда подставляет реальный номер.
export function createEvent(params = {}) {
  const {
    module,
    caseId,
    attemptNo = 1,
    startedAt,
    finishedAt = Date.now(),
    score,
    skillTags = [],
    selfAssessment = null,
    hintsUsed = 0,
    notes = '',
  } = params;

  if (!module) throw new StorageError('bad_input', 'createEvent требует module.');
  if (!caseId) throw new StorageError('bad_input', 'createEvent требует caseId.');
  if (!Number.isFinite(startedAt)) {
    throw new StorageError('bad_input', 'createEvent требует startedAt (timestamp).');
  }

  return {
    eventId: crypto.randomUUID(),
    module,
    caseId,
    attemptNo,
    startedAt,
    finishedAt,
    durationSec: computeDurationSec(startedAt, finishedAt),
    score: clampScore(score),
    skillTags: Array.isArray(skillTags) ? [...skillTags] : [],
    selfAssessment: selfAssessment ?? null,
    hintsUsed: Number.isFinite(hintsUsed) ? hintsUsed : 0,
    notes: String(notes ?? ''),
  };
}

// --- Финализация попытки (T1.3.1) --------------------------------------------
// Записывает событие РОВНО ОДИН РАЗ (PRD §4: «Событие записывается ровно один раз
// — после финальной самооценки») и снимает статус «в процессе», удаляя черновик
// (getCaseStatus после этого вернёт 'passed' с последним score). attemptNo
// вычисляется здесь, если вызывающий его не передал.
export async function saveAndFinalize(params = {}) {
  const attemptNo = Number.isFinite(params.attemptNo)
    ? params.attemptNo
    : await getAttemptNo(params.caseId);

  const event = createEvent({ ...params, attemptNo });
  await saveEvent(event);

  // Черновик больше не нужен — попытка завершена. Сбой удаления не должен
  // «отменять» уже записанное событие, поэтому ошибку только логируем.
  try {
    await deleteDraftState(event.caseId);
  } catch (err) {
    console.error('[event] не удалось удалить черновик после финализации', event.caseId, err);
  }

  // Сигнал интерфейсу: прогресс изменился. Навигатор курса (Sidebar) и каталог
  // обновляют отметки и прогресс-бары без перезагрузки. Доставка не критична.
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('at:progress-changed', {
        detail: { caseId: event.caseId, module: event.module },
      }));
    }
  } catch { /* среда без window (node-тесты) — игнорируем */ }

  return event;
}

// --- Smoke-check для консоли (?smoke=event, см. main.js) ----------------------
// Проверяет normalizeScore по всем веткам PRD §4, инкремент attemptNo и то, что
// saveAndFinalize пишет событие и снимает черновик. Тестовые записи подчищаются.
export async function smokeTest() {
  const checks = [];
  const expect = (name, cond) => checks.push({ name, ok: !!cond });

  // normalizeScore: только самооценка → self·100.
  expect('self-only', normalizeScore(undefined, 0.8) === 80);
  // только авто → auto·100.
  expect('auto-only', normalizeScore(0.6, null) === 60);
  // комбинированный с весами по умолчанию 0.5/0.5.
  expect('combined-default', normalizeScore(0.6, 0.8) === 70);
  // комбинированный с явными весами.
  expect('combined-weights',
    normalizeScore(1, 0, { wAuto: 0.7, wSelf: 0.3 }) === 70);
  // обрезание в 0–100.
  expect('clamp-high', normalizeScore(1.5, 1.5) === 100);
  expect('clamp-low', normalizeScore(-1, -1) === 0);
  // нечего оценивать → 0, не NaN.
  expect('empty', normalizeScore(null, undefined) === 0);

  // computeDurationSec: кап 90 минут.
  const t0 = 1_000_000;
  expect('duration-normal', computeDurationSec(t0, t0 + 65_000) === 65);
  expect('duration-capped',
    computeDurationSec(t0, t0 + (DURATION_CAP_SEC + 600) * 1000) === DURATION_CAP_SEC);
  expect('duration-negative', computeDurationSec(t0, t0 - 5000) === 0);

  // Полный цикл записи: две попытки одного кейса → attemptNo 1, затем 2.
  const caseId = `__smoke_evt_${Date.now()}`;
  const base = {
    module: '5.3',
    caseId,
    startedAt: Date.now() - 30_000,
    score: normalizeScore(0.5, 1),
    skillTags: ['data-viz'],
    selfAssessment: { insight: 100 },
    hintsUsed: 1,
    notes: 'smoke',
  };

  const e1 = await saveAndFinalize({ ...base });
  const e2 = await saveAndFinalize({ ...base });
  expect('attemptNo-1', e1.attemptNo === 1);
  expect('attemptNo-2', e2.attemptNo === 2);
  expect('score-combined', e1.score === 75); // 0.5·0.5 + 0.5·1 = 0.75
  expect('has-eventId', typeof e1.eventId === 'string' && e1.eventId !== e2.eventId);
  expect('next-attempt', (await getAttemptNo(caseId)) === 3);

  // Подчищаем тестовые события.
  const written = await getEvents({ caseId });
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('events', 'readwrite');
    for (const e of written) tx.objectStore('events').delete(e.eventId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  const failed = checks.filter((c) => !c.ok);
  const ok = failed.length === 0;
  console[ok ? 'info' : 'error'](
    `[event.smokeTest] ${ok ? 'OK — все проверки прошли' : 'FAIL'}`,
    ok ? checks.length : failed,
  );
  return ok;
}
