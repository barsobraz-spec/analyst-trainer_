// core/components/caseScaffold.js — мелкие общие кирпичики экрана кейса.
//
// Эти три помощника были побайтово скопированы во всех семи modules/*/CaseView.js
// (T1.6–T8.3). Вынесены сюда, чтобы правка разметки/текста делалась в одном месте,
// а экраны кейсов отличались только своей предметной логикой. Чистый DOM, без
// зависимостей от modules/ — поэтому живут рядом с CaseHeader/SelfAssessment в core.
//
// ES-модуль: `import { textBlock, factsBlock, doneNotice } from
//             '../../core/components/caseScaffold.js'`.

import { getAdjacent, caseHash } from '../courseNav.js';
import { SelfAssessment } from './SelfAssessment.js';

// Текстовый блок: абзацы по пустым строкам. Используется для scenario кейса.
export function textBlock(className, text) {
  const wrap = document.createElement('div');
  wrap.className = className;
  for (const para of String(text).split(/\n\s*\n/)) {
    const p = document.createElement('p');
    p.textContent = para.trim();
    wrap.append(p);
  }
  return wrap;
}

// Список фактов/данных кейса («Что известно»). title переопределяется при нужде.
export function factsBlock(facts, title = 'Что известно') {
  const wrap = document.createElement('div');
  wrap.className = 'case-view__facts';
  const h = document.createElement('h2');
  h.className = 'case-view__facts-title';
  h.textContent = title;
  const ul = document.createElement('ul');
  ul.className = 'case-view__facts-list';
  for (const f of facts) {
    const li = document.createElement('li');
    li.textContent = String(f);
    ul.append(li);
  }
  wrap.append(h, ul);
  return wrap;
}

// Уведомление «Попытка записана» с автоподбором СЛЕДУЮЩЕГО кейса (как в буткемпах:
// после завершения сразу предлагается «дальше», без возврата в каталог) плюс ссылка
// на список кейсов модуля. lead — ведущий текст (по умолчанию общий; 5.5 добавляет в
// него итоговый балл). Текущий кейс берётся из маршрута (#/module/:id/case/:caseId),
// поэтому сигнатура не меняется и все семь экранов используют функцию без правок.
// Возвращает <div> (CTA «следующий кейс» дозагружается асинхронно из courseNav).
export function doneNotice(moduleId, lead = 'Попытка записана. ') {
  const wrap = document.createElement('div');
  wrap.className = 'done-notice';

  // Короткая celebratory-анимация: галочка + расходящееся кольцо + конфетти.
  // Чисто декоративна (aria-hidden), при prefers-reduced-motion остаётся статичной.
  wrap.append(buildCelebration());

  const line = document.createElement('p');
  line.className = 'done-notice__line';
  line.textContent = lead.trim();
  wrap.append(line);

  const actions = document.createElement('div');
  actions.className = 'done-notice__actions';
  wrap.append(actions);

  const back = document.createElement('a');
  back.className = 'done-notice__secondary';
  back.href = `#/module/${encodeURIComponent(moduleId)}`;
  back.textContent = 'К списку кейсов';
  actions.append(back);

  // Автоподбор следующего кейса по маршруту курса.
  const caseId = currentCaseId();
  if (caseId) {
    getAdjacent(caseId)
      .then(({ next, index }) => {
        // index === -1 → кейса нет в линейном маршруте (пользовательский кейс 5.7):
        // не навязываем «дальше» и не объявляем курс пройденным — хватит ссылки на список.
        if (index === -1) return;
        const cta = next
          ? primaryCta(caseHash(next), 'Следующий кейс', next.title)
          : primaryCta('#/analytics', 'Курс пройден', 'Открыть Learning Analytics');
        actions.prepend(cta); // основной призыв — первым
      })
      .catch((err) => console.error('[doneNotice] не удалось определить следующий кейс', err));
  }

  return wrap;
}

// Финализационный «хребёт» экрана кейса (Ф6), общий для всех модулей с самооценкой
// (5.1/5.2/5.3/5.4/5.7): монтирует SelfAssessment в selfHost, формирует контекст
// события в МОМЕНТ финализации (останавливает таймер шапки → актуальный finishedAt,
// отдаёт module/caseId/startedAt/skillTags/notes), после записи показывает doneNotice
// и подбор следующего кейса, плавно прокручивает к форме. Раньше эти ~18 строк были
// побайтово скопированы в каждом modules/*/CaseView.js — теперь контракт getEventParams
// (формат, на который опирается analytics 5.8) задаётся в одном месте.
//
// opts:
//   caseData                — загруженный кейс (module/caseId/skillTags берутся отсюда);
//   header                  — контроллер CaseHeader ({ startedAt, stop() });
//   criteria                — критерии самооценки модуля (Ф6);
//   hintsUsed/hintsTotal    — для строки «открыто N из M» (по умолчанию 0/0);
//   autoFraction            — авто-часть для комбинированного балла (5.3/5.5) или null;
//   getNotes()              — текст в notes события (вызывается при финализации);
//   beforeFinalize()        — опц. освобождение ресурсов перед записью (напр. Chart.destroy).
export function mountSelfAssessment(selfHost, {
  caseData,
  header,
  criteria,
  hintsUsed = 0,
  hintsTotal = 0,
  autoFraction = null,
  getNotes,
  beforeFinalize,
}) {
  const self = SelfAssessment({
    criteria,
    hintsUsed,
    hintsTotal,
    autoFraction,
    // Контекст попытки берётся в момент «Завершить попытку»: тогда же гасим таймер
    // шапки и отдаём финальную длительность (PRD §4).
    getEventParams: () => {
      const { finishedAt } = header.stop();
      if (beforeFinalize) beforeFinalize();
      return {
        module: caseData.module,
        caseId: caseData.caseId,
        startedAt: header.startedAt,
        finishedAt,
        skillTags: caseData.skillTags || [],
        notes: typeof getNotes === 'function' ? getNotes() : '',
      };
    },
    onFinalized: () => { selfHost.append(doneNotice(caseData.module)); },
  });
  selfHost.append(self);
  self.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  return self;
}

// Декоративный «салют» завершения: галочка в круге, расходящееся кольцо и
// разлетающиеся конфетти. Траектории конфетти заданы CSS-переменными (--cx/--cy/
// --cr/--cd) — анимирует одна keyframes-правило в styles.css. aria-hidden: для
// скринридера достаточно текстового «Попытка записана».
function buildCelebration() {
  const box = document.createElement('div');
  box.className = 'done-notice__celebrate';
  box.setAttribute('aria-hidden', 'true');

  const ring = spanWith('done-notice__ring', '');
  const check = spanWith('done-notice__check', '✓');

  const confetti = document.createElement('div');
  confetti.className = 'done-notice__confetti';
  const colors = ['#6e79f2', '#57c97e', '#e0b13a', '#ff6b6b', '#8ab0ff'];
  for (let i = 0; i < 16; i++) {
    const piece = document.createElement('span');
    const angle = (Math.PI * 2 * i) / 16 + (Math.random() * 0.4 - 0.2);
    const dist = 46 + Math.random() * 34;
    piece.style.setProperty('--cx', `${Math.round(Math.cos(angle) * dist)}px`);
    piece.style.setProperty('--cy', `${Math.round(Math.sin(angle) * dist - 12)}px`);
    piece.style.setProperty('--cr', `${Math.round(Math.random() * 360)}deg`);
    piece.style.setProperty('--cd', `${Math.round(Math.random() * 70)}ms`);
    piece.style.background = colors[i % colors.length];
    confetti.append(piece);
  }

  box.append(ring, check, confetti);
  return box;
}

// Крупная ссылка-призыв «дальше» (подпись + название цели + стрелка).
function primaryCta(href, label, title) {
  const a = document.createElement('a');
  a.className = 'done-notice__next';
  a.href = href;
  a.append(
    spanWith('done-notice__next-label', label),
    spanWith('done-notice__next-title', title),
  );
  const arrow = spanWith('done-notice__next-arrow', '→');
  arrow.setAttribute('aria-hidden', 'true');
  a.append(arrow);
  return a;
}

function spanWith(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

// caseId текущего экрана из хеша (#/module/:id/case/:caseId) — для подбора «дальше».
function currentCaseId() {
  const m = location.hash.match(/#\/module\/[^/]+\/case\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
