// modules/analytics/Recommendations.js — разбор слабых мест и рекомендации (T9.2.2).
//
// PRD §5.8 Ф3/Ф4: показывает модули-«слабые места» (по правилу adjScore/hintsUsed
// из core/analytics.computeWeakModules) и для каждого — несколько кейсов для
// тренировки (непройденные или низкобалльные подходящего уровня). Рекомендации не
// выдаются, пока не выполнено условие из Ф4, — этот компонент монтируется экраном
// только когда есть слабые модули (computeWeakModules уже учитывает минимум попыток).
//
// На вход — готовые элементы `[{ module:{moduleId,title,avgAdjScore,avgHints,reasons},
// cases:[{caseId,title,difficulty,status,lastScore}] }]` (кейсы уже отфильтрованы
// recommendCasesForModule в экране). Компонент только отображает и даёт ссылки.
//
// ES-модуль: `import { Recommendations } from './modules/analytics/Recommendations.js'`.

import { DifficultyBadge, StatusBadge } from '../../core/components/StatusBadge.js';

const REASON_LABELS = {
  low_score: 'низкий средний результат',
  many_hints: 'частое использование подсказок',
};

export function Recommendations({ items = [] } = {}) {
  const root = document.createElement('section');
  root.className = 'analytics-section recommendations';

  const h2 = document.createElement('h2');
  h2.className = 'analytics-section__title';
  h2.textContent = 'Что тренировать дальше';
  root.append(h2);

  const intro = document.createElement('p');
  intro.className = 'recommendations__intro';
  intro.textContent =
    'Эти модули отстают по результату или потребовали больше подсказок — начните с них.';
  root.append(intro);

  for (const item of items) root.append(buildModuleBlock(item));
  return root;
}

function buildModuleBlock({ module, cases }) {
  const block = document.createElement('article');
  block.className = 'recommendations__module';

  const head = document.createElement('div');
  head.className = 'recommendations__module-head';
  const title = document.createElement('h3');
  title.className = 'recommendations__module-title';
  const link = document.createElement('a');
  link.href = `#/module/${encodeURIComponent(module.moduleId)}`;
  link.textContent = `${module.moduleId} · ${module.title}`;
  title.append(link);
  head.append(title);
  block.append(head);

  // Почему модуль попал в слабые места + ключевые числа.
  const why = document.createElement('p');
  why.className = 'recommendations__why';
  const reasons = module.reasons.map((r) => REASON_LABELS[r] || r).join(' и ');
  why.textContent =
    `Причина: ${reasons}. Средний результат (с поправкой на сложность): ` +
    `${module.avgAdjScore} / 100, подсказок в среднем: ${module.avgHints}.`;
  block.append(why);

  if (cases.length === 0) {
    const done = document.createElement('p');
    done.className = 'recommendations__all-done';
    done.textContent = 'Все кейсы модуля пройдены — повторите их, чтобы закрепить результат.';
    block.append(done);
    return block;
  }

  const advice = document.createElement('p');
  advice.className = 'recommendations__advice';
  advice.textContent = `Рекомендуем пройти (${cases.length}):`;
  block.append(advice);

  const list = document.createElement('ul');
  list.className = 'recommendations__cases';
  for (const c of cases) list.append(buildCaseItem(module.moduleId, c));
  block.append(list);

  return block;
}

function buildCaseItem(moduleId, c) {
  const li = document.createElement('li');
  const link = document.createElement('a');
  link.className = 'recommendations__case';
  link.href = `#/module/${encodeURIComponent(moduleId)}/case/${encodeURIComponent(c.caseId)}`;

  const title = document.createElement('span');
  title.className = 'recommendations__case-title';
  title.textContent = c.title || c.caseId;

  link.append(title, DifficultyBadge(c.difficulty), StatusBadge(c.status));
  if (c.status === 'passed' && typeof c.lastScore === 'number') {
    const score = document.createElement('span');
    score.className = 'recommendations__case-score';
    score.textContent = `последний: ${c.lastScore}`;
    link.append(score);
  }

  li.append(link);
  return li;
}
