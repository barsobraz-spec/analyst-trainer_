// modules/automation/ReadinessChecklist.js — чек-лист готовности автоматизации (T8.2.1).
//
// PRD §5.7 Ф3: четыре критерия готовности проекта — определён триггер, описаны
// входы/выходы каждого шага, учтены исключения, определён измеримый результат.
// Чек-лист формирует балл: `score = (пройдено пунктов / всего пунктов) · 100`
// (T8.2). В отличие от ручного чек-листа гипотез (5.2), здесь критерии проверяются
// АВТОМАТИЧЕСКИ по текущей схеме процесса — это честнее (балл нельзя «накликать»)
// и напрямую связывает оценку с построенной схемой (Ф1/Ф2).
//
// Балл используется как итог для пользовательских кейсов (Ф5/Ф6: эталона нет —
// `score` = доля выполненных пунктов). Для встроенных кейсов чек-лист служит
// рабочим ориентиром, а итог выставляет самооценка (см. modules/automation/CaseView.js).
//
// Контроллер: { element, refresh(schema), getFraction, getScore, getState, lock }.
// Экран кейса вызывает refresh(builder.getState()) при каждом изменении схемы.
//
// ES-модуль: `import { ReadinessChecklist } from './modules/automation/ReadinessChecklist.js'`.

function nonEmpty(node, field) {
  const v = node && node[field];
  return typeof v === 'string' && v.trim().length > 0;
}

// Критерии готовности (PRD §5.7 Ф3). Каждый — предикат над массивом узлов схемы.
export const READINESS_CRITERIA = [
  {
    id: 'trigger',
    label: 'Определён триггер',
    hint: 'Есть стартовый узел-триггер с описанием, что запускает процесс.',
    test: (nodes) => nodes.some((n) => n.type === 'trigger' && nonEmpty(n, 'title')),
  },
  {
    id: 'io',
    label: 'Описаны входы и выходы каждого шага',
    hint: 'У каждого действия и условия заполнены поля «вход» и «выход».',
    test: (nodes) => {
      const steps = nodes.filter((n) => n.type === 'action' || n.type === 'condition');
      return steps.length > 0 && steps.every((n) => nonEmpty(n, 'input') && nonEmpty(n, 'output'));
    },
  },
  {
    id: 'exceptions',
    label: 'Учтены исключения',
    hint: 'В схеме есть узел-условие, отрабатывающий нештатный случай.',
    test: (nodes) => nodes.some((n) => n.type === 'condition' && nonEmpty(n, 'title')),
  },
  {
    id: 'outcome',
    label: 'Определён измеримый результат',
    hint: 'Есть итоговый узел, в поле «выход» которого описан измеримый результат.',
    test: (nodes) => nodes.some((n) => n.type === 'outcome' && nonEmpty(n, 'title') && nonEmpty(n, 'output')),
  },
];

// Чистый расчёт: какие критерии пройдены для данной схемы. Вынесен наружу, чтобы
// его могли переиспользовать тесты и (при желании) экспорт.
export function evaluateReadiness(schema) {
  const nodes = Array.isArray(schema) ? schema : Array.isArray(schema?.nodes) ? schema.nodes : [];
  const valid = nodes.filter((n) => n && typeof n === 'object');
  const state = {};
  let passed = 0;
  for (const c of READINESS_CRITERIA) {
    const ok = !!c.test(valid);
    state[c.id] = ok;
    if (ok) passed += 1;
  }
  const fraction = READINESS_CRITERIA.length ? passed / READINESS_CRITERIA.length : 0;
  return { state, passed, total: READINESS_CRITERIA.length, fraction };
}

export function ReadinessChecklist({ initialSchema } = {}) {
  const root = document.createElement('section');
  root.className = 'readiness';

  const title = document.createElement('h2');
  title.className = 'readiness__title';
  title.textContent = 'Чек-лист готовности';
  root.append(title);

  const list = document.createElement('ul');
  list.className = 'readiness__list';
  root.append(list);

  const rows = {};
  for (const c of READINESS_CRITERIA) {
    const li = document.createElement('li');
    li.className = 'readiness__row';

    const mark = document.createElement('span');
    mark.className = 'readiness__mark';
    mark.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'readiness__text';
    const label = document.createElement('span');
    label.className = 'readiness__label';
    label.textContent = c.label;
    const hint = document.createElement('span');
    hint.className = 'readiness__hint';
    hint.textContent = c.hint;
    text.append(label, hint);

    li.append(mark, text);
    list.append(li);
    rows[c.id] = { li, mark, label };
  }

  const score = document.createElement('p');
  score.className = 'readiness__score';
  root.append(score);

  let last = { fraction: 0, passed: 0, total: READINESS_CRITERIA.length, state: {} };

  // Пересчёт по текущей схеме: обновляем отметки и балл.
  function refresh(schema) {
    last = evaluateReadiness(schema);
    for (const c of READINESS_CRITERIA) {
      const ok = last.state[c.id];
      const row = rows[c.id];
      row.li.classList.toggle('readiness__row--done', ok);
      row.mark.textContent = ok ? '✓' : '○';
      row.label.setAttribute('aria-label', `${c.label}: ${ok ? 'выполнено' : 'не выполнено'}`);
    }
    score.textContent = `Готовность: ${last.passed} из ${last.total} · балл ${getScore()}`;
  }

  function getFraction() { return last.fraction; }
  function getScore() { return Math.round(last.fraction * 100); }
  function getState() { return { ...last.state }; }

  function lock() {
    root.classList.add('readiness--locked');
  }

  refresh(initialSchema);
  return { element: root, refresh, getFraction, getScore, getState, lock };
}
