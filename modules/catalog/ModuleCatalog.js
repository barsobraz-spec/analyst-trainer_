// modules/catalog/ModuleCatalog.js — главный экран: каталог модулей (T1.1).
//
// Реализует PRD §6 Ф1: восемь карточек модулей с краткой статистикой из IndexedDB.
// Семь обучающих модулей (5.1–5.7) показывают прогресс-бар (пройдено/всего) и
// «средний score» и ведут на список своих кейсов (#/module/:id). Модуль 5.8
// (Learning Analytics) кейсов не имеет — его карточка ведёт на экран аналитики.
//
// Сверху — блок «Продолжить/Начать» (как в буткемпах): один клик к незавершённому
// кейсу, без поиска по каталогу. Цель берётся из единого маршрута курса (courseNav)
// и сводки прогресса (core/progress.js); статусы читаются ОДНИМ батчем на весь экран.
//
// Компонент асинхронный: роутер дожидается Promise. Сбой хранилища не валит экран —
// показываем прочерки/нулевой прогресс (каталог остаётся работоспособным, PRD §3).
//
// ES-модуль: `import { ModuleCatalog } from './modules/catalog/ModuleCatalog.js'`.

import { MODULES } from '../../core/modules.js';
import { getOutline, caseHash } from '../../core/courseNav.js';
import { loadProgressMap, moduleProgress, getResumeTarget } from '../../core/progress.js';

export async function ModuleCatalog() {
  const section = document.createElement('section');
  section.className = 'catalog screen';

  const h1 = document.createElement('h1');
  h1.textContent = 'Каталог модулей';
  section.append(h1);

  const intro = document.createElement('p');
  intro.className = 'catalog__intro';
  intro.textContent = 'Выберите модуль, чтобы тренироваться на кейсах. Прогресс сохраняется локально.';
  section.append(intro);

  // Маршрут курса (для счётчиков и «Продолжить») + сводка прогресса одним батчем.
  const outline = await getOutline();
  const progress = await loadProgressMap();

  // Блок «Продолжить/Начать» — один клик к нужному кейсу.
  const hero = buildHero(getResumeTarget(outline, progress));
  if (hero) section.append(hero);

  // Прогресс по модулям из маршрута (id → { passed, total, avgScore }).
  const progByModule = new Map();
  for (const mod of outline.modules) {
    progByModule.set(mod.id, moduleProgress(mod.cases, progress));
  }

  const grid = document.createElement('div');
  grid.className = 'catalog__grid';
  section.append(grid);

  for (const module of MODULES) {
    grid.append(buildCard(module, progByModule.get(module.id), progress != null));
  }

  return section;
}

// --- Блок «Продолжить / Начать / Курс пройден» -------------------------------
function buildHero(resume) {
  if (!resume || resume.kind === 'empty') return null;

  const box = document.createElement('div');
  box.className = 'catalog__hero';

  const text = document.createElement('div');
  text.className = 'catalog__hero-text';

  const cta = document.createElement('a');
  cta.className = 'catalog__hero-cta';

  if (resume.kind === 'resume') {
    text.append(
      heroTitle('Продолжите с того места, где остановились'),
      heroSub(resume.case.title),
    );
    cta.href = caseHash(resume.case);
    cta.textContent = 'Продолжить →';
  } else if (resume.kind === 'start') {
    text.append(
      heroTitle('Начните обучение'),
      heroSub(`Первый кейс: ${resume.case.title}`),
    );
    cta.href = caseHash(resume.case);
    cta.textContent = 'Начать →';
  } else { // 'done'
    text.append(
      heroTitle('Вы прошли все кейсы курса'),
      heroSub('Посмотрите сводку прогресса по навыкам.'),
    );
    cta.href = '#/analytics';
    cta.textContent = 'Learning Analytics →';
  }

  box.append(text, cta);
  return box;
}

function heroTitle(t) {
  const el = document.createElement('strong');
  el.className = 'catalog__hero-title';
  el.textContent = t;
  return el;
}
function heroSub(t) {
  const el = document.createElement('span');
  el.className = 'catalog__hero-sub';
  el.textContent = t;
  return el;
}

// --- Карточка модуля ---------------------------------------------------------
// Целиком <a> — нативная навигация по хешу, работают «Назад/Вперёд», клавиатура и
// фокус без доп. обработчиков (T1.1.1).
function buildCard(module, prog, dbOk) {
  const card = document.createElement('a');
  card.className = 'module-card';

  const title = document.createElement('h2');
  title.className = 'module-card__title';
  title.textContent = `${module.id} · ${module.title}`;
  card.append(title);

  const desc = document.createElement('p');
  desc.className = 'module-card__desc';
  desc.textContent = module.description;
  card.append(desc);

  if (module.hasCases) {
    card.href = `#/module/${module.id}`;
    card.append(buildProgress(prog, dbOk));
  } else {
    // Learning Analytics: вместо статистики прохождения — призыв открыть аналитику.
    card.href = '#/analytics';
    card.classList.add('module-card--analytics');
    const hint = document.createElement('p');
    hint.className = 'module-card__stats module-card__stats--muted';
    hint.textContent = 'Сводка прогресса по навыкам →';
    card.append(hint);
  }

  return card;
}

// Прогресс-бар модуля + строка «пройдено / средний score».
function buildProgress(prog, dbOk) {
  const box = document.createElement('div');
  box.className = 'module-card__progress';

  if (!dbOk || !prog) {
    const muted = document.createElement('p');
    muted.className = 'module-card__stats module-card__stats--muted';
    muted.textContent = 'Статистика недоступна';
    box.append(muted);
    return box;
  }

  const pct = prog.total > 0 ? Math.round((prog.passed / prog.total) * 100) : 0;

  const bar = document.createElement('div');
  bar.className = 'module-card__bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(prog.total));
  bar.setAttribute('aria-valuenow', String(prog.passed));
  const fill = document.createElement('span');
  fill.style.width = `${pct}%`;
  if (prog.total > 0 && prog.passed === prog.total) fill.classList.add('is-complete');
  bar.append(fill);
  box.append(bar);

  const stats = document.createElement('p');
  stats.className = 'module-card__stats';
  if (prog.passed === 0) {
    stats.classList.add('module-card__stats--muted');
    stats.textContent = `Ни одного кейса не пройдено · всего ${prog.total}`;
  } else {
    const passed = document.createElement('span');
    passed.className = 'module-card__metric';
    passed.textContent = `Пройдено: ${prog.passed} из ${prog.total}`;
    const avg = document.createElement('span');
    avg.className = 'module-card__metric';
    avg.textContent = prog.avgScore === null
      ? 'Средний score: —'
      : `Средний score: ${prog.avgScore}`;
    stats.append(passed, avg);
  }
  box.append(stats);
  return box;
}
