// core/modules.js — реестр восьми обучающих модулей (PRD §5, §6 Ф1).
//
// Единая точка истины по названиям, описаниям и группам навыков модулей. Каталог
// (T1.1), список кейсов (T1.2) и Learning Analytics (Этап 9) берут метаданные
// модулей отсюда, чтобы тексты не расходились между экранами.
//
// Идентификаторы 5.1–5.8 совпадают с полем `module` в кейсах и событиях.
// Модули 5.1–5.7 содержат кейсы; 5.8 (Learning Analytics) кейсов не имеет.
//
// Точка расширения: чтобы добавить новый тип контента —
//   1. добавить запись в MODULES (id, title, description, skillGroup, hasCases);
//   2. вызвать registerModuleView(id, ViewFn) из модульного слоя (modules/).
// Никакие другие файлы (роутер, валидатор, хост кейсов) менять не нужно.
//
// ES-модуль: `import { MODULES, getModule, CASE_MODULES,
//   registerModuleView, getModuleView } from './core/modules.js'`.

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

// Полный реестр типов: { id, title, description, skillGroup, hasCases, view, validator, grader }.
// view, validator, grader — null до явной регистрации.
// view заполняется из modules/caseHost.js; grader — из того же файла или отдельного плагина.
// Контракт нового типа контента — см. docs/extension-guide.md.
const _registry = new Map(MODULES.map((m) => [m.id, { ...m, view: null, validator: null, grader: null }]));

// Метаданные модуля по id ('5.1') или undefined, если id неизвестен.
export function getModule(id) {
  return _registry.get(id);
}

// Зарегистрировать CaseView-функцию для модуля. Вызывается из modules/caseHost.js.
// Позволяет core/ не импортировать ничего из modules/ (нет нарушения слоёв).
export function registerModuleView(id, viewFn) {
  const entry = _registry.get(id);
  if (!entry) {
    console.warn(`[modules] registerModuleView: неизвестный id "${id}"`);
    return;
  }
  entry.view = viewFn;
}

// Получить зарегистрированный CaseView для модуля, или null если не зарегистрирован.
export function getModuleView(id) {
  return _registry.get(id)?.view ?? null;
}

// Зарегистрировать Grader для модуля. Grader — объект { grade(answer, ref, opts?) → GradeResult }.
// Реализации — SqlGrader, SelfGrader, ScoreGrader из core/grader.js.
export function registerModuleGrader(id, grader) {
  const entry = _registry.get(id);
  if (!entry) {
    console.warn(`[modules] registerModuleGrader: неизвестный id "${id}"`);
    return;
  }
  entry.grader = grader;
}

// Получить зарегистрированный Grader для модуля, или null если не зарегистрирован.
export function getModuleGrader(id) {
  return _registry.get(id)?.grader ?? null;
}
