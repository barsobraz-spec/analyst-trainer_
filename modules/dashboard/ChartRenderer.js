// modules/dashboard/ChartRenderer.js — интерактивный дашборд из данных кейса (T5.1).
//
// PRD §5.3 Ф1: графики строятся ИЗ ДАННЫХ КЕЙСА (без правок кода приложения),
// поддерживаются типы line / bar / pie, наведение показывает значение точки/сегмента
// (нативный tooltip Chart.js), и — если кейс это задаёт — переключение периодов.
//
// Источник — `payload.charts` (см. JSON-схему ниже). Рендерер не знает предметной
// области: он лишь переносит описание графика в конфиг Chart.js. Chart.js грузится
// ленино (loadChart) — поэтому функция асинхронная.
//
// JSON-схема графика (элемент payload.charts):
//   {
//     "id": "revenue",                  // нужен AnomalyMarker'у и разбору
//     "title": "Выручка по месяцам",
//     "type": "line" | "bar" | "pie",
//     "labels": ["Янв","Фев", …],       // подписи оси X / сегментов
//     "datasets": [ { "label": "Выручка", "data": [ … ] } ],
//     "valueSuffix": " тыс ₽",          // опц.: подпись к значению в tooltip
//     "periods": [                       // опц.: переключение периодов (Ф1)
//       { "id": "2024", "label": "2024", "labels": [ … ], "datasets": [ … ] }
//     ]
//   }
//
// Возвращает контроллер { element, getChart(id), destroy() }. destroy() уничтожает
// инстансы Chart.js (у роутера нет unmount-хука — известное ограничение, см. T1.6;
// экран кейса вызывает destroy при финализации, чтобы не копить ResizeObserver'ы).
//
// ES-модуль: `import { ChartRenderer } from './ChartRenderer.js'`.

import { loadChart } from './loadChart.js';
import { MAX_DATASET_BYTES } from '../../config.js';

// Палитра серий — насыщенные цвета, читаемые на обеих темах (Chart.js рисует на
// canvas, цвета серий не наследуют CSS). Текст/сетку/легенду подкрашиваем под
// активную тему через themeColors() (T10.3), чтобы график был читаем и в тёмной.
const SERIES_COLORS = ['#2f6feb', '#1f7a3d', '#bf8700', '#8250df', '#cf222e', '#0a7ea4'];

// Считывает цвета текущей темы из CSS-переменных (--text, --text-muted, --border).
// Берём с documentElement, где висит data-theme; пустые значения подстраховываем.
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  return {
    text: pick('--text', '#1b1f24'),
    muted: pick('--text-muted', '#6a737d'),
    grid: pick('--border', '#e1e4e8'),
  };
}

export async function ChartRenderer({ charts } = {}) {
  const root = document.createElement('section');
  root.className = 'dashboard';
  root.setAttribute('aria-label', 'Интерактивный дашборд');

  const list = Array.isArray(charts) ? charts : [];

  // Защита от слишком тяжёлого описания графиков (PRD §5.3: датасет > лимита —
  // ошибка контента, не «зависание» вкладки). Размер файла кейса уже проверен
  // загрузчиком; здесь страхуемся от гигантских inline-массивов точек.
  const approxBytes = roughByteSize(list);
  if (approxBytes > MAX_DATASET_BYTES) {
    root.append(errorBlock(
      `Данные дашборда слишком большие (${Math.round(approxBytes / 1024)} КБ) — кейс отмечен как ошибочный контент.`,
    ));
    return { element: root, getChart: () => null, destroy() {} };
  }

  if (list.length === 0) {
    root.append(errorBlock('В кейсе не задано ни одного графика.'));
    return { element: root, getChart: () => null, destroy() {} };
  }

  let Chart;
  try {
    Chart = await loadChart();
  } catch (err) {
    console.error('[dashboard] Chart.js не загрузился', err);
    root.append(errorBlock('Не удалось загрузить библиотеку графиков. Обновите страницу.'));
    return { element: root, getChart: () => null, destroy() {} };
  }

  const instances = new Map(); // id → Chart

  list.forEach((spec, i) => {
    const card = buildChartCard(Chart, spec, i, instances);
    root.append(card);
  });

  return {
    element: root,
    getChart: (id) => instances.get(id) || null,
    destroy() {
      for (const chart of instances.values()) {
        try { chart.destroy(); } catch { /* уже уничтожен */ }
      }
      instances.clear();
    },
  };
}

// --- Одна карточка графика (заголовок + переключатель периодов + canvas) ------
function buildChartCard(Chart, spec, index, instances) {
  const card = document.createElement('figure');
  card.className = 'dashboard__chart';

  if (spec.title) {
    const cap = document.createElement('figcaption');
    cap.className = 'dashboard__chart-title';
    cap.textContent = spec.title;
    card.append(cap);
  }

  // Переключатель периодов (Ф1) — только если кейс задал несколько периодов.
  const periods = Array.isArray(spec.periods) && spec.periods.length > 0 ? spec.periods : null;
  let activePeriod = periods ? periods[0] : null;

  const canvas = document.createElement('canvas');
  canvas.className = 'dashboard__canvas';
  // Доступная подпись: canvas не читается скринридером, даём текстовое резюме.
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', describeChart(spec, activePeriod));

  const chartId = spec.id || `chart-${index}`;

  function dataFor(source) {
    return {
      labels: source.labels || spec.labels || [],
      datasets: (source.datasets || spec.datasets || []).map((ds, di) => styleDataset(ds, di, spec.type)),
    };
  }

  let controls = null;
  if (periods) {
    controls = document.createElement('div');
    controls.className = 'dashboard__periods';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Период');
    periods.forEach((p, pi) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dashboard__period';
      btn.textContent = p.label || p.id || `Период ${pi + 1}`;
      btn.setAttribute('aria-pressed', String(pi === 0));
      btn.addEventListener('click', () => {
        if (activePeriod === p) return;
        activePeriod = p;
        const next = dataFor(p);
        chart.data.labels = next.labels;
        chart.data.datasets = next.datasets;
        chart.update();
        canvas.setAttribute('aria-label', describeChart(spec, p));
        for (const b of controls.children) b.setAttribute('aria-pressed', String(b === btn));
      });
      controls.append(btn);
    });
    card.append(controls);
  }

  card.append(canvas);

  const chart = new Chart(canvas, {
    type: spec.type === 'pie' ? 'pie' : spec.type === 'bar' ? 'bar' : 'line',
    data: dataFor(activePeriod || spec),
    options: chartOptions(spec),
  });

  instances.set(chartId, chart);
  return card;
}

// Применяет цвет серии и базовый стиль в зависимости от типа графика.
function styleDataset(ds, di, type) {
  const color = SERIES_COLORS[di % SERIES_COLORS.length];
  const data = Array.isArray(ds.data) ? ds.data : [];
  if (type === 'pie') {
    // У круговой диаграммы цвет — у каждого сегмента, а не у серии.
    return {
      label: ds.label || '',
      data,
      backgroundColor: data.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length]),
      borderColor: '#ffffff',
      borderWidth: 2,
    };
  }
  if (type === 'bar') {
    return { label: ds.label || '', data, backgroundColor: color, borderColor: color, borderWidth: 1 };
  }
  // line
  return {
    label: ds.label || '',
    data,
    borderColor: color,
    backgroundColor: color,
    pointBackgroundColor: color,
    tension: 0.25,
    fill: false,
  };
}

function chartOptions(spec) {
  const isPie = spec.type === 'pie';
  const suffix = spec.valueSuffix || '';
  const theme = themeColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false, // детерминированно для проверок и быстрее на слабых машинах
    color: theme.text, // базовый цвет текста (легенда, подписи) под тему
    plugins: {
      legend: { display: isPie || (spec.datasets || []).length > 1, labels: { color: theme.text } },
      tooltip: {
        // Ф1: наведение показывает значение точки/сегмента.
        callbacks: {
          label: (ctx) => {
            const base = isPie ? ctx.label : (ctx.dataset.label || '');
            const value = isPie ? ctx.parsed : ctx.parsed.y;
            return `${base ? base + ': ' : ''}${value}${suffix}`;
          },
        },
      },
    },
    scales: isPie ? {} : {
      x: {
        ticks: { color: theme.muted },
        grid: { color: theme.grid },
      },
      y: {
        beginAtZero: true,
        title: { display: !!spec.yLabel, text: spec.yLabel || '', color: theme.muted },
        ticks: { color: theme.muted },
        grid: { color: theme.grid },
      },
    },
  };
}

// Текстовое резюме графика для скринридера (canvas сам по себе нечитаем).
function describeChart(spec, period) {
  const labels = (period && period.labels) || spec.labels || [];
  const datasets = (period && period.datasets) || spec.datasets || [];
  const kind = spec.type === 'pie' ? 'круговая диаграмма' : spec.type === 'bar' ? 'столбчатая диаграмма' : 'линейный график';
  const series = datasets.map((d) => d.label).filter(Boolean).join(', ');
  return `${spec.title || 'График'} — ${kind}${series ? `, ряды: ${series}` : ''}, точек: ${labels.length}.`;
}

// Грубая оценка размера inline-данных графиков (без полной сериализации в строку
// каждой проверки — берём JSON.stringify один раз).
function roughByteSize(charts) {
  try {
    return new Blob([JSON.stringify(charts)]).size;
  } catch {
    return 0;
  }
}

function errorBlock(text) {
  const p = document.createElement('p');
  p.className = 'dashboard__error';
  p.setAttribute('role', 'alert');
  p.textContent = text;
  return p;
}
