// modules/shared/caseCatalog.js — сводный справочник метаданных кейсов.
//
// Несколько новых экранов (Избранное, История, Практика, прогресс по навыку)
// показывают кейсы «вперемешку» из разных модулей и потому им нужно по caseId
// быстро узнать модуль/название/сложность. Манифест (cases/index.json) и
// пользовательские кейсы 5.7 (IndexedDB, только чтение) объединяются здесь в одну
// карту — чтобы не дублировать эту склейку на каждом экране (как уже делает
// AnalyticsView). Только чтение: логика и хранилище не меняются.
//
// Лежит в modules/, а не в core/: импортирует modules/automation/userCases.js
// (core по слоям не зависит от modules).
//
// ES-модуль: `import { loadCaseMetaMap } from './modules/shared/caseCatalog.js'`.

import { loadIndex } from '../../core/caseLoader.js';
import { listAutomationUserCases } from '../automation/userCases.js';

// Map caseId → { caseId, module, title, difficulty, isUserCase, broken }.
// `broken` — запись манифеста помечена ошибкой (битый кейс); такие не открываем.
// Никогда не бросает: сбой манифеста/хранилища → то, что удалось прочитать.
export async function loadCaseMetaMap() {
  const map = new Map();

  let entries = [];
  try {
    ({ entries } = await loadIndex());
  } catch (err) {
    console.error('[caseCatalog] не удалось загрузить манифест', err);
  }
  for (const e of entries) {
    if (!e || typeof e.caseId !== 'string') continue;
    map.set(e.caseId, {
      caseId: e.caseId,
      module: e.module,
      title: e.title || e.caseId,
      difficulty: e.difficulty,
      isUserCase: false,
      broken: e.status === 'error',
    });
  }

  let userCases = [];
  try {
    userCases = await listAutomationUserCases();
  } catch (err) {
    console.error('[caseCatalog] не удалось прочитать пользовательские кейсы', err);
  }
  for (const c of userCases) {
    if (!c || typeof c.caseId !== 'string') continue;
    map.set(c.caseId, {
      caseId: c.caseId,
      module: c.module || '5.7',
      title: c.title || c.caseId,
      difficulty: c.difficulty || 'basic',
      isUserCase: true,
      broken: false,
    });
  }

  return map;
}
