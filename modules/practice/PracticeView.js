// modules/practice/PracticeView.js — экран «Практика» (#/practice).
//
// Быстрый способ потренироваться: показывает СЛУЧАЙНЫЙ кейс из любого модуля. Если
// кейс не нравится — кнопка «Другой кейс» подбирает другой, не перезагружая страницу.
// Маршрут кейсов берём из core/courseNav (тот же порядок, что у курса), статус — из
// IndexedDB (только чтение). Логику/хранилище не трогаем.
//
// ES-модуль: `import { PracticeView } from './modules/practice/PracticeView.js'`.

import { getModule } from '../../core/modules.js';
import { getOutline, caseHash } from '../../core/courseNav.js';
import { loadProgressMap, statusOf } from '../../core/progress.js';
import { StatusBadge, DifficultyBadge } from '../../core/components/StatusBadge.js';
import { FavoriteButton } from '../../core/components/FavoriteButton.js';
import { pageHeader, emptyState } from '../shared/ui.js';

// Эмодзи-иконка модуля (как на главной, для визуального акцента).
const MODULE_ICON = {
  '5.1': '🔍', '5.2': '💡', '5.3': '📊', '5.4': '🎯',
  '5.5': '🗄️', '5.6': '🚀', '5.7': '⚙️',
};

export async function PracticeView() {
  const root = document.createElement('section');
  root.className = 'practice screen';
  root.append(pageHeader('Практика', 'Случайный кейс из любого модуля — быстрый способ потренироваться.'));

  const [outline, progress] = await Promise.all([getOutline(), loadProgressMap()]);
  const pool = outline.flat;

  if (pool.length === 0) {
    root.append(emptyState({
      icon: '🎲',
      title: 'Пока нет кейсов для практики',
      text: 'Когда появятся кейсы, здесь можно будет тренироваться на случайных задачах.',
      ctaHref: '#/modules',
      ctaText: 'Открыть каталог →',
    }));
    return root;
  }

  // Слот, который перерисовывается кнопкой «Другой кейс» (без перезагрузки).
  const slot = document.createElement('div');
  slot.className = 'practice__slot';
  root.append(slot);

  let current = null;

  function pick() {
    // Подбираем случайный кейс, отличный от текущего (если есть выбор).
    let next = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && current) {
      let guard = 0;
      while (next.caseId === current.caseId && guard < 20) {
        next = pool[Math.floor(Math.random() * pool.length)];
        guard += 1;
      }
    }
    current = next;
    slot.replaceChildren(buildCard(next, progress, pick));
  }

  pick();
  return root;
}

function buildCard(c, progress, onAnother) {
  const card = document.createElement('div');
  card.className = 'practice-card';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'practice-card__eyebrow';
  eyebrow.textContent = 'Случайный кейс';
  card.append(eyebrow);

  // Модуль (иконка + id · название).
  const mod = getModule(c.module);
  const modRow = document.createElement('div');
  modRow.className = 'practice-card__module';
  const icon = document.createElement('span');
  icon.className = 'practice-card__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = MODULE_ICON[c.module] || '•';
  const modName = document.createElement('span');
  modName.className = 'practice-card__module-name';
  modName.textContent = mod ? `${mod.id} · ${mod.title}` : c.module;
  modRow.append(icon, modName);
  card.append(modRow);

  // Название кейса.
  const title = document.createElement('h2');
  title.className = 'practice-card__title';
  title.textContent = c.title;
  card.append(title);

  // Бейджи: сложность + статус + звезда.
  const badges = document.createElement('div');
  badges.className = 'practice-card__badges';
  const st = statusOf(progress, c.caseId);
  badges.append(DifficultyBadge(c.difficulty), StatusBadge(st.status), FavoriteButton(c.caseId));
  card.append(badges);

  // Действия: начать / другой кейс.
  const actions = document.createElement('div');
  actions.className = 'practice-card__actions';

  const start = document.createElement('a');
  start.className = 'practice-card__start';
  start.href = caseHash(c);
  start.textContent = st.status === 'passed' ? 'Пройти снова →' : 'Начать кейс →';

  const another = document.createElement('button');
  another.type = 'button';
  another.className = 'practice-card__another';
  another.textContent = '🎲 Другой кейс';
  another.addEventListener('click', onAnother);

  actions.append(start, another);
  card.append(actions);

  return card;
}
