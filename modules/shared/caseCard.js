// modules/shared/caseCard.js — строка-карточка кейса со звёздочкой (общая).
//
// Единый вид строки кейса для экранов, показывающих кейсы из разных модулей
// (Избранное, прогресс по навыку, Практика). Совпадает по верстке и классам со
// списком кейсов модуля (.case-row), плюс кнопка «в избранное». Возвращает <li>,
// чтобы корректно жить внутри <ul>.
//
// ES-модуль: `import { caseCard } from './modules/shared/caseCard.js'`.

import { getModule } from '../../core/modules.js';
import { StatusBadge, DifficultyBadge } from '../../core/components/StatusBadge.js';
import { FavoriteButton } from '../../core/components/FavoriteButton.js';
import { caseHash } from '../../core/courseNav.js';

// caseCard({ meta, status, lastScore, live, showModule, favorites })
//   meta        — { caseId, module, title, difficulty, broken }
//   status      — 'passed' | 'in_progress' | 'not_started' | null
//   lastScore   — число 0–100 | null
//   live        — звезда подписывается на изменения избранного (для страницы «Избранное»)
//   showModule  — показать строку «5.1 · Data Detective» под названием
//   favorites   — показывать ли кнопку-звёздочку (по умолчанию да)
export function caseCard({
  meta,
  status = null,
  lastScore = null,
  live = false,
  showModule = true,
  favorites = true,
} = {}) {
  const li = document.createElement('li');
  li.className = 'case-row-wrap';
  li.dataset.caseId = meta.caseId;

  // Битый кейс не открываем — показываем как неактивную строку.
  if (meta.broken) {
    const row = document.createElement('div');
    row.className = 'case-row case-row--error';
    const head = document.createElement('div');
    head.className = 'case-row__head';
    head.append(caseTitle(meta.title), DifficultyBadge(meta.difficulty));
    const note = document.createElement('p');
    note.className = 'case-row__error';
    note.textContent = 'Кейс содержит ошибку и недоступен для прохождения.';
    row.append(head, note);
    li.append(row);
    if (favorites) li.append(starControl(meta.caseId, live, li));
    return li;
  }

  const link = document.createElement('a');
  link.className = 'case-row';
  link.href = caseHash({ module: meta.module, caseId: meta.caseId });

  const head = document.createElement('div');
  head.className = 'case-row__head';
  head.append(caseTitle(meta.title), DifficultyBadge(meta.difficulty));
  link.append(head);

  if (showModule) {
    const mod = getModule(meta.module);
    const m = document.createElement('span');
    m.className = 'case-row__module';
    m.textContent = mod ? `${mod.id} · ${mod.title}` : meta.module;
    link.append(m);
  }

  const metaRow = document.createElement('div');
  metaRow.className = 'case-row__meta';
  metaRow.append(StatusBadge(status));
  if (typeof lastScore === 'number' && Number.isFinite(lastScore)) {
    const score = document.createElement('span');
    score.className = 'case-row__score';
    score.textContent = `Последний результат: ${lastScore}`;
    metaRow.append(score);
  }
  link.append(metaRow);

  li.append(link);
  if (favorites) li.append(starControl(meta.caseId, live, li));
  return li;
}

// Кнопка-звезда. В live-режиме возвращает контроллер — берём из него element.
function starControl(caseId, live, li) {
  const fav = FavoriteButton(caseId, { live });
  return fav instanceof Node ? fav : fav.element;
}

function caseTitle(text) {
  const h2 = document.createElement('h2');
  h2.className = 'case-row__title';
  h2.textContent = text;
  return h2;
}
