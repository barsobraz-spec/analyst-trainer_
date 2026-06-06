// modules/detective/ReasoningChain.js — цепочка рассуждений модуля 5.1 (T1.6.2).
//
// PRD §5.1 Ф2: пользователь строит ответ по шагам «что я вижу в данных» → «что это
// значит» → «вывод». Каждый шаг — отдельное текстовое поле; шаги можно добавлять и
// удалять. Незавершённая цепочка сохраняется (статус «в процессе») — за сохранение
// отвечает экран кейса через колбэк onChange (он дебаунсит и пишет черновик в
// IndexedDB), здесь — только UI и состояние.
//
// Возвращает контроллер { element, getSteps, getRawSteps, isEmpty, lock }, потому
// что экрану кейса нужно: читать заполненные шаги (для записи/черновика), знать,
// пуста ли цепочка (Ф3 — блокировка отправки), и заблокировать ввод после отправки.
//
// ES-модуль: `import { ReasoningChain } from './modules/detective/ReasoningChain.js'`.

// Подсказки-плейсхолдеры по умолчанию (PRD §5.1 Ф2). Кейс может переопределить их
// через payload.reasoning.stepPrompts; число стартовых шагов = число подсказок.
const DEFAULT_PROMPTS = [
  'Что я вижу в данных?',
  'Что это значит?',
  'Вывод',
];

export function ReasoningChain({ initialSteps, prompts, onChange } = {}) {
  const stepPrompts = Array.isArray(prompts) && prompts.length > 0 ? prompts : DEFAULT_PROMPTS;

  const root = document.createElement('section');
  root.className = 'reasoning-chain';

  const title = document.createElement('h2');
  title.className = 'reasoning-chain__title';
  title.textContent = 'Цепочка рассуждений';
  root.append(title);

  const hint = document.createElement('p');
  hint.className = 'reasoning-chain__hint';
  hint.textContent = 'Стройте вывод по шагам: что видно в данных → что это значит → вывод.';
  root.append(hint);

  const list = document.createElement('ol');
  list.className = 'reasoning-chain__list';
  root.append(list);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'reasoning-chain__add';
  addBtn.textContent = '+ Добавить шаг';
  addBtn.addEventListener('click', () => {
    addStep('');
    notify();
  });
  root.append(addBtn);

  let locked = false;

  // Восстанавливаем сохранённый черновик, иначе заводим по одному пустому шагу на
  // каждую подсказку (стартовый каркас «вижу → значит → вывод»).
  const seed = Array.isArray(initialSteps) && initialSteps.length > 0
    ? initialSteps
    : stepPrompts.map(() => '');
  for (const value of seed) addStep(value);

  function addStep(value) {
    const index = list.children.length; // для плейсхолдера-подсказки
    const li = document.createElement('li');
    li.className = 'reasoning-chain__step';

    const textarea = document.createElement('textarea');
    textarea.className = 'reasoning-chain__input';
    textarea.rows = 2;
    textarea.value = value || '';
    textarea.placeholder = stepPrompts[index] || 'Следующий шаг рассуждения…';
    textarea.addEventListener('input', notify);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'reasoning-chain__remove';
    remove.textContent = 'Удалить';
    remove.setAttribute('aria-label', 'Удалить шаг');
    remove.addEventListener('click', () => {
      if (locked) return;
      // Всегда оставляем хотя бы одно поле — иначе экран «схлопывается».
      if (list.children.length <= 1) {
        textarea.value = '';
      } else {
        li.remove();
      }
      notify();
    });

    li.append(textarea, remove);
    list.append(li);
  }

  function getRawSteps() {
    return [...list.querySelectorAll('.reasoning-chain__input')].map((t) => t.value);
  }

  function getSteps() {
    return getRawSteps().map((s) => s.trim()).filter((s) => s.length > 0);
  }

  function isEmpty() {
    return getSteps().length === 0;
  }

  function lock() {
    locked = true;
    for (const el of root.querySelectorAll('textarea, button')) el.disabled = true;
  }

  function notify() {
    if (onChange) onChange();
  }

  return { element: root, getSteps, getRawSteps, isEmpty, lock };
}
