// modules/simulator/RoundResult.js — разбор последствий раунда (T7.2.3, PRD §5.6 Ф6).
//
// После применения раунда показывает: какое решение было принято и его обоснование,
// как изменились метрики (дельты до→после) и пояснение из payload — как именно
// решение повлияло на бизнес. Чистый рендер (renderRoundResult) — состояние ведёт
// CaseView, здесь только разметка готового результата.
//
// ES-модуль: `import { renderRoundResult } from './RoundResult.js'`.

import { formatMetricValue } from './StatePanel.js';

// args:
//   roundIndex   — 0-based номер раунда (для заголовка показываем +1);
//   decision     — { summary, justification } из DecisionForm.getDecision();
//   before/after — снимки состояния до и после раунда;
//   metrics      — описания метрик (label/format) для форматирования дельт;
//   explanation  — текст-разбор раунда из payload (как решение повлияло).
export function renderRoundResult({ roundIndex = 0, title, decision = {}, before = {}, after = {}, metrics = [], explanation } = {}) {
  const root = document.createElement('div');
  root.className = 'round-result';

  const h3 = document.createElement('h3');
  h3.className = 'round-result__title';
  h3.textContent = title ? `Итог: ${title}` : `Итог раунда ${roundIndex + 1}`;
  root.append(h3);

  // Принятое решение и обоснование (фиксируем выбор пользователя).
  if (decision.summary) {
    root.append(line('round-result__decision', 'Решение: ', decision.summary));
  }
  if (decision.justification) {
    root.append(line('round-result__justification', 'Обоснование: ', decision.justification));
  }

  // Как изменились метрики (до → после с дельтой).
  const changes = buildChanges(metrics, before, after);
  if (changes) root.append(changes);

  // Пояснение из payload — как решение повлияло на метрики (Ф6).
  if (explanation) {
    const exp = document.createElement('div');
    exp.className = 'round-result__explanation';
    for (const para of String(explanation).split(/\n\s*\n/)) {
      const p = document.createElement('p');
      p.textContent = para.trim();
      exp.append(p);
    }
    root.append(exp);
  }

  return root;
}

function buildChanges(metrics, before, after) {
  const rows = [];
  for (const metric of metrics) {
    const a = after?.[metric.key];
    const b = before?.[metric.key];
    if (a == null) continue;
    if (Number.isFinite(a) && Number.isFinite(b) && a === b) continue; // без изменений — пропускаем
    rows.push({ metric, before: b, after: a });
  }
  if (rows.length === 0) return null;

  const wrap = document.createElement('ul');
  wrap.className = 'round-result__changes';
  for (const { metric, before: b, after: a } of rows) {
    const li = document.createElement('li');
    li.className = 'round-result__change';
    const name = document.createElement('span');
    name.className = 'round-result__change-name';
    name.textContent = `${metric.label || metric.key}: `;
    const values = document.createElement('span');
    values.className = 'round-result__change-values';
    values.textContent = `${formatMetricValue(b, metric)} → ${formatMetricValue(a, metric)}`;
    li.append(name, values);
    wrap.append(li);
  }
  return wrap;
}

function line(className, labelText, valueText) {
  const p = document.createElement('p');
  p.className = className;
  const strong = document.createElement('strong');
  strong.textContent = labelText;
  p.append(strong, document.createTextNode(valueText));
  return p;
}
