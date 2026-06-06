// modules/automation/userCases.js — пользовательские кейсы автоматизации (T8.3.1).
//
// PRD §5.7 Ф5: пользователь может завести собственную задачу на автоматизацию и
// спроектировать её в том же конструкторе. Свой кейс хранится в IndexedDB (store
// `userCases`) рядом с прогрессом и попадает в экспорт/импорт (это уже обеспечено
// общим бэкапом store'ов в T2.1 — отдельной логики не требуется).
//
// Объект пользовательского кейса повторяет каркас встроенного кейса (PRD §4
// «JSON-схема кейса»), чтобы экран кейса и список кейсов работали с ним единообразно:
// те же поля module/title/difficulty/skillTags/payload. Признак `isUserCase: true`
// отличает свой кейс от встроенного (нет эталона → итог по чек-листу готовности,
// PRD §5.7 Ф6) и помечает строку в списке.
//
// ES-модуль: `import { createUserCase, listAutomationUserCases, findUserCase }
//             from './modules/automation/userCases.js'`.

import { saveUserCase, getUserCases } from '../../core/db.js';
import { StorageError } from '../../core/db.js';

const AUTOMATION_MODULE = '5.7';

// Создаёт и сохраняет пользовательский кейс автоматизации (T8.3.1).
// Возвращает сохранённый объект кейса (с присвоенным caseId).
export async function createUserCase(title, description) {
  const cleanTitle = String(title ?? '').trim();
  if (!cleanTitle) {
    throw new StorageError('bad_input', 'У задачи должно быть название.');
  }

  const obj = {
    caseId: `user-${crypto.randomUUID()}`,
    module: AUTOMATION_MODULE,
    schemaVersion: 1,
    title: cleanTitle,
    difficulty: 'basic',
    skillTags: ['automation-design'],
    isUserCase: true,
    createdAt: Date.now(),
    payload: {
      scenario: String(description ?? '').trim(),
      question:
        'Спроектируйте автоматизацию: постройте схему «Триггер → Шаги → Результат», ' +
        'заполните карточки шагов и пройдите чек-лист готовности.',
    },
  };

  await saveUserCase(obj);
  return obj;
}

// Все пользовательские кейсы модуля 5.7 (свежие сверху). Никогда не бросает на
// «нет данных» — при сбое хранилища возвращает пустой список, список кейсов
// останется работоспособным (как и встроенные кейсы при сбое статуса).
export async function listAutomationUserCases() {
  let all = [];
  try {
    all = await getUserCases();
  } catch (err) {
    console.error('[automation] не удалось прочитать пользовательские кейсы', err);
    return [];
  }
  return all
    .filter((c) => c && c.module === AUTOMATION_MODULE)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// Находит пользовательский кейс по caseId (для открытия из caseHost). null, если нет.
export async function findUserCase(caseId) {
  const all = await listAutomationUserCases();
  return all.find((c) => c.caseId === caseId) ?? null;
}
