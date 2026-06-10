// core/grader.js — единый интерфейс «проверяющего» (Grader) и первые плагины.
//
// Grader — объект с одним методом:
//   grade(answer, reference, options?) → GradeResult
//
// GradeResult:
//   { fraction: number (0..1), feedback?: string, details?: any }
//
//   fraction — доля правильности (0 = полностью неверно, 1 = идеально);
//   feedback — опциональный текст для отображения пользователю;
//   details  — опциональные данные для внутреннего использования (отладка, UI).
//
// Встроенные плагины:
//   SqlGrader    — точное совпадение SQL-выборок (модуль 5.5)
//   SelfGrader   — взвешенная самооценка по критериям (5.1, 5.2, 5.4, 5.7)
//   ScoreGrader  — обёртка над функцией, возвращающей долю (5.3, 5.6)
//
// Офлайн-инвариант (PRD §2): каждый встроенный плагин детерминирован и не
// требует сети. AI-grader реализуется как ещё один плагин за этим интерфейсом;
// локальный fallback обязателен.
//
// Как добавить проверяющего — см. docs/extension-guide.md.
//
// ES-модуль: `import { SqlGrader, SelfGrader, ScoreGrader } from './core/grader.js'`.

import { compareResultSets } from './sqlComparator.js';
import { computeSelfFraction } from './components/SelfAssessment.js';

// ---------------------------------------------------------------------------
// SqlGrader — сравнение результата SQL-запроса с эталоном (модуль 5.5).
//
// answer   : { columns, rows } | rows[][] — фактическая выборка
// reference: { columns, rows } | rows[][] — эталонная выборка
// options  : { orderSensitive?: boolean }
// ---------------------------------------------------------------------------
export const SqlGrader = {
  /** @param {object|Array} answer @param {object|Array} reference @param {{orderSensitive?:boolean}} [options] */
  grade(answer, reference, { orderSensitive = false } = {}) {
    const match = compareResultSets(answer, reference, orderSensitive);
    return {
      fraction: match ? 1 : 0,
      feedback: match ? null : 'Результат не совпадает с эталонной выборкой.',
    };
  },
};

// ---------------------------------------------------------------------------
// SelfGrader — взвешенная самооценка по набору критериев (модули 5.1–5.4, 5.7).
//
// answer   : Record<criterionId, number (0–100)>  — выставленные значения
// reference: Array<{ id, label, weight?, type? }> — критерии (та же структура,
//            что принимает SelfAssessment)
// ---------------------------------------------------------------------------
export const SelfGrader = {
  /** @param {Record<string,number>} answer @param {Array} reference */
  grade(answer, reference) {
    const fraction = computeSelfFraction(reference, answer);
    return { fraction };
  },
};

// ---------------------------------------------------------------------------
// ScoreGrader — фабрика для числовой оценки (модули 5.3 авто-часть, 5.6, 5.7).
//
// computeFn: (...gradeArgs) → number (0..1)
//
// Пример:
//   const SimGrader = ScoreGrader((finalState, target) => {
//     const raw = computeSimulationScore(finalState, target);
//     return raw / 100; // computeSimulationScore возвращает 0–100
//   });
//   SimGrader.grade(finalState, target) → { fraction: 0.93 }
// ---------------------------------------------------------------------------
export function ScoreGrader(computeFn) {
  return {
    /** @param {...any} args forwarded to computeFn */
    grade(...args) {
      const fraction = Number(computeFn(...args));
      return { fraction: Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// Утилита: создать grader с фиксированным набором параметров (partial application).
// Позволяет не передавать options при каждом вызове grade().
//
// Пример:
//   const orderedSqlGrader = withOptions(SqlGrader, { orderSensitive: true });
//   orderedSqlGrader.grade(actual, expected); // без options
// ---------------------------------------------------------------------------
export function withOptions(grader, defaultOptions) {
  return {
    grade(answer, reference, extraOptions = {}) {
      return grader.grade(answer, reference, { ...defaultOptions, ...extraOptions });
    },
  };
}
