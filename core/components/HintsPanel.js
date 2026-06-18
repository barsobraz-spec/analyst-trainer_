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

import { h } from '../dom.js';

export function HintsPanel({ hints = [], onReveal } = {}) {
  const panel = h('section', { className: 'hints-panel' },
    h('h2', { className: 'hints-panel__title' }, 'Подсказки'),
  );

  // Нормализуем элементы: допускаем массив строк или объектов { text }.
  const items = hints
    .map((hint) => (typeof hint === 'string' ? hint : (hint && hint.text) || ''))
    .filter((t) => t.trim().length > 0);

  let hintsUsed = 0;

  if (items.length === 0) {
    panel.append(h('p', { className: 'hints-panel__empty' }, 'Для этого кейса подсказок нет.'));
    return { element: panel, getHintsUsed: () => 0 };
  }

  // Список открытых подсказок (наполняется по одной).
  const list = h('ol', { className: 'hints-panel__list' });
  const button = h('button', { type: 'button', className: 'hints-panel__reveal' });
  panel.append(list, button);

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
    list.append(h('li', { className: 'hints-panel__item' }, items[hintsUsed]));
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
