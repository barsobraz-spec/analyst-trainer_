// core/components/HintsPanel.js — панель подсказок по запросу (T1.5.2).
//
// PRD §5 Ф4: подсказки открываются по одной по желанию пользователя, число
// открытых пишется в hintsUsed. Подсказки НЕ снижают score автоматически
// (PRD §4 «Влияние подсказок на балл») — этот компонент только показывает их и
// считает hintsUsed; интерпретацией занимается самооценка и Learning Analytics.
//
// Число подсказок задаётся содержимым кейса (PRD: «до трёх»), поэтому компонент
// работает с произвольным N, а не зашивает 3.
//
// Возвращает контроллер { element, getHintsUsed }, потому что вызывающему (экрану
// кейса / SelfAssessment) при финализации нужно прочитать актуальное hintsUsed.
// Опциональный onReveal(hintsUsed) позволяет вживую обновлять контекст самооценки.
//
// ES-модуль: `import { HintsPanel } from './core/components/HintsPanel.js'`.

export function HintsPanel({ hints = [], onReveal } = {}) {
  const panel = document.createElement('section');
  panel.className = 'hints-panel';

  const title = document.createElement('h2');
  title.className = 'hints-panel__title';
  title.textContent = 'Подсказки';
  panel.append(title);

  // Нормализуем элементы: допускаем массив строк или объектов { text }.
  const items = hints
    .map((h) => (typeof h === 'string' ? h : (h && h.text) || ''))
    .filter((t) => t.trim().length > 0);

  let hintsUsed = 0;

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hints-panel__empty';
    empty.textContent = 'Для этого кейса подсказок нет.';
    panel.append(empty);
    return { element: panel, getHintsUsed: () => 0 };
  }

  // Список открытых подсказок (наполняется по одной).
  const list = document.createElement('ol');
  list.className = 'hints-panel__list';
  panel.append(list);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hints-panel__reveal';
  panel.append(button);

  function updateButton() {
    const remaining = items.length - hintsUsed;
    if (remaining <= 0) {
      button.disabled = true;
      button.textContent = 'Все подсказки открыты';
    } else {
      button.textContent = `Открыть подсказку (осталось ${remaining})`;
    }
  }

  button.addEventListener('click', () => {
    if (hintsUsed >= items.length) return;
    const li = document.createElement('li');
    li.className = 'hints-panel__item';
    li.textContent = items[hintsUsed];
    list.append(li);
    hintsUsed += 1;
    updateButton();
    if (onReveal) onReveal(hintsUsed);
  });

  updateButton();

  return {
    element: panel,
    getHintsUsed: () => hintsUsed,
  };
}
