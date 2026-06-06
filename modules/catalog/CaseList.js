// modules/catalog/CaseList.js — экран списка кейсов модуля (T1.2).
//
// Реализует PRD §6 Ф2 (список кейсов модуля со сложностью, статусом и последним
// результатом) и Ф3 (фильтр по уровню сложности). Открывается по #/module/:id.
//
// Принципы (общие с каталогом, ModuleCatalog.js):
//   • один битый кейс не ломает экран — он показывается как «ошибочный» с причиной
//     и НЕ открывается (PRD §6 Ф7);
//   • статусы кейсов считаются параллельно; сбой хранилища по кейсу → прочерк
//     вместо статуса, список остаётся работоспособным (PRD §3);
//   • фильтр по сложности — чисто клиентский, без повторной загрузки.
//
// ES-модуль: `import { CaseList } from './modules/catalog/CaseList.js'`.

import { getModule } from '../../core/modules.js';
import { loadAllCases } from '../../core/caseLoader.js';
import { getCaseStatus } from '../../core/stats.js';
import { StatusBadge, DifficultyBadge } from '../../core/components/StatusBadge.js';
import { FavoriteButton } from '../../core/components/FavoriteButton.js';
import { navigate } from '../../core/router.js';
import { createUserCase, listAutomationUserCases } from '../automation/userCases.js';

// Модуль, в котором пользователь может заводить свои кейсы (PRD §5.7 Ф5).
const USER_CASE_MODULE = '5.7';

// Порядок и состав кнопок фильтра сложности (Ф3). 'all' — без фильтра.
const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'basic', label: 'Базовый' },
  { key: 'intermediate', label: 'Средний' },
  { key: 'advanced', label: 'Продвинутый' },
];

export async function CaseList({ id }) {
  const section = document.createElement('section');
  section.className = 'case-list screen';

  const module = getModule(id);

  // Неизвестный модуль или модуль без кейсов (5.8 Learning Analytics ведёт на
  // отдельный экран и сюда попадать не должен) — показываем понятную заглушку.
  if (!module || !module.hasCases) {
    return notAModuleScreen(section, id);
  }

  const h1 = document.createElement('h1');
  h1.textContent = `${module.id} · ${module.title}`;
  section.append(h1);

  const intro = document.createElement('p');
  intro.className = 'case-list__intro';
  intro.textContent = module.description;
  section.append(intro);

  // Грузим только кейсы этого модуля (фильтрация по module на уровне манифеста).
  const { cases, indexError } = await loadAllCases({ module: module.id });

  if (indexError) {
    section.append(banner(`Не удалось прочитать список кейсов: ${indexError}`));
  }

  // Модуль 5.7: подмешиваем пользовательские кейсы (Ф5) к встроенным. Свои кейсы —
  // готовые объекты-кейсы из IndexedDB; помечаем их status:'ok' для единообразия.
  if (module.id === USER_CASE_MODULE) {
    const userCases = await listAutomationUserCases();
    for (const uc of userCases) {
      cases.push({ ...uc, status: 'ok' });
    }
    // Точка входа создания своей задачи (T8.3.1) — над фильтрами и списком.
    section.append(buildUserCaseCreator(module.id));
  }

  // Статусы только для рабочих кейсов и параллельно; порядок кейсов сохраняем.
  // Сбой по конкретному кейсу не валит экран — статус останется null (прочерк).
  const statusById = new Map();
  await Promise.all(
    cases.filter((c) => c.status === 'ok').map(async (c) => {
      try {
        statusById.set(c.caseId, await getCaseStatus(c.caseId));
      } catch (err) {
        console.error('[case-list] не удалось получить статус кейса', c.caseId, err);
        statusById.set(c.caseId, null);
      }
    }),
  );

  if (cases.length === 0) {
    section.append(emptyState('В этом модуле пока нет кейсов.'));
    return section;
  }

  // --- Фильтр по сложности (Ф3) + перерисовываемый список --------------------
  let activeFilter = 'all';

  const toolbar = document.createElement('div');
  toolbar.className = 'case-list__filters';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Фильтр по сложности');

  const list = document.createElement('ul');
  list.className = 'case-list__items';

  function renderList() {
    const visible = activeFilter === 'all'
      ? cases
      : cases.filter((c) => c.difficulty === activeFilter);

    list.replaceChildren();
    if (visible.length === 0) {
      list.append(emptyState('Нет кейсов выбранной сложности.'));
      return;
    }
    for (const c of visible) {
      list.append(buildCaseItem(module.id, c, statusById.get(c.caseId)));
    }
  }

  for (const f of FILTERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'case-list__filter';
    btn.textContent = f.label;
    btn.setAttribute('aria-pressed', String(f.key === activeFilter));
    btn.addEventListener('click', () => {
      if (activeFilter === f.key) return;
      activeFilter = f.key;
      for (const b of toolbar.children) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
      renderList();
    });
    toolbar.append(btn);
  }

  section.append(toolbar, list);
  renderList();
  return section;
}

// --- Элемент списка: рабочий кейс или ошибочный ------------------------------

function buildCaseItem(moduleId, c, statusInfo) {
  const li = document.createElement('li');

  // Ошибочный кейс (PRD §6 Ф2/Ф7): виден с причиной, но не открывается.
  if (c.status === 'error') {
    li.className = 'case-row case-row--error';

    const head = document.createElement('div');
    head.className = 'case-row__head';
    head.append(
      caseTitle(c.title || c.caseId || 'Без названия'),
      DifficultyBadge(c.difficulty),
    );
    li.append(head);

    const reason = document.createElement('p');
    reason.className = 'case-row__error';
    reason.textContent = `Кейс не загружен (${describeError(c.errorCode)}): ${c.errorDetail || '—'}`;
    li.append(reason);
    return li;
  }

  // Рабочий кейс — целиком ссылка на экран прохождения (#/module/:id/case/:caseId).
  // Звёздочка «в избранное» — сосед ссылки (не вложена в <a>), поэтому клик по
  // звезде не открывает кейс. Обёртка-<li> даёт корректную разметку списка и якорь
  // для абсолютно позиционированной звезды.
  li.className = 'case-row-wrap';

  const link = document.createElement('a');
  link.className = 'case-row';
  link.href = `#/module/${moduleId}/case/${encodeURIComponent(c.caseId)}`;

  const head = document.createElement('div');
  head.className = 'case-row__head';
  head.append(caseTitle(c.title), DifficultyBadge(c.difficulty));
  if (c.isUserCase) head.append(userCaseBadge());
  link.append(head);

  const meta = document.createElement('div');
  meta.className = 'case-row__meta';
  // statusInfo: { status, lastScore } | null (null — статус недоступен из-за сбоя БД).
  meta.append(StatusBadge(statusInfo ? statusInfo.status : null), lastScore(statusInfo));
  link.append(meta);

  li.append(link, FavoriteButton(c.caseId));
  return li;
}

function caseTitle(text) {
  const h2 = document.createElement('h2');
  h2.className = 'case-row__title';
  h2.textContent = text;
  return h2;
}

// Метка-иконка «своя задача» рядом с заголовком пользовательского кейса (T8.3.2).
function userCaseBadge() {
  const span = document.createElement('span');
  span.className = 'case-row__user-badge';
  span.textContent = '★ Своя задача';
  span.title = 'Кейс создан вами';
  return span;
}

// --- Точка входа «Создать свою задачу» (T8.3.1, PRD §5.7 Ф5) ------------------
// Кнопка раскрывает форму (название + описание); по созданию кейс пишется в
// IndexedDB и сразу открывается в конструкторе процесса.
function buildUserCaseCreator(moduleId) {
  const wrap = document.createElement('div');
  wrap.className = 'user-case-creator';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'user-case-creator__toggle';
  toggle.textContent = '+ Создать свою задачу';
  wrap.append(toggle);

  const form = document.createElement('form');
  form.className = 'user-case-creator__form';
  form.hidden = true;
  form.noValidate = true;

  const titleField = field('Название задачи', 'input', 'Например: Автоматизировать обработку входящих заявок');
  const descField = field('Описание (бизнес-задача)', 'textarea', 'Опишите, что и зачем автоматизируем');
  form.append(titleField.wrap, descField.wrap);

  const actions = document.createElement('div');
  actions.className = 'user-case-creator__actions';
  const create = document.createElement('button');
  create.type = 'submit';
  create.className = 'user-case-creator__create';
  create.textContent = 'Создать и открыть';
  const status = document.createElement('span');
  status.className = 'user-case-creator__status';
  status.setAttribute('role', 'status');
  actions.append(create, status);
  form.append(actions);
  wrap.append(form);

  toggle.addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) titleField.input.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = titleField.input.value.trim();
    if (!title) {
      status.textContent = 'Введите название задачи.';
      titleField.input.focus();
      return;
    }
    create.disabled = true;
    status.textContent = 'Создаём…';
    try {
      const created = await createUserCase(title, descField.input.value);
      navigate(`/module/${moduleId}/case/${encodeURIComponent(created.caseId)}`);
    } catch (err) {
      console.error('[case-list] не удалось создать свою задачу', err);
      status.textContent = 'Не удалось создать задачу. Проверьте хранилище.';
      create.disabled = false;
    }
  });

  return wrap;
}

// Поле формы: подпись + однострочный/многострочный ввод.
function field(labelText, kind, placeholder) {
  const wrap = document.createElement('label');
  wrap.className = 'user-case-creator__field';
  const span = document.createElement('span');
  span.className = 'user-case-creator__label';
  span.textContent = labelText;
  const input = kind === 'textarea'
    ? document.createElement('textarea')
    : document.createElement('input');
  if (kind === 'textarea') input.rows = 3;
  else input.type = 'text';
  input.className = 'user-case-creator__input';
  input.placeholder = placeholder;
  wrap.append(span, input);
  return { wrap, input };
}

function lastScore(statusInfo) {
  const span = document.createElement('span');
  span.className = 'case-row__score';
  if (statusInfo && typeof statusInfo.lastScore === 'number') {
    span.textContent = `Последний score: ${statusInfo.lastScore}`;
  } else {
    span.classList.add('case-row__score--muted');
    span.textContent = 'Результата ещё нет';
  }
  return span;
}

// --- Вспомогательные блоки ---------------------------------------------------

function describeError(code) {
  switch (code) {
    case 'schema_invalid': return 'ошибка структуры';
    case 'unknown_module': return 'неизвестный модуль';
    case 'invalid_tag': return 'неизвестный тег навыка';
    case 'dataset_too_large': return 'слишком большой файл';
    case 'load_failed': return 'файл недоступен';
    default: return code || 'ошибка';
  }
}

function emptyState(text) {
  const p = document.createElement('p');
  p.className = 'case-list__empty';
  p.textContent = text;
  return p;
}

function banner(text) {
  const p = document.createElement('p');
  p.className = 'case-list__banner';
  p.textContent = text;
  return p;
}

function notAModuleScreen(section, id) {
  const h1 = document.createElement('h1');
  h1.textContent = 'Модуль не найден';
  const p = document.createElement('p');
  p.textContent = `Модуль «${id}» не существует или не содержит кейсов.`;
  const back = document.createElement('a');
  back.href = '#/modules';
  back.textContent = '← К каталогу';
  section.append(h1, p, back);
  return section;
}
