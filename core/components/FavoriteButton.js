// core/components/FavoriteButton.js — кнопка-звёздочка «в избранное».
//
// Переиспользуемый контрол: на любом кейсе (строка списка, карточка практики и т.д.)
// ставит/снимает отметку «избранное». Состояние держит core/favorites.js
// (localStorage), эта кнопка — только UI. По клику переключает отметку и сам
// обновляет вид; ничего не знает о странице, на которой стоит.
//
// Кнопка — отдельный элемент, НЕ вложена в ссылку кейса (вложенная интерактивность
// в <a> недопустима), поэтому клик по звезде не открывает кейс. По умолчанию
// слушателей на window НЕ вешает (чтобы на длинных списках не плодить утечки):
// перерисовывается по своему клику. Для экранов, где нужна живая синхронизация
// между несколькими звёздами одного кейса, можно передать { live: true } —
// тогда кнопка подписывается на FAVORITES_EVENT и возвращает { element, destroy }.
//
// ES-модуль: `import { FavoriteButton } from './core/components/FavoriteButton.js'`.

import { isFavorite, toggleFavorite, FAVORITES_EVENT } from '../favorites.js';

// FavoriteButton(caseId, { live }) → HTMLButtonElement | { element, destroy }.
export function FavoriteButton(caseId, { live = false } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fav-btn';
  btn.append(starIcon());

  function sync() {
    const fav = isFavorite(caseId);
    btn.classList.toggle('is-fav', fav);
    btn.setAttribute('aria-pressed', String(fav));
    const label = fav ? 'Убрать из избранного' : 'Добавить в избранное';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  btn.addEventListener('click', (e) => {
    // Звезда живёт рядом со ссылкой-кейсом — гасим всплытие/навигацию.
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(caseId);
    sync();
  });

  sync();

  if (!live) return btn;

  const onChange = (e) => {
    if (!e.detail || e.detail.caseId === caseId) sync();
  };
  window.addEventListener(FAVORITES_EVENT, onChange);
  return {
    element: btn,
    destroy: () => window.removeEventListener(FAVORITES_EVENT, onChange),
  };
}

function starIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 3.2l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 16.9l-5.31 2.79 1.01-5.9L3.41 9.43l5.93-.86L12 3.2z');
  svg.append(path);
  return svg;
}
