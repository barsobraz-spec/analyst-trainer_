// modules/analytics/SkillProgress.js — прогресс по группам навыков (T9.1.3).
//
// PRD §5.8 Ф2: отдельные показатели по группам тегов (аналитическое мышление,
// бизнес-мышление, практические навыки) — средний score и динамика во времени.
// Динамика рисуется компактным SVG-спарклайном (без Chart.js — экран аналитики
// остаётся лёгким и без «висящих» инстансов графиков).
//
// На вход — готовый агрегат из core/analytics.aggregateBySkillGroup(events).
//
// ES-модуль: `import { SkillProgress } from './modules/analytics/SkillProgress.js'`.

export function SkillProgress({ groups = [] } = {}) {
  const root = document.createElement('section');
  root.className = 'analytics-section skill-progress';

  const h2 = document.createElement('h2');
  h2.className = 'analytics-section__title';
  h2.textContent = 'Прогресс по навыкам';
  root.append(h2);

  const list = document.createElement('div');
  list.className = 'skill-progress__list';
  for (const g of groups) list.append(buildGroupRow(g));
  root.append(list);

  return root;
}

function buildGroupRow(g) {
  const row = document.createElement('div');
  row.className = 'skill-progress__row';

  const head = document.createElement('div');
  head.className = 'skill-progress__head';
  const label = document.createElement('span');
  label.className = 'skill-progress__label';
  label.textContent = g.label;
  const value = document.createElement('span');
  value.className = 'skill-progress__value';
  value.textContent = g.avgScore != null ? `${g.avgScore} / 100` : 'нет данных';
  if (g.avgScore == null) value.classList.add('skill-progress__value--muted');
  head.append(label, value);
  row.append(head);

  if (g.count === 0) {
    const hint = document.createElement('p');
    hint.className = 'skill-progress__empty';
    hint.textContent = 'Пройдите кейсы этой группы, чтобы увидеть прогресс.';
    row.append(hint);
    return row;
  }

  // Полоса среднего балла.
  const bar = document.createElement('div');
  bar.className = 'skill-progress__bar';
  const fill = document.createElement('div');
  fill.className = 'skill-progress__bar-fill';
  fill.style.width = `${g.avgScore ?? 0}%`;
  fill.classList.add(scoreClass(g.avgScore));
  bar.append(fill);
  row.append(bar);

  // Динамика (спарклайн) — если попыток больше одной.
  const scores = g.series.map((p) => p.score).filter((s) => Number.isFinite(s));
  if (scores.length >= 2) {
    const dyn = document.createElement('div');
    dyn.className = 'skill-progress__dynamics';
    const caption = document.createElement('span');
    caption.className = 'skill-progress__dynamics-caption';
    caption.textContent = `Динамика по ${scores.length} попыткам:`;
    dyn.append(caption, sparkline(scores));
    row.append(dyn);
  }

  const meta = document.createElement('p');
  meta.className = 'skill-progress__meta';
  meta.textContent = `Кейсов в группе: ${g.count}`;
  row.append(meta);

  return row;
}

function scoreClass(score) {
  if (score == null) return 'skill-progress__bar-fill--muted';
  if (score >= 75) return 'skill-progress__bar-fill--high';
  if (score >= 50) return 'skill-progress__bar-fill--mid';
  return 'skill-progress__bar-fill--low';
}

// Компактный SVG-спарклайн динамики баллов (0–100 по вертикали).
function sparkline(scores, { width = 220, height = 40 } = {}) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `Динамика баллов: от ${scores[0]} до ${scores[scores.length - 1]} из 100.`,
  );

  const pad = 3;
  const n = scores.length;
  const xStep = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const yOf = (s) => height - pad - (Math.max(0, Math.min(100, s)) / 100) * (height - pad * 2);
  const points = scores.map((s, i) => `${pad + i * xStep},${yOf(s)}`);

  const poly = document.createElementNS(svgNS, 'polyline');
  poly.setAttribute('class', 'sparkline__line');
  poly.setAttribute('points', points.join(' '));
  poly.setAttribute('fill', 'none');
  svg.append(poly);

  // Маркер последней точки.
  const [lastX, lastY] = points[points.length - 1].split(',');
  const dot = document.createElementNS(svgNS, 'circle');
  dot.setAttribute('class', 'sparkline__dot');
  dot.setAttribute('cx', lastX);
  dot.setAttribute('cy', lastY);
  dot.setAttribute('r', '2.5');
  svg.append(dot);

  return svg;
}
