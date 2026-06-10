// core/components/SelfAssessment.js — единая механика самооценки (T1.4).
//
// Переиспользуемый компонент из PRD §4 («Единая механика самооценки»): после
// открытия эталона пользователь сверяет свой ответ и выставляет баллы по
// критериям модуля; итог нормализуется в 0–100. Различаются только наборы
// критериев (Ф6 каждого модуля 5.1/5.2/5.3-инсайт/5.4/5.7), сама механика общая.
//
// Принципы (PRD §4):
//   • подсказки НЕ снижают score автоматически — показываем «вы открыли N из M
//     подсказок» как контекст, чтобы пользователь учёл это сам;
//   • для модулей с авто-частью (5.3, 5.5) итог комбинируется с autoFraction по
//     правилам normalizeScore (веса из config.js);
//   • самооценка не редактируется задним числом: после записи события форма
//     блокируется, повторная отправка невозможна (повторная оценка = новая попытка).
//
// Компонент сам вызывает saveAndFinalize (кнопка «Завершить попытку»). Контекст
// попытки (module/caseId/startedAt/skillTags/notes/finishedAt) берётся в момент
// финализации через getEventParams() — это позволяет экрану кейса остановить
// таймер CaseHeader и отдать актуальный finishedAt именно при нажатии кнопки.
//
// ES-модуль: `import { SelfAssessment } from './core/components/SelfAssessment.js'`.

import { normalizeScore, clampScore, saveAndFinalize } from '../event.js';
import { t } from '../i18n.js';

// --- Чистый расчёт доли самооочки (T1.4.2) -----------------------------------
// criteria: [{ id, label, weight?, type?: 'score'|'checkbox' }]
// values:   { [id]: number 0–100 }  (для checkbox значение уже 0 или 100)
// Возвращает долю 0..1 — взвешенное среднее баллов критериев. Если суммарный
// вес равен нулю (нет критериев) — 0.
export function computeSelfFraction(criteria, values) {
  let weightSum = 0;
  let acc = 0;
  for (const c of criteria) {
    const w = Number.isFinite(c.weight) ? c.weight : 1;
    const v = clampScore(values[c.id]); // 0–100, целое
    weightSum += w;
    acc += w * v;
  }
  return weightSum > 0 ? acc / weightSum / 100 : 0;
}

const DEFAULT_HINTS_TOTAL = 3; // PRD §5: до трёх подсказок на кейс

export function SelfAssessment({
  criteria = [],
  hintsUsed = 0,
  hintsTotal = DEFAULT_HINTS_TOTAL,
  autoFraction = null,         // доля авто-части (5.3/5.5) либо null, если её нет
  weights = {},                // { wAuto, wSelf } для комбинации; по умолч. из config
  getEventParams,              // () => { module, caseId, startedAt, finishedAt?, skillTags?, notes? }
  onFinalized,                 // async (event) => void — навигация на разбор/результат
} = {}) {
  const form = document.createElement('form');
  form.className = 'self-assessment';
  form.noValidate = true;

  const legendWrap = document.createElement('div');
  legendWrap.className = 'self-assessment__head';
  const title = document.createElement('h2');
  title.className = 'self-assessment__title';
  title.textContent = t('sa.title');
  legendWrap.append(title);

  // Контекст подсказок (PRD §4: показываем как информацию, на балл не влияет).
  if (hintsTotal > 0) {
    const hints = document.createElement('p');
    hints.className = 'self-assessment__hints';
    hints.textContent = t('sa.hintsCtx', { used: hintsUsed, total: hintsTotal });
    legendWrap.append(hints);
  }
  form.append(legendWrap);

  // Текущее значение каждого критерия (0–100). score-критерии стартуют с 50
  // (нейтрально), checkbox — с 0 (не выполнено).
  const values = {};

  const list = document.createElement('div');
  list.className = 'self-assessment__criteria';

  for (const c of criteria) {
    const isCheckbox = c.type === 'checkbox';
    values[c.id] = isCheckbox ? 0 : 50;
    list.append(buildCriterionRow(c, isCheckbox, (v) => {
      values[c.id] = v;
      refreshTotal();
    }));
  }
  form.append(list);

  // Живой предпросмотр итогового балла (с учётом авто-части, если есть).
  const totalLine = document.createElement('p');
  totalLine.className = 'self-assessment__total';
  form.append(totalLine);

  function currentScore() {
    const selfFraction = computeSelfFraction(criteria, values);
    return normalizeScore(autoFraction, selfFraction, weights);
  }

  function refreshTotal() {
    totalLine.textContent = t('sa.total', { score: currentScore() });
  }
  refreshTotal();

  // --- Кнопка финализации + блокировка повторной отправки (T1.4.3) -----------
  const actions = document.createElement('div');
  actions.className = 'self-assessment__actions';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'self-assessment__submit';
  submit.textContent = t('sa.submit');
  actions.append(submit);

  const status = document.createElement('p');
  status.className = 'self-assessment__status';
  status.setAttribute('role', 'status');
  actions.append(status);

  form.append(actions);

  let finalized = false;
  let submitting = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (finalized || submitting) return; // повторная отправка заблокирована
    submitting = true;
    submit.disabled = true;
    status.textContent = t('sa.saving');

    try {
      const selfFraction = computeSelfFraction(criteria, values);
      const score = normalizeScore(autoFraction, selfFraction, weights);
      const base = (getEventParams ? getEventParams() : {}) || {};

      const event = await saveAndFinalize({
        ...base,
        score,
        selfAssessment: { values: { ...values }, selfFraction },
        hintsUsed,
      });

      // Успех: фиксируем состояние, блокируем редактирование (PRD §4 — без правок
      // задним числом). Повторная оценка = новая попытка.
      finalized = true;
      lockInputs(list);
      submit.hidden = true;
      status.classList.add('self-assessment__status--done');
      status.textContent = t('sa.saved', { score });

      if (onFinalized) await onFinalized(event);
    } catch (err) {
      console.error('[self-assessment] не удалось записать попытку', err);
      status.classList.add('self-assessment__status--error');
      status.textContent = t('sa.error');
      submit.disabled = false; // дать повторить попытку записи (не новую попытку)
      submitting = false;
    }
  });

  return form;
}

// --- Построение одной строки критерия ----------------------------------------
// score-критерий — ползунок 0–100 с числовым индикатором; checkbox-критерий —
// флажок «выполнено», который вносит вес целиком (100) или ноль.
function buildCriterionRow(criterion, isCheckbox, onChange) {
  const row = document.createElement('div');
  row.className = 'self-assessment__row';

  const inputId = `sa-${criterion.id}`;
  const label = document.createElement('label');
  label.className = 'self-assessment__label';
  label.htmlFor = inputId;
  label.textContent = criterion.label || criterion.id;

  if (isCheckbox) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = inputId;
    input.className = 'self-assessment__checkbox';
    input.addEventListener('change', () => onChange(input.checked ? 100 : 0));
    row.append(input, label);
    return row;
  }

  const control = document.createElement('div');
  control.className = 'self-assessment__control';

  const range = document.createElement('input');
  range.type = 'range';
  range.id = inputId;
  range.className = 'self-assessment__range';
  range.min = '0';
  range.max = '100';
  range.step = '5';
  range.value = '50';

  const output = document.createElement('output');
  output.className = 'self-assessment__value';
  output.htmlFor = inputId;
  output.textContent = '50';

  range.addEventListener('input', () => {
    const v = clampScore(Number(range.value));
    output.textContent = String(v);
    onChange(v);
  });

  control.append(range, output);
  row.append(label, control);
  return row;
}

// Блокирует все поля ввода в контейнере (после записи события).
function lockInputs(container) {
  for (const el of container.querySelectorAll('input, button, select, textarea')) {
    el.disabled = true;
  }
}
