// modules/resources/ResourcesView.js — экран «Ресурсы» (#/resources).
//
// Статическая подборка полезных ссылок для аналитика, сгруппированная по темам
// (SQL, аналитика, бизнес, книги, YouTube). Внешние ссылки открываются в новой
// вкладке. Никаких данных из хранилища — чистый контент.
//
// ES-модуль: `import { ResourcesView } from './modules/resources/ResourcesView.js'`.

import { pageHeader } from '../shared/ui.js';

// Подборки. item: { label, desc?, href? }. Без href — это книга/заметка (не ссылка).
const GROUPS = [
  {
    icon: '🗄️',
    title: 'SQL',
    hint: 'Тренируйте запросы от простых выборок до оконных функций.',
    items: [
      { label: 'SQLZoo', desc: 'Интерактивные упражнения по SQL прямо в браузере.', href: 'https://sqlzoo.net' },
      { label: 'Mode SQL Tutorial', desc: 'Путь от основ SQL до аналитических запросов.', href: 'https://mode.com/sql-tutorial' },
      { label: 'LeetCode · Database', desc: 'Задачи по SQL с автопроверкой и разбором.', href: 'https://leetcode.com/problemset/database' },
    ],
  },
  {
    icon: '📊',
    title: 'Аналитика',
    hint: 'Как находить смысл в данных и доносить его до людей.',
    items: [
      { label: 'Storytelling with Data', desc: 'Визуализация и подача данных, которые убеждают.', href: 'https://www.storytellingwithdata.com' },
      { label: 'Kaggle', desc: 'Датасеты, соревнования и ноутбуки сообщества.', href: 'https://www.kaggle.com' },
    ],
  },
  {
    icon: '💼',
    title: 'Бизнес',
    hint: 'Связывайте данные с бизнес-моделью и ценностью продукта.',
    items: [
      { label: 'Strategyzer', desc: 'Бизнес-модели и ценностные предложения (Canvas).', href: 'https://www.strategyzer.com' },
    ],
  },
  {
    icon: '📚',
    title: 'Книги',
    hint: 'Фундамент мышления аналитика — на длинной дистанции.',
    items: [
      { label: '«Грокаем алгоритмы»', desc: 'Алгоритмы и структуры данных простым языком, с иллюстрациями.' },
      { label: '«Думай как аналитик»', desc: 'Аналитический подход к рабочим и жизненным задачам.' },
      { label: '«Naked Statistics»', desc: 'Статистика без занудных формул — на живых примерах.' },
    ],
  },
  {
    icon: '▶️',
    title: 'YouTube',
    hint: 'Каналы по Data Analysis на английском и русском.',
    items: [
      { label: 'Alex The Analyst', desc: 'Путь в профессию Data Analyst, SQL и портфолио (англ.).', href: 'https://www.youtube.com/@AlexTheAnalyst' },
      { label: 'Luke Barousse', desc: 'Инструменты и реальные проекты аналитика данных (англ.).', href: 'https://www.youtube.com/@LukeBarousse' },
      { label: 'Аналитика данных на русском', desc: 'Подборка обучающих видео по аналитике данных.', href: 'https://www.youtube.com/results?search_query=аналитика+данных+обучение' },
    ],
  },
];

export function ResourcesView() {
  const root = document.createElement('section');
  root.className = 'resources screen';
  root.append(pageHeader('Ресурсы', 'Подборка материалов, которые помогут расти как аналитику. Ссылки открываются в новой вкладке.'));

  const grid = document.createElement('div');
  grid.className = 'resources__grid';
  for (const group of GROUPS) grid.append(buildGroup(group));
  root.append(grid);

  return root;
}

function buildGroup(group) {
  const card = document.createElement('section');
  card.className = 'resource-card home-widget';

  const head = document.createElement('div');
  head.className = 'resource-card__head';
  const icon = document.createElement('span');
  icon.className = 'resource-card__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = group.icon;
  const title = document.createElement('h2');
  title.className = 'resource-card__title';
  title.textContent = group.title;
  head.append(icon, title);
  card.append(head);

  if (group.hint) {
    const hint = document.createElement('p');
    hint.className = 'resource-card__hint';
    hint.textContent = group.hint;
    card.append(hint);
  }

  const list = document.createElement('ul');
  list.className = 'resource-list';
  for (const item of group.items) list.append(buildItem(item));
  card.append(list);

  return card;
}

function buildItem(item) {
  const li = document.createElement('li');
  li.className = 'resource-item';

  // Книга/заметка без ссылки vs внешняя ссылка.
  const head = item.href ? document.createElement('a') : document.createElement('span');
  head.className = 'resource-item__label';
  head.textContent = item.label;
  if (item.href) {
    head.href = item.href;
    head.target = '_blank';
    head.rel = 'noopener noreferrer';
    const ext = document.createElement('span');
    ext.className = 'resource-item__ext';
    ext.setAttribute('aria-hidden', 'true');
    ext.textContent = '↗';
    head.append(ext);
  } else {
    li.classList.add('resource-item--book');
  }
  li.append(head);

  if (item.desc) {
    const desc = document.createElement('p');
    desc.className = 'resource-item__desc';
    desc.textContent = item.desc;
    li.append(desc);
  }
  return li;
}
