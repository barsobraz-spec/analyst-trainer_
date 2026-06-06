// modules/sql/loadCodeMirror.js — ленивая загрузка CodeMirror 5 + SQL-режима (T6.2.1).
//
// CodeMirror лежит локально (vendor/codemirror/) и подключается ТОЛЬКО при открытии
// кейса 5.5 — на стартовой странице редактор не грузится. UMD-сборка при загрузке
// обычным <script> кладёт глобал `window.CodeMirror`; режим mode/sql/sql.js — это
// плагин, который при загрузке регистрирует SQL-режим в уже существующем глобале.
// Поэтому порядок важен: сначала ядро + его CSS, затем SQL-режим.
//
// Промис кэшируется — повторные открытия кейсов 5.5 берут уже загруженную библиотеку.
//
// ES-модуль: `import { loadCodeMirror } from './loadCodeMirror.js'`.

let cmPromise = null;

export function loadCodeMirror() {
  if (typeof window !== 'undefined' && window.CodeMirror) {
    return Promise.resolve(window.CodeMirror);
  }
  if (cmPromise) return cmPromise;

  cmPromise = (async () => {
    injectCss(new URL('../../vendor/codemirror/codemirror.css', import.meta.url).href);
    await loadScript(new URL('../../vendor/codemirror/codemirror.js', import.meta.url).href);
    // SQL-режим регистрируется в глобал CodeMirror, поэтому грузится строго после ядра.
    await loadScript(new URL('../../vendor/codemirror/mode/sql/sql.js', import.meta.url).href);
    if (!window.CodeMirror) throw new Error('CodeMirror загрузился, но глобал CodeMirror недоступен.');
    return window.CodeMirror;
  })().catch((err) => {
    cmPromise = null; // дать шанс повторить при следующем открытии
    throw err;
  });

  return cmPromise;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false; // сохраняем порядок (ядро → режим)
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
    document.head.append(s);
  });
}

function injectCss(href) {
  if (document.querySelector(`link[data-cm-css="1"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.cmCss = '1';
  document.head.append(link);
}
