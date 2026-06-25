// modules/home/HomeDashboard.js — главный экран «Главная» (дашборд обучения).
//
// Реализует стартовую страницу в стиле рабочей панели: приветствие, крупный блок
// «Продолжить обучение», быстрый вход в основные сценарии и сводные виджеты
// прогресса без лишней навигационной дроби.
//
// ВСЕ числа берутся из IndexedDB через существующие функции ядра — логика модулей
// и хранилища не трогается:
//   • loadProgressMap (core/progress) — статусы всех кейсов одним батчем;
//   • getOutline (core/courseNav) — маршрут курса (модули и кейсы по порядку);
//   • moduleProgress (core/progress) — пройдено/всего по набору кейсов;
//   • getResumeTarget (core/progress) — куда ведёт кнопка «Продолжить/Начать»;
//   • getEvents (core/db) — события прохождения для активности за неделю.
//
// Экран асинхронный: роутер дожидается Promise. Сбой хранилища не валит экран —
// показываем нулевой прогресс (дашборд остаётся работоспособным, PRD §3).
//
// ES-модуль: `import { HomeDashboard } from './modules/home/HomeDashboard.js'`.

import { getModule } from '../../core/modules.js';
import { getOutline, caseHash } from '../../core/courseNav.js';
import { loadProgressMap, moduleProgress, getResumeTarget } from '../../core/progress.js';
import {
  getAllCareerApplications,
  getAllMonthlyExamProgress,
  getAllProjectProgress,
  getAllTaskProgress,
  getEvents,
  getLearningSettings,
} from '../../core/db.js';
import { loadLearningContent } from '../../core/learningContent.js';
import { calculateStudyPosition, TOTAL_STUDY_DAYS } from '../../core/learningSchedule.js';
import { calculateReadinessLevel } from '../../core/learningProgress.js';
import { ProgressRing } from '../../core/components/ProgressRing.js';

// Группы навыков для блока «Ваш прогресс» (метка → модули группы).
const SKILL_BARS = [
  { label: 'Аналитика', modules: ['5.1', '5.2', '5.4'] },
  { label: 'SQL', modules: ['5.3', '5.5'] },
  { label: 'Бизнес', modules: ['5.6', '5.7'] },
];

export async function HomeDashboard() {
  const section = document.createElement('section');
  section.className = 'home screen';

  // --- Данные одним заходом ---------------------------------------------------
  const [outline, progress, learningSnapshot, events] = await Promise.all([
    withFallback(getOutline(), { modules: [], flat: [] }, '[home] не удалось загрузить маршрут курса'),
    withFallback(loadProgressMap(), null, '[home] не удалось загрузить прогресс'),
    withFallback(loadLearningDashboardSnapshot(), { error: new Error('learning_snapshot_timeout') }, '[home] не удалось загрузить сводку обучения'),
    withFallback(getEvents({}), [], '[home] не удалось загрузить события активности'),
  ]);

  // Прогресс по каждому модулю маршрута (id → { passed, total, avgScore }).
  const progByModule = new Map();
  for (const mod of outline.modules) {
    progByModule.set(mod.id, moduleProgress(mod.cases, progress));
  }

  // Общий прогресс курса (для цели Junior Analyst и блока «До цели»).
  let coursePassed = 0;
  let courseTotal = 0;
  for (const p of progByModule.values()) {
    coursePassed += p.passed;
    courseTotal += p.total;
  }
  const coursePct = courseTotal > 0 ? Math.round((coursePassed / courseTotal) * 100) : 0;

  const resume = getResumeTarget(outline, progress);

  // --- Сборка экрана ----------------------------------------------------------
  section.append(buildGreeting());
  section.append(buildHero(resume, progByModule));
  section.append(buildFocusBoard(resume, learningSnapshot));

  const widgets = document.createElement('div');
  widgets.className = 'home-widgets';
  widgets.append(
    buildSkillProgress(outline, progress),
    buildGoal(coursePct, coursePassed, courseTotal),
    buildActivity(events),
  );
  section.append(widgets);

  return section;
}

function withFallback(promise, fallback, label, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      console.error(`${label}: timeout ${timeoutMs}ms`);
      done(fallback);
    }, timeoutMs);
    Promise.resolve(promise).then(done).catch((err) => {
      console.error(label, err);
      done(fallback);
    });
  });
}

// --- Сводка учебной системы ---------------------------------------------------
async function loadLearningDashboardSnapshot() {
  try {
    const content = await loadLearningContent();
    const [
      settings,
      taskProgress,
      projectProgress,
      monthlyExamProgress,
      careerApplications,
    ] = await Promise.all([
      getLearningSettings().catch(() => null),
      getAllTaskProgress().catch(() => []),
      getAllProjectProgress().catch(() => []),
      getAllMonthlyExamProgress().catch(() => []),
      getAllCareerApplications().catch(() => []),
    ]);

    const position = calculateStudyPosition(settings?.startDate || '');
    const readiness = calculateReadinessLevel({
      tasks: content.allTasks,
      taskProgress,
      projects: content.projects.projects || [],
      projectProgress,
      globalQualityChecklist: content.projects.globalQualityChecklist || [],
      months: content.plan.months || [],
      monthlyExamProgress,
      careerApplications,
    });
    const month = position.month ? content.monthsByNumber.get(position.month) : null;

    return { content, settings, position, readiness, month };
  } catch (err) {
    console.error('[home] не удалось загрузить сводку учебной системы', err);
    return { error: err };
  }
}

function learningStatus(position, month) {
  if (position.status === 'not_configured' || position.status === 'invalid_start') {
    return {
      badge: 'Маршрут',
      title: 'Дата старта не задана',
      detail: 'Укажите старт в разделе "Сегодня", чтобы видеть текущий день и месяц плана.',
    };
  }
  if (position.status === 'before_start') {
    return {
      badge: 'Старт впереди',
      title: `${position.daysUntilStart} ${plural(position.daysUntilStart, 'день', 'дня', 'дней')} до начала`,
      detail: 'Можно заранее подготовить рабочую папку, GitHub и трекер проектов.',
    };
  }
  if (position.status === 'completed') {
    return {
      badge: 'План завершен',
      title: `${TOTAL_STUDY_DAYS} учебных дней`,
      detail: 'Самое время вернуться к слабым местам, проектам и карьерному треку.',
    };
  }
  return {
    badge: position.restDay ? 'Повторение' : `День ${position.studyDay} из ${TOTAL_STUDY_DAYS}`,
    title: `М${position.month} · Н${position.weekOfMonth}`,
    detail: month?.title || month?.focus || 'Текущий период учебного плана',
  };
}

// --- Приветствие --------------------------------------------------------------
function buildGreeting() {
  const head = document.createElement('header');
  head.className = 'home-greet';
  const h1 = document.createElement('h1');
  h1.className = 'home-greet__title';
  h1.textContent = 'Рабочий стол аналитика';
  const sub = document.createElement('p');
  sub.className = 'home-greet__sub';
  sub.textContent = 'Главные действия собраны рядом: день обучения, практика, проекты и прогресс.';
  head.append(h1, sub);
  return head;
}

// --- Блок «Продолжить обучение» ----------------------------------------------
function buildHero(resume, progByModule) {
  const box = document.createElement('div');
  box.className = 'home-hero';

  const body = document.createElement('div');
  body.className = 'home-hero__body';

  if (resume.kind === 'empty') {
    body.append(eyebrow('ОБУЧЕНИЕ'));
    body.append(heroTitle('Начните обучение'));
    body.append(heroDesc('Выберите модуль, чтобы тренироваться на кейсах. Прогресс сохраняется локально.'));

    const actions = document.createElement('div');
    actions.className = 'home-hero__actions';
    actions.append(heroCta('#/modules', 'Выбрать другой модуль', true));
    body.append(actions);

    box.append(body);
    return box;
  }

  // Курс пройден целиком — предлагаем аналитику.
  if (resume.kind === 'done') {
    body.append(eyebrow('ОБУЧЕНИЕ'));
    body.append(heroTitle('Вы прошли все кейсы курса'));
    body.append(heroDesc('Загляните в Learning Analytics — посмотрите сводку прогресса по навыкам.'));
    const actions = document.createElement('div');
    actions.className = 'home-hero__actions';
    actions.append(heroCta('#/analytics', 'Открыть аналитику', true));
    body.append(actions);
    box.append(body);
    return box;
  }

  const mod = getModule(resume.case.module);
  const prog = progByModule.get(resume.case.module) || { passed: 0, total: 0 };
  const pct = prog.total > 0 ? Math.round((prog.passed / prog.total) * 100) : 0;
  const starting = resume.kind === 'start';

  body.append(eyebrow(starting ? 'НАЧАТЬ ОБУЧЕНИЕ' : 'ПРОДОЛЖИТЬ ОБУЧЕНИЕ'));
  body.append(heroTitle(`${mod ? mod.id : resume.case.module} ${mod ? mod.title : ''}`.trim()));
  body.append(heroDesc(mod ? mod.description : resume.case.title));

  // Прогресс по текущему модулю.
  const progWrap = document.createElement('div');
  progWrap.className = 'home-hero__progress';
  const label = document.createElement('div');
  label.className = 'home-hero__progress-row';
  label.append(spanText('home-hero__progress-label', 'Прогресс в модуле'),
    spanText('home-hero__progress-pct', `${pct}%`));
  progWrap.append(label, bar(pct));
  body.append(progWrap);

  const actions = document.createElement('div');
  actions.className = 'home-hero__actions';
  actions.append(
    heroCta(caseHash(resume.case), starting ? 'Начать кейс' : 'Продолжить кейс', true),
    heroCta('#/modules', 'Выбрать другой модуль', false),
  );
  body.append(actions);

  box.append(body);
  return box;
}

function eyebrow(t) {
  const el = document.createElement('span');
  el.className = 'home-hero__eyebrow';
  el.textContent = t;
  return el;
}
function heroTitle(t) {
  const el = document.createElement('h2');
  el.className = 'home-hero__title';
  el.textContent = t;
  return el;
}
function heroDesc(t) {
  const el = document.createElement('p');
  el.className = 'home-hero__desc';
  el.textContent = t;
  return el;
}
function heroCta(href, text, primary) {
  const a = document.createElement('a');
  a.className = primary ? 'home-hero__cta home-hero__cta--primary' : 'home-hero__cta home-hero__cta--ghost';
  a.href = href;
  a.textContent = text;
  return a;
}

// --- Главные сценарии ---------------------------------------------------------
function buildFocusBoard(resume, learningSnapshot) {
  const wrap = document.createElement('section');
  wrap.className = 'home-focus';

  const head = document.createElement('div');
  head.className = 'home-focus__head';
  const title = document.createElement('h2');
  title.className = 'home-section__title';
  title.textContent = 'Быстрый вход';
  const all = document.createElement('a');
  all.className = 'home-link';
  all.href = '#/modules';
  all.textContent = 'Весь курс';
  head.append(title, all);
  wrap.append(head);

  const grid = document.createElement('div');
  grid.className = 'home-focus__grid';
  grid.append(
    focusCard(todayFocus(learningSnapshot)),
    focusCard(practiceFocus(resume)),
    focusCard(projectFocus(learningSnapshot)),
  );
  wrap.append(grid);
  return wrap;
}

function todayFocus(snapshot) {
  if (snapshot.error) {
    return {
      label: 'Сегодня',
      title: 'Учебный день',
      text: 'Откройте раздел дня, когда учебный контент снова будет доступен.',
      href: '#/learning/today',
    };
  }
  const status = learningStatus(snapshot.position || {}, snapshot.month);
  return {
    label: status.badge,
    title: status.title,
    text: status.detail,
    href: '#/learning/today',
  };
}

function practiceFocus(resume) {
  if ((resume.kind === 'resume' || resume.kind === 'start') && resume.case) {
    return {
      label: resume.kind === 'start' ? 'Практика' : 'Продолжить',
      title: resume.case.title,
      text: 'Один клик до ближайшего кейса.',
      href: caseHash(resume.case),
    };
  }
  return {
    label: 'Практика',
    title: 'Каталог кейсов',
    text: 'Выберите модуль и тренируйте конкретный навык.',
    href: '#/modules',
  };
}

function projectFocus(snapshot) {
  const projects = snapshot?.content?.projects?.projects || [];
  return {
    label: 'Портфолио',
    title: projects.length ? `${projects.length} учебных проектов` : 'Учебные проекты',
    text: 'Собирайте результаты, которые можно показать в резюме.',
    href: '#/learning/projects',
  };
}

function focusCard(item) {
  const a = document.createElement('a');
  a.className = 'home-focus-card';
  a.href = item.href;
  a.append(
    spanText('home-focus-card__label', item.label),
    spanText('home-focus-card__title', item.title),
    paragraph('home-focus-card__text', item.text),
  );
  return a;
}

// --- Виджет «Ваш прогресс» (по навыкам) --------------------------------------
function buildSkillProgress(outline, progress) {
  const card = widgetCard('Ваш прогресс');

  const casesByModule = new Map();
  for (const mod of outline.modules) casesByModule.set(mod.id, mod.cases);

  const list = document.createElement('div');
  list.className = 'home-bars';
  for (const sb of SKILL_BARS) {
    let passed = 0;
    let total = 0;
    for (const mid of sb.modules) {
      const cases = casesByModule.get(mid) || [];
      const p = moduleProgress(cases, progress);
      passed += p.passed;
      total += p.total;
    }
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

    const row = document.createElement('div');
    row.className = 'home-bar';
    const head = document.createElement('div');
    head.className = 'home-bar__head';
    head.append(spanText('home-bar__label', sb.label), spanText('home-bar__pct', `${pct}%`));
    row.append(head, bar(pct));
    list.append(row);
  }
  card.append(list);
  card.append(widgetLink('#/analytics', 'Смотреть детальную аналитику →'));
  return card;
}

// --- Виджет «До цели Junior Analyst» -----------------------------------------
function buildGoal(pct, passed, total) {
  const card = widgetCard('До цели Junior Analyst');
  const body = document.createElement('div');
  body.className = 'home-goal';
  body.append(ProgressRing(pct, { size: 104, stroke: 10 }));
  const text = document.createElement('div');
  text.className = 'home-goal__text';
  text.append(spanText('home-goal__lead', 'Вы прошли'),
    spanText('home-goal__count', `${passed} из ${total} ${plural(total, 'кейса', 'кейсов', 'кейсов')}`));
  body.append(text);
  card.append(body);
  card.append(widgetLink('#/analytics', 'Что нужно для достижения? →'));
  return card;
}

// --- Виджет «Активность на этой неделе» --------------------------------------
function buildActivity(events) {
  const card = widgetCard('Активность на этой неделе');
  const week = weekStats(events);

  const days = document.createElement('div');
  days.className = 'home-week';
  const NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  week.days.forEach((active, i) => {
    const d = document.createElement('div');
    d.className = 'home-week__day';
    if (active) d.classList.add('is-active');
    const dot = document.createElement('span');
    dot.className = 'home-week__dot';
    dot.setAttribute('aria-hidden', 'true');
    if (active) dot.textContent = '✓';
    d.append(spanText('home-week__name', NAMES[i]), dot);
    days.append(d);
  });
  card.append(days);

  const stats = document.createElement('div');
  stats.className = 'home-week__stats';
  stats.append(
    metric(String(week.solved), 'Кейсов решено'),
    metric(formatDuration(week.durationSec), 'Время в обучении'),
  );
  card.append(stats);
  card.append(widgetLink('#/analytics', 'История активности →'));
  return card;
}

function metric(value, label) {
  const m = document.createElement('div');
  m.className = 'home-metric';
  m.append(spanText('home-metric__value', value), spanText('home-metric__label', label));
  return m;
}

function paragraph(className, text) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

// Статистика текущей недели (Пн–Вс, локальная зона): активные дни, решённые
// кейсы (разные caseId с событием на неделе) и суммарное время по событиям недели.
function weekStats(events) {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (monday.getDay() + 6) % 7; // 0 = понедельник
  monday.setDate(monday.getDate() - dow);
  const start = monday.getTime();
  const end = start + 7 * 86_400_000;

  const daysActive = [false, false, false, false, false, false, false];
  const solvedCases = new Set();
  let durationSec = 0;
  for (const e of events) {
    const t = e.finishedAt ?? 0;
    if (t < start || t >= end) continue;
    const idx = Math.floor((t - start) / 86_400_000);
    if (idx >= 0 && idx < 7) daysActive[idx] = true;
    if (e.caseId) solvedCases.add(e.caseId);
    if (Number.isFinite(e.durationSec)) durationSec += e.durationSec;
  }
  return { days: daysActive, solved: solvedCases.size, durationSec };
}

function formatDuration(sec) {
  if (!sec) return '0м';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
  return `${m}м`;
}

// --- Общие помощники виджетов -------------------------------------------------
function widgetCard(title) {
  const card = document.createElement('section');
  card.className = 'home-widget';
  const h3 = document.createElement('h3');
  h3.className = 'home-widget__title';
  h3.textContent = title;
  card.append(h3);
  return card;
}
function widgetLink(href, text) {
  const a = document.createElement('a');
  a.className = 'home-link home-widget__link';
  a.href = href;
  a.textContent = text;
  return a;
}

// Горизонтальный прогресс-бар (доля 0–100).
function bar(pct) {
  const wrap = document.createElement('div');
  wrap.className = 'home-progressbar';
  wrap.setAttribute('role', 'progressbar');
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', '100');
  wrap.setAttribute('aria-valuenow', String(pct));
  const fill = document.createElement('span');
  fill.style.width = `${pct}%`;
  wrap.append(fill);
  return wrap;
}

function spanText(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
