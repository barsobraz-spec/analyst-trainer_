// core/simulationEngine.js — безопасный числовой движок симуляций (T7.1, PRD §5.6 Ф3).
//
// Формулы кейса 5.6 — это ограниченные арифметические выражения над именованными
// метриками и параметрами решения. Они вычисляются БЕЗОПАСНЫМ парсером `expr-eval`
// (vendor/expr-eval), а НЕ через `eval()` / `Function()` — JSON кейса не должен иметь
// возможности выполнить произвольный JS (PRD §2 принцип 1, §5.6 Ф3).
//
// Что гарантирует этот модуль:
//   • whitelist операций `+ − * / ( )` — остальные операторы (^, %, сравнения,
//     логика, присваивание, индексация, тернарник, факториал, конкатенация,
//     определение функций) ОТКЛЮЧЕНЫ в конфигурации парсера;
//   • whitelist функций `min / max / round / abs / clamp` — все прочие встроенные
//     функции и unary-функции (sin, sqrt, length, not, …) удалены;
//   • доступ к свойствам объектов запрещён (allowMemberAccess:false) — нельзя
//     добраться до `constructor`/прототипов;
//   • результат формулы обязан быть конечным числом: NaN / Infinity / деление на
//     ноль → выбрасывается SimulationError('bad_value'), раунд не применяется,
//     кейс помечается как ошибочный контент (PRD §5.6 Ф3, обработка некорректных
//     значений — это дефект JSON-формул, а не действие пользователя);
//   • НИГДЕ не вызываются eval() и Function() — используется только
//     parser.parse(expr).evaluate(scope) (метод toJSFunction expr-eval, который
//     единственный создаёт Function, не вызывается).
//
// ES-модуль:
//   `import { createSimulationEngine, computeSimulationScore, SimulationError }
//    from './core/simulationEngine.js'`.

import { clampScore } from './event.js';

// --- Типизированная ошибка движка симуляции ----------------------------------
// code: 'bad_formula' (формула не парсится / пустая) | 'eval_failed' (ошибка
// вычисления) | 'bad_value' (результат не конечное число). Все три CaseView
// трактует как ошибку контента кейса (PRD §5.6 Ф3).
export class SimulationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SimulationError';
    this.code = code;
  }
}

// --- Ленивая загрузка expr-eval из vendor/ -----------------------------------
// UMD-сборка при загрузке обычным <script> кладёт API в глобал `window.exprEval`
// (см. обёртку vendor/expr-eval/expr-eval.umd.js). Грузим её ТОЛЬКО при открытии
// кейса 5.6 — на стартовой странице библиотека не нужна. Промис кэшируется.
let exprEvalPromise = null;

function loadExprEval() {
  if (typeof window !== 'undefined' && window.exprEval && window.exprEval.Parser) {
    return Promise.resolve(window.exprEval);
  }
  if (exprEvalPromise) return exprEvalPromise;

  exprEvalPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // URL считаем относительно этого модуля, чтобы не зависеть от document base.
    script.src = new URL('../vendor/expr-eval/expr-eval.umd.js', import.meta.url).href;
    script.async = true;
    script.onload = () => {
      if (window.exprEval && window.exprEval.Parser) resolve(window.exprEval);
      else reject(new Error('expr-eval загрузился, но глобал exprEval.Parser недоступен.'));
    };
    script.onerror = () => {
      exprEvalPromise = null; // дать шанс повторить попытку при следующем открытии
      reject(new Error('Не удалось загрузить expr-eval из vendor/.'));
    };
    document.head.append(script);
  });
  return exprEvalPromise;
}

// --- Построение МАКСИМАЛЬНО ограниченного парсера -----------------------------
// Это сердце безопасности модуля. Любое расширение whitelist — осознанное
// изменение здесь, а не свободный ввод в JSON кейса.
function buildSafeParser(exprEval) {
  const parser = new exprEval.Parser({
    // Включены только четыре арифметических оператора (PRD §5.6 Ф3). Скобки `()`
    // не оператор, а синтаксис группировки — доступны всегда.
    operators: {
      add: true,
      subtract: true,
      multiply: true,
      divide: true,
      // Всё остальное явно выключено:
      power: false,        // ^
      remainder: false,    // %
      factorial: false,    // !
      comparison: false,   // < > <= >= == !=
      logical: false,      // and or not
      conditional: false,  // ?:
      concatenate: false,  // ||
      assignment: false,   // =  (нельзя создавать/менять переменные)
      array: false,        // [ ]  (нет индексации)
      fndef: false,        // ()=  (нельзя определять функции)
      'in': false,
    },
    // Запрет доступа к свойствам объектов — отсекает путь к constructor/прототипам.
    allowMemberAccess: false,
  });

  // Оставляем только разрешённые функции (PRD §5.6 Ф3). clamp в expr-eval нет —
  // добавляем сами; round/abs существуют как unary, но мы выражаем их как функции,
  // чтобы whitelist был явным и единообразным.
  parser.functions = {
    min: Math.min,
    max: Math.max,
    round: (x) => Math.round(x),
    abs: (x) => Math.abs(x),
    clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  };

  // Из unary-операторов оставляем только унарный плюс/минус (знак числа).
  // Удаляем sin/cos/sqrt/log/length/not/факториал и пр. — они не нужны и
  // расширяют поверхность атаки/ошибок.
  parser.unaryOps = {
    '-': parser.unaryOps['-'],
    '+': parser.unaryOps['+'],
  };

  // Константы (PI/E/true/false) формулам бизнес-модели не нужны и могли бы
  // случайно затенить метрику с тем же именем — убираем.
  parser.consts = {};

  return parser;
}

// --- Публичная фабрика движка ------------------------------------------------
// Возвращает объект-движок с предсобранным безопасным парсером и кэшем
// скомпилированных формул. Один движок живёт на время прохождения кейса.
export async function createSimulationEngine() {
  const exprEval = await loadExprEval();
  const parser = buildSafeParser(exprEval);
  const cache = new Map(); // expr-строка → скомпилированное выражение

  function compile(expr) {
    if (typeof expr !== 'string' || expr.trim() === '') {
      throw new SimulationError('bad_formula', 'Формула пуста или не является строкой.');
    }
    let compiled = cache.get(expr);
    if (compiled) return compiled;
    try {
      compiled = parser.parse(expr);
    } catch (err) {
      throw new SimulationError('bad_formula', `Не удалось разобрать формулу «${expr}»: ${err.message}`);
    }
    cache.set(expr, compiled);
    return compiled;
  }

  // Вычислить одну формулу в заданном скоупе → конечное число (или SimulationError).
  function evaluate(expr, scope = {}) {
    const compiled = compile(expr);
    let result;
    try {
      result = compiled.evaluate(scope);
    } catch (err) {
      throw new SimulationError('eval_failed', `Ошибка вычисления формулы «${expr}»: ${err.message}`);
    }
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      // NaN / Infinity / деление на ноль (PRD §5.6 Ф3).
      throw new SimulationError('bad_value', `Формула «${expr}» вернула некорректное число (${result}).`);
    }
    return result;
  }

  // Применить модель раунда. steps — упорядоченный массив { key, formula }:
  // формулы вычисляются ПО ПОРЯДКУ и накапливаются в рабочем скоупе, поэтому
  // поздние формулы могут опираться на значения, вычисленные ранее в этом раунде
  // (промежуточные величины и новые значения метрик). Возвращает { ...baseScope,
  // ...вычисленные ключи }. На любом некорректном значении бросает SimulationError —
  // вызывающий не применяет раунд и помечает кейс ошибочным.
  function applyModel(steps, baseScope = {}) {
    if (!Array.isArray(steps)) {
      throw new SimulationError('bad_formula', 'Модель раунда должна быть массивом шагов { key, formula }.');
    }
    const scope = { ...baseScope };
    for (const step of steps) {
      if (!step || typeof step.key !== 'string' || step.key.trim() === '') {
        throw new SimulationError('bad_formula', 'Шаг модели должен иметь непустой строковый key.');
      }
      scope[step.key] = evaluate(step.formula, scope);
    }
    return scope;
  }

  return { compile, evaluate, applyModel };
}

// --- Валидация пользовательского ввода по диапазону (T7.1.4) ------------------
// Проверяет ДО передачи значения в движок, что число задано и лежит в [min, max]
// из кейса. min/max опциональны (undefined/null — граница не ограничена).
export function validateInRange(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (min != null && Number.isFinite(min) && value < min) return false;
  if (max != null && Number.isFinite(max) && value > max) return false;
  return true;
}

// --- Балл за прохождение симуляции (T7.3.1, PRD §4 «5.6», §5.6 Ф5) ------------
// score = clamp(достигнуто / цель · 100, 0, 100). Для цели-минимизации
// (direction:'min', например «удержать отток ниже X») берём обратное отношение
// цель/достигнуто. finalState — итоговые метрики, target — { metric, value,
// direction?: 'max' | 'min' }.
export function computeSimulationScore(finalState, target) {
  if (!target || typeof target !== 'object') return 0;
  const achieved = Number(finalState?.[target.metric]);
  const goal = Number(target.value);
  if (!Number.isFinite(achieved) || !Number.isFinite(goal) || goal === 0) return 0;

  const ratio = target.direction === 'min'
    ? (achieved === 0 ? 0 : goal / achieved) // меньше — лучше
    : achieved / goal;                       // больше — лучше (по умолчанию)

  return clampScore(ratio * 100);
}

// --- Smoke-check для консоли (?smoke=sim, см. main.js) ------------------------
// Проверяет: разрешённая арифметика и функции; ОТКЛЮЧЁННЫЕ операторы/доступ к
// свойствам не парсятся; NaN/Infinity/деление на ноль → bad_value; модель раунда
// с накоплением скоупа; валидация диапазона; computeSimulationScore. eval/Function
// не используются по построению (вызывается только parse().evaluate()).
export async function smokeTest() {
  const checks = [];
  const expect = (name, cond) => checks.push({ name, ok: !!cond });
  const engine = await createSimulationEngine();

  // Разрешённая арифметика и приоритет/скобки.
  expect('arithmetic', engine.evaluate('(a + b) * 2 - 1', { a: 3, b: 4 }) === 13);
  expect('divide', engine.evaluate('x / y', { x: 10, y: 4 }) === 2.5);
  // Разрешённые функции.
  expect('min-max', engine.evaluate('min(a, b) + max(a, b)', { a: 2, b: 5 }) === 7);
  expect('round', engine.evaluate('round(x)', { x: 2.6 }) === 3);
  expect('abs', engine.evaluate('abs(x)', { x: -4 }) === 4);
  expect('clamp', engine.evaluate('clamp(x, 0, 100)', { x: 150 }) === 100);

  // Отключённые операторы / функции / доступ к свойствам → bad_formula (не парсятся).
  const blocked = (expr) => {
    try { engine.compile(expr); return false; }
    catch (err) { return err instanceof SimulationError && err.code === 'bad_formula'; }
  };
  expect('block-power', blocked('2 ^ 3'));
  expect('block-assignment', blocked('x = 5'));
  expect('block-comparison', blocked('a > b'));
  expect('block-array', blocked('a[0]'));
  expect('block-member', blocked('a.constructor'));

  // Имя неразрешённой функции (sqrt/sin/length/…) синтаксически парсится как
  // вызов неизвестной функции, но НЕ доступно при вычислении — её нет в whitelist
  // (parser.functions), поэтому evaluate бросает eval_failed. Это и есть гарантия,
  // что через JSON-формулу не дотянуться до Math.* и т.п.
  const fnUnavailable = (expr) => {
    try { engine.evaluate(expr, { x: 4 }); return false; }
    catch (err) { return err instanceof SimulationError && err.code === 'eval_failed'; }
  };
  expect('block-sqrt', fnUnavailable('sqrt(x)'));
  expect('block-sin', fnUnavailable('sin(x)'));
  expect('block-length', fnUnavailable('length(x)'));

  // Некорректные значения → bad_value (раунд не применяется).
  const badValue = (expr, scope) => {
    try { engine.evaluate(expr, scope); return false; }
    catch (err) { return err instanceof SimulationError && err.code === 'bad_value'; }
  };
  expect('div-by-zero', badValue('x / y', { x: 1, y: 0 }));            // Infinity
  expect('nan', badValue('x / y', { x: 0, y: 0 }));                    // NaN
  expect('missing-var', (() => {
    try { engine.evaluate('a + missing', { a: 1 }); return false; }
    catch (err) { return err instanceof SimulationError; }            // undefined → не число
  })());

  // Модель раунда: формулы накапливаются по порядку.
  const out = engine.applyModel(
    [
      { key: 'acquired', formula: 'round(budget / cac)' },
      { key: 'customers', formula: 'customers + acquired' },
      { key: 'revenue', formula: 'customers * arpu' },
    ],
    { customers: 100, cac: 50, budget: 500, arpu: 10 },
  );
  expect('model-acquired', out.acquired === 10);
  expect('model-customers', out.customers === 110);
  expect('model-revenue', out.revenue === 1100);

  // Валидация диапазона.
  expect('range-ok', validateInRange(10, 0, 50) === true);
  expect('range-low', validateInRange(-1, 0, 50) === false);
  expect('range-high', validateInRange(60, 0, 50) === false);
  expect('range-nan', validateInRange(NaN, 0, 50) === false);
  expect('range-open', validateInRange(999, 0, null) === true);

  // Балл за симуляцию.
  expect('score-max', computeSimulationScore({ revenue: 2200000 }, { metric: 'revenue', value: 2000000 }) === 100);
  expect('score-partial', computeSimulationScore({ revenue: 1500000 }, { metric: 'revenue', value: 2000000 }) === 75);
  expect('score-min-dir', computeSimulationScore({ churn: 4 }, { metric: 'churn', value: 5, direction: 'min' }) === 100);

  const failed = checks.filter((c) => !c.ok);
  const ok = failed.length === 0;
  console[ok ? 'info' : 'error'](
    `[simulationEngine.smokeTest] ${ok ? 'OK — все проверки прошли' : 'FAIL'}`,
    ok ? checks.length : failed,
  );
  return ok;
}
