// core/stats.js — агрегация статистики по модулю для каталога (T1.1.2).
//
// Каталог (PRD §6 Ф1) показывает по каждому модулю «сколько кейсов пройдено» и
// «средний score». Источник — события прохождения из IndexedDB (раздел 4 PRD).
//
// Решения по семантике:
//   • «пройденный кейс» = кейс, по которому есть хотя бы одно завершённое событие
//     (число РАЗНЫХ caseId, а не число попыток — повторное прохождение одного
//     кейса не должно раздувать счётчик);
//   • «средний score» считается по ОДНОМУ представителю на кейс — последней
//     попытке (события приходят отсортированными по finishedAt убыв.), чтобы
//     кейс с десятком попыток не перевешивал остальные.
//
// ES-модуль: `import { getModuleStats } from './core/stats.js'`.

import { getEvents, getLastEvent, getDraftState } from './db.js';

// Сводит список событий к { passedCount, avgScore }. Вынесено отдельно, чтобы
// можно было считать статистику и из уже загруженных событий без обращения к БД.
// `avgScore` — целое 0–100 или null, если оценённых кейсов нет.
export function summarizeEvents(events) {
  const latestByCase = new Map();
  for (const e of events) {
    // События отсортированы по убыванию finishedAt → первое встреченное по
    // caseId и есть последняя попытка.
    if (!latestByCase.has(e.caseId)) latestByCase.set(e.caseId, e);
  }

  const passedCount = latestByCase.size;
  const scores = [];
  for (const e of latestByCase.values()) {
    if (typeof e.score === 'number' && Number.isFinite(e.score)) scores.push(e.score);
  }

  const avgScore = scores.length === 0
    ? null
    : Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);

  return { passedCount, avgScore };
}

// Статистика одного модуля по его событиям из IndexedDB. Никогда не бросает:
// при пустом модуле возвращает нулевую статистику (empty state на каталоге).
export async function getModuleStats(moduleId) {
  const events = await getEvents({ module: moduleId });
  return summarizeEvents(events);
}

// Статус кейса для списка кейсов модуля (T1.2, PRD §4 «Статусы кейса»):
//   • 'passed'      — есть хотя бы одно завершённое событие (показываем последний score);
//   • 'in_progress' — события нет, но сохранён черновик незавершённого прохождения;
//   • 'not_started' — ни события, ни черновика.
// Приоритет события над черновиком: saveAndFinalize (T1.3) удаляет черновик при
// финализации, поэтому черновик при наличии события означает уже НОВУЮ попытку —
// но в списках PRD показывает ПОСЛЕДНИЙ результат, поэтому кейс считается пройденным.
// `lastScore` — score последней попытки (0–100) либо null. Никогда не бросает на
// «нет данных»; ошибку доступа к БД оставляем вызывающему (он покажет прочерк).
export async function getCaseStatus(caseId) {
  const [lastEvent, draft] = await Promise.all([
    getLastEvent(caseId),
    getDraftState(caseId),
  ]);

  if (lastEvent) {
    const lastScore = typeof lastEvent.score === 'number' && Number.isFinite(lastEvent.score)
      ? lastEvent.score
      : null;
    return { status: 'passed', lastScore };
  }
  if (draft != null) return { status: 'in_progress', lastScore: null };
  return { status: 'not_started', lastScore: null };
}
