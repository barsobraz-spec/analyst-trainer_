// modules/sql/SubtaskProgress.js — многошаговое расследование (T6.3.2).
//
// PRD §5.5 Ф4: подзадачи идут по порядку, вывод одной подводит к следующей;
// прогресс сохраняется (статус «в процессе»). Ф3: решение текущей подзадачи
// проверяется автоматически (сверка результата с эталоном — делает CaseView через
// колбэк onCheck, т.к. движок SQL принадлежит ему). Ф5: эталонный запрос с
// пояснением открывается после решения или ПО ЗАПРОСУ.
//
// Сам компонент НЕ владеет ни редактором, ни БД: он ведёт состояние шагов
// (что решено, какой шаг текущий), рисует прогресс и делегирует проверку наружу.
// Сохранение черновика тоже ведёт владелец (CaseView) через onChange(solvedIds).
//
// subtasks: [{ id, prompt, orderSensitive?, referenceSql, explanation? }]
//
// Контроллер: { element, getSolvedIds, getSolvedCount, getTotal, getFraction,
//               allSolved, lock }.
//
// ES-модуль: `import { SubtaskProgress } from './SubtaskProgress.js'`.

export function SubtaskProgress({ subtasks, initialSolved = [], onCheck, onChange } = {}) {
  const list = Array.isArray(subtasks) ? subtasks : [];
  const solved = new Set(initialSolved.filter((id) => list.some((s) => s.id === id)));
  let locked = false;
  let checking = false;

  const root = document.createElement('section');
  root.className = 'subtasks';
  root.setAttribute('aria-label', 'Подзадачи расследования');

  const head = document.createElement('div');
  head.className = 'subtasks__head';
  const h2 = document.createElement('h2');
  h2.className = 'subtasks__title';
  h2.textContent = 'Расследование';
  const progress = document.createElement('p');
  progress.className = 'subtasks__progress';
  head.append(h2, progress);
  root.append(head);

  // Текущий шаг = первый нерешённый (по порядку).
  function currentIndex() {
    const idx = list.findIndex((s) => !solved.has(s.id));
    return idx; // -1, если все решены
  }

  const stepsWrap = document.createElement('ol');
  stepsWrap.className = 'subtasks__list';
  root.append(stepsWrap);

  // Зона текущего шага: подсказка-формулировка, проверка, эталон.
  const active = document.createElement('div');
  active.className = 'subtasks__active';
  root.append(active);

  function render() {
    progress.textContent = `Решено ${solved.size} из ${list.length}`;

    stepsWrap.replaceChildren();
    const curIdx = currentIndex();
    list.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = 'subtasks__step';
      const isSolved = solved.has(s.id);
      const isCurrent = i === curIdx;
      li.classList.toggle('subtasks__step--solved', isSolved);
      li.classList.toggle('subtasks__step--current', isCurrent);

      const marker = document.createElement('span');
      marker.className = 'subtasks__marker';
      marker.textContent = isSolved ? '✓' : String(i + 1);
      const label = document.createElement('span');
      label.className = 'subtasks__step-label';
      // Формулировки ещё не открытых шагов показываем приглушённо, но видимо
      // (расследование линейное — пользователь видит план целиком).
      label.textContent = s.prompt || `Подзадача ${i + 1}`;
      li.append(marker, label);
      stepsWrap.append(li);
    });

    renderActive(curIdx);
  }

  function renderActive(curIdx) {
    active.replaceChildren();
    if (curIdx === -1) {
      const done = document.createElement('p');
      done.className = 'subtasks__all-done';
      done.textContent = '✓ Все подзадачи решены. Можно завершать расследование.';
      active.append(done);
      return;
    }

    const subtask = list[curIdx];

    const prompt = document.createElement('p');
    prompt.className = 'subtasks__active-prompt';
    prompt.append(strong(`Подзадача ${curIdx + 1}. `), document.createTextNode(subtask.prompt || ''));
    active.append(prompt);

    const actions = document.createElement('div');
    actions.className = 'subtasks__actions';

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'subtasks__check';
    checkBtn.textContent = 'Проверить решение';
    checkBtn.disabled = locked || checking;

    const refBtn = document.createElement('button');
    refBtn.type = 'button';
    refBtn.className = 'subtasks__reference-btn';
    refBtn.textContent = 'Показать эталонный запрос';

    actions.append(checkBtn, refBtn);
    active.append(actions);

    const feedback = document.createElement('p');
    feedback.className = 'subtasks__feedback';
    feedback.setAttribute('role', 'status');
    active.append(feedback);

    const reference = buildReference(subtask);
    active.append(reference.element);
    refBtn.addEventListener('click', () => reference.reveal());

    checkBtn.addEventListener('click', async () => {
      if (locked || checking) return;
      checking = true;
      checkBtn.disabled = true;
      feedback.className = 'subtasks__feedback';
      feedback.textContent = 'Выполняем запрос…';
      let verdict;
      try {
        verdict = await onCheck(subtask);
      } catch (err) {
        verdict = { correct: false, message: String(err && err.message || err) };
      }
      checking = false;

      if (verdict && verdict.correct) {
        solved.add(subtask.id);
        feedback.classList.add('subtasks__feedback--ok');
        feedback.textContent = '✓ Верно — подзадача засчитана.';
        reference.reveal(); // после решения эталон открывается (Ф5)
        onChange && onChange([...solved]);
        // Небольшая пауза, чтобы пользователь увидел успех, затем — следующий шаг.
        setTimeout(() => { if (!locked) render(); }, 700);
      } else {
        feedback.classList.add('subtasks__feedback--no');
        feedback.textContent = '✗ ' + ((verdict && verdict.message) || 'Результат не совпал с эталоном. Сверьтесь со схемой и формулировкой.');
        checkBtn.disabled = locked;
      }
    });
  }

  render();

  return {
    element: root,
    getSolvedIds: () => [...solved],
    getSolvedCount: () => solved.size,
    getTotal: () => list.length,
    getCurrentSubtask: () => list[currentIndex()] || null,
    getFraction: () => (list.length ? solved.size / list.length : null),
    allSolved: () => list.length > 0 && solved.size === list.length,
    lock() {
      locked = true;
      for (const el of root.querySelectorAll('button')) el.disabled = true;
    },
  };
}

// Эталонный запрос + пояснение (скрыт до открытия). Внутри SubtaskProgress, т.к.
// привязан к конкретной подзадаче.
function buildReference(subtask) {
  const box = document.createElement('div');
  box.className = 'subtasks__reference';
  box.hidden = true;

  const title = document.createElement('h3');
  title.className = 'subtasks__reference-title';
  title.textContent = 'Эталонный запрос';
  box.append(title);

  const pre = document.createElement('pre');
  pre.className = 'subtasks__reference-sql';
  const code = document.createElement('code');
  code.textContent = subtask.referenceSql || '—';
  pre.append(code);
  box.append(pre);

  if (subtask.explanation) {
    const exp = document.createElement('p');
    exp.className = 'subtasks__reference-explanation';
    exp.textContent = subtask.explanation;
    box.append(exp);
  }

  let revealed = false;
  return {
    element: box,
    reveal() { if (!revealed) { revealed = true; box.hidden = false; } },
  };
}

function strong(text) {
  const el = document.createElement('strong');
  el.textContent = text;
  return el;
}
