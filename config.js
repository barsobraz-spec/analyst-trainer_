// config.js — единая точка истины для всех настраиваемых констант приложения.
// ES-модуль: импортируется как `import { CONFIG, DURATION_CAP_SEC } from './config.js'`.
// Все числа берутся из PRD.md (§3, §4) и TASKS.md (T0.1). Менять значения — только здесь.

// --- Версия приложения ---
// Показывается на экране «О проекте». Семантическая версия: проект прошёл все
// этапы TASKS.md (0–10) и функционально полон — отсюда 1.0.
export const APP_VERSION = '1.0.0';

// --- Версия кэша ассетов ---
// ЕДИНСТВЕННАЯ точка смены cache-bust суффикса ?v=v1.7
//   index.html  <link href="styles.css?v=v1.7">  и  <script src="main.js?v=v1.7">
//   main.js     import '…/appRoutes.js?v=v1.7'
//   core/appRoutes.js  import '…/TasksView.js?v=v1.7'
//
// Когда нужно сбросить кэш браузера — измени значение здесь, затем запусти:
//   bash scripts/bump-cache-version.sh
// Скрипт подставит новое значение во все четыре места.
export const APP_CACHE_VERSION = 'v1.7';

// --- Лимиты контента ---
// Максимальный размер исходного датасета одного кейса (PRD §3: 5 MB).
export const MAX_DATASET_BYTES = 5 * 1024 * 1024; // 5 242 880

// --- Время попытки ---
// Кап засчитываемой длительности попытки (PRD §4: 90 минут = 5400 сек).
export const DURATION_CAP_SEC = 5400;

// --- Нормализация score (PRD §4) ---
// Веса авто-проверки и самооценки для комбинированного балла (5.3, 5.5).
export const W_AUTO = 0.5;
export const W_SELF = 0.5;

// --- SQL Investigation (5.5): движок sql.js в Web Worker (T6.1) ---
// Таймаут одного запроса: если sql.js не ответил за это время (например, тяжёлый
// декартов JOIN), воркер принудительно завершается и пересоздаётся — вкладка не
// «зависает» (PRD §2 принцип 3, §5.5). Считается на главном потоке.
export const SQL_QUERY_TIMEOUT_MS = 5000;
// Максимум строк результата, отображаемых в таблице (защита UI от огромных выборок;
// сравнение с эталоном работает по полному результату, ограничен лишь показ).
export const SQL_MAX_DISPLAY_ROWS = 200;

// --- Learning Analytics: бонус сложности к score (T9.2) ---
export const ADJ_BONUS = { basic: 0, intermediate: 10, advanced: 20 };

// --- Learning Analytics: правило выявления слабых мест (T9.2) ---
export const WEAK_SCORE_THRESHOLD = 60; // средний adjScore ниже — кандидат в «слабые»
export const WEAK_HINTS_THRESHOLD = 1;  // средний hintsUsed выше — кандидат в «слабые»
export const WEAK_MIN_ATTEMPTS = 3;     // минимум попыток, чтобы вообще оценивать модуль
export const WEAK_WINDOW = 5;           // по скольким последним попыткам считать среднее

// Агрегирующий объект — удобно логировать/передавать целиком.
export const CONFIG = {
  APP_VERSION,
  MAX_DATASET_BYTES,
  DURATION_CAP_SEC,
  W_AUTO,
  W_SELF,
  SQL_QUERY_TIMEOUT_MS,
  SQL_MAX_DISPLAY_ROWS,
  ADJ_BONUS,
  WEAK_SCORE_THRESHOLD,
  WEAK_HINTS_THRESHOLD,
  WEAK_MIN_ATTEMPTS,
  WEAK_WINDOW,
};
