// core/analytics.js — агрегации Learning Analytics (T9.1.2, T9.2.1).
//
// Чистые функции над списком событий прохождения (PRD §4 «Модель события») —
// единственная точка истины по расчётам модуля 5.8 (PRD §5.8). Без DOM и без
// обращения к хранилищу: на вход массив событий, на выход — числа/структуры.
// Экран аналитики (modules/analytics/*) грузит события из IndexedDB, обогащает их
// сложностью кейса (`difficulty` — из манифеста/пользовательских кейсов, нужна для
// adjScore) и передаёт сюда.
//
// Семантика средних совпадает с каталогом (core/stats.js): «средний score» и число
// решённых кейсов считаются по ПОСЛЕДНЕЙ попытке каждого кейса (повтор одного кейса
// не раздувает счётчик и не перевешивает среднее). «Суммарное время» — по ВСЕМ
// попыткам (каждая отняла время). Слабые места (Ф4) считаются по последним N
// попыткам модуля — там важна свежая динамика, а не история целиком.
//
// ES-модуль: `import * as analytics from './core/analytics.js'`.

import {
  ADJ_BONUS,
  WEAK_SCORE_THRESHOLD,
  WEAK_HINTS_THRESHOLD,
  WEAK_MIN_ATTEMPTS,
  WEAK_WINDOW,
} from '../config.js';
import { SKILL_GROUPS, SKILL_GROUP_LABELS, groupForTag } from './skillTags.js';
import { getModule } from './modules.js';

// --- Общие помощники ---------------------------------------------------------

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function finiteScores(events) {
  return events.map((e) => e.score).filter((s) => Number.isFinite(s));
}

// Последняя (по finishedAt) попытка по каждому кейсу — представитель кейса для
// средних, как в core/stats.js.
export function lastAttemptPerCase(events) {
  const byCase = new Map();
  for (const e of events) {
    const prev = byCase.get(e.caseId);
    if (!prev || (e.finishedAt ?? 0) > (prev.finishedAt ?? 0)) byCase.set(e.caseId, e);
  }
  return [...byCase.values()];
}

// --- Ф1: сводная панель ------------------------------------------------------
// solvedCases — число РАЗНЫХ кейсов с событием; avgScore — среднее по последней
// попытке каждого кейса (0–100 или null); totalDurationSec — сумма по всем попыткам;
// totalAttempts — всего событий.
export function summarize(events) {
  const last = lastAttemptPerCase(events);
  const scores = finiteScores(last);
  const avgScore = scores.length ? Math.round(mean(scores)) : null;
  const totalDurationSec = events.reduce(
    (n, e) => n + (Number.isFinite(e.durationSec) ? e.durationSec : 0),
    0,
  );
  return {
    solvedCases: last.length,
    totalAttempts: events.length,
    avgScore,
    totalDurationSec,
  };
}

// Ключ календарного дня события в локальной зоне (YYYY-MM-DD).
function dayKey(ts) {
  const d = new Date(ts ?? 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// --- Ф1: активность по дням --------------------------------------------------
// Возвращает [{ date:'YYYY-MM-DD', count }] от первого дня активности до последнего,
// с нулями в «пустые» дни (для ровного bar-chart). Ограничивает хвостом maxDays.
export function dailyActivity(events, { maxDays = 60 } = {}) {
  if (events.length === 0) return [];
  const counts = new Map();
  for (const e of events) {
    const k = dayKey(e.finishedAt);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const keys = [...counts.keys()].sort();
  const start = new Date(`${keys[0]}T00:00:00`);
  const end = new Date(`${keys[keys.length - 1]}T00:00:00`);
  const out = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d.getTime());
    out.push({ date: k, count: counts.get(k) || 0 });
  }
  return out.slice(-maxDays);
}

// --- Нормализация score по сложности (Ф4) ------------------------------------
// adjScore = score + bonus(difficulty). difficulty берётся из обогащённого события;
// неизвестная сложность → бонус 0 (не штрафуем за отсутствие данных).
export function adjScoreOf(event, bonus = ADJ_BONUS) {
  const base = Number.isFinite(event.score) ? event.score : 0;
  return base + (bonus[event.difficulty] ?? 0);
}

// --- Ф2: прогресс по группам навыков -----------------------------------------
// Для каждой группы (analytical/practical/business): средний score (по последней
// попытке каждого кейса группы), число кейсов и хронологический ряд для спарклайна
// динамики. Событие относится к группе, если хотя бы один его тег входит в группу.
export function aggregateBySkillGroup(events) {
  return Object.keys(SKILL_GROUPS).map((group) => {
    const inGroup = events.filter((e) =>
      (e.skillTags || []).some((t) => groupForTag(t) === group),
    );
    const last = lastAttemptPerCase(inGroup);
    const scores = finiteScores(last);
    const series = [...inGroup]
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
      .map((e) => ({ t: e.finishedAt, score: e.score }));
    return {
      group,
      label: SKILL_GROUP_LABELS[group],
      count: last.length,
      avgScore: scores.length ? Math.round(mean(scores)) : null,
      series,
    };
  });
}

// --- Ф3/Ф4: слабые места -----------------------------------------------------
// Модуль слабый, если по нему ≥ minAttempts попыток и за последние `window` попыток
// средний adjScore < scoreThreshold ЛИБО средний hintsUsed > hintsThreshold.
// Возвращает слабые модули, отсортированные по возрастанию среднего adjScore.
// Пороги/бонусы — из config.js, переопределяются через opts (для тестов).
export function computeWeakModules(events, opts = {}) {
  const {
    bonus = ADJ_BONUS,
    scoreThreshold = WEAK_SCORE_THRESHOLD,
    hintsThreshold = WEAK_HINTS_THRESHOLD,
    minAttempts = WEAK_MIN_ATTEMPTS,
    window = WEAK_WINDOW,
  } = opts;

  const byModule = new Map();
  for (const e of events) {
    if (!byModule.has(e.module)) byModule.set(e.module, []);
    byModule.get(e.module).push(e);
  }

  const weak = [];
  for (const [moduleId, evs] of byModule) {
    if (evs.length < minAttempts) continue;
    const recent = [...evs]
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
      .slice(0, window);
    const avgAdj = mean(recent.map((e) => adjScoreOf(e, bonus)));
    const avgHints = mean(recent.map((e) => (Number.isFinite(e.hintsUsed) ? e.hintsUsed : 0)));

    const reasons = [];
    if (avgAdj < scoreThreshold) reasons.push('low_score');
    if (avgHints > hintsThreshold) reasons.push('many_hints');
    if (reasons.length === 0) continue;

    const mod = getModule(moduleId);
    weak.push({
      moduleId,
      title: mod ? mod.title : moduleId,
      attempts: evs.length,
      windowSize: recent.length,
      avgAdjScore: Math.round(avgAdj),
      avgHints: Math.round(avgHints * 10) / 10,
      reasons,
    });
  }

  weak.sort((a, b) => a.avgAdjScore - b.avgAdjScore);
  return weak;
}

// --- Ф4: фильтрация рекомендуемых кейсов (T9.2.3) ----------------------------
// Для слабого модуля выбирает кейсы для тренировки: сначала непройденные, затем
// пройденные с низким последним score; сортирует по возрастанию сложности
// (basic → advanced). `moduleCases` — рабочие кейсы модуля из манифеста
// (`{ caseId, title, difficulty }`); `statusByCase` — Map caseId → { status, lastScore }.
const DIFFICULTY_ORDER = { basic: 0, intermediate: 1, advanced: 2 };

export function recommendCasesForModule(moduleCases, statusByCase, opts = {}) {
  const { limit = 3, lowScore = WEAK_SCORE_THRESHOLD } = opts;

  const scored = moduleCases.map((c) => {
    const st = statusByCase.get(c.caseId) || { status: 'not_started', lastScore: null };
    // приоритет: не начат (0) → пройден с низким баллом (1) → пройден хорошо (2, не советуем)
    let priority = 2;
    if (st.status !== 'passed') priority = 0;
    else if (typeof st.lastScore === 'number' && st.lastScore < lowScore) priority = 1;
    return { ...c, status: st.status, lastScore: st.lastScore, priority };
  });

  return scored
    .filter((c) => c.priority < 2)
    .sort((a, b) =>
      a.priority - b.priority ||
      (DIFFICULTY_ORDER[a.difficulty] ?? 1) - (DIFFICULTY_ORDER[b.difficulty] ?? 1),
    )
    .slice(0, limit);
}

// --- Smoke-check для консоли (?smoke=analytics, см. main.js) ------------------
export function smokeTest() {
  const checks = [];
  const expect = (name, cond) => checks.push({ name, ok: !!cond });

  const t0 = Date.UTC(2026, 0, 1, 12);
  const day = 86_400_000;
  const ev = (over) => ({
    module: '5.1', caseId: 'c', score: 50, durationSec: 60, hintsUsed: 0,
    skillTags: ['analytical-thinking'], difficulty: 'basic', finishedAt: t0, ...over,
  });

  // summarize: две попытки одного кейса → 1 решённый, среднее по ПОСЛЕДНЕЙ (90), время суммируется.
  const s = summarize([
    ev({ caseId: 'a', score: 30, finishedAt: t0, durationSec: 100 }),
    ev({ caseId: 'a', score: 90, finishedAt: t0 + day, durationSec: 200 }),
  ]);
  expect('solved-distinct', s.solvedCases === 1);
  expect('avg-last-attempt', s.avgScore === 90);
  expect('duration-all', s.totalDurationSec === 300);

  // dailyActivity: нули в пустые дни.
  const act = dailyActivity([ev({ finishedAt: t0 }), ev({ finishedAt: t0 + 2 * day })]);
  expect('activity-zerofill', act.length === 3 && act[1].count === 0 && act[0].count === 1);

  // adjScore: бонус по сложности.
  expect('adj-basic', adjScoreOf(ev({ score: 50, difficulty: 'basic' })) === 50);
  expect('adj-advanced', adjScoreOf(ev({ score: 50, difficulty: 'advanced' })) === 70);

  // skill groups: аналитический тег попадает в analytical.
  const groups = aggregateBySkillGroup([ev({ caseId: 'a', score: 80 })]);
  const analytical = groups.find((g) => g.group === 'analytical');
  expect('group-avg', analytical.avgScore === 80 && analytical.count === 1);
  expect('group-series', analytical.series.length === 1);

  // weak modules: 3 попытки, низкий adjScore → слабый; мало попыток → не слабый.
  const weak = computeWeakModules([
    ev({ module: '5.5', caseId: 'x', score: 30 }),
    ev({ module: '5.5', caseId: 'y', score: 40 }),
    ev({ module: '5.5', caseId: 'z', score: 50 }),
    ev({ module: '5.1', caseId: 'p', score: 10 }), // 1 попытка < minAttempts
  ]);
  expect('weak-detected', weak.length === 1 && weak[0].moduleId === '5.5');
  expect('weak-reason', weak[0].reasons.includes('low_score'));

  // weak by hints: высокий score, но много подсказок.
  const weakHints = computeWeakModules([
    ev({ module: '5.2', caseId: 'a', score: 95, hintsUsed: 3 }),
    ev({ module: '5.2', caseId: 'b', score: 95, hintsUsed: 2 }),
    ev({ module: '5.2', caseId: 'c', score: 95, hintsUsed: 2 }),
  ]);
  expect('weak-hints', weakHints.length === 1 && weakHints[0].reasons.includes('many_hints'));

  // recommend: непройденные и низкобалльные, по возрастанию сложности; хорошо пройденный исключён.
  const cases = [
    { caseId: 'c1', title: 'A', difficulty: 'advanced' },
    { caseId: 'c2', title: 'B', difficulty: 'basic' },
    { caseId: 'c3', title: 'C', difficulty: 'basic' },
  ];
  const statuses = new Map([
    ['c1', { status: 'not_started', lastScore: null }],
    ['c2', { status: 'passed', lastScore: 40 }],
    ['c3', { status: 'passed', lastScore: 95 }],
  ]);
  const rec = recommendCasesForModule(cases, statuses);
  expect('rec-excludes-good', !rec.some((c) => c.caseId === 'c3'));
  // Сначала непройденные (c1, priority 0), затем пройденные с низким баллом (c2, priority 1).
  expect('rec-priority-order', rec[0].caseId === 'c1' && rec[1].caseId === 'c2');

  const failed = checks.filter((c) => !c.ok);
  const ok = failed.length === 0;
  console[ok ? 'info' : 'error'](
    `[analytics.smokeTest] ${ok ? 'OK — агрегации считаются верно' : 'FAIL'}`,
    ok ? checks.length : failed,
  );
  return ok;
}
