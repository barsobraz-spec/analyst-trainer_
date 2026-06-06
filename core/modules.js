// core/modules.js — реестр восьми обучающих модулей (PRD §5, §6 Ф1).
//
// Единая точка истины по названиям, описаниям и группам навыков модулей. Каталог
// (T1.1), список кейсов (T1.2) и Learning Analytics (Этап 9) берут метаданные
// модулей отсюда, чтобы тексты не расходились между экранами.
//
// Идентификаторы 5.1–5.8 совпадают с полем `module` в кейсах и событиях.
// Модули 5.1–5.7 содержат кейсы (см. KNOWN_CASE_MODULES в caseValidator.js);
// 5.8 (Learning Analytics) кейсов не имеет и открывается как отдельный экран
// аналитики, а не как список кейсов.
//
// ES-модуль: `import { MODULES, getModule, CASE_MODULES } from './core/modules.js'`.

export const MODULES = [
  {
    id: '5.1',
    title: 'Data Detective',
    description: 'Извлечение выводов из ограниченных данных и текстового контекста.',
    skillGroup: 'analytical',
    hasCases: true,
  },
  {
    id: '5.2',
    title: 'Hypothesis Trainer',
    description: 'Формулировка проверяемых, измеримых и релевантных гипотез.',
    skillGroup: 'analytical',
    hasCases: true,
  },
  {
    id: '5.3',
    title: 'Dashboard Analysis',
    description: 'Чтение графиков, поиск аномалий и формулировка инсайтов.',
    skillGroup: 'practical',
    hasCases: true,
  },
  {
    id: '5.4',
    title: 'Root Cause Analysis',
    description: 'Поиск корневых причин через структурированные методики.',
    skillGroup: 'analytical',
    hasCases: true,
  },
  {
    id: '5.5',
    title: 'SQL Investigation',
    description: 'Практика SQL на расследованиях: серия связанных запросов.',
    skillGroup: 'practical',
    hasCases: true,
  },
  {
    id: '5.6',
    title: 'Business Simulator',
    description: 'Принятие бизнес-решений в многошаговом сценарии с числовой моделью.',
    skillGroup: 'business',
    hasCases: true,
  },
  {
    id: '5.7',
    title: 'Automation Designer',
    description: 'Проектирование автоматизаций на уровне схемы и процесса.',
    skillGroup: 'business',
    hasCases: true,
  },
  {
    id: '5.8',
    title: 'Learning Analytics',
    description: 'Анализ собственного прогресса по навыкам на основе данных всех модулей.',
    skillGroup: null,
    hasCases: false,
  },
];

// Только модули с кейсами (5.1–5.7) — для каталога и фильтров статистики.
export const CASE_MODULES = MODULES.filter((m) => m.hasCases);

const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));

// Метаданные модуля по id (`'5.1'`) или undefined, если id неизвестен.
export function getModule(id) {
  return MODULE_BY_ID.get(id);
}
