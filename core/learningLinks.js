// core/learningLinks.js — связь учебного плана с модулями тренажера (T2.3).

import { getModule } from './modules.js';

export function resolveTrainerModule(moduleId) {
  const module = getModule(moduleId);
  if (!module) {
    return {
      moduleId,
      title: `Модуль ${moduleId}`,
      href: null,
      known: false,
      hasCases: false,
      reason: 'Модуль не найден в реестре тренажера.',
    };
  }

  return {
    moduleId: module.id,
    title: module.title,
    description: module.description,
    href: module.hasCases ? `#/module/${encodeURIComponent(module.id)}` : '#/analytics',
    known: true,
    hasCases: module.hasCases,
  };
}

export function resolveTrainerModules(moduleIds = []) {
  return unique(moduleIds).map(resolveTrainerModule);
}

export function moduleButton(moduleId, label = 'Потренироваться') {
  const resolved = resolveTrainerModule(moduleId);
  if (!resolved.href) {
    const span = document.createElement('span');
    span.className = 'learning-practice learning-practice--disabled';
    span.textContent = `Нет связи: ${moduleId}`;
    return span;
  }
  const a = document.createElement('a');
  a.className = 'learning-practice';
  a.href = resolved.href;
  a.textContent = `${label}: ${resolved.moduleId}`;
  a.title = resolved.title;
  return a;
}

export function firstPracticeHref(moduleIds = []) {
  const found = resolveTrainerModules(moduleIds).find((item) => item.href);
  return found?.href || '#/modules';
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}
