// core/components/ProgressRing.js — кольцевой индикатор прогресса (SVG).
//
// Маленький переиспользуемый компонент: кольцо с долей 0–100 и процентом в центре.
// Используют дашборд («До цели Junior Analyst») и сайдбар (карточка цели).
//
// ES-модуль: `import { ProgressRing } from './core/components/ProgressRing.js'`.

export function ProgressRing(pct, { size = 104, stroke = 10 } = {}) {
  const value = Math.max(0, Math.min(100, Math.round(pct) || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);

  const wrap = document.createElement('div');
  wrap.className = 'progress-ring';
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `Прогресс ${value}%`);
  const svg = svgEl('svg', {
    viewBox: `0 0 ${size} ${size}`,
    width: String(size),
    height: String(size),
  });
  svg.append(
    svgEl('circle', {
      class: 'progress-ring__track',
      cx: String(size / 2),
      cy: String(size / 2),
      r: String(r),
      fill: 'none',
      'stroke-width': String(stroke),
    }),
    svgEl('circle', {
      class: 'progress-ring__fill',
      cx: String(size / 2),
      cy: String(size / 2),
      r: String(r),
      fill: 'none',
      'stroke-width': String(stroke),
      'stroke-linecap': 'round',
      'stroke-dasharray': String(c),
      'stroke-dashoffset': String(off),
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
    }),
  );
  const label = document.createElement('span');
  label.className = 'progress-ring__label';
  label.textContent = `${value}%`;
  wrap.append(svg, label);
  return wrap;
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}
