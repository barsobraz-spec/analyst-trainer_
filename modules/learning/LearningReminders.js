// modules/learning/LearningReminders.js — внутренние напоминания V1 (T7.4).

import {
  dismissLearningReminder,
  getAllLearningReminders,
  saveLearningReminder,
} from '../../core/db.js';
import { navigate } from '../../core/router.js';
import { button, card, emptyPanel, text } from './learningUi.js';

const DEFAULT_SCOPES = ['today', 'projects', 'weak_spots', 'career'];

export async function LearningRemindersPanel({
  title = 'Напоминания',
  scopes = DEFAULT_SCOPES,
  suggestions = [],
  emptyText = 'Активных напоминаний пока нет.',
} = {}) {
  const scopeSet = new Set(scopes);
  const reminders = await getAllLearningReminders().catch(() => []);
  const active = reminders
    .filter((item) => item.status === 'active' && scopeSet.has(item.scope))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const box = card('learning-reminders');
  box.append(text('h2', 'learning-card__title', title));

  if (active.length === 0) {
    box.append(emptyPanel(emptyText));
  } else {
    const list = document.createElement('div');
    list.className = 'learning-reminders__list';
    for (const reminder of active) list.append(reminderRow(reminder));
    box.append(list);
  }

  const uniqueSuggestions = dedupeSuggestions(suggestions)
    .filter((suggestion) => !active.some((reminder) => reminderKey(reminder) === reminderKey(suggestion)));
  if (uniqueSuggestions.length > 0) {
    const create = document.createElement('div');
    create.className = 'learning-reminders__create';
    create.append(text('h3', 'learning-subtitle', 'Быстро добавить'));
    for (const suggestion of uniqueSuggestions) create.append(suggestionButton(suggestion));
    box.append(create);
  }

  return box;
}

export const REMINDER_SUGGESTIONS = Object.freeze({
  today: {
    scope: 'today',
    type: 'daily',
    sourceId: 'learning-today',
    title: 'Вернуться к сегодняшним задачам',
    detail: 'Проверить состав дня, практику и дневник аналитика.',
    href: '#/learning/today',
  },
  projects: {
    scope: 'projects',
    type: 'project',
    sourceId: 'learning-projects',
    title: 'Продвинуть проект портфолио',
    detail: 'Вернуться к GitHub, README, скриншотам или чек-листу качества.',
    href: '#/learning/projects',
  },
  weakSpots: {
    scope: 'weak_spots',
    type: 'repeat',
    sourceId: 'learning-weak-spots',
    title: 'Повторить слабые места',
    detail: 'Разобрать задачи со статусом "Повторить" и перейти к практике.',
    href: '#/learning/tasks?status=repeat',
  },
  career: {
    scope: 'career',
    type: 'career',
    sourceId: 'learning-career',
    title: 'Вернуться к карьерным действиям',
    detail: 'Проверить отклики, активные процессы и ближайший карьерный шаг.',
    href: '#/learning/career',
  },
});

function reminderRow(reminder) {
  const row = document.createElement('article');
  row.className = 'learning-reminder';
  const body = document.createElement('div');
  body.className = 'learning-reminder__body';

  const title = document.createElement(reminder.href ? 'a' : 'strong');
  title.className = 'learning-reminder__title';
  title.textContent = reminder.title;
  if (reminder.href) title.href = reminder.href;
  body.append(title);
  if (reminder.detail) body.append(text('p', 'learning-muted', reminder.detail));

  const close = button('Закрыть', 'learning-button--small');
  close.addEventListener('click', async () => {
    await dismissLearningReminder(reminder.reminderId);
    navigate(location.hash.replace(/^#/, '') || '/learning/today');
  });

  row.append(body, close);
  return row;
}

function suggestionButton(suggestion) {
  const action = button(suggestion.title, 'learning-button--small');
  action.addEventListener('click', async () => {
    await saveLearningReminder({
      scope: suggestion.scope,
      type: suggestion.type,
      sourceId: suggestion.sourceId,
      title: suggestion.title,
      detail: suggestion.detail,
      href: suggestion.href,
    });
    navigate(location.hash.replace(/^#/, '') || '/learning/today');
  });
  return action;
}

function dedupeSuggestions(suggestions) {
  const out = [];
  const seen = new Set();
  for (const item of suggestions || []) {
    if (!item?.scope || !item?.title) continue;
    const key = reminderKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function reminderKey(item) {
  return `${item.scope}:${item.type || 'custom'}:${item.sourceId || item.title}`;
}
