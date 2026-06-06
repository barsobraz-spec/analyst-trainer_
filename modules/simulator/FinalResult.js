// modules/simulator/FinalResult.js — итог симуляции (T7.3.2, PRD §5.6 Ф5).
//
// После последнего раунда показывает: финальное значение целевой метрики рядом с
// целевым показателем, достигнутый балл (computeSimulationScore, шкала 0–100), и —
// по раскрытию — эталонную стратегию из payload (как стоило действовать). Балл
// считает CaseView (через computeSimulationScore) и передаёт сюда уже готовым.
//
// renderFinalResult возвращает { element } — самооценки у 5.6 нет (балл целиком
// определяется достижением цели, PRD §4 «5.6»), поэтому событие пишет CaseView
// сразу после показа итога.
//
// ES-модуль: `import { renderFinalResult } from './FinalResult.js'`.

import { formatMetricValue } from './StatePanel.js';

// args:
//   finalState  — итоговые метрики;
//   metrics     — описания метрик (для поиска формата целевой);
//   target      — { metric, value, direction?, label? };
//   score       — итоговый балл 0–100 (computeSimulationScore);
//   reference   — эталонная стратегия (строка/массив абзацев).
export function renderFinalResult({ finalState = {}, metrics = [], target = {}, score = 0, reference } = {}) {
  const root = document.createElement('section');
  root.className = 'final-result';

  const h2 = document.createElement('h2');
  h2.className = 'final-result__title';
  h2.textContent = 'Итог симуляции';
  root.append(h2);

  const targetMetric = metrics.find((m) => m.key === target.metric) || { key: target.metric };
  const achieved = finalState[target.metric];

  // Достигнуто vs цель — крупными плашками рядом.
  const compare = document.createElement('div');
  compare.className = 'final-result__compare';
  compare.append(
    statBlock('Достигнуто', formatMetricValue(achieved, targetMetric)),
    statBlock('Цель', formatMetricValue(target.value, targetMetric)),
    statBlock('Балл', `${score} / 100`, 'final-result__stat--score'),
  );
  root.append(compare);

  if (target.label) {
    const caption = document.createElement('p');
    caption.className = 'final-result__caption';
    caption.textContent = target.direction === 'min'
      ? `Цель: удержать «${target.label}» не выше целевого значения.`
      : `Цель: достичь по показателю «${target.label}» не меньше целевого значения.`;
    root.append(caption);
  }

  // Вердикт достижения цели.
  const reached = target.direction === 'min'
    ? Number(achieved) <= Number(target.value)
    : Number(achieved) >= Number(target.value);
  const verdict = document.createElement('p');
  verdict.className = `final-result__verdict final-result__verdict--${reached ? 'reached' : 'missed'}`;
  verdict.textContent = reached
    ? 'Цель достигнута — стратегия сработала.'
    : 'Цель не достигнута. Сверьтесь с эталонной стратегией ниже.';
  root.append(verdict);

  // Эталонная стратегия (Ф6 «в конце — эталонная стратегия»).
  const refWrap = document.createElement('div');
  refWrap.className = 'final-result__reference';
  const refTitle = document.createElement('h3');
  refTitle.className = 'final-result__reference-title';
  refTitle.textContent = 'Эталонная стратегия';
  refWrap.append(refTitle);

  const paragraphs = normalizeReference(reference);
  if (paragraphs.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Эталонная стратегия для этого кейса ещё не задана — сравните свой ход с динамикой метрик выше.';
    refWrap.append(p);
  } else {
    for (const para of paragraphs) {
      const p = document.createElement('p');
      p.textContent = para;
      refWrap.append(p);
    }
  }
  root.append(refWrap);

  return { element: root };
}

function statBlock(label, value, extraClass = '') {
  const block = document.createElement('div');
  block.className = `final-result__stat ${extraClass}`.trim();
  const l = document.createElement('span');
  l.className = 'final-result__stat-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'final-result__stat-value';
  v.textContent = value;
  block.append(l, v);
  return block;
}

function normalizeReference(reference) {
  if (!reference) return [];
  if (Array.isArray(reference)) return reference.map((s) => String(s).trim()).filter(Boolean);
  return String(reference).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}
