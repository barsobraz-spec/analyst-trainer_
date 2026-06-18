// modules/favorites/FavoritesView.js — экран «Избранное» (#/favorites).
//
// Показывает кейсы, отмеченные звёздочкой (core/favorites.js, localStorage). Для
// каждого — название, модуль, сложность, статус прохождения (из IndexedDB, только
// чтение) и звезда для снятия отметки. Снятие отметки убирает строку на лету; когда
// список опустеет — показываем пустое состояние. Логику и хранилище не трогаем.
//
// Возвращает { element, destroy }: на странице висит один слушатель at:favorites-changed,
// его снимает destroy при уходе с экрана (контракт жизненного цикла роутера).
//
// ES-модуль: `import { FavoritesView } from './modules/favorites/FavoritesView.js'`.

import { getFavorites, FAVORITES_EVENT } from '../../core/favorites.js';
import { loadProgressMap, statusOf } from '../../core/progress.js';
import { loadCaseMetaMap } from '../shared/caseCatalog.js';
import { caseCard } from '../shared/caseCard.js';
import { pageHeader, emptyState, plural } from '../shared/ui.js';

export async function FavoritesView() {
  const root = document.createElement('section');
  root.className = 'favorites screen';
  root.append(pageHeader('Избранное', 'Кейсы, которые вы отметили звёздочкой, чтобы вернуться к ним позже.'));

  const favIds = getFavorites();
  const [metaMap, progress] = await Promise.all([loadCaseMetaMap(), loadProgressMap()]);

  // Контейнер, который переключается между списком и пустым состоянием.
  const body = document.createElement('div');
  body.className = 'favorites__body';
  root.append(body);

  // Счётчик отмеченных кейсов (показываем только когда есть избранное).
  const count = document.createElement('p');
  count.className = 'favorites__count';

  const list = document.createElement('ul');
  list.className = 'case-list__items';

  function showEmpty() {
    body.replaceChildren(emptyState({
      icon: 'star',
      title: 'Пока ничего не отмечено',
      text: 'Откройте список кейсов и нажмите звёздочку на любом кейсе — он появится здесь.',
      ctaHref: '#/modules',
      ctaText: 'Открыть каталог →',
    }));
  }

  function updateCount() {
    const n = list.children.length;
    count.textContent = `${n} ${plural(n, 'кейс', 'кейса', 'кейсов')} в избранном`;
  }

  if (favIds.length === 0) {
    showEmpty();
  } else {
    // Свежие отметки — сверху (массив хранит порядок добавления).
    for (const id of [...favIds].reverse()) {
      const meta = metaMap.get(id) || { caseId: id, module: '', title: id, difficulty: undefined, broken: false };
      const st = statusOf(progress, id);
      list.append(caseCard({ meta, status: st.status, lastScore: st.lastScore }));
    }
    body.append(count, list);
    updateCount();
  }

  // Живое обновление: снятие звезды убирает строку; опустевший список → пустое состояние.
  const onChange = (e) => {
    const detail = e.detail || {};
    if (detail.favorite === false && detail.caseId) {
      const row = list.querySelector(`[data-case-id="${cssEscape(detail.caseId)}"]`);
      if (row) row.remove();
      if (list.children.length === 0) showEmpty();
      else updateCount();
    }
  };
  window.addEventListener(FAVORITES_EVENT, onChange);

  return {
    element: root,
    destroy: () => window.removeEventListener(FAVORITES_EVENT, onChange),
  };
}

// Экранирование значения для селектора (caseId пользовательских кейсов = user-<uuid>,
// но на всякий случай — на случай нестандартных id).
function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/["\\\]]/g, '\\$&');
}
