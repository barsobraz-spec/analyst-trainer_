// core/learningSearch.js — локальный индекс учебной системы (T2.4).

import { resolveTrainerModules } from './learningLinks.js';

export function buildLearningSearchIndex(content) {
  if (!content) return [];
  return [
    ...indexPlan(content),
    ...indexTasks(content),
    ...indexProjects(content),
    ...indexCareer(content),
  ];
}

export function searchLearningContent(content, query, { limit = 12, types } = {}) {
  const q = normalize(query);
  if (!q) return [];
  const allowed = types ? new Set(types) : null;
  return buildLearningSearchIndex(content)
    .filter((item) => !allowed || allowed.has(item.type))
    .map((item) => ({ item, score: score(item, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'ru'))
    .slice(0, limit)
    .map((row) => row.item);
}

function indexPlan(content) {
  const rows = [];
  for (const month of content.plan.months || []) {
    rows.push(makeItem({
      type: 'plan',
      label: `Месяц ${month.month}`,
      title: month.title,
      description: month.focus,
      href: `#/learning/plan?month=${month.month}`,
      text: [month.artifact, ...(month.skills || []), ...moduleTexts(month.trainerLinks?.map((link) => link.module))],
    }));
    for (const week of month.weeks || []) {
      rows.push(makeItem({
        type: 'topic',
        label: `Месяц ${month.month}, неделя ${week.week}`,
        title: week.title,
        description: (week.topics || []).join(' '),
        href: `#/learning/plan?month=${month.month}`,
        text: [month.title, ...(month.skills || []), ...moduleTexts(month.trainerLinks?.map((link) => link.module))],
      }));
    }
  }
  return rows;
}

function indexTasks(content) {
  return content.allTasks.map((task) => {
    const practice = content.practicesByTaskId?.get(task.id)?.practiceContent || {};
    return makeItem({
      type: 'task',
      label: `Задача · месяц ${task.month}`,
      title: task.title,
      description: content.skillsById.get(task.skill)?.title || task.skill,
      href: `#/learning/tasks?task=${encodeURIComponent(task.id)}`,
      text: [
        task.id,
        String(task.number || ''),
        `месяц ${task.month}`,
        task.skill,
        practice.businessContext,
        practice.managerRequest,
        practice.businessGoal,
        ...(practice.skills || []),
        ...(task.trainerModules || []),
        ...moduleTexts(task.trainerModules),
      ],
    });
  });
}

function indexProjects(content) {
  return (content.projects.projects || []).map((project) => makeItem({
    type: 'project',
    label: `Проект · месяц ${project.month}`,
    title: project.fullTitle || project.title,
    description: project.businessQuestion,
    href: `#/learning/projects?project=${encodeURIComponent(project.id)}`,
    text: [
      project.id,
      project.primarySkill,
      ...(project.stack || []),
      ...(project.deliverables || []),
      ...(project.trainerModules || []),
      ...moduleTexts(project.trainerModules),
    ],
  }));
}

function indexCareer(content) {
  const rows = [];
  for (const month of content.career.monthlyActions || []) {
    rows.push(makeItem({
      type: 'career',
      label: `Карьера · месяц ${month.month}`,
      title: month.phase,
      description: (month.actions || []).join(' '),
      href: `#/learning/career?month=${month.month}`,
      text: [month.applicationTarget, month.networkingTarget],
    }));
  }
  for (const channel of content.career.channels || []) {
    rows.push(makeItem({
      type: 'career',
      label: 'Канал поиска',
      title: channel.title,
      description: channel.type,
      href: '#/learning/career',
      text: [channel.id],
    }));
  }
  return rows;
}

function makeItem(item) {
  const haystack = normalize([
    item.label,
    item.title,
    item.description,
    ...(item.text || []),
  ].filter(Boolean).join(' '));
  return { ...item, haystack };
}

function score(item, q) {
  if (!item.haystack.includes(q)) return 0;
  let value = 1;
  if (normalize(item.title).includes(q)) value += 4;
  if (normalize(item.label).includes(q)) value += 2;
  if (normalize(item.description).includes(q)) value += 1;
  return value;
}

function moduleTexts(moduleIds = []) {
  return resolveTrainerModules(moduleIds).flatMap((item) => [item.moduleId, item.title, item.description || '']);
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}
