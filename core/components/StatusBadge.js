// core/components/StatusBadge.js — переиспользуемые бейджи кейса (T1.5.4).
//
// Единая точка для двух типов бейджей, которые встречаются на нескольких экранах
// (список кейсов, шапка кейса, будущие экраны результата):
//   • StatusBadge(status)      — статус прохождения кейса (PRD §4 «Статусы кейса»);
//   • DifficultyBadge(level)   — уровень сложности кейса (PRD §4: difficulty).
//
// Раньше обе разметки жили внутри CaseList.js; вынесены сюда, чтобы CaseHeader и
// другие экраны не дублировали подписи и классы. Цвета бейджей заданы в styles.css
// (.badge--status-*, .badge--difficulty/--basic/...), здесь только разметка и текст.
//
// ES-модуль: `import { StatusBadge, DifficultyBadge } from './core/components/StatusBadge.js'`.

// Человекочитаемые подписи закрытых перечней (PRD §4).
export const STATUS_LABEL = {
  not_started: 'Не начат',
  in_progress: 'В процессе',
  passed: 'Пройден',
};

export const DIFFICULTY_LABEL = {
  basic: 'Базовый',
  intermediate: 'Средний',
  advanced: 'Продвинутый',
};

// Бейдж статуса прохождения. status: 'not_started' | 'in_progress' | 'passed'.
// null/undefined → «Статус недоступен» (например, сбой чтения хранилища — PRD §3),
// неизвестное значение показываем как есть, не роняя экран.
export function StatusBadge(status) {
  const span = document.createElement('span');
  span.className = 'badge badge--status';

  if (status == null) {
    span.classList.add('badge--status-unknown');
    span.textContent = 'Статус недоступен';
    return span;
  }

  span.classList.add(`badge--status-${String(status).replace('_', '-')}`);
  span.textContent = STATUS_LABEL[status] ?? String(status);
  return span;
}

// Бейдж сложности. level: 'basic' | 'intermediate' | 'advanced'.
// Неизвестный/пустой уровень → нейтральный бейдж, без падения.
export function DifficultyBadge(level) {
  const span = document.createElement('span');
  const known = Object.prototype.hasOwnProperty.call(DIFFICULTY_LABEL, level);
  span.className = `badge badge--difficulty badge--${known ? level : 'unknown'}`;
  span.textContent = known ? DIFFICULTY_LABEL[level] : (level || 'без уровня');
  return span;
}
