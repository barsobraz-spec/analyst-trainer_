// modules/analytics/AnalyticsView.js — экран Learning Analytics, модуль 5.8 (Этап 9).
//
// Оркестратор страницы `#/analytics` (PRD §5.8): грузит события прохождения из всех
// модулей, обогащает их сложностью и названием кейса (нужны для adjScore и журнала),
// считает агрегаты через core/analytics.js и собирает панели:
//   Ф1 — SummaryPanel (сводка + активность по дням);
//   Ф2 — SkillProgress (прогресс по группам навыков + динамика);
//   Ф3/Ф4 — Recommendations (слабые места + что тренировать дальше);
//   Ф5 — ReflectionJournal (журнал заметок/самооценок с фильтрами);
//   Ф6 — точка входа экспорта/импорта (переиспользует DataControls из T2.1).
//
// Пустые состояния (PRD §5.8): без событий — приглашение пройти первый кейс; при
// < 3 решённых кейсов динамика и рекомендации заменяются подсказкой, а сводка и
// журнал уже показываются.
//
// ES-модуль: `import { AnalyticsView } from './modules/analytics/AnalyticsView.js'`.

import { getEvents } from '../../core/db.js';
import { loadIndex } from '../../core/caseLoader.js';
import { getCaseStatus } from '../../core/stats.js';
import { AiMentor } from '../../core/components/AiMentor.js';
import { buildMentorContext, MENTOR_MODES } from '../../core/mentorContext.js';
import { loadTopicGraph, topicsForCase } from '../../core/topicGraph.js';
import { WEAK_MIN_ATTEMPTS } from '../../config.js';
import {
  summarize,
  dailyActivity,
  aggregateBySkillGroup,
  computeWeakModules,
  recommendCasesForModule,
} from '../../core/analytics.js';
import { listAutomationUserCases } from '../automation/userCases.js';
import { DataControls } from '../../core/components/DataControls.js';
import { SummaryPanel } from './SummaryPanel.js';
import { SkillProgress } from './SkillProgress.js';
import { Recommendations } from './Recommendations.js';
import { ReflectionJournal } from './ReflectionJournal.js';

export async function AnalyticsView() {
  const root = document.createElement('section');
  root.className = 'analytics screen';

  const h1 = document.createElement('h1');
  h1.textContent = 'Learning Analytics';
  root.append(h1);

  const intro = document.createElement('p');
  intro.className = 'analytics__intro';
  intro.textContent = 'Анализ вашего прогресса по навыкам на основе данных всех модулей.';
  root.append(intro);

  // --- Данные: события + метаданные кейсов (сложность, название) --------------
  let events = [];
  let entries = [];
  let userCases = [];
  let loadError = null;
  try {
    [events, { entries }, userCases] = await Promise.all([
      getEvents({}),
      loadIndex().catch(() => ({ entries: [] })),
      listAutomationUserCases(),
    ]);
  } catch (err) {
    console.error('[analytics] не удалось загрузить данные', err);
    loadError = err;
  }

  if (loadError) {
    root.append(banner('Не удалось прочитать прогресс из локального хранилища. Обновите страницу.'));
    return root;
  }

  // Карты caseId → { difficulty, title } из манифеста и пользовательских кейсов.
  const meta = new Map();
  for (const e of entries) {
    if (e && e.caseId) meta.set(e.caseId, { difficulty: e.difficulty, title: e.title });
  }
  for (const c of userCases) {
    meta.set(c.caseId, { difficulty: c.difficulty || 'basic', title: c.title });
  }

  // Обогащаем события (исходные из БД не содержат difficulty/title — PRD §4).
  const enriched = events.map((e) => {
    const m = meta.get(e.caseId) || {};
    return { ...e, difficulty: m.difficulty || 'basic', title: m.title || e.caseId };
  });

  const summary = summarize(enriched);

  // Постоянная точка входа экспорта/импорта (PRD §5.8 Ф6 → §6 Ф5).
  root.append(buildBackupEntry());

  // Совсем нет данных — единое приглашение.
  if (summary.solvedCases === 0) {
    root.append(emptyState(
      'Вы ещё не прошли ни одного кейса.',
      'Откройте каталог и пройдите первый кейс — здесь появится ваша статистика, прогресс по навыкам и рекомендации.',
    ));
    return root;
  }

  // Ф1 — сводка показывается всегда, когда есть хоть одно событие.
  root.append(SummaryPanel({ summary, activity: dailyActivity(enriched) }));

  // Ф2/Ф3/Ф4 — динамика и рекомендации достоверны только при достаточных данных.
  if (summary.solvedCases >= WEAK_MIN_ATTEMPTS) {
    root.append(SkillProgress({ groups: aggregateBySkillGroup(enriched) }));

    const topicGraph = await loadTopicGraph().catch(() => null);
    const recItems = await buildRecommendations(enriched, entries);
    if (recItems.length > 0) {
      root.append(Recommendations({ items: recItems }));
    } else {
      root.append(note('Слабых мест не обнаружено — так держать! Продолжайте проходить новые кейсы.'));
    }
    root.append(buildAiNextStepMentor({ summary, enriched, recItems, topicGraph }));
  } else {
    const left = WEAK_MIN_ATTEMPTS - summary.solvedCases;
    root.append(note(
      `Пройдите ещё ${left} ${plural(left, 'кейс', 'кейса', 'кейсов')}, ` +
      'чтобы открылись динамика по навыкам и персональные рекомендации.',
    ));
  }

  // Ф5 — журнал рефлексии всегда (фильтры внутри).
  root.append(ReflectionJournal({ events: enriched }));

  return root;
}

function buildAiNextStepMentor({ summary, enriched, recItems, topicGraph }) {
  const topics = topicsForRecommendationItems(topicGraph, recItems);
  const weakSpots = weakSpotsForAi(recItems);
  const progressSummary = {
    solvedCases: summary.solvedCases,
    avgScore: summary.avgScore,
    totalAttempts: enriched.length,
    weakModules: recItems.map((item) => ({
      moduleId: item.module.moduleId,
      title: item.module.title,
      avgAdjScore: item.module.avgAdjScore,
      avgHints: item.module.avgHints,
      reasons: item.module.reasons,
    })),
    recentScores: enriched.slice(-6).map((event) => ({
      module: event.module,
      caseId: event.caseId,
      score: Number.isFinite(event.score) ? event.score : null,
    })),
  };
  return AiMentor({
    title: 'AI-наставник по слабым местам',
    description: 'Соберет план повторения на ближайшие 1-3 дня по агрегированному прогрессу.',
    modes: [MENTOR_MODES.nextStep],
    defaultMode: MENTOR_MODES.nextStep,
    buildContext: () => buildMentorContext({
      mode: MENTOR_MODES.nextStep,
      topics,
      weakSpots,
      progressSummary,
    }),
    getStudentAnswer: () => '',
    compactDisabled: true,
  }).element;
}

function topicsForRecommendationItems(graph, recItems) {
  if (!graph?.topics) return [];
  const byId = new Map();
  for (const item of recItems) {
    for (const topic of graph.topics.filter((candidate) => candidate.moduleRefs?.includes(item.module.moduleId))) {
      if (topic?.id) byId.set(topic.id, topic);
    }
    for (const c of item.cases || []) {
      for (const topic of topicsForCase(graph, c.caseId, 4)) {
        if (topic?.id) byId.set(topic.id, topic);
      }
    }
  }
  return Array.from(byId.values()).slice(0, 6);
}

function weakSpotsForAi(recItems) {
  const result = [];
  for (const item of recItems) {
    result.push({
      label: `${item.module.moduleId} · ${item.module.title}`,
      reason: item.module.reasons.join(', '),
      score: item.module.avgAdjScore,
    });
    for (const c of (item.cases || []).slice(0, 3)) {
      result.push({
        caseId: c.caseId,
        label: c.title || c.caseId,
        reason: c.status === 'passed' ? 'низкий последний балл' : 'кейс еще не закрыт',
        score: Number.isFinite(c.lastScore) ? c.lastScore : null,
      });
    }
  }
  return result.slice(0, 12);
}

// Слабые модули + отфильтрованные кейсы для тренировки. Статусы кейсов берём только
// для модулей, попавших в слабые места (не дёргаем БД по всему каталогу).
async function buildRecommendations(enriched, entries) {
  const weak = computeWeakModules(enriched);
  if (weak.length === 0) return [];

  // Рабочие кейсы манифеста по модулям (ошибочные записи пропускаем).
  const casesByModule = new Map();
  for (const e of entries) {
    if (!e || e.status === 'error' || !e.module) continue;
    if (!casesByModule.has(e.module)) casesByModule.set(e.module, []);
    casesByModule.get(e.module).push({ caseId: e.caseId, title: e.title, difficulty: e.difficulty });
  }

  const items = [];
  for (const module of weak) {
    const moduleCases = casesByModule.get(module.moduleId) || [];
    const statusByCase = new Map();
    await Promise.all(moduleCases.map(async (c) => {
      try {
        statusByCase.set(c.caseId, await getCaseStatus(c.caseId));
      } catch {
        statusByCase.set(c.caseId, { status: 'not_started', lastScore: null });
      }
    }));
    const cases = recommendCasesForModule(moduleCases, statusByCase);
    items.push({ module, cases });
  }
  return items;
}

// --- Блоки-помощники ---------------------------------------------------------

function buildBackupEntry() {
  const wrap = document.createElement('section');
  wrap.className = 'analytics-section analytics-backup';
  const h2 = document.createElement('h2');
  h2.className = 'analytics-section__title';
  h2.textContent = 'Резервное копирование';
  const p = document.createElement('p');
  p.className = 'analytics-backup__hint';
  p.textContent = 'Сохраните весь прогресс в файл или перенесите его на другую машину.';
  wrap.append(h2, p, DataControls());
  return wrap;
}

function emptyState(title, text) {
  const wrap = document.createElement('div');
  wrap.className = 'analytics__empty';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  const link = document.createElement('a');
  link.className = 'analytics__empty-cta';
  link.href = '#/modules';
  link.textContent = 'Открыть каталог →';
  wrap.append(h2, p, link);
  return wrap;
}

function note(text) {
  const p = document.createElement('p');
  p.className = 'analytics__note';
  p.textContent = text;
  return p;
}

function banner(text) {
  const p = document.createElement('p');
  p.className = 'analytics__banner';
  p.textContent = text;
  return p;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
