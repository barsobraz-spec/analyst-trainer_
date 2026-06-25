// core/components/DataControls.js — точка входа экспорта/импорта в шапке (T2.1.3).
//
// Постоянно доступна из шапки (PRD §6 Ф5 / §3): «Экспорт» скачивает резервную
// копию всего прогресса, «Импорт» загружает её обратно. Импорт ЗАМЕНЯЕТ весь
// текущий прогресс, поэтому требует подтверждения (диалог подтверждения T2.1) —
// здесь оно инлайновое и на экране, чтобы сообщение было видно, а не во
// всплывающем окне браузера. Результат и ошибки выводятся текстом рядом (PRD:
// «при ошибке — понятное сообщение на экране»).
//
// Вся логика выгрузки/загрузки и миграций — в core/backup.js; здесь только UI.
// ES-модуль: `import { DataControls } from './core/components/DataControls.js'`.

import { exportAll, parseBackupFile, importAll, clearProgress } from '../backup.js?v=v1.6';
import { navigate } from '../router.js';
import { PROGRESS_EVENT } from '../event.js?v=v1.6';

export function DataControls() {
  const root = document.createElement('div');
  root.className = 'data-controls';

  const exportBtn = button('Экспорт', 'data-controls__btn');
  exportBtn.title = 'Скачать резервную копию всего прогресса в JSON-файл';

  const importBtn = button('Импорт', 'data-controls__btn');
  importBtn.title = 'Загрузить прогресс из ранее сохранённого файла';

  const resetBtn = button('Сброс', 'data-controls__btn data-controls__btn--danger');
  resetBtn.title = 'Очистить весь прогресс прохождения, сохранив настройки курса';

  // Скрытый файловый input — клик по «Импорт» открывает выбор файла.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;

  // Инлайновая панель подтверждения импорта (показывается после выбора файла).
  const confirmBar = document.createElement('span');
  confirmBar.className = 'data-controls__confirm';
  confirmBar.hidden = true;

  // Статусная строка: результат экспорта/импорта или ошибка.
  const status = document.createElement('span');
  status.className = 'data-controls__status';
  status.setAttribute('aria-live', 'polite');

  root.append(exportBtn, importBtn, resetBtn, fileInput, confirmBar, status);

  function setStatus(text, kind = 'info') {
    status.textContent = text;
    status.dataset.kind = kind;
    // Ошибку анонсируем ассистивным технологиям настойчивее, чем обычный статус.
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function setBusy(busy) {
    exportBtn.disabled = busy;
    importBtn.disabled = busy;
    resetBtn.disabled = busy;
  }

  // --- Экспорт: скачивание без подтверждения (действие не разрушительное) -----
  exportBtn.addEventListener('click', async () => {
    setBusy(true);
    setStatus('Готовлю файл…');
    try {
      const backup = await exportAll();
      setStatus(`Сохранено: резервная копия (${countRecords(backup.stores)} записей).`, 'success');
    } catch (err) {
      reportError('экспорт', err);
    } finally {
      setBusy(false);
    }
  });

  // --- Импорт: выбор файла → подтверждение → замена данных --------------------
  importBtn.addEventListener('click', () => {
    fileInput.value = ''; // позволяем выбрать тот же файл повторно
    fileInput.click();
  });

  resetBtn.addEventListener('click', () => {
    askResetConfirm();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    let backup;
    try {
      backup = await parseBackupFile(file);
    } catch (err) {
      reportError('импорт', err);
      return;
    }
    askConfirm(backup);
  });

  function askConfirm(backup) {
    setStatus('');
    setBusy(true); // на время подтверждения блокируем повторные действия
    confirmBar.replaceChildren();

    const text = document.createElement('span');
    text.className = 'data-controls__confirm-text';
    text.textContent = 'Импорт заменит весь текущий прогресс. Продолжить?';

    const yes = button('Заменить', 'data-controls__confirm-yes');
    const no = button('Отмена', 'data-controls__confirm-no');

    no.addEventListener('click', () => {
      hideConfirmBar();
      setBusy(false);
      setStatus('Импорт отменён — данные не изменены.');
    });

    yes.addEventListener('click', async () => {
      // Прячем подтверждение, но НЕ снимаем busy: кнопки остаются заблокированными
      // до конца записи, чтобы нельзя было запустить экспорт/импорт поверх импорта.
      hideConfirmBar();
      setStatus('Импортирую…');
      try {
        const result = await importAll(backup);
        const total = Object.values(result.counts).reduce((n, c) => n + c, 0);
        setStatus(`Импортировано: ${total} записей. Прогресс обновлён.`, 'success');
        // Перерисовываем текущий экран — статистика/списки должны отразить новые данные.
        navigate(location.hash || '#/');
      } catch (err) {
        reportError('импорт', err);
      } finally {
        setBusy(false);
      }
    });

    confirmBar.append(text, yes, no);
    confirmBar.hidden = false;
  }

  function askResetConfirm() {
    setStatus('');
    setBusy(true);
    confirmBar.replaceChildren();

    const text = document.createElement('span');
    text.className = 'data-controls__confirm-text';
    text.textContent = 'Сброс очистит прохождение, черновики, задачи, проекты и карьерный трек. Продолжить?';

    const yes = button('Сбросить', 'data-controls__confirm-yes data-controls__confirm-yes--danger');
    const no = button('Отмена', 'data-controls__confirm-no');

    no.addEventListener('click', () => {
      hideConfirmBar();
      setBusy(false);
      setStatus('Сброс отменён — данные не изменены.');
    });

    yes.addEventListener('click', async () => {
      hideConfirmBar();
      setStatus('Очищаю прогресс…');
      try {
        const result = await clearProgress({ keepLearningSettings: true });
        const totalKept = Object.values(result.counts).reduce((n, c) => n + c, 0);
        setStatus(`Прогресс сброшен. Сохранено служебных записей: ${totalKept}.`, 'success');
        window.dispatchEvent(new CustomEvent(PROGRESS_EVENT, { detail: { reset: true } }));
        navigate(location.hash || '#/');
      } catch (err) {
        reportError('сброс', err);
      } finally {
        setBusy(false);
      }
    });

    confirmBar.append(text, yes, no);
    confirmBar.hidden = false;
  }

  function hideConfirmBar() {
    confirmBar.hidden = true;
    confirmBar.replaceChildren();
  }

  function reportError(op, err) {
    setStatus(err?.message || `Не удалось выполнить ${op}. Попробуйте ещё раз.`, 'error');
    console.error(`[backup] ${op} не удался:`, err?.code || err?.name, err);
  }

  return root;
}

function button(label, className) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  return b;
}

// Сумма записей по всем stores — для краткого статуса «N записей».
function countRecords(stores) {
  return Object.values(stores).reduce(
    (n, v) => n + (Array.isArray(v) ? v.length : 0),
    0,
  );
}
