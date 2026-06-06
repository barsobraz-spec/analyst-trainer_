// core/components/CaseHeader.js — шапка экрана кейса с таймером сессии (T1.3.4).
//
// Показывает заголовок кейса и идущее время попытки. Время попытки участвует в
// событии прохождения (PRD §4: durationSec), поэтому таймер здесь — единая точка
// отсчёта: он фиксирует startedAt и умеет отдать зачтённую длительность с капом
// DURATION_CAP_SEC (90 минут). Экран кейса (T1.6+) монтирует эту шапку, а при
// финализации берёт startedAt/finishedAt отсюда и передаёт в saveAndFinalize.
//
// Возвращает не голый DOM-узел, а контроллер { element, startedAt, getDurationSec,
// stop }, потому что вызывающему нужны и разметка, и доступ к данным таймера.
//
// ES-модуль: `import { CaseHeader } from './core/components/CaseHeader.js'`.

import { DURATION_CAP_SEC } from '../../config.js';
import { DifficultyBadge } from './StatusBadge.js';

export function CaseHeader({
  title,
  subtitle,
  difficulty,            // 'basic' | 'intermediate' | 'advanced' — бейдж сложности
  attemptNo,             // номер текущей попытки (PRD §4: attemptNo)
  startedAt = Date.now(),
} = {}) {
  const header = document.createElement('header');
  header.className = 'case-header';

  const titles = document.createElement('div');
  titles.className = 'case-header__titles';

  const h1 = document.createElement('h1');
  h1.className = 'case-header__title';
  h1.textContent = title || 'Кейс';
  titles.append(h1);

  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'case-header__subtitle';
    sub.textContent = subtitle;
    titles.append(sub);
  }

  // Мета-строка: сложность + номер попытки (T1.5.1). Показываем, только если есть
  // что показать, — иначе строка не занимает место.
  if (difficulty || Number.isFinite(attemptNo)) {
    const meta = document.createElement('div');
    meta.className = 'case-header__meta';
    if (difficulty) meta.append(DifficultyBadge(difficulty));
    if (Number.isFinite(attemptNo)) {
      const attempt = document.createElement('span');
      attempt.className = 'case-header__attempt';
      attempt.textContent = `Попытка №${attemptNo}`;
      meta.append(attempt);
    }
    titles.append(meta);
  }

  // Таймер: моноширинный счётчик. aria-live='off' — не зачитываем каждую секунду.
  const timer = document.createElement('span');
  timer.className = 'case-header__timer';
  timer.setAttribute('role', 'timer');
  timer.setAttribute('aria-label', 'Время попытки');

  header.append(titles, timer);

  let intervalId = null;
  let finishedAt = null; // фиксируется в stop(); до этого время «течёт»

  // Сырое прошедшее время в секундах (без капа) — для индикатора превышения.
  function elapsedSec(now = Date.now()) {
    return Math.max(0, Math.round(((finishedAt ?? now) - startedAt) / 1000));
  }
  // Зачтённое время — с капом 90 минут (PRD §4). Именно это идёт в durationSec.
  function cappedSec(now) {
    return Math.min(elapsedSec(now), DURATION_CAP_SEC);
  }

  function render() {
    timer.textContent = formatHMS(cappedSec());
    // По достижении капа подсвечиваем, что дальше время не засчитывается.
    const capped = elapsedSec() >= DURATION_CAP_SEC;
    timer.classList.toggle('case-header__timer--capped', capped);
    timer.title = capped
      ? `Засчитано максимум ${formatHMS(DURATION_CAP_SEC)} (90 минут)`
      : 'Время текущей попытки';
  }

  render();
  intervalId = setInterval(render, 1000);

  // Останавливает таймер (вызывается при финализации попытки). Идемпотентна:
  // повторный вызов возвращает уже зафиксированный результат.
  function stop() {
    if (finishedAt == null) {
      finishedAt = Date.now();
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      render();
    }
    return { finishedAt, durationSec: cappedSec() };
  }

  return {
    element: header,
    startedAt,
    // Текущая зачтённая длительность (с капом) — для промежуточных нужд UI.
    getDurationSec: () => cappedSec(),
    stop,
  };
}

// Форматирует секунды в M:SS или H:MM:SS. Кап — 90 минут, поэтому без часов
// большую часть времени, но формат корректен и для больших значений.
export function formatHMS(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
