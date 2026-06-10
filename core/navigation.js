// core/navigation.js — единый источник структуры навигации приложения.
//
// UI-компоненты читают этот конфиг и не решают, какие разделы являются главными.
// Это удерживает сайдбар, нижнюю навигацию и будущие shell-компоненты от разъезда.

export const LEARNING_NAV_STORAGE_KEY = 'at:sidebar:learning-open';

export const NAV_GROUPS = [
  {
    heading: '',
    items: [
      { label: 'Главная', icon: 'home', href: '#/', match: { exact: '/' } },
    ],
  },
  {
    heading: 'Обучение',
    collapsible: true,
    icon: 'book',
    storageKey: LEARNING_NAV_STORAGE_KEY,
    items: [
      { label: 'Сегодня', icon: 'calendar', href: '#/learning/today', match: { exact: '/learning/today' } },
      { label: 'План обучения', icon: 'map', href: '#/learning/plan', match: { exact: '/learning/plan' } },
      { label: 'Задачи', icon: 'check', href: '#/learning/tasks', match: { exact: '/learning/tasks' } },
      { label: 'Проекты', icon: 'folder', href: '#/learning/projects', match: { exact: '/learning/projects' } },
      { label: 'Карьера', icon: 'briefcase', href: '#/learning/career', match: { exact: '/learning/career' } },
    ],
  },
  {
    heading: 'Тренажер',
    collapsible: true,
    icon: 'grid',
    storageKey: 'at:sidebar:trainer-open',
    items: [
      { label: 'Маршрут курса', icon: 'grid', href: '#/modules', match: { exact: '/modules', prefix: '/module' } },
      { label: 'Практика', icon: 'target', href: '#/practice', match: { exact: '/practice' } },
      { label: 'Mock Interview', icon: 'briefcase', href: '#/learning/mock-interview', match: { exact: '/learning/mock-interview' } },
    ],
  },
  {
    heading: 'Прогресс',
    items: [
      { label: 'Аналитика', icon: 'chart', href: '#/analytics', match: { exact: '/analytics' } },
      { label: 'История', icon: 'clock', href: '#/history', match: { exact: '/history' } },
    ],
  },
  {
    heading: 'Ещё',
    collapsible: true,
    icon: 'settings',
    storageKey: 'at:sidebar:more-open',
    items: [
      { label: 'Избранное', icon: 'star', href: '#/favorites', match: { exact: '/favorites' } },
      { label: 'Ресурсы', icon: 'book', href: '#/resources', match: { exact: '/resources' } },
      { label: 'Настройки', icon: 'settings', href: '#/settings', match: { exact: '/settings' } },
      { label: 'О проекте', icon: 'info', href: '#/about', match: { exact: '/about' } },
    ],
  },
];

export const BOTTOM_NAV_ITEMS = {
  home: { href: '#/', icon: 'home', label: 'Главная', match: 'home' },
  continue: { href: '#/modules', icon: 'play', label: 'Дальше', match: 'continue' },
  practice: { href: '#/practice', icon: 'target', label: 'Практика', match: 'practice' },
  plan: { href: '#/learning/plan', icon: 'map', label: 'План обучения', match: 'plan' },
};
