// core/favorites.js — список «избранных» кейсов (отмеченных звёздочкой).
//
// Избранное — это пользовательская закладка, а НЕ прогресс прохождения. По духу
// раздела PRD §3 («localStorage допустим для UI-настроек, прогресс — в IndexedDB»)
// храним отметки в localStorage: это UI-уровень, IndexedDB и логику прохождения
// не трогаем. Ключ — массив caseId; порядок = порядок добавления (свежие в конец).
//
// Любое изменение шлёт событие `at:favorites-changed`, чтобы открытые экраны
// (страница «Избранное», звёздочки в списках) обновлялись без перезагрузки.
//
// ES-модуль: `import { isFavorite, toggleFavorite, getFavorites } from './core/favorites.js'`.

export const FAVORITES_KEY = 'at-favorites';
export const FAVORITES_EVENT = 'at:favorites-changed';

// Читает массив caseId из localStorage. Любой сбой (нет доступа, битый JSON) →
// пустой список: избранное необязательно для работы приложения.
function read() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch (err) {
    // Переполнение/приватный режим — не критично, просто не сохранится.
    console.error('[favorites] не удалось сохранить избранное', err);
  }
}

function emit(caseId, favorite) {
  window.dispatchEvent(new CustomEvent(FAVORITES_EVENT, { detail: { caseId, favorite } }));
}

// Все избранные caseId (копия — наружу не отдаём внутренний массив).
export function getFavorites() {
  return read();
}

export function isFavorite(caseId) {
  return read().includes(caseId);
}

// Переключает отметку и возвращает новое состояние (true — теперь в избранном).
export function toggleFavorite(caseId) {
  if (!caseId) return false;
  const list = read();
  const i = list.indexOf(caseId);
  let favorite;
  if (i === -1) {
    list.push(caseId);
    favorite = true;
  } else {
    list.splice(i, 1);
    favorite = false;
  }
  write(list);
  emit(caseId, favorite);
  return favorite;
}

// Явно задать состояние (для программных сценариев). Возвращает итоговое состояние.
export function setFavorite(caseId, favorite) {
  if (!caseId) return false;
  if (isFavorite(caseId) === favorite) return favorite;
  return toggleFavorite(caseId);
}
