// core/aiReview.js — тонкий клиент для внешней AI-проверки ответов.
//
// Статическое приложение не должно хранить секретный DeepSeek API key в браузере.
// Поэтому здесь сохраняется только URL backend/proxy, который уже на своей стороне
// вызывает нужную модель и возвращает безопасный результат.

import { MENTOR_MODES, normalizeMentorMode, mentorModeSupportsScore } from './mentorContext.js';

const AI_REVIEW_SETTINGS_KEY = 'at-ai-review-settings';
const AI_REVIEW_CONSENT_KEY = 'at-ai-review-consent-accepted';
const AI_REVIEW_SESSION_KEY = 'at-ai-review-session-id';
const AI_REVIEW_CONSENT_VERSION = 1;
const AI_REVIEW_PROVIDER = 'deepseek';
const MAX_TRANSPORT_TEXT = 2400;
const MAX_TRANSPORT_DEPTH = 8;
const MAX_TRANSPORT_ARRAY = 50;
const SENSITIVE_CONTEXT_KEY_RE = /^(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|authorization|bearer|password|passwd|secret|client[_-]?secret|private[_-]?key|session[_-]?secret)$/i;

let cachedAiReviewSessionId = '';

export const DEFAULT_AI_REVIEW_MODEL = 'deepseek-v4-pro';
export const DEFAULT_AI_REVIEW_HINT_MODEL = 'deepseek-v4-flash';

export function getAiReviewSettings() {
  try {
    const raw = localStorage.getItem(AI_REVIEW_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeSettings(parsed);
  } catch {
    return normalizeSettings({});
  }
}

export function saveAiReviewSettings(settings = {}) {
  const previous = getAiReviewSettings();
  const previousConsentSignature = aiReviewConsentSignature(previous);
  const normalized = normalizeSettings(settings);
  try {
    localStorage.setItem(AI_REVIEW_SETTINGS_KEY, JSON.stringify(normalized));
    if (previousConsentSignature !== aiReviewConsentSignature(normalized)) {
      localStorage.removeItem(AI_REVIEW_CONSENT_KEY);
    }
  } catch {
    // Настройка удобства, не критичная для прохождения.
  }
  return normalized;
}

export function hasAiReviewConsent(settings = getAiReviewSettings()) {
  const signature = aiReviewConsentSignature(settings);
  if (!signature) return false;
  try {
    const consent = parseAiReviewConsent(localStorage.getItem(AI_REVIEW_CONSENT_KEY));
    return consent.accepted === true && consent.signature === signature;
  } catch {
    return false;
  }
}

export function saveAiReviewConsent(accepted = true, settings = getAiReviewSettings()) {
  const signature = aiReviewConsentSignature(settings);
  try {
    if (accepted && signature) {
      localStorage.setItem(AI_REVIEW_CONSENT_KEY, JSON.stringify({
        version: AI_REVIEW_CONSENT_VERSION,
        accepted: true,
        signature,
        provider: AI_REVIEW_PROVIDER,
        endpoint: normalizeSettings(settings).endpoint,
        acceptedAt: new Date().toISOString(),
      }));
    } else {
      localStorage.removeItem(AI_REVIEW_CONSENT_KEY);
    }
  } catch {
    // Consent влияет только на UX. Если localStorage недоступен, UI спросит снова.
  }
  return !!accepted && !!signature;
}

export function getAiReviewConsentInfo(settings = getAiReviewSettings()) {
  const normalized = normalizeSettings(settings);
  const signature = aiReviewConsentSignature(normalized);
  let consent = { accepted: false };
  try {
    consent = parseAiReviewConsent(localStorage.getItem(AI_REVIEW_CONSENT_KEY));
  } catch {
    consent = { accepted: false };
  }
  return {
    provider: AI_REVIEW_PROVIDER,
    endpoint: normalized.endpoint,
    model: normalized.model,
    signature,
    accepted: !!signature && consent.accepted === true && consent.signature === signature,
    acceptedAt: consent.acceptedAt || '',
  };
}

export function getAiReviewSessionId() {
  if (cachedAiReviewSessionId) return cachedAiReviewSessionId;

  try {
    const saved = String(localStorage.getItem(AI_REVIEW_SESSION_KEY) || '').trim();
    if (isAiReviewSessionId(saved)) {
      cachedAiReviewSessionId = saved;
      return cachedAiReviewSessionId;
    }
  } catch {
    // Если localStorage недоступен, используем session id только в памяти.
  }

  cachedAiReviewSessionId = makeAiReviewSessionId();
  try {
    localStorage.setItem(AI_REVIEW_SESSION_KEY, cachedAiReviewSessionId);
  } catch {
    // Стабильность между перезагрузками не критична, если storage заблокирован.
  }
  return cachedAiReviewSessionId;
}

export async function reviewAnswer({ endpoint, model, mode, context, studentAnswer, answer } = {}) {
  const target = String(endpoint || '').trim();
  if (!target) {
    throw new Error('Укажите URL AI-proxy в настройках.');
  }
  if (!/^https?:\/\//i.test(target)) {
    throw new Error('URL AI-proxy должен начинаться с http:// или https://.');
  }

  const normalizedMode = normalizeMentorMode(mode || MENTOR_MODES.referenceCheck);
  const normalizedModel = String(model || defaultModelForMode(normalizedMode)).trim()
    || defaultModelForMode(normalizedMode);
  const normalizedAnswer = sanitizeTransportText(String(studentAnswer ?? answer ?? '').trim());
  const normalizedContext = sanitizeAiReviewContextForTransport(context);

  let response;
  try {
    response = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Analyst-Trainer-Session': getAiReviewSessionId(),
      },
      body: JSON.stringify({
        provider: AI_REVIEW_PROVIDER,
        model: normalizedModel,
        mode: normalizedMode,
        context: normalizedContext,
        studentAnswer: normalizedAnswer,
        // Старые mock/proxy могли читать эти поля. Держим alias до миграции UI.
        task: 'ai-mentor-review',
        answer: normalizedAnswer,
      }),
    });
  } catch (err) {
    throw new Error('AI-proxy недоступен. Проверьте URL, CORS и подключение к сети.');
  }

  let payload = null;
  const text = await response.text();
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }

  if (!response.ok) {
    const message = payload?.error || payload?.message || text || errorMessageForStatus(response.status);
    throw new Error(message);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('AI-proxy вернул ответ в неподдерживаемом формате.');
  }

  return normalizeReviewResponse(payload, { mode: normalizedMode });
}

export function defaultModelForMode(mode) {
  const normalizedMode = normalizeMentorMode(mode);
  return normalizedMode === MENTOR_MODES.hint || normalizedMode === MENTOR_MODES.nextStep
    ? DEFAULT_AI_REVIEW_HINT_MODEL
    : DEFAULT_AI_REVIEW_MODEL;
}

function normalizeSettings(settings) {
  return {
    endpoint: String(settings.endpoint || '').trim(),
    model: String(settings.model || DEFAULT_AI_REVIEW_MODEL).trim() || DEFAULT_AI_REVIEW_MODEL,
    disabled: !!settings.disabled,
  };
}

function aiReviewConsentSignature(settings = {}) {
  const normalized = normalizeSettings(settings);
  return normalized.endpoint ? `${AI_REVIEW_PROVIDER}|${normalized.endpoint}|${normalized.model}` : '';
}

function parseAiReviewConsent(raw) {
  if (!raw) return { accepted: false };
  if (raw === '1') {
    return { accepted: true, signature: '', legacy: true };
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { accepted: false };
  } catch {
    return { accepted: false };
  }
}

export function normalizeReviewResponse(payload, { mode = MENTOR_MODES.referenceCheck } = {}) {
  const normalizedMode = normalizeMentorMode(mode);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('AI-proxy вернул ответ в неподдерживаемом формате.');
  }

  const verdict = cleanText(payload.verdict || payload.title || payload.status);
  const feedback = cleanText(payload.feedback || payload.review || payload.text || payload.summary);
  const strengths = normalizeTextList(payload.strengths);
  const issues = normalizeTextList(payload.issues);
  const improvements = normalizeTextList(payload.improvements);
  const nextSteps = normalizeTextList(payload.nextSteps || payload.next_steps);
  const mentorQuestion = cleanText(payload.mentorQuestion || payload.mentor_question || payload.question);
  const score = normalizeScore(payload.score);

  const hasUsefulBody = !!(verdict || feedback || mentorQuestion
    || strengths.length || issues.length || improvements.length || nextSteps.length);
  if (!hasUsefulBody) {
    throw new Error('AI-proxy вернул пустой или неполный разбор.');
  }
  if (mentorModeSupportsScore(normalizedMode) && score === null && !verdict && !feedback) {
    throw new Error('AI-proxy вернул неполный ответ для проверки.');
  }

  return {
    mode: normalizedMode,
    score,
    verdict,
    feedback,
    strengths,
    issues,
    mentorQuestion,
    improvements,
    nextSteps,
    raw: payload,
  };
}

export function sanitizeAiReviewContextForTransport(context) {
  if (context === null || context === undefined) return {};
  if (typeof context === 'string') return { text: sanitizeTransportText(context) };
  if (typeof context === 'object') {
    const sanitized = sanitizeTransportValue(context, 0, new WeakSet());
    return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? sanitized : {};
  }
  return { text: sanitizeTransportText(String(context)) };
}

function sanitizeTransportValue(value, depth, seen) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return sanitizeTransportText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= MAX_TRANSPORT_DEPTH) return [];
    return value.slice(0, MAX_TRANSPORT_ARRAY)
      .map((item) => sanitizeTransportValue(item, depth + 1, seen))
      .filter((item) => item !== null && item !== undefined && item !== '');
  }
  if (typeof value === 'object') {
    if (depth >= MAX_TRANSPORT_DEPTH || seen.has(value)) return null;
    seen.add(value);
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      if (!isSafeContextKey(key)) continue;
      const sanitized = sanitizeTransportValue(nested, depth + 1, seen);
      if (sanitized === null || sanitized === undefined || sanitized === '') continue;
      if (Array.isArray(sanitized) && sanitized.length === 0) continue;
      if (typeof sanitized === 'object' && !Array.isArray(sanitized) && Object.keys(sanitized).length === 0) continue;
      out[key] = sanitized;
    }
    seen.delete(value);
    return out;
  }
  return null;
}

function isSafeContextKey(key) {
  const value = String(key || '');
  if (value === '__proto__' || value === 'prototype' || value === 'constructor') return false;
  return !SENSITIVE_CONTEXT_KEY_RE.test(value);
}

function sanitizeTransportText(value) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  const redacted = redactSensitiveText(compact);
  return redacted.length > MAX_TRANSPORT_TEXT
    ? `${redacted.slice(0, MAX_TRANSPORT_TEXT - 1)}…`
    : redacted;
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [redacted-secret]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|authorization|password|passwd|secret|client[_-]?secret|private[_-]?key))\s*[:=]\s*["']?[^"'\s,;]{8,}/gi, '$1: [redacted-secret]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted-secret]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-secret]');
}

function makeAiReviewSessionId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Падаем в fallback ниже.
  }

  const parts = [
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 12),
  ];
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const values = new Uint32Array(2);
      crypto.getRandomValues(values);
      parts.push(...Array.from(values, (value) => value.toString(36)));
    }
  } catch {
    // Math.random fallback уже добавлен.
  }
  return `at-${parts.filter(Boolean).join('-')}`;
}

function isAiReviewSessionId(value) {
  return /^[a-zA-Z0-9._:-]{8,128}$/.test(String(value || ''));
}

function normalizeScore(value) {
  const num = typeof value === 'string' && value.trim() !== ''
    ? Number(value)
    : value;
  return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : null;
}

function normalizeTextList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).slice(0, 8);
  const text = cleanText(value);
  return text ? [text] : [];
}

function cleanText(value) {
  return typeof value === 'string'
    ? redactSensitiveText(value.replace(/\s+/g, ' ').trim())
    : '';
}

function errorMessageForStatus(status) {
  if (status === 400) return 'AI-proxy не принял запрос. Проверьте настройки и формат контекста.';
  if (status === 401) return 'AI-proxy отклонил запрос: нет доступа или неверный server-side ключ.';
  if (status === 429) return 'Лимит AI-запросов исчерпан. Попробуйте позже.';
  if (status === 502) return 'AI-provider временно недоступен через proxy.';
  return `AI-proxy вернул HTTP ${status}`;
}

export function smokeTest() {
  const hint = normalizeReviewResponse({
    feedback: 'Посмотри на переход между соседними шагами.',
    nextSteps: 'Сравни конверсии по шагам.',
  }, { mode: MENTOR_MODES.hint });
  const check = normalizeReviewResponse({
    score: 130,
    verdict: 'Нужно доработать',
    issues: 'Причина названа слишком широко.',
  }, { mode: MENTOR_MODES.referenceCheck });
  const sanitizedContext = sanitizeAiReviewContextForTransport({
    apiKey: 'sk-1234567890abcdef1234567890abcdef',
    task: {
      scenario: 'Bearer abcdefghijklmnop1234567890',
      question: 'Как проверить падение конверсии?',
    },
  });
  const ok = hint.score === null
    && hint.nextSteps.length === 1
    && check.score === 100
    && check.issues.length === 1
    && sanitizedContext.apiKey === undefined
    && sanitizedContext.task?.scenario === 'Bearer [redacted-secret]';
  console[ok ? 'info' : 'error'](`[aiReview.smokeTest] ${ok ? 'OK' : 'FAIL'}`);
  return ok;
}
