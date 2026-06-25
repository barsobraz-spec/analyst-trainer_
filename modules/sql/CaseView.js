// modules/sql/CaseView.js — экран кейса модуля 5.5 SQL Investigation (T6.3).
//
// Собирает функции модуля из PRD §5.5:
//   Ф1 — исполняемый SQL-редактор (SQLEditor) + кнопка «Выполнить» + таблица результата;
//   Ф2 — постоянная панель схемы (SchemaPanel) из метаданных датасета;
//   Ф3 — автопроверка результата подзадачи (compareResultSets с учётом orderSensitive);
//   Ф4 — многошаговое расследование (SubtaskProgress) + сохранение прогресса (черновик);
//   Ф5 — эталонный запрос с пояснением (внутри SubtaskProgress);
//   Ф6 — история запросов сессии (QueryHistory) с повторным запуском.
//
// БД sql.js живёт в Web Worker (SqlEngine): тяжёлый запрос не блокирует UI, при
// зависании воркер пересоздаётся (таймаут). БД строится из ОТДЕЛЬНОГО файла
// датасета (payload.datasetPath) — он грузится с проверкой размера (loadDataset).
//
// Оценка (PRD §4): у 5.5 НЕТ текстовой самооценки (её нет в перечне §4), поэтому
// score = autoFraction · 100 = доля решённых подзадач. Событие пишется ровно один
// раз — по кнопке «Завершить расследование» (saveAndFinalize); до этого уход с
// экрана сохраняет прогресс как «в процессе».
//
// ES-модуль: `import { SqlCaseView } from './modules/sql/CaseView.js'`.

import { CaseHeader } from '../../core/components/CaseHeader.js';
import { TopicGraphPanel } from '../../core/components/TopicGraphPanel.js';
import { mountCaseAiMentor } from '../../core/components/caseAiMentor.js';
import { textBlock, doneNotice } from '../../core/components/caseScaffold.js';
import { saveDraftState, getDraftState } from '../../core/db.js';
import { saveAndFinalize, normalizeScore } from '../../core/event.js';
import { loadDataset, loadIndex } from '../../core/caseLoader.js';
import { loadLearningContent } from '../../core/learningContent.js';
import { loadTopicGraph, topicsForCase } from '../../core/topicGraph.js';
import { MENTOR_MODES } from '../../core/mentorContext.js';
import { compareResultSets } from '../../core/sqlComparator.js';
import { createSqlEngine } from './SqlEngine.js';
import { SQLEditor } from './SQLEditor.js';
import { SchemaPanel } from './SchemaPanel.js';
import { QueryHistory } from './QueryHistory.js';
import { SubtaskProgress } from './SubtaskProgress.js';
import { renderResultTable } from './ResultTable.js';

export async function SqlCaseView({ caseData, attemptNo } = {}) {
  const payload = caseData.payload || {};
  const caseId = caseData.caseId;

  const root = document.createElement('section');
  root.className = 'case-view screen sql-case';

  // --- Шапка с таймером -------------------------------------------------------
  const header = CaseHeader({ title: caseData.title || 'Кейс', difficulty: caseData.difficulty, attemptNo });
  root.append(header.element);

  if (payload.scenario) root.append(textBlock('case-view__scenario', payload.scenario));
  if (payload.question) {
    const q = document.createElement('p');
    q.className = 'case-view__question';
    q.textContent = payload.question;
    root.append(q);
  }

  mountCaseTopicPanel(root, caseId);

  // --- Датасет → БД (отдельный файл, с проверкой размера) ---------------------
  const dataset = await resolveDataset(payload);
  if (!dataset.ok) {
    root.append(errorBlock(dataset.message));
    return root;
  }

  const status = document.createElement('p');
  status.className = 'sql-case__status';
  status.setAttribute('role', 'status');
  status.textContent = 'Готовим базу данных…';
  root.append(status);

  const engine = createSqlEngine({ dataset: dataset.data });
  let schema;
  try {
    schema = await engine.ready();
  } catch (err) {
    console.error('[sql] не удалось построить БД', err);
    status.remove();
    root.append(errorBlock('Не удалось построить базу данных из датасета: ' + (err.message || err)));
    engine.destroy();
    return root;
  }
  status.remove();

  // Восстанавливаем прогресс подзадач (статус «в процессе»).
  let draft = null;
  try { draft = await getDraftState(caseId); } catch (err) { console.error('[sql] чтение черновика', err); }

  // --- Рабочая область: схема | (редактор + результат + история) --------------
  const workspace = document.createElement('div');
  workspace.className = 'sql-case__workspace';

  const schemaPanel = SchemaPanel({ schema });
  workspace.append(schemaPanel);

  const main = document.createElement('div');
  main.className = 'sql-case__main';
  workspace.append(main);
  root.append(workspace);

  // Ф6: история (объявляем раньше редактора — onPick ссылается на editor через замыкание).
  let editor = null;
  const history = QueryHistory({
    onPick: (sql) => {
      if (!editor) return;
      editor.setValue(sql);
      runQuery();
    },
  });

  // Ф1: редактор + «Выполнить» + таблица результата.
  editor = await SQLEditor({ initialValue: payload.starterSql || '', onRun: () => runQuery() });
  main.append(editor.element);

  const runBar = document.createElement('div');
  runBar.className = 'sql-case__run-bar';
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'sql-case__run';
  runBtn.textContent = 'Выполнить';
  const runHint = document.createElement('span');
  runHint.className = 'sql-case__run-hint';
  runHint.textContent = 'или Ctrl/Cmd + Enter';
  runBar.append(runBtn, runHint);
  main.append(runBar);

  const resultHost = document.createElement('div');
  resultHost.className = 'sql-case__result';
  main.append(resultHost);

  main.append(history.element);

  editor.refresh(); // CodeMirror корректно меряет размеры только в DOM

  // --- Выполнение запроса (Ф1) ------------------------------------------------
  let running = false;
  let finalized = false;
  async function runQuery() {
    if (finalized || running) return null;
    const sql = editor.getValue().trim();
    if (!sql) { showResultMessage('Введите SQL-запрос.'); return null; }
    running = true;
    runBtn.disabled = true;
    showResultMessage('Выполняем запрос…');
    try {
      const result = await engine.exec(sql);
      history.add(sql);
      resultHost.replaceChildren(renderResultTable(result));
      return result;
    } catch (err) {
      showResultMessage('Ошибка: ' + (err.message || err), true);
      return null;
    } finally {
      running = false;
      runBtn.disabled = finalized;
    }
  }
  runBtn.addEventListener('click', () => runQuery());

  function showResultMessage(text, isError) {
    const p = document.createElement('p');
    p.className = 'result-table__note' + (isError ? ' result-table__note--error' : '');
    if (isError) p.setAttribute('role', 'alert');
    p.textContent = text;
    resultHost.replaceChildren(p);
  }

  // --- Ф3/Ф4: подзадачи + автопроверка ----------------------------------------
  const subtasks = SubtaskProgress({
    subtasks: payload.subtasks || [],
    initialSolved: draft?.solved || [],
    onCheck: checkCurrentSubtask,
    onChange: (solvedIds) => { saveProgress(solvedIds); refreshFinishHint(); },
  });
  root.append(subtasks.element);

  let lastSqlCheck = null;
  const aiMentor = await mountCaseAiMentor({
    caseData,
    modes: [MENTOR_MODES.hint, MENTOR_MODES.sqlReview],
    defaultMode: MENTOR_MODES.hint,
    resolveModeState: (mode) => {
      if (mode === MENTOR_MODES.hint) {
        return lastSqlCheck
          ? { hidden: true }
          : { label: 'Подсказать по SQL', submitLabel: 'Получить SQL-подсказку' };
      }
      if (mode === MENTOR_MODES.sqlReview) {
        return lastSqlCheck
          ? { label: 'Объяснить ошибку SQL', submitLabel: 'Объяснить ошибку SQL' }
          : { hidden: true };
      }
      return {};
    },
    getStudentAnswer: () => editor.getValue(),
    getSqlContext: () => ({
      ...(lastSqlCheck || {}),
      userSql: lastSqlCheck?.userSql || editor.getValue().trim(),
      subtask: lastSqlCheck?.subtask || subtasks.getCurrentSubtask(),
      schema,
    }),
    getDraftSnapshot: () => ({
      ...(draft || {}),
      solved: subtasks.getSolvedIds(),
    }),
    isSubmitted: () => finalized,
    onFocusAnswer: () => editor.focus && editor.focus(),
  });
  root.append(aiMentor.element);

  // Проверка текущей подзадачи: выполняем запрос пользователя и эталонный запрос,
  // сверяем результаты (Ф3). Запрос пользователя попадает в историю.
  async function checkCurrentSubtask(subtask) {
    const sql = editor.getValue().trim();
    if (!sql) {
      lastSqlCheck = null;
      aiMentor.refreshPreview();
      return { correct: false, message: 'Сначала напишите запрос в редакторе.' };
    }

    let actual;
    try {
      actual = await engine.exec(sql);
    } catch (err) {
      const message = 'Запрос не выполнился: ' + (err.message || err);
      lastSqlCheck = {
        userSql: sql,
        referenceSql: subtask.referenceSql,
        subtask,
        autograderMessage: message,
      };
      aiMentor.refreshPreview();
      return { correct: false, message };
    }
    history.add(sql);
    resultHost.replaceChildren(renderResultTable(actual));

    let expected;
    try {
      expected = await engine.exec(subtask.referenceSql);
    } catch (err) {
      console.error('[sql] эталонный запрос подзадачи не выполнился', subtask.id, err);
      lastSqlCheck = null;
      aiMentor.refreshPreview();
      return { correct: false, message: 'Эталон этой подзадачи содержит ошибку — отметьте кейс как проблемный.' };
    }

    const correct = compareResultSets(actual, expected, !!subtask.orderSensitive);
    if (correct) {
      lastSqlCheck = null;
      aiMentor.refreshPreview();
      return { correct: true };
    }
    const message = 'Результат не совпал с эталоном. Проверьте столбцы, фильтры и агрегацию.';
    lastSqlCheck = {
      userSql: sql,
      referenceSql: subtask.referenceSql,
      subtask,
      autograderMessage: message,
    };
    aiMentor.refreshPreview();
    return { correct: false, message };
  }

  async function saveProgress(solvedIds) {
    if (finalized) return;
    try {
      await saveDraftState(caseId, { ...(draft || {}), solved: solvedIds });
    } catch (err) {
      console.error('[sql] не удалось сохранить прогресс подзадач', caseId, err);
    }
  }

  // --- Завершение расследования (запись события) ------------------------------
  const finishBar = document.createElement('div');
  finishBar.className = 'case-view__submit-bar';
  const finishBtn = document.createElement('button');
  finishBtn.type = 'button';
  finishBtn.className = 'case-view__submit';
  finishBtn.textContent = 'Завершить расследование';
  const finishHint = document.createElement('span');
  finishHint.className = 'case-view__submit-hint';
  finishBar.append(finishBtn, finishHint);
  root.append(finishBar);

  const doneHost = document.createElement('div');
  doneHost.className = 'case-view__self-host';
  root.append(doneHost);

  finishBtn.addEventListener('click', async () => {
    if (finalized) return;
    finalized = true;
    finishBtn.disabled = true;
    finishHint.textContent = 'Записываем результат…';

    const fraction = subtasks.getFraction() ?? 0;
    const score = normalizeScore(fraction, null); // только авто-часть (PRD §4)
    const { finishedAt } = header.stop();

    try {
      await saveAndFinalize({
        module: caseData.module,
        caseId,
        startedAt: header.startedAt,
        finishedAt,
        score,
        skillTags: caseData.skillTags || [],
        hintsUsed: 0,
        notes: `Решено подзадач: ${subtasks.getSolvedCount()} из ${subtasks.getTotal()}.`,
      });

      subtasks.lock();
      runBtn.disabled = true;
      finishBtn.hidden = true;
      finishHint.textContent = '';
      engine.destroy();

      doneHost.append(doneNotice(caseData.module, `Попытка записана. Итоговый балл: ${score} / 100. `));
    } catch (err) {
      console.error('[sql] не удалось записать событие', err);
      finalized = false;
      finishBtn.disabled = false;
      finishHint.textContent = 'Не удалось сохранить результат. Попробуйте ещё раз.';
    }
  });

  function refreshFinishHint() {
    if (finalized) return;
    finishHint.textContent = subtasks.allSolved()
      ? 'Все подзадачи решены — можно завершать.'
      : 'Можно завершить в любой момент; балл — доля решённых подзадач.';
  }
  refreshFinishHint();

  // unmount-хук роутера: уход с кейса без «Завершить» иначе оставлял бы Web Worker
  // + WASM-инстанс sql.js живыми. Гасим таймер шапки и завершаем воркер (обе
  // операции идемпотентны — на финализации engine.destroy уже мог быть вызван).
  return {
    element: root,
    destroy: () => { header.stop(); engine.destroy(); },
  };
}

function mountCaseTopicPanel(root, caseId) {
  const host = document.createElement('div');
  host.className = 'topic-graph-panel-slot';
  host.append(TopicGraphPanel({
    title: 'Что повторить',
    topics: [],
    showEmpty: true,
    emptyText: 'Загружаем связи тем…',
    className: 'topic-graph-panel--case',
  }));
  root.append(host);

  buildCaseTopicPanel(caseId)
    .then((panel) => {
      if (!host.isConnected) return;
      host.replaceChildren(panel);
    })
    .catch((err) => {
      console.warn('[sql] topic graph panel недоступна:', err.message || err);
      if (!host.isConnected) return;
      host.replaceChildren(TopicGraphPanel({
        title: 'Что повторить',
        topics: [],
        graph: { error: err },
        showEmpty: true,
        errorText: 'Связи тем сейчас недоступны, кейс можно продолжать.',
        className: 'topic-graph-panel--case',
      }));
    });
}

async function buildCaseTopicPanel(caseId) {
  const graph = await loadTopicGraph();
  const topics = topicsForCase(graph, caseId, 3);
  const [content, casesById] = topics.length > 0
    ? await Promise.all([
      loadLearningContent().catch((err) => {
        console.warn('[sql] learning content для topic panel недоступен:', err.message || err);
        return null;
      }),
      loadCasesById().catch((err) => {
        console.warn('[sql] case index для topic panel недоступен:', err.message || err);
        return new Map();
      }),
    ])
    : [null, new Map()];

  return TopicGraphPanel({
    title: 'Что повторить',
    topics,
    graph,
    content,
    casesById,
    maxTopics: 3,
    showEmpty: true,
    emptyText: 'Для этого кейса связанные темы пока не настроены.',
    errorText: 'Связи тем сейчас недоступны, кейс можно продолжать.',
    className: 'topic-graph-panel--case',
  });
}

async function loadCasesById() {
  const { entries } = await loadIndex();
  return new Map((entries || [])
    .filter((item) => item.caseId && item.module && item.status !== 'error')
    .map((item) => [item.caseId, item]));
}

// Датасет: отдельный файл по payload.datasetPath (T6.3.3) либо инлайн payload.dataset
// (запасной вариант для маленьких кейсов).
async function resolveDataset(payload) {
  if (payload.datasetPath) {
    const res = await loadDataset(payload.datasetPath);
    if (!res.ok) return { ok: false, message: `Датасет не загружен (${res.errorCode}): ${res.errorDetail}` };
    return { ok: true, data: res.dataset };
  }
  if (payload.dataset && typeof payload.dataset === 'object') {
    return { ok: true, data: payload.dataset };
  }
  return { ok: false, message: 'В кейсе не задан датасет (payload.datasetPath или payload.dataset).' };
}

function errorBlock(text) {
  const p = document.createElement('p');
  p.className = 'dashboard__error';
  p.setAttribute('role', 'alert');
  p.textContent = text;
  return p;
}
