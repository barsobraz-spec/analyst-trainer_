// core/components/AiMentor.js — общий UI AI-ментора для кейсов.
//
// Компонент не собирает контекст сам: владелец экрана передает buildContext(mode),
// чтобы 5.1, 5.5 и будущие модули контролировали режимно-нужные поля.

import {
  getAiReviewSettings,
  hasAiReviewConsent,
  saveAiReviewConsent,
  reviewAnswer,
} from '../aiReview.js';
import { deleteAiMentorReview, getAiMentorReviews, saveAiMentorReview } from '../db.js';
import { MENTOR_MODE_LABELS, MENTOR_MODES, normalizeMentorMode, mentorModeSupportsScore } from '../mentorContext.js';

export function AiMentor({
  title = 'AI-ментор',
  description = 'Проверит ход мысли, даст подсказку или предложит следующий шаг.',
  modes = [MENTOR_MODES.hint],
  defaultMode,
  buildContext,
  getStudentAnswer,
  onFocusAnswer,
  onRepeatLater,
  onBeforeReferenceCheck,
  resolveModeState,
  compactDisabled = false,
  historyScope,
} = {}) {
  const allowedModes = normalizeModes(modes);
  let activeMode = normalizeMentorMode(defaultMode || allowedModes[0] || MENTOR_MODES.hint);
  if (!allowedModes.includes(activeMode)) activeMode = allowedModes[0] || MENTOR_MODES.hint;
  let pendingContext = null;
  let busy = false;

  const root = document.createElement('section');
  root.className = 'ai-mentor';

  const head = document.createElement('div');
  head.className = 'ai-mentor__head';
  const copy = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.className = 'ai-mentor__title';
  h2.textContent = title;
  const p = document.createElement('p');
  p.className = 'ai-mentor__description';
  p.textContent = description;
  copy.append(h2, p);
  head.append(copy);
  root.append(head);

  const settings = getAiReviewSettings();
  const historyHost = document.createElement('div');
  historyHost.className = 'ai-mentor__history';

  if (settings.disabled || !settings.endpoint) {
    root.append(disabledState(settings.disabled, { compact: compactDisabled }));
    if (historyScope?.caseId) {
      root.append(historyHost);
      refreshHistory();
    }
    return { element: root, refreshPreview: () => {} };
  }

  const tabs = document.createElement('div');
  tabs.className = 'ai-mentor__modes';
  const tabButtons = new Map();
  for (const mode of allowedModes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-mentor__mode';
    btn.textContent = modeLabel(mode);
    btn.addEventListener('click', () => {
      const state = getModeState(mode);
      if (state.disabled) {
        setStatus(state.disabledMessage || 'Этот режим пока недоступен.', 'warn');
        return;
      }
      activeMode = mode;
      renderModeState();
    });
    tabs.append(btn);
    tabButtons.set(mode, btn);
  }
  root.append(tabs);

  const previewHost = document.createElement('div');
  previewHost.className = 'ai-mentor__preview';
  root.append(previewHost);

  const actions = document.createElement('div');
  actions.className = 'ai-mentor__actions';
  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'learning-button learning-button--primary';
  run.textContent = 'Спросить ментора';
  actions.append(run);
  root.append(actions);

  const status = document.createElement('p');
  status.className = 'ai-mentor__status';
  status.setAttribute('aria-live', 'polite');
  root.append(status);

  const result = document.createElement('div');
  result.className = 'ai-mentor__result';
  result.hidden = true;
  root.append(result);

  if (historyScope?.caseId) {
    root.append(historyHost);
    refreshHistory();
  }

  run.addEventListener('click', () => submit());

  function renderModeState() {
    ensureActiveMode();
    for (const [mode, btn] of tabButtons) {
      const state = getModeState(mode);
      const active = mode === activeMode;
      btn.hidden = state.hidden;
      btn.disabled = state.disabled;
      btn.textContent = state.label;
      btn.classList.toggle('ai-mentor__mode--active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    const state = currentModeState();
    run.textContent = state.submitLabel || 'Спросить ментора';
    run.disabled = !!state.disabled;
    pendingContext = safeBuildContext(state.mode);
    renderPreview(previewHost, previewWithProxyInfo(pendingContext?.preview, getAiReviewSettings()));
    result.hidden = true;
    result.replaceChildren();
    setStatus(state.disabled ? (state.disabledMessage || 'Этот режим пока недоступен.') : '', state.disabled ? 'warn' : 'info');
  }

  function safeBuildContext(mode) {
    if (typeof buildContext !== 'function') return null;
    try {
      return buildContext(mode);
    } catch (err) {
      console.error('[AiMentor] context build failed', err);
      setStatus('Не удалось подготовить контекст для AI-ментора.', 'error');
      return null;
    }
  }

  async function submit() {
    if (busy) return;
    const state = currentModeState();
    if (state.disabled) {
      setStatus(state.disabledMessage || 'Этот режим пока недоступен.', 'warn');
      return;
    }
    const freshSettings = getAiReviewSettings();
    if (freshSettings.disabled || !freshSettings.endpoint) {
      setStatus(freshSettings.disabled
        ? 'AI-ментор отключен в настройках.'
        : 'Укажите URL AI-proxy в настройках.', 'warn');
      return;
    }

    const built = safeBuildContext(state.mode);
    if (!built?.context) {
      setStatus('Контекст для AI-ментора пока недоступен.', 'error');
      return;
    }
    pendingContext = built;

    const weakAnswer = built.context.warnings?.find((item) => item.code === 'weak_answer');
    if (weakAnswer && state.mode !== MENTOR_MODES.hint) {
      renderWeakAnswerChoice(weakAnswer);
      return;
    }

    if (state.mode === MENTOR_MODES.referenceCheck && built.context.policy?.formativeOnly) {
      renderReferenceCheckGate(built);
      return;
    }

    const redirect = built.context.warnings?.find((item) => item.suggestedMode && item.code !== 'weak_answer');
    if (redirect && state.mode !== redirect.suggestedMode) {
      const targetMode = findModeForMentorMode(redirect.suggestedMode);
      if (targetMode) {
        activeMode = targetMode;
        pendingContext = safeBuildContext(redirect.suggestedMode);
        renderModeState();
      }
      setStatus(redirect.message, 'warn');
      return;
    }

    if (!hasAiReviewConsent(freshSettings)) {
      renderConsent(built, freshSettings);
      return;
    }

    busy = true;
    run.disabled = true;
    result.hidden = true;
    result.replaceChildren();
    setStatus('Отправляю запрос AI-ментору…');
    try {
      const review = await reviewAnswer({
        endpoint: freshSettings.endpoint,
        model: freshSettings.model,
        mode: state.mode,
        context: built.context,
        studentAnswer: typeof getStudentAnswer === 'function' ? getStudentAnswer() : built.context.studentAnswer,
      });
      await persistReview(review, state.mode, built, freshSettings);
      renderReview(result, review, state.mode, built.context);
      result.hidden = false;
      setStatus('Разбор готов.', 'success');
    } catch (err) {
      setStatus(err?.message || 'AI-ментор не смог ответить.', 'error');
    } finally {
      busy = false;
      run.disabled = false;
    }
  }

  function renderWeakAnswerChoice(warning) {
    result.hidden = false;
    result.replaceChildren();
    const box = document.createElement('div');
    box.className = 'ai-mentor__choice';
    const titleEl = document.createElement('h3');
    titleEl.className = 'ai-mentor__result-title';
    titleEl.textContent = 'Ответ пока короткий';
    const text = paragraph(warning.message || 'Для проверки нужен более развернутый ответ. Можно дописать его или запросить подсказку.');
    const row = document.createElement('div');
    row.className = 'ai-mentor__actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'learning-button learning-button--primary';
    edit.textContent = 'Дописать ответ';
    const hint = document.createElement('button');
    hint.type = 'button';
    hint.className = 'learning-button';
    hint.textContent = 'Получить подсказку';
    edit.addEventListener('click', () => {
      result.hidden = true;
      result.replaceChildren();
      setStatus('Дописать ответ можно в поле выше.');
      if (typeof onFocusAnswer === 'function') onFocusAnswer();
    });
    hint.addEventListener('click', () => {
      const targetMode = findModeForMentorMode(warning.suggestedMode || MENTOR_MODES.hint)
        || findModeForMentorMode(MENTOR_MODES.explainError);
      if (targetMode) activeMode = targetMode;
      else if (typeof onFocusAnswer === 'function') onFocusAnswer();
      renderModeState();
      if (targetMode) submit();
    });
    row.append(edit, hint);
    box.append(titleEl, text, row);
    result.append(box);
    setStatus('Нужно выбрать следующий шаг.', 'warn');
  }

  function renderReferenceCheckGate(built) {
    result.hidden = false;
    result.replaceChildren();
    const box = document.createElement('div');
    box.className = 'ai-mentor__choice';
    const titleEl = document.createElement('h3');
    titleEl.className = 'ai-mentor__result-title';
    titleEl.textContent = 'Проверка по эталону';
    const text = paragraph('Чтобы проверить ответ по эталону, нужно зафиксировать текущую попытку и открыть эталон. После этого редактировать этот ответ нельзя.');
    const preview = document.createElement('div');
    preview.className = 'ai-mentor__preview ai-mentor__preview--choice';
    renderPreview(preview, previewWithProxyInfo(built.preview, getAiReviewSettings()));
    const row = document.createElement('div');
    row.className = 'ai-mentor__actions';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'learning-button learning-button--primary';
    confirm.textContent = 'Зафиксировать и проверить';
    const hint = document.createElement('button');
    hint.type = 'button';
    hint.className = 'learning-button';
    hint.textContent = 'Дать подсказку вместо этого';
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      try {
        if (typeof onBeforeReferenceCheck !== 'function') {
          throw new Error('Этот экран пока не умеет фиксировать ответ из AI-проверки.');
        }
        const ok = await onBeforeReferenceCheck({ mode: MENTOR_MODES.referenceCheck, context: built.context });
        if (ok === false) {
          confirm.disabled = false;
          return;
        }
        renderModeState();
        submit();
      } catch (err) {
        confirm.disabled = false;
        setStatus(err?.message || 'Не удалось зафиксировать ответ.', 'error');
      }
    });
    hint.addEventListener('click', () => {
      const hintMode = findModeForMentorMode(MENTOR_MODES.hint);
      if (hintMode) activeMode = hintMode;
      renderModeState();
      submit();
    });
    row.append(confirm, hint);
    box.append(titleEl, text, preview, row);
    result.append(box);
    setStatus('Подтвердите фиксацию ответа или запросите подсказку.', 'warn');
  }

  function renderConsent(built, consentSettings) {
    result.hidden = false;
    result.replaceChildren();
    const box = document.createElement('div');
    box.className = 'ai-mentor__consent';
    const titleEl = document.createElement('h3');
    titleEl.className = 'ai-mentor__result-title';
    titleEl.textContent = 'Перед первым AI-запросом';
    const text = document.createElement('p');
    text.className = 'ai-mentor__text';
    text.textContent = `Ответ уйдет во внешний AI-proxy: ${consentSettings.endpoint}. Секретный ключ в браузер не отправляется. При смене proxy URL или модели приложение спросит согласие заново.`;
    const preview = document.createElement('div');
    preview.className = 'ai-mentor__preview ai-mentor__preview--consent';
    renderPreview(preview, previewWithProxyInfo(built.preview, consentSettings));
    const row = document.createElement('div');
    row.className = 'ai-mentor__actions';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'learning-button learning-button--primary';
    confirm.textContent = 'Подтвердить и отправить';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'learning-button';
    cancel.textContent = 'Отмена';
    confirm.addEventListener('click', () => {
      saveAiReviewConsent(true, consentSettings);
      result.hidden = true;
      submit();
    });
    cancel.addEventListener('click', () => {
      result.hidden = true;
      result.replaceChildren();
      setStatus('AI-запрос отменен.');
    });
    row.append(confirm, cancel);
    box.append(titleEl, text, preview, row);
    result.append(box);
    setStatus('Нужно подтверждение перед первым запросом.');
  }

  function renderReview(container, review, mode, context) {
    container.replaceChildren();
    const titleEl = document.createElement('h3');
    titleEl.className = 'ai-mentor__result-title';
    titleEl.textContent = review.verdict || 'Ответ ментора';
    container.append(titleEl);

    if (mentorModeSupportsScore(mode) && context?.policy?.allowScore !== false && review.score !== null) {
      const score = document.createElement('p');
      score.className = 'ai-mentor__score';
      score.textContent = `Оценка: ${review.score}/100`;
      container.append(score);
    }

    if (review.feedback) container.append(paragraph(review.feedback));
    appendList(container, 'Что уже хорошо', review.strengths);
    appendList(container, 'Что доработать', review.issues);
    if (review.mentorQuestion) {
      const question = paragraph(review.mentorQuestion);
      question.classList.add('ai-mentor__question');
      container.append(question);
    }
    appendList(container, 'Как улучшить', review.improvements);
    appendList(container, 'Следующий шаг', review.nextSteps);

    const note = paragraph('AI-feedback носит учебный характер: он не является автозачетом и не меняет прогресс без вашего действия.');
    note.classList.add('ai-mentor__text--note');
    container.append(note);

    const row = document.createElement('div');
    row.className = 'ai-mentor__actions';
    const focus = document.createElement('button');
    focus.type = 'button';
    focus.className = 'learning-button';
    focus.textContent = 'Исправить ответ';
    focus.addEventListener('click', () => {
      if (typeof onFocusAnswer === 'function') onFocusAnswer();
    });
    row.append(focus);

    if (typeof onRepeatLater === 'function') {
      const repeat = document.createElement('button');
      repeat.type = 'button';
      repeat.className = 'learning-button';
      repeat.textContent = 'Повторить позже';
      repeat.addEventListener('click', async () => {
        repeat.disabled = true;
        try {
          await onRepeatLater({ mode, review });
          setStatus('Пометка “повторить позже” сохранена.', 'success');
        } catch (err) {
          repeat.disabled = false;
          setStatus(err?.message || 'Не удалось сохранить пометку.', 'error');
        }
      });
      row.append(repeat);
    }
    container.append(row);
  }

  async function persistReview(review, mode, built, freshSettings) {
    if (!historyScope?.caseId) return;
    try {
      await saveAiMentorReview({
        caseId: historyScope.caseId,
        module: historyScope.module,
        caseTitle: historyScope.caseTitle,
        mode,
        model: freshSettings.model,
        review: reviewForHistory(review),
        previewSummary: built?.preview?.summary,
      });
      await refreshHistory();
    } catch (err) {
      console.warn('[AiMentor] review history save failed', err);
    }
  }

  async function refreshHistory() {
    if (!historyScope?.caseId || !historyHost) return;
    historyHost.replaceChildren();
    try {
      const reviews = await getAiMentorReviews({ caseId: historyScope.caseId });
      renderHistory(historyHost, reviews);
    } catch (err) {
      console.warn('[AiMentor] review history load failed', err);
      const p = paragraph('История AI-проверок временно недоступна.');
      p.classList.add('ai-mentor__history-empty');
      historyHost.append(p);
    }
  }

  function renderHistory(container, reviews) {
    const details = document.createElement('details');
    details.className = 'ai-mentor__history-details';
    const summary = document.createElement('summary');
    summary.textContent = reviews.length
      ? `История AI-проверок (${reviews.length})`
      : 'История AI-проверок';
    details.append(summary);

    if (!reviews.length) {
      const empty = paragraph('Здесь появятся последние локально сохраненные разборы по этому кейсу.');
      empty.classList.add('ai-mentor__history-empty');
      details.append(empty);
      container.append(details);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'ai-mentor__history-list';
    for (const item of reviews) list.append(historyRow(item));
    details.append(list);
    container.append(details);
  }

  function historyRow(item) {
    const li = document.createElement('li');
    li.className = 'ai-mentor__history-row';

    const body = document.createElement('div');
    body.className = 'ai-mentor__history-body';
    const meta = document.createElement('span');
    meta.className = 'ai-mentor__history-meta';
    const date = Number.isFinite(item.createdAt) ? new Date(item.createdAt) : null;
    const time = date ? date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const score = Number.isFinite(item.score) ? ` · ${item.score}/100` : '';
    meta.textContent = `${time}${time ? ' · ' : ''}${modeLabel(item.mode)}${score}`;
    body.append(meta);
    const title = document.createElement('strong');
    title.className = 'ai-mentor__history-title';
    title.textContent = item.verdict || item.summary || item.feedback || item.mentorQuestion || 'Разбор AI-ментора';
    body.append(title);
    const next = firstUsefulText(item);
    if (next) {
      const note = document.createElement('span');
      note.className = 'ai-mentor__history-note';
      note.textContent = next;
      body.append(note);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ai-mentor__history-delete';
    remove.textContent = 'Удалить';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await deleteAiMentorReview(item.reviewId);
        setStatus('Запись AI-истории удалена.', 'success');
        await refreshHistory();
      } catch (err) {
        remove.disabled = false;
        setStatus(err?.message || 'Не удалось удалить запись AI-истории.', 'error');
      }
    });

    li.append(body, remove);
    return li;
  }

  function setStatus(text, kind = 'info') {
    status.textContent = text;
    status.dataset.kind = kind;
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function currentModeState() {
    return getModeState(activeMode);
  }

  function getModeState(mode) {
    const baseMode = normalizeMentorMode(mode);
    const custom = typeof resolveModeState === 'function'
      ? (resolveModeState(baseMode, { settings }) || {})
      : {};
    const requestMode = normalizeMentorMode(custom.mode || baseMode);
    return {
      key: baseMode,
      mode: requestMode,
      label: custom.label || modeLabel(requestMode),
      hidden: !!custom.hidden,
      disabled: !!custom.disabled,
      disabledMessage: custom.disabledMessage || '',
      submitLabel: custom.submitLabel || '',
    };
  }

  function ensureActiveMode() {
    const current = getModeState(activeMode);
    if (!current.hidden && !current.disabled) return;
    const next = allowedModes.find((mode) => {
      const state = getModeState(mode);
      return !state.hidden && !state.disabled;
    }) || allowedModes.find((mode) => !getModeState(mode).hidden);
    if (next) activeMode = next;
  }

  function findModeForMentorMode(targetMode) {
    const normalized = normalizeMentorMode(targetMode);
    return allowedModes.find((mode) => {
      const state = getModeState(mode);
      return !state.hidden && !state.disabled && state.mode === normalized;
    }) || allowedModes.find((mode) => normalizeMentorMode(mode) === normalized && !getModeState(mode).hidden);
  }

  renderModeState();

  return {
    element: root,
    refreshPreview: renderModeState,
  };
}

function normalizeModes(modes) {
  const result = [];
  for (const mode of modes || []) {
    const normalized = normalizeMentorMode(mode);
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result.length ? result : [MENTOR_MODES.hint];
}

function modeLabel(mode) {
  return MENTOR_MODE_LABELS[normalizeMentorMode(mode)] || mode;
}

function disabledState(disabledByUser, { compact = false } = {}) {
  const box = document.createElement('div');
  box.className = compact ? 'ai-mentor__disabled ai-mentor__disabled--compact' : 'ai-mentor__disabled';
  const p = document.createElement('p');
  p.className = 'ai-mentor__text';
  p.textContent = disabledByUser
    ? 'AI-ментор отключен в настройках.'
    : 'AI-ментор доступен после настройки proxy.';
  const link = document.createElement('a');
  link.className = 'learning-button';
  link.href = '#/settings';
  link.textContent = compact ? 'Настроить' : 'Настроить AI';
  box.append(p, link);
  return box;
}

function renderPreview(host, preview) {
  host.replaceChildren();
  if (!preview) return;
  const summary = document.createElement('p');
  summary.className = 'ai-mentor__preview-summary';
  summary.textContent = preview.summary || 'Будет отправлен минимальный контекст режима.';
  const details = document.createElement('details');
  details.className = 'ai-mentor__details';
  const summaryEl = document.createElement('summary');
  summaryEl.textContent = 'Что именно отправляется';
  const list = document.createElement('ul');
  list.className = 'ai-mentor__detail-list';
  for (const item of preview.details || []) {
    const li = document.createElement('li');
    li.textContent = `${item.label}: ${item.value}`;
    list.append(li);
  }
  if (preview.excluded?.length) {
    const li = document.createElement('li');
    li.textContent = `Не отправляется: ${preview.excluded.join(', ')}`;
    list.append(li);
  }
  for (const warning of preview.warnings || []) {
    const li = document.createElement('li');
    li.textContent = warning.message || String(warning.code || 'Есть ограничение режима.');
    list.append(li);
  }
  details.append(summaryEl, list);
  host.append(summary, details);
}

function previewWithProxyInfo(preview, settings = {}) {
  if (!preview) return preview;
  const details = [
    { label: 'AI-proxy URL', value: settings.endpoint || 'не настроен' },
    { label: 'Модель', value: settings.model || 'по умолчанию' },
    ...(preview.details || []),
    { label: 'Сохранение AI-feedback', value: 'в IndexedDB остается только короткая история: verdict, score, вопрос и summary' },
  ];
  const excluded = uniqueText([
    ...(preview.excluded || []),
    'серверный API key провайдера',
    'полный AI-feedback в IndexedDB',
  ]);
  return { ...preview, details, excluded };
}

function reviewForHistory(review = {}) {
  return {
    mode: review.mode,
    score: Number.isFinite(review.score) ? review.score : null,
    verdict: truncateHistoryText(review.verdict, 220),
    feedback: truncateHistoryText(firstHistorySummaryText(review), 260),
    mentorQuestion: truncateHistoryText(review.mentorQuestion, 260),
  };
}

function firstHistorySummaryText(review = {}) {
  const fields = [
    review.feedback,
    ...(Array.isArray(review.issues) ? review.issues : []),
    ...(Array.isArray(review.improvements) ? review.improvements : []),
    ...(Array.isArray(review.nextSteps) ? review.nextSteps : []),
    ...(Array.isArray(review.strengths) ? review.strengths : []),
  ];
  return fields.find((text) => typeof text === 'string' && text.trim()) || '';
}

function truncateHistoryText(value, max) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function uniqueText(items) {
  return Array.from(new Set((items || []).filter((item) => typeof item === 'string' && item.trim())));
}

function paragraph(text) {
  const p = document.createElement('p');
  p.className = 'ai-mentor__text';
  p.textContent = text;
  return p;
}

function appendList(container, title, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const h = document.createElement('h4');
  h.className = 'ai-mentor__list-title';
  h.textContent = title;
  const ul = document.createElement('ul');
  ul.className = 'ai-mentor__list';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  container.append(h, ul);
}

function firstUsefulText(item) {
  const fields = [
    item.summary,
    item.mentorQuestion,
    ...(Array.isArray(item.issues) ? item.issues : []),
    ...(Array.isArray(item.nextSteps) ? item.nextSteps : []),
    ...(Array.isArray(item.improvements) ? item.improvements : []),
  ];
  return fields.find((text) => typeof text === 'string' && text.trim()) || '';
}
