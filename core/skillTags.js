// core/skillTags.js — закрытая таксономия тегов навыков (T0.3.4).
//
// Единственная точка истины по тегам и их группировке — PRD §4
// («Таксономия тегов навыков»). Словарь ЗАКРЫТЫЙ: свободный ввод тегов запрещён,
// чтобы не плодить расхождения «sql»/«SQL». Добавление тега — правка этого файла
// (значение + группа), а не свободный ввод в JSON кейса.
//
// ES-модуль: `import { isKnownTag, groupForTag, SKILL_GROUP_LABELS } from './core/skillTags.js'`.

// --- Закрытый словарь тегов (7 значений, PRD §4) -----------------------------
export const SKILL_TAGS = [
  'analytical-thinking',
  'hypotheses',
  'data-viz',
  'root-cause',
  'sql',
  'business-thinking',
  'automation-design',
  'ai-tools',
];

// Быстрый lookup при валидации.
const SKILL_TAG_SET = new Set(SKILL_TAGS);

// --- Группы навыков, по которым агрегирует Learning Analytics (5.8) ----------
// Ключи групп — стабильные машинные идентификаторы; человекочитаемые названия
// в SKILL_GROUP_LABELS (их показывает UI прогресса по навыкам).
export const SKILL_GROUPS = {
  analytical: ['analytical-thinking', 'hypotheses', 'root-cause'],
  practical: ['sql', 'data-viz', 'ai-tools'],
  business: ['business-thinking', 'automation-design'],
};

export const SKILL_GROUP_LABELS = {
  analytical: 'Аналитическое мышление',
  practical: 'Практические навыки Data Analyst',
  business: 'Бизнес-мышление',
};

// Обратный индекс «тег → группа», строится один раз из SKILL_GROUPS.
const TAG_TO_GROUP = Object.freeze(
  Object.entries(SKILL_GROUPS).reduce((acc, [group, tags]) => {
    for (const tag of tags) acc[tag] = group;
    return acc;
  }, {}),
);

// --- Публичные хелперы -------------------------------------------------------

// Тег входит в закрытый словарь? Используется валидатором кейсов (T0.3.3).
export function isKnownTag(tag) {
  return SKILL_TAG_SET.has(tag);
}

// Группа навыков для тега (`'analytical'|'practical'|'business'`) или null.
export function groupForTag(tag) {
  return TAG_TO_GROUP[tag] ?? null;
}
