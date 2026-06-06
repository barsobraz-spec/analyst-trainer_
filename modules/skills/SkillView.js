// modules/skills/SkillView.js — прогресс по одному навыку (#/skill/:id).
//
// Навыки сгруппированы как на главной и в сайдбаре: Аналитика, SQL, Бизнес. Каждая
// страница показывает прогресс именно по этому навыку: какие кейсы пройдены (по
// модулям), средняя оценка и слабые места с рекомендациями. Глобальная сводка по
// всем навыкам остаётся на экране Learning Analytics (#/analytics) — туда ведёт
// ссылка внизу.
//
// Всё считается из IndexedDB (только чтение) и манифеста; логику/хранилище и расчёты
// (core/analytics.js, core/progress.js) переиспользуем как есть.
//
// ES-модуль: `import { SkillView } from './modules/skills/SkillView.js'`.

import { getEvents } from '../../core/db.js';
import { getModule } from '../../core/modules.js';
import { getOutline } from '../../core/courseNav.js';
import { loadProgressMap, statusOf } from '../../core/progress.js';
import { computeWeakModules, recommendCasesForModule } from '../../core/analytics.js';
import { ProgressRing } from '../../core/components/ProgressRing.js';
import { Recommendations } from '../analytics/Recommendations.js';
import { loadCaseMetaMap } from '../shared/caseCatalog.js';
import { caseCard } from '../shared/caseCard.js';
import { pageHeader, sectionTitle, emptyState, plural } from '../shared/ui.js';

// Навыки ↔ модули (совпадает с группами skillTags и виджетом «Ваш прогресс» главной).
const SKILLS = {
  analytics: {
    title: 'Аналитика',
    subtitle: 'Аналитическое мышление: выводы из данных, гипотезы и поиск корневых причин.',
    modules: ['5.1', '5.2', '5.4'],
  },
  sql: {
    title: 'SQL и данные',
    subtitle: 'Практические навыки: чтение дашбордов, поиск аномалий и SQL-расследования.',
    modules: ['5.3', '5.5'],
  },
  business: {
    title: 'Бизнес',
    subtitle: 'Бизнес-мышление: решения в симуляторе и проектирование автоматизаций.',
    modules: ['5.6', '5.7'],
  },
};

export async function SkillView({ id }) {
  const root = document.createElement('section');
  root.className = 'skill screen';

  const skill = SKILLS[id];
  if (!skill) {
    return notFound(root, id);
  }

  root.append(pageHeader(skill.title, skill.subtitle));

  // --- Данные: маршрут, прогресс, события (для слабых мест) -------------------
  const [outline, progress, events, metaMap] = await Promise.all([
    getOutline(),
    loadProgressMap(),
    getEvents({}).catch(() => []),
    loadCaseMetaMap().catch(() => new Map()),
  ]);

  const modulesInSkill = skill.modules
    .map((mid) => outline.modules.find((m) => m.id === mid))
    .filter(Boolean);

  // --- Сводка по навыку: пройдено / всего / средняя оценка -------------------
  let passed = 0;
  let total = 0;
  const scores = [];
  for (const mod of modulesInSkill) {
    for (const c of mod.cases) {
      total += 1;
      const st = statusOf(progress, c.caseId);
      if (st.status === 'passed') {
        passed += 1;
        if (typeof st.lastScore === 'number') scores.push(st.lastScore);
      }
    }
  }
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  root.append(buildSummary({ pct, passed, total, avg }));

  // --- Какие кейсы пройдены: по модулям навыка -------------------------------
  root.append(sectionTitle('Какие кейсы пройдены'));
  if (total === 0) {
    root.append(emptyState({
      icon: '📚',
      title: 'В этом навыке пока нет кейсов',
      text: 'Загляните в каталог — возможно, кейсы появятся позже.',
      ctaHref: '#/modules',
      ctaText: 'Открыть каталог →',
    }));
  } else {
    for (const mod of modulesInSkill) root.append(buildModuleBlock(mod, progress));
  }

  // --- Слабые места + рекомендации (переиспользуем разбор аналитики) ----------
  root.append(sectionTitle('Слабые места'));
  const weakItems = buildWeakItems(events, metaMap, outline, progress, skill.modules);
  if (weakItems.length > 0) {
    root.append(Recommendations({ items: weakItems }));
  } else {
    root.append(note(
      passed === 0
        ? 'Пройдите несколько кейсов этого навыка — здесь появится разбор слабых мест.'
        : 'Слабых мест не обнаружено — отличная работа! Продолжайте закреплять навык.',
    ));
  }

  // --- Ссылка на полную аналитику --------------------------------------------
  const more = document.createElement('a');
  more.className = 'skill__more home-link';
  more.href = '#/analytics';
  more.textContent = 'Подробная аналитика по всем навыкам →';
  root.append(more);

  return root;
}

// --- Сводная плашка навыка ----------------------------------------------------
function buildSummary({ pct, passed, total, avg }) {
  const card = document.createElement('div');
  card.className = 'skill-summary home-widget';

  const ringWrap = document.createElement('div');
  ringWrap.className = 'skill-summary__ring';
  ringWrap.append(ProgressRing(pct, { size: 96, stroke: 9 }));
  card.append(ringWrap);

  const stats = document.createElement('div');
  stats.className = 'skill-summary__stats';
  stats.append(
    stat(`${passed} / ${total}`, `${plural(total, 'кейс', 'кейса', 'кейсов')} пройдено`),
    stat(avg == null ? '—' : String(avg), 'средняя оценка'),
  );
  card.append(stats);
  return card;
}

function stat(value, label) {
  const wrap = document.createElement('div');
  wrap.className = 'skill-summary__stat';
  const v = document.createElement('span');
  v.className = 'skill-summary__value';
  v.textContent = value;
  const l = document.createElement('span');
  l.className = 'skill-summary__label';
  l.textContent = label;
  wrap.append(v, l);
  return wrap;
}

// --- Блок модуля: заголовок + его кейсы со статусом ----------------------------
function buildModuleBlock(mod, progress) {
  const block = document.createElement('section');
  block.className = 'skill-module';

  const head = document.createElement('div');
  head.className = 'skill-module__head';
  const title = document.createElement('h3');
  title.className = 'skill-module__title';
  const link = document.createElement('a');
  link.href = `#/module/${encodeURIComponent(mod.id)}`;
  link.textContent = `${mod.id} · ${mod.title}`;
  title.append(link);

  // Сколько пройдено в модуле.
  let mPassed = 0;
  for (const c of mod.cases) if (statusOf(progress, c.caseId).status === 'passed') mPassed += 1;
  const counter = document.createElement('span');
  counter.className = 'skill-module__counter';
  counter.textContent = `${mPassed} / ${mod.cases.length}`;
  head.append(title, counter);
  block.append(head);

  const list = document.createElement('ul');
  list.className = 'case-list__items';
  for (const c of mod.cases) {
    const st = statusOf(progress, c.caseId);
    list.append(caseCard({
      meta: { caseId: c.caseId, module: mod.id, title: c.title, difficulty: c.difficulty, broken: false },
      status: st.status,
      lastScore: st.lastScore,
      showModule: false,
    }));
  }
  block.append(list);
  return block;
}

// --- Слабые модули навыка + рекомендованные кейсы (как в AnalyticsView) --------
function buildWeakItems(events, metaMap, outline, progress, skillModuleIds) {
  const enriched = events.map((e) => {
    const m = metaMap.get(e.caseId) || {};
    return { ...e, difficulty: m.difficulty || 'basic', title: m.title || e.caseId };
  });

  const weak = computeWeakModules(enriched).filter((w) => skillModuleIds.includes(w.moduleId));

  const items = [];
  for (const module of weak) {
    const mod = outline.modules.find((m) => m.id === module.moduleId);
    const moduleCases = mod ? mod.cases : [];
    const statusByCase = new Map();
    for (const c of moduleCases) statusByCase.set(c.caseId, statusOf(progress, c.caseId));
    items.push({ module, cases: recommendCasesForModule(moduleCases, statusByCase) });
  }
  return items;
}

function note(text) {
  const p = document.createElement('p');
  p.className = 'skill__note';
  p.textContent = text;
  return p;
}

function notFound(root, id) {
  root.append(pageHeader('Навык не найден', `Раздел навыка «${id}» не существует.`));
  const back = document.createElement('a');
  back.className = 'home-link';
  back.href = '#/modules';
  back.textContent = '← К каталогу модулей';
  root.append(back);
  return root;
}
