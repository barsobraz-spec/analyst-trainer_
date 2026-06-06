// modules/caseHost.js — загрузчик и диспетчер экрана кейса (T1.6).
//
// Роут #/module/:id/case/:caseId ведёт сюда. Хост решает общие задачи, не зависящие
// от модуля: найти кейс в манифесте, загрузить и провалидировать его, вычислить
// номер попытки, обработать ошибки (кейс не найден / битый кейс) — и передать
// готовый caseData нужному модульному представлению. Реализованы модули 5.1
// (Data Detective), 5.2 (Hypothesis Trainer), 5.3 (Dashboard Analysis), 5.4
// (Root Cause Analysis), 5.5 (SQL Investigation) и 5.6 (Business Simulator);
// остальные показывают заглушку «в разработке» до своих этапов.
//
// ES-модуль: `import { CaseHost } from './modules/caseHost.js'`.

import { loadIndex, loadCase } from '../core/caseLoader.js';
import { getAttemptNo } from '../core/event.js';
import { caseNavFooter, installSwipeNav } from '../core/components/caseNav.js';
import { DetectiveCaseView } from './detective/CaseView.js';
import { HypothesisCaseView } from './hypothesis/CaseView.js';
import { RcaCaseView } from './rca/CaseView.js';
import { DashboardCaseView } from './dashboard/CaseView.js';
import { SqlCaseView } from './sql/CaseView.js';
import { SimulatorCaseView } from './simulator/CaseView.js';
import { AutomationCaseView } from './automation/CaseView.js';
import { findUserCase } from './automation/userCases.js';

// Реестр модульных представлений. Ключ — id модуля (PRD §5).
const MODULE_VIEWS = {
  '5.1': DetectiveCaseView,
  '5.2': HypothesisCaseView,
  '5.3': DashboardCaseView,
  '5.4': RcaCaseView,
  '5.5': SqlCaseView,
  '5.6': SimulatorCaseView,
  '5.7': AutomationCaseView,
};

// Модуль с пользовательскими кейсами (Automation Designer, PRD §5.7 Ф5).
const USER_CASE_MODULE = '5.7';

export async function CaseHost({ id, caseId }) {
  // Находим запись манифеста по caseId в пределах запрошенного модуля.
  const { entries, error: indexError } = await loadIndex();
  if (indexError) {
    return errorScreen('Не удалось открыть кейс', indexError, id);
  }

  const entry = entries.find((e) => e.caseId === caseId && e.module === id);

  let caseData;
  if (!entry) {
    // В манифесте нет — возможно, это пользовательский кейс 5.7 (PRD §5.7 Ф5).
    if (id === USER_CASE_MODULE) {
      let userCase = null;
      try {
        userCase = await findUserCase(caseId);
      } catch (err) {
        console.error('[caseHost] не удалось прочитать пользовательский кейс', caseId, err);
      }
      if (userCase) {
        caseData = userCase;
      }
    }
    if (!caseData) {
      return errorScreen('Кейс не найден', `Кейс «${caseId}» не найден в модуле ${id}.`, id);
    }
  } else if (entry.status === 'error') {
    return errorScreen(
      'Кейс не найден',
      `Кейс «${caseId}» содержит ошибку в манифесте и не может быть открыт.`,
      id,
    );
  } else {
    // Загружаем и валидируем сам файл кейса (битый кейс не открываем — PRD §6 Ф7).
    const result = await loadCase(entry.path, entry);
    if (!result.ok) {
      return errorScreen('Кейс не загружен', describeError(result.errorCode, result.errorDetail), id);
    }
    caseData = result.case;
  }

  const View = MODULE_VIEWS[id];
  if (!View) {
    return errorScreen(
      'Модуль в разработке',
      `Прохождение кейсов модуля ${id} появится в следующих задачах.`,
      id,
    );
  }

  // Номер попытки (PRD §4). Сбой БД не должен мешать открыть кейс — берём 1.
  let attemptNo = 1;
  try {
    attemptNo = await getAttemptNo(caseId);
  } catch (err) {
    console.error('[caseHost] не удалось вычислить номер попытки', caseId, err);
  }

  const view = await View({ caseData, attemptNo });
  return withCaseChrome(view, id, caseId);
}

// Оборачивает экран кейса общей «обвязкой» навигации: постоянная панель
// «предыдущий/следующий» под кейсом и свайп между кейсами (мобильный жест). Так
// переход между кейсами доступен на любом экране кейса, а отдельным CaseView об
// этом знать не нужно. Контракт жизненного цикла роутера ({ element, destroy })
// сохраняется: destroy снимает обработчики свайпа и вызывает destroy самого экрана.
function withCaseChrome(view, moduleId, caseId) {
  const isView = view && typeof view === 'object'
    && 'element' in view && typeof view.destroy === 'function';
  const inner = isView ? view.element : view;

  const container = document.createElement('div');
  container.className = 'case-shell';
  if (inner instanceof Node) container.append(inner);
  container.append(caseNavFooter(moduleId, caseId));

  const removeSwipe = installSwipeNav(container, caseId);

  return {
    element: container,
    destroy: () => {
      try { removeSwipe(); } catch { /* уже снято */ }
      if (isView) {
        try { view.destroy(); } catch (err) { console.error('[caseHost] ошибка destroy экрана', err); }
      }
    },
  };
}

function describeError(code, detail) {
  const label = {
    schema_invalid: 'ошибка структуры кейса',
    unknown_module: 'неизвестный модуль',
    invalid_tag: 'неизвестный тег навыка',
    dataset_too_large: 'файл кейса слишком большой',
    load_failed: 'файл кейса недоступен',
  }[code] || 'ошибка загрузки';
  return `${label}: ${detail || '—'}`;
}

function errorScreen(heading, message, moduleId) {
  const section = document.createElement('section');
  section.className = 'screen case-host-error';

  const h1 = document.createElement('h1');
  h1.textContent = heading;
  const p = document.createElement('p');
  p.textContent = message;
  const back = document.createElement('a');
  back.href = moduleId ? `#/module/${encodeURIComponent(moduleId)}` : '#/';
  back.textContent = '← К списку кейсов';

  section.append(h1, p, back);
  return section;
}
