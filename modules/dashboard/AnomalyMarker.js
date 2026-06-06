// modules/dashboard/AnomalyMarker.js — задача «Найди аномалию» (T5.2).
//
// PRD §5.3 Ф3: пользователь отмечает точку/период на графике; система сверяет с
// заложенной аномалией и засчитывает попадание С ДОПУСКОМ ПО ПОЗИЦИИ (tolerance).
//
// Реализация выбора — кнопки по подписям периодов (а не клик по точке canvas):
// это доступнее и тестируемо (тот же приём, что у матрицы 5.2 — селект вместо
// drag-and-drop). Допуск позиционный: |индекс выбора − индекс аномалии| ≤ tolerance,
// поэтому «соседний» период засчитывается, если кейс это разрешил.
//
// Засчитанная аномалия — это одна авто-задача: её результат входит в общий
// autoFraction (агрегацию ведёт CaseView, T5.2.3).
//
// JSON-схема (payload.anomaly):
//   {
//     "chartId": "revenue",   // график, по которому ищем аномалию (берём его labels)
//     "index": 6,             // индекс аномального периода в labels
//     "tolerance": 0,         // допуск по позиции (по умолчанию 0 — точное попадание)
//     "prompt": "Отметьте месяц с аномальным провалом выручки",
//     "explanation": "…"      // опц. пояснение после ответа
//   }
//
// Контроллер: { element, isAnswered, isCorrect, getResult, lock }.
//
// ES-модуль: `import { AnomalyMarker } from './AnomalyMarker.js'`.

export function AnomalyMarker({ anomaly, labels } = {}) {
  const root = document.createElement('section');
  root.className = 'anomaly';
  root.setAttribute('aria-label', 'Поиск аномалии');

  const opts = Array.isArray(labels) ? labels : [];
  const targetIndex = Number.isInteger(anomaly?.index) ? anomaly.index : -1;
  const tolerance = Number.isFinite(anomaly?.tolerance) ? Math.abs(anomaly.tolerance) : 0;

  const h2 = document.createElement('h2');
  h2.className = 'anomaly__title';
  h2.textContent = 'Найди аномалию';
  root.append(h2);

  const prompt = document.createElement('p');
  prompt.className = 'anomaly__prompt';
  prompt.textContent = anomaly?.prompt || 'Отметьте период, который выглядит аномальным.';
  root.append(prompt);

  let answered = false;
  let correct = false;
  let chosenIndex = -1;

  const choices = document.createElement('div');
  choices.className = 'anomaly__choices';
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', prompt.textContent);

  const buttons = [];
  opts.forEach((label, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'anomaly__choice';
    btn.textContent = String(label);
    btn.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      chosenIndex = i;
      correct = targetIndex >= 0 && Math.abs(i - targetIndex) <= tolerance;
      btn.classList.add(correct ? 'anomaly__choice--ok' : 'anomaly__choice--no');
      // Подсветим правильный период, если пользователь промахнулся.
      if (!correct && buttons[targetIndex]) buttons[targetIndex].classList.add('anomaly__choice--target');
      for (const b of buttons) b.disabled = true;
      showFeedback();
    });
    buttons.push(btn);
    choices.append(btn);
  });
  root.append(choices);

  const feedback = document.createElement('p');
  feedback.className = 'anomaly__feedback';
  feedback.setAttribute('role', 'status');
  root.append(feedback);

  function showFeedback() {
    feedback.classList.add(correct ? 'anomaly__feedback--ok' : 'anomaly__feedback--no');
    const verdict = correct ? '✓ Аномалия отмечена верно.' : '✗ Это не аномальный период.';
    feedback.textContent = anomaly?.explanation ? `${verdict} ${anomaly.explanation}` : verdict;
  }

  return {
    element: root,
    isAnswered: () => answered,
    isCorrect: () => correct,
    getResult: () => ({ answered, correct, chosenIndex, targetIndex }),
    lock() {
      for (const b of buttons) b.disabled = true;
    },
  };
}
