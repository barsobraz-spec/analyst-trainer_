// core/courseNav.js — учебный «маршрут» курса: порядок модулей и кейсов + соседи.
//
// Навигатор-сайдбар (Sidebar.js), переход «следующий кейс» (caseScaffold.doneNotice),
// нижняя панель кейса и свайп (caseNav.js) и экран каталога (ModuleCatalog) берут
// отсюда ЕДИНЫЙ порядок прохождения. Источник — манифест cases/index.json (PRD §6 Ф6),
// в порядке модулей 5.1–5.7 и внутри модуля по порядку записей (базовый→продвинутый).
//
// Учебный маршрут НЕ содержит технических фикстур (caseId с ведущим «_», напр.
// _test-broken) и записей с битыми метаданными — это демо ошибок контента, они видны
// только в списке кейсов модуля, но не в «следующий/предыдущий».
//
// Манифест статичен в пределах сессии, поэтому результат кэшируется (один fetch).
//
// ES-модуль: `import { getOutline, getAdjacent } from './core/courseNav.js'`.

import { loadIndex } from './caseLoader.js';
import { CASE_MODULES } from './modules.js';

let outlinePromise = null;

// В учебный маршрут попадают только корректные содержательные кейсы.
function isLearningCase(entry) {
  return entry
    && entry.status !== 'error'
    && typeof entry.caseId === 'string'
    && entry.caseId.charAt(0) !== '_';
}

// Структура маршрута:
//   { modules: [{ id, title, cases: [{ caseId, module, title, difficulty }] }],
//     flat:    [ ...все кейсы по порядку прохождения ] }
export function getOutline() {
  if (!outlinePromise) outlinePromise = buildOutline();
  return outlinePromise;
}

async function buildOutline() {
  let entries = [];
  try {
    const res = await loadIndex();
    entries = Array.isArray(res?.entries) ? res.entries : [];
  } catch (err) {
    console.error('[courseNav] не удалось загрузить манифест курса', err);
  }

  const learning = entries.filter(isLearningCase);

  const modules = CASE_MODULES.map((m) => ({
    id: m.id,
    title: m.title,
    cases: learning
      .filter((e) => e.module === m.id)
      .map((e) => ({
        caseId: e.caseId,
        module: e.module,
        title: e.title || e.caseId,
        difficulty: e.difficulty,
      })),
  }));

  const flat = [];
  for (const mod of modules) {
    for (const c of mod.cases) flat.push(c);
  }
  flat.forEach((c, i) => { c.order = i; });

  return { modules, flat };
}

// Положение кейса в маршруте: соседи (через границы модулей — после последнего
// кейса 5.1 идёт первый кейс 5.2), а также index/total для различения «последний
// кейс курса» и «кейса нет в маршруте». Неизвестный caseId (например пользовательский
// кейс 5.7, которого нет в манифесте) даёт index:-1 — потребители тогда не предлагают
// ни «следующий», ни «курс пройден», а ведут к списку кейсов модуля.
export async function getAdjacent(caseId) {
  const { flat } = await getOutline();
  const i = flat.findIndex((c) => c.caseId === caseId);
  if (i === -1) return { prev: null, next: null, index: -1, total: flat.length };
  return {
    prev: i > 0 ? flat[i - 1] : null,
    next: i < flat.length - 1 ? flat[i + 1] : null,
    index: i,
    total: flat.length,
  };
}

// Хеш-ссылка на экран кейса. Используется навигацией и переходом «следующий».
export function caseHash(c) {
  return `#/module/${encodeURIComponent(c.module)}/case/${encodeURIComponent(c.caseId)}`;
}
