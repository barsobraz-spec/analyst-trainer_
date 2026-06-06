// modules/sql/SQLEditor.js — SQL-редактор с подсветкой синтаксиса (T6.2.1).
//
// PRD §5.5 Ф1: поле ввода с подсветкой синтаксиса. Используем CodeMirror 5 из
// vendor/ (ленивая загрузка). Если CodeMirror по какой-то причине не поднялся —
// откатываемся на обычный <textarea>, чтобы кейс всё равно проходился (graceful
// degradation: подсветка — украшение, а не условие работы).
//
// Возвращает контроллер { element, getValue, setValue, focus, refresh }. refresh()
// нужен после монтирования в DOM — CodeMirror корректно пересчитывает размеры
// только когда виден на странице.
//
// ES-модуль: `import { SQLEditor } from './SQLEditor.js'`.

import { loadCodeMirror } from './loadCodeMirror.js';

export async function SQLEditor({ initialValue = '', onRun } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sql-editor';

  const textarea = document.createElement('textarea');
  textarea.className = 'sql-editor__textarea';
  textarea.value = initialValue;
  textarea.setAttribute('aria-label', 'Поле SQL-запроса');
  wrap.append(textarea);

  let CM;
  try {
    CM = await loadCodeMirror();
  } catch (err) {
    console.error('[sql] CodeMirror не загрузился — откат на textarea', err);
    return plainTextareaController(wrap, textarea, onRun);
  }

  const cm = CM.fromTextArea(textarea, {
    mode: 'text/x-sql',
    lineNumbers: true,
    lineWrapping: true,
    autofocus: false,
    viewportMargin: Infinity, // высота по содержимому — поле растёт под запрос
    extraKeys: {
      'Ctrl-Enter': () => onRun && onRun(),
      'Cmd-Enter': () => onRun && onRun(),
    },
  });

  return {
    element: wrap,
    getValue: () => cm.getValue(),
    setValue: (v) => { cm.setValue(v == null ? '' : String(v)); cm.refresh(); },
    focus: () => cm.focus(),
    refresh: () => cm.refresh(),
  };
}

// Запасной режим без CodeMirror: те же методы, Ctrl/Cmd-Enter тоже работают.
function plainTextareaController(wrap, textarea, onRun) {
  textarea.rows = 6;
  textarea.classList.add('sql-editor__textarea--plain');
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onRun && onRun();
    }
  });
  return {
    element: wrap,
    getValue: () => textarea.value,
    setValue: (v) => { textarea.value = v == null ? '' : String(v); },
    focus: () => textarea.focus(),
    refresh: () => {},
  };
}
