// modules/analytics/SummaryPanel.js — сводная панель Learning Analytics (T9.1.1).
//
// PRD §5.8 Ф1: общее число решённых кейсов, средний результат, суммарное время и
// активность по дням. Активность рисуется лёгким bar-chart на чистом DOM/CSS (без
// Chart.js): экран аналитики открывается мгновенно, не тянет 200 КБ библиотеки и
// не оставляет «висящих» инстансов графиков (у роутера нет unmount-хука).
//
// На вход — готовые агрегаты из core/analytics.js (summarize + dailyActivity),
// компонент только отображает.
//
// ES-модуль: `import { SummaryPanel } from './modules/analytics/SummaryPanel.js'`.

export function SummaryPanel({ summary, activity = [] } = {}) {
  const root = document.createElement('section');
  root.className = 'analytics-section summary-panel';

  const h2 = document.createElement('h2');
  h2.className = 'analytics-section__title';
  h2.textContent = 'Сводка';
  root.append(h2);

  // --- Плитки ключевых чисел --------------------------------------------------
  const stats = document.createElement('div');
  stats.className = 'summary-panel__stats';
  stats.append(
    statCard('Решено кейсов', String(summary.solvedCases)),
    statCard('Средний результат', summary.avgScore != null ? `${summary.avgScore} / 100` : '—'),
    statCard('Суммарное время', formatDuration(summary.totalDurationSec)),
    statCard('Всего попыток', String(summary.totalAttempts)),
  );
  root.append(stats);

  // --- Активность по дням -----------------------------------------------------
  const actWrap = document.createElement('div');
  actWrap.className = 'summary-panel__activity';
  const actTitle = document.createElement('h3');
  actTitle.className = 'summary-panel__subtitle';
  actTitle.textContent = 'Активность по дням';
  actWrap.append(actTitle);
  actWrap.append(buildActivityChart(activity));
  root.append(actWrap);

  return root;
}

function statCard(label, value) {
  const card = document.createElement('div');
  card.className = 'summary-panel__stat';
  const v = document.createElement('div');
  v.className = 'summary-panel__stat-value';
  v.textContent = value;
  const l = document.createElement('div');
  l.className = 'summary-panel__stat-label';
  l.textContent = label;
  card.append(v, l);
  return card;
}

// Bar-chart активности: по столбику на день, высота ∝ числу завершённых попыток.
function buildActivityChart(activity) {
  if (activity.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'summary-panel__activity-empty';
    empty.textContent = 'Пока нет данных об активности.';
    return empty;
  }

  const max = Math.max(...activity.map((d) => d.count), 1);
  const chart = document.createElement('div');
  chart.className = 'activity-chart';
  chart.setAttribute('role', 'img');
  chart.setAttribute(
    'aria-label',
    `Активность по дням: ${activity.length} дней, максимум ${max} кейсов за день.`,
  );

  for (const d of activity) {
    const col = document.createElement('div');
    col.className = 'activity-chart__col';
    col.title = `${formatDay(d.date)}: ${d.count} ${plural(d.count)}`;

    const bar = document.createElement('div');
    bar.className = 'activity-chart__bar';
    bar.style.height = `${Math.round((d.count / max) * 100)}%`;
    if (d.count === 0) bar.classList.add('activity-chart__bar--empty');
    col.append(bar);
    chart.append(col);
  }

  return chart;
}

// --- Форматтеры --------------------------------------------------------------

export function formatDuration(totalSec) {
  const s = Math.max(0, Math.round(totalSec || 0));
  if (s === 0) return '0 мин';
  const hours = Math.floor(s / 3600);
  const minutes = Math.round((s % 3600) / 60);
  const parts = [];
  if (hours > 0) parts.push(`${hours} ч`);
  if (minutes > 0 || hours === 0) parts.push(`${minutes} мин`);
  return parts.join(' ');
}

function formatDay(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function plural(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'кейс';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'кейса';
  return 'кейсов';
}
