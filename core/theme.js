// core/theme.js — переключение светлой/тёмной темы (T10.3.2).
//
// Тема хранится в localStorage (мелкая UI-настройка — PRD §3 разрешает localStorage
// именно для этого, прогресс при этом остаётся в IndexedDB). Источник истины о
// текущей теме — атрибут data-theme на <html>; CSS-палитры висят на :root и
// [data-theme="dark"] (см. styles.css). Чтобы не было мерцания при загрузке, тему
// применяет крошечный инлайн-скрипт в <head> ещё до отрисовки; этот модуль лишь
// предоставляет переключатель в шапке и общие хелперы.
//
// ES-модуль: `import { ThemeToggle, applyStoredTheme } from './core/theme.js'`.

export const THEME_KEY = 'at-theme';
const THEMES = ['light', 'dark'];

// Прочитать сохранённую тему; если явного выбора не было — СВЕТЛАЯ (основная тема
// продукта, как на макете, см. styles.css). localStorage может быть недоступен
// (приватный режим) — тогда молча используем дефолт, тема не критична для работы.
export function getStoredTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch { /* localStorage недоступен — игнорируем */ }
  if (THEMES.includes(stored)) return stored;
  return 'dark';
}

// Применить тему к документу. Атрибут data-theme ставится ЯВНО ('light' | 'dark'):
// тёмная палитра живёт в :root, светлая — в [data-theme="light"], поэтому достаточно
// корректного значения атрибута (см. styles.css).
export function applyTheme(theme) {
  const value = THEMES.includes(theme) ? theme : 'dark';
  document.documentElement.setAttribute('data-theme', value);
  return value;
}

// Применить сохранённую тему (на случай, если инлайн-скрипт в <head> отсутствует).
export function applyStoredTheme() {
  return applyTheme(getStoredTheme());
}

// Текущая активная тема по состоянию документа.
export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

// Сохранить выбор пользователя (тихо игнорирует недоступный localStorage).
function persistTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* не критично */ }
}

// Кнопка-переключатель темы для шапки. Иконка-только, поэтому обязателен
// aria-label + aria-pressed (T10.3.4). Возвращает готовый <button>.
export function ThemeToggle() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-toggle';

  const sync = () => {
    const dark = currentTheme() === 'dark';
    // Иконка показывает, КУДА переключим (солнце в тёмной теме, луна в светлой).
    btn.textContent = dark ? '☀' : '☾';
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('aria-label', dark ? 'Переключить на светлую тему' : 'Переключить на тёмную тему');
    btn.title = btn.getAttribute('aria-label');
  };

  btn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    persistTheme(next);
    sync();
  });

  sync();
  return btn;
}
