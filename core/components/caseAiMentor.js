// core/components/caseAiMentor.js — общий адаптер AI-ментора для кейсов.

import { AiMentor } from './AiMentor.js';
import { getDraftState, saveDraftState } from '../db.js';
import { loadTopicGraph, topicsForCase } from '../topicGraph.js';
import { buildMentorContext, MENTOR_MODES } from '../mentorContext.js';

export async function mountCaseAiMentor({
  caseData,
  caseId = caseData?.caseId,
  modes = [
    MENTOR_MODES.hint,
    MENTOR_MODES.referenceCheck,
    MENTOR_MODES.explainError,
    MENTOR_MODES.nextStep,
  ],
  defaultMode = MENTOR_MODES.hint,
  getStudentAnswer,
  getStudentArtifacts,
  getSqlContext,
  getErrorContext,
  getWeakSpots,
  getProgressSummary,
  getDraftSnapshot,
  isSubmitted,
  isReadyForReference,
  onBeforeReferenceCheck,
  onFocusAnswer,
  resolveModeState,
  disabled,
  disabledMessage,
} = {}) {
  const topicGraph = await loadTopicGraph();
  const caseTopics = topicsForCase(topicGraph, caseId, 4);

  return AiMentor({
    modes,
    defaultMode,
    compactDisabled: true,
    resolveModeState: (mode) => {
      if (disabled) {
        return {
          disabled: true,
          disabledMessage: disabledMessage || 'AI-ментор для этого кейса пока недоступен.',
        };
      }
      if (typeof resolveModeState === 'function') {
        const custom = resolveModeState(mode);
        if (custom) return custom;
      }
      if (mode === MENTOR_MODES.hint) {
        return submittedNow()
          ? { hidden: true }
          : { label: 'Дать подсказку', submitLabel: 'Получить подсказку' };
      }
      if (mode === MENTOR_MODES.explainError) {
        return submittedNow()
          ? { label: 'Объяснить ошибку', submitLabel: 'Объяснить ошибку' }
          : { hidden: true };
      }
      if (mode === MENTOR_MODES.referenceCheck) {
        return {
          label: 'Проверить по эталону',
          submitLabel: 'Проверить по эталону',
          disabled: !readyForReferenceNow(),
          disabledMessage: 'Сначала заполните обязательные поля кейса.',
        };
      }
      if (mode === MENTOR_MODES.businessReview) {
        return {
          label: 'Проверить бизнес-вывод',
          submitLabel: 'Проверить бизнес-вывод',
        };
      }
      if (mode === MENTOR_MODES.nextStep) {
        return { label: 'Что повторить?', submitLabel: 'Показать следующий шаг' };
      }
      if (mode === MENTOR_MODES.sqlReview) {
        return { label: 'Объяснить ошибку SQL', submitLabel: 'Объяснить ошибку SQL' };
      }
      return {};
    },
    buildContext: (mode) => buildMentorContext({
      mode,
      caseData,
      topicGraph,
      topics: caseTopics,
      studentAnswer: readStudentAnswer(),
      studentArtifacts: typeof getStudentArtifacts === 'function' ? getStudentArtifacts() : null,
      sql: typeof getSqlContext === 'function' ? getSqlContext() : null,
      errorContext: typeof getErrorContext === 'function' ? getErrorContext() : null,
      weakSpots: typeof getWeakSpots === 'function' ? getWeakSpots() : null,
      progressSummary: typeof getProgressSummary === 'function' ? getProgressSummary() : null,
      referenceUnlocked: submittedNow(),
    }),
    historyScope: {
      caseId,
      module: caseData?.module,
      caseTitle: caseData?.title,
    },
    getStudentAnswer: readStudentAnswer,
    onFocusAnswer,
    onRepeatLater: async ({ mode, review }) => {
      if (!caseId) return;
      let current = {};
      try { current = (await getDraftState(caseId)) || {}; } catch { current = {}; }
      const snapshot = typeof getDraftSnapshot === 'function' ? getDraftSnapshot() : {};
      await saveDraftState(caseId, {
        ...current,
        ...(snapshot && typeof snapshot === 'object' ? snapshot : {}),
        aiMentor: {
          repeatLater: true,
          mode,
          score: Number.isFinite(review?.score) ? review.score : null,
          updatedAt: Date.now(),
        },
      });
    },
    onBeforeReferenceCheck,
  });

  function readStudentAnswer() {
    return typeof getStudentAnswer === 'function' ? String(getStudentAnswer() || '') : '';
  }

  function submittedNow() {
    return typeof isSubmitted === 'function' ? !!isSubmitted() : false;
  }

  function readyForReferenceNow() {
    return typeof isReadyForReference === 'function' ? !!isReadyForReference() : true;
  }
}
