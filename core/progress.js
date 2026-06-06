// core/progress.js — сводный статус всех кейсов одним пакетом (для навигатора и «Продолжить»).
//
// core/stats.js считает статус по ОДНОМУ кейсу (2 запроса) — этого хватает экрану
// списка. Сайдбару и каталогу нужен статус сразу по всем кейсам, поэтому здесь —
// один батч: все события + все черновики читаются разом, статусы выводятся в памяти.
// Семантика совпадает со stats.getCaseStatus (PRD §4 «Статусы кейса»):
//   событие → 'passed' (с последним score); иначе черновик → 'in_progress'; иначе 'not_started'.
//
// ES-модуль: `import { loadProgressMap, getResumeTarget } from './core/progress.js'`.

import { getEvents, getAllDraftStates } from './db.js';

// Map caseId → { status, lastScore }. При сбое хранилища возвращает null —
// навигатор тогда покажется без отметок прогресса (но останется работоспособным).
export async function loadProgressMap() {
  try {
    const [events, drafts] = await Promise.all([getEvents(), getAllDraftStates()]);

    const map = new Map();
    // События отсортированы по убыванию finishedAt → первое встреченное по caseId
    // есть последняя попытка (как в stats.summarizeEvents).
    for (const e of events) {
      if (!map.has(e.caseId)) {
        const lastScore = typeof e.score === 'number' && Number.isFinite(e.score) ? e.score : null;
        map.set(e.caseId, { status: 'passed', lastScore });
      }
    }
    for (const d of drafts) {
      if (!map.has(d.caseId)) map.set(d.caseId, { status: 'in_progress', lastScore: null });
    }
    return map;
  } catch (err) {
    console.error('[progress] не удалось собрать статусы кейсов', err);
    return null;
  }
}

// Статус одного кейса по карте (с безопасными дефолтами).
export function statusOf(progressMap, caseId) {
  if (!progressMap) return { status: 'unknown', lastScore: null };
  return progressMap.get(caseId) || { status: 'not_started', lastScore: null };
}

// Прогресс модуля: сколько кейсов пройдено из общего числа, плюс средний score
// (по пройденным). totals берутся из маршрута (outline), статусы — из progressMap.
export function moduleProgress(moduleCases, progressMap) {
  const total = moduleCases.length;
  let passed = 0;
  const scores = [];
  for (const c of moduleCases) {
    const st = statusOf(progressMap, c.caseId);
    if (st.status === 'passed') {
      passed += 1;
      if (typeof st.lastScore === 'number') scores.push(st.lastScore);
    }
  }
  const avgScore = scores.length === 0
    ? null
    : Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  return { passed, total, avgScore };
}

// Цель кнопки «Продолжить/Начать» — первый незавершённый кейс маршрута (как в
// буткемпах: возврат точно туда, где остановился). kind:
//   'resume' — есть незавершённый черновик; 'start' — первый не начатый кейс;
//   'done'   — все кейсы пройдены (предлагаем аналитику); 'empty' — кейсов нет.
export function getResumeTarget(outline, progressMap) {
  const flat = outline?.flat || [];
  if (flat.length === 0) return { kind: 'empty', case: null };

  let firstInProgress = null;
  let firstNotStarted = null;
  for (const c of flat) {
    const st = statusOf(progressMap, c.caseId).status;
    if (st === 'in_progress' && !firstInProgress) firstInProgress = c;
    // 'unknown' (БД недоступна) трактуем как «не начат» — даём начать с первого.
    if ((st === 'not_started' || st === 'unknown') && !firstNotStarted) firstNotStarted = c;
  }

  if (firstInProgress) return { kind: 'resume', case: firstInProgress };
  if (firstNotStarted) return { kind: 'start', case: firstNotStarted };
  return { kind: 'done', case: null };
}
