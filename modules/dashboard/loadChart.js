// modules/dashboard/loadChart.js — ленивая загрузка Chart.js из vendor/ (T5.1).
//
// Chart.js лежит локально (vendor/chart.js/chart.umd.js) и подключается ТОЛЬКО
// когда открывается кейс модуля 5.3 — на стартовой странице 200 КБ библиотеки
// не грузятся, консоль остаётся чистой (см. комментарий в index.html).
//
// UMD-сборка при загрузке обычным <script> (без module/AMD-окружения) кладёт
// конструктор в глобал `window.Chart`. Поэтому грузим её инъекцией <script> и
// резолвимся, когда глобал появился. Промис кэшируется — повторные открытия
// кейсов 5.3 берут уже загруженную библиотеку.
//
// ES-модуль: `import { loadChart } from './loadChart.js'`.

let chartPromise = null;

export function loadChart() {
  if (typeof window !== 'undefined' && window.Chart) {
    return Promise.resolve(window.Chart);
  }
  if (chartPromise) return chartPromise;

  chartPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // URL считаем относительно этого модуля, чтобы не зависеть от document base.
    script.src = new URL('../../vendor/chart.js/chart.umd.js', import.meta.url).href;
    script.async = true;
    script.onload = () => {
      if (window.Chart) resolve(window.Chart);
      else reject(new Error('Chart.js загрузился, но глобал Chart недоступен.'));
    };
    script.onerror = () => {
      chartPromise = null; // дать шанс повторить попытку при следующем открытии
      reject(new Error('Не удалось загрузить Chart.js из vendor/.'));
    };
    document.head.append(script);
  });
  return chartPromise;
}
