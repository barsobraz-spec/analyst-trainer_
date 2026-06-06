// modules/simulator/StatePanel.js — панель состояния симуляции (T7.2.1, PRD §5.6 Ф1).
//
// Показывает текущие значения ключевых метрик и их динамику по раундам в виде
// таблицы (раунды-столбцы, метрики-строки) — мини-«график» в тексте без внешних
// библиотек. Контроллер: { element, update(history) }, где history — массив
// снимков состояния по раундам (history[0] = старт, history[i] = после раунда i).
//
// metrics: [{ key, label, format?: 'int'|'money'|'percent'|'number', suffix? }].
// Форматирование значений — здесь (единое место), чтобы DecisionForm/RoundResult
// показывали те же числа одинаково (через экспортируемый formatMetricValue).
//
// ES-модуль: `import { StatePanel, formatMetricValue } from './StatePanel.js'`.

// Форматирование одного значения метрики под её формат. Все форматы — русская
// локаль (разделитель разрядов — пробел). Нечисловое/пустое → «—».
export function formatMetricValue(value, metric = {}) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);

  const suffix = metric.suffix ? ` ${metric.suffix}` : '';
  switch (metric.format) {
    case 'money':
      return `${formatNumber(Math.round(num))} ₽${suffix}`;
    case 'percent':
      return `${formatNumber(roundTo(num, 1))}%${suffix}`;
    case 'int':
      return `${formatNumber(Math.round(num))}${suffix}`;
    case 'number':
    default:
      return `${formatNumber(roundTo(num, 2))}${suffix}`;
  }
}

function formatNumber(n) {
  return new Intl.NumberFormat('ru-RU').format(n);
}

function roundTo(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function StatePanel({ metrics = [], title = 'Состояние бизнеса' } = {}) {
  const root = document.createElement('section');
  root.className = 'state-panel';
  root.setAttribute('aria-label', title);

  const h2 = document.createElement('h2');
  h2.className = 'state-panel__title';
  h2.textContent = title;
  root.append(h2);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'state-panel__table-wrap';
  const table = document.createElement('table');
  table.className = 'state-panel__table';
  tableWrap.append(table);
  root.append(tableWrap);

  // history: [startState, afterRound1, afterRound2, ...]. По умолчанию — пусто,
  // CaseView вызывает update() со стартовым состоянием сразу после монтажа.
  function update(history = []) {
    table.replaceChildren();
    if (history.length === 0 || metrics.length === 0) return;

    const roundCount = history.length - 1; // первый снимок — старт

    // Заголовок: метрика | Старт | Раунд 1 | … | Сейчас.
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.append(th('Метрика', 'state-panel__metric-head'));
    headRow.append(th('Старт'));
    for (let i = 1; i <= roundCount; i++) {
      const isLast = i === roundCount;
      headRow.append(th(isLast ? `Раунд ${i} (сейчас)` : `Раунд ${i}`));
    }
    thead.append(headRow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    for (const metric of metrics) {
      const row = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      name.className = 'state-panel__metric-name';
      name.textContent = metric.label || metric.key;
      row.append(name);

      let prev = null;
      history.forEach((snapshot, idx) => {
        const value = snapshot ? snapshot[metric.key] : undefined;
        const td = document.createElement('td');
        td.className = 'state-panel__cell';
        const valueSpan = document.createElement('span');
        valueSpan.className = 'state-panel__value';
        valueSpan.textContent = formatMetricValue(value, metric);
        td.append(valueSpan);

        // Дельта относительно предыдущего снимка (динамика по раундам, Ф1).
        if (idx > 0 && Number.isFinite(value) && Number.isFinite(prev) && value !== prev) {
          td.append(buildDelta(value - prev));
        }
        prev = Number.isFinite(value) ? value : prev;
        row.append(td);
      });
      tbody.append(row);
    }
    table.append(tbody);
  }

  return { element: root, update };
}

function th(text, className) {
  const el = document.createElement('th');
  el.scope = 'col';
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

// Стрелка-индикатор изменения метрики (направление, без оценки «хорошо/плохо» —
// для одних метрик рост хорош, для других плох; цвет нейтральный).
function buildDelta(diff) {
  const span = document.createElement('span');
  span.className = `state-panel__delta state-panel__delta--${diff > 0 ? 'up' : 'down'}`;
  const arrow = diff > 0 ? '▲' : '▼';
  span.textContent = `${arrow} ${formatNumber(roundTo(Math.abs(diff), 1))}`;
  return span;
}
