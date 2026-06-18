// modules/learning/plan/DayDetail.js — отображение и fallback-модель дня плана.

import { moduleButton } from '../../../core/learningLinks.js';
import { caseHash } from '../../../core/courseNav.js';
import { text } from '../learningUi.js';

const STUDY_DAYS_PER_WEEK = 6;
const REST_DAY_NUMBER = 7;

export function DayDetail(day, month, week, caseIndex) {
  const box = document.createElement('section');
  box.className = 'learning-day-detail';
  if (!day) {
    box.append(text('p', 'learning-empty', 'День не найден.'));
    return box;
  }
  if (day.day === REST_DAY_NUMBER) box.classList.add('is-rest-day');
  box.append(
    text('span', 'learning-month__badge', dayLabel(day)),
    text('h3', 'learning-card__title', day.title),
    text('p', 'learning-muted', day.summary || week.title),
  );

  const facts = document.createElement('div');
  facts.className = 'learning-day-facts';
  if (day.goal) facts.append(dayFact('Главная цель', day.goal));
  if (day.result) facts.append(dayFact('Результат дня', day.result));
  if (facts.childElementCount > 0) box.append(facts);

  box.append(practiceLaunch(day, caseIndex));

  if (Array.isArray(day.blocks) && day.blocks.length > 0) {
    const blocks = document.createElement('div');
    blocks.className = 'learning-day-blocks';
    for (const block of day.blocks) blocks.append(dayBlock(block));
    box.append(blocks);
  } else {
    box.append(topicList(day, month));
  }

  box.append(
    namedList('Контрольные вопросы', day.controlQuestions),
    namedList('Чек-лист', day.checklist),
    namedList('Критерии завершения', day.completionCriteria),
    namedList('Типичные ошибки', day.commonMistakes),
  );
  return box;
}

export function buildWeekDays(week, month) {
  if (!week) return [];
  if (Array.isArray(week.days) && week.days.length > 0) {
    const activeDays = week.days
      .slice(0, STUDY_DAYS_PER_WEEK)
      .map((rawDay, index) => normalizeDay(rawDay, index, week));
    return week.restDay
      ? [...activeDays, normalizeRestDay(week.restDay, week)]
      : activeDays;
  }

  const topics = Array.isArray(week.topics) ? week.topics : [];
  return Array.from({ length: STUDY_DAYS_PER_WEEK }, (_, index) => {
    const dayNumber = index + 1;
    const topic = topics[index];
    if (topic) {
      return {
        day: dayNumber,
        title: shortTitle(topic),
        summary: week.title,
        topics: [topic],
      };
    }
    if (dayNumber === 5) {
      return {
        day: dayNumber,
        title: 'Практика недели',
        summary: week.title,
        topics: [
          'Закрепить темы недели на практической задаче или кейсе тренажера.',
          month?.artifact ? `Связать практику с артефактом месяца: ${month.artifact}.` : 'Сделать небольшой рабочий артефакт по теме недели.',
        ],
      };
    }
    return {
      day: dayNumber,
      title: 'Повторение и мини-артефакт',
      summary: week.title,
      topics: [
        'Повторить слабые места недели и закрыть незавершенные заметки.',
        'Описать в дневнике, что получилось, что требует повторения и какой следующий шаг.',
      ],
    };
  });
}

export function dayLabel(day) {
  if (!day) return 'День 1';
  return `День ${day.monthDay || day.day}`;
}

function normalizeDay(rawDay, index, week) {
  const dayNumber = readBoundedNumber(rawDay?.day, 1, STUDY_DAYS_PER_WEEK, index + 1);
  const topics = Array.isArray(rawDay?.topics)
    ? rawDay.topics
    : [rawDay?.topic].filter(Boolean);
  return {
    ...rawDay,
    day: dayNumber,
    title: rawDay?.title || shortTitle(topics[0]) || `День ${dayNumber}`,
    summary: rawDay?.summary || week.title,
    topics: topics.length > 0 ? topics : [rawDay?.title || week.title].filter(Boolean),
  };
}

function normalizeRestDay(rawDay, week) {
  const topics = Array.isArray(rawDay?.topics)
    ? rawDay.topics
    : [rawDay?.topic].filter(Boolean);
  return {
    ...rawDay,
    day: REST_DAY_NUMBER,
    title: rawDay?.title || 'Лёгкий день',
    summary: rawDay?.summary || week.title,
    topics: topics.length > 0 ? topics : [rawDay?.title || week.title].filter(Boolean),
  };
}

// Кнопки запуска практики тренажёра прямо в карточке дня: day.caseIds →
// конкретные кейсы (#/module/:id/case/:caseId). Если ссылок нет или индекс
// кейсов недоступен — секция не отображается.
function practiceLaunch(day, caseIndex) {
  const ids = Array.isArray(day.caseIds) ? day.caseIds : [];
  if (ids.length === 0 || !caseIndex) return document.createDocumentFragment();

  const links = document.createElement('div');
  links.className = 'learning-practice-links';
  for (const id of ids) {
    const entry = caseIndex.get(id);
    if (!entry) continue;
    const link = document.createElement('a');
    link.className = 'learning-practice';
    link.href = caseHash(entry);
    link.textContent = `Начать практику: ${entry.title}`;
    link.title = `Модуль ${entry.module} · ${entry.title}`;
    links.append(link);
  }
  if (links.childElementCount === 0) return document.createDocumentFragment();

  const section = document.createElement('section');
  section.className = 'learning-day-section learning-day-practice';
  section.append(
    text('h4', 'learning-subtitle', 'Практика в тренажёре по теме дня'),
    text('p', 'learning-muted', 'Закрепи тему сразу на кейсе тренажёра — параллельно с запросами в DBeaver.'),
    links,
  );
  return section;
}

function dayFact(label, value) {
  const item = document.createElement('section');
  item.className = 'learning-day-fact';
  item.append(text('strong', '', label), text('p', '', value));
  return item;
}

function dayBlock(block) {
  const section = document.createElement('section');
  section.className = 'learning-day-block';
  const head = document.createElement('div');
  head.className = 'learning-day-block__head';
  head.append(text('strong', '', block.title || 'Блок дня'));
  if (block.durationMinutes) head.append(text('span', '', `${block.durationMinutes} мин`));
  section.append(head);

  const list = document.createElement('ul');
  list.className = 'learning-list';
  for (const item of block.items || []) {
    const li = document.createElement('li');
    li.textContent = item;
    list.append(li);
  }
  section.append(list);
  return section;
}

function topicList(day, month) {
  const list = document.createElement('ul');
  list.className = 'learning-list';
  for (const topic of day.topics || []) {
    const li = document.createElement('li');
    li.append(document.createTextNode(topic));
    const firstModule = month.trainerLinks?.[0]?.module;
    if (firstModule) li.append(moduleButton(firstModule, 'Практика'));
    list.append(li);
  }
  return list;
}

function namedList(title, items) {
  if (!Array.isArray(items) || items.length === 0) return document.createDocumentFragment();
  const section = document.createElement('section');
  section.className = 'learning-day-section';
  section.append(text('h4', 'learning-subtitle', title));
  const list = document.createElement('ul');
  list.className = 'learning-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    list.append(li);
  }
  section.append(list);
  return section;
}

function readBoundedNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function shortTitle(value) {
  const clean = String(value || '').replace(/\s+/g, ' ').replace(/[.。]+$/, '').trim();
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean;
}
