// api/ai-review.js - Vercel serverless proxy for Analyst Trainer AI mentor.
//
// The browser stores only this endpoint URL. The DeepSeek API key must live in
// server-side environment variables and is never returned to the client.

const DEFAULT_DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_PROVIDER_TIMEOUT_MS = 20 * 1000;
const DEFAULT_ALLOWED_LOCAL_ORIGINS = [
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:9090',
  'http://127.0.0.1:9090',
];
const MAX_BODY_BYTES = 64 * 1024;
const MINUTE_LIMIT = 5;
const DAY_LIMIT = 20;
const ONE_MINUTE_MS = 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const minuteBuckets = new Map();
const dailyBuckets = new Map();

const MODE_LABELS = {
  reference_check: 'проверка по эталону',
  hint: 'подсказка',
  explain_error: 'объяснение ошибки',
  sql_review: 'разбор SQL',
  next_step: 'следующий шаг',
  business_review: 'проверка бизнес-вывода',
  readme_review: 'проверка README и портфолио-проекта',
  mock_interview: 'разбор mock-интервью аналитика',
};

const MODES_WITH_SCORE = new Set(['reference_check', 'business_review', 'readme_review', 'mock_interview']);
const MODES_WITH_REQUIRED_ANSWER = new Set(['reference_check', 'business_review', 'readme_review', 'mock_interview']);

module.exports = async function handler(req, res) {
  const origin = String(req.headers.origin || '');
  if (!applyCors(req, res, origin)) {
    return sendJson(res, 403, {
      error: 'Origin is not allowed for this AI proxy.',
      code: 'cors_forbidden',
    });
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, {
      error: 'Method is not allowed. Use POST /api/ai-review.',
      code: 'method_not_allowed',
    });
  }

  const rate = checkRateLimit(req);
  if (!rate.ok) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))));
    return sendJson(res, 429, {
      error: rate.kind === 'daily'
        ? 'Daily AI mentor limit reached. Try again tomorrow.'
        : 'AI mentor minute limit reached. Try again in a minute.',
      code: rate.kind === 'daily' ? 'daily_rate_limit' : 'minute_rate_limit',
      retryAfterSeconds: Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000)),
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, {
      error: err.message || 'Request body is not valid JSON.',
      code: err.code || 'invalid_request',
    });
  }

  const validation = validateRequest(body);
  if (!validation.ok) {
    return sendJson(res, 400, {
      error: validation.error,
      code: 'invalid_request',
    });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return sendJson(res, 401, {
      error: 'Server-side DEEPSEEK_API_KEY is not configured.',
      code: 'missing_provider_key',
    });
  }

  let providerPayload;
  try {
    providerPayload = await callDeepSeek({
      apiKey,
      model: resolveProviderModel(body.model),
      mode: body.mode,
      context: body.context,
      studentAnswer: String(body.studentAnswer || ''),
    });
  } catch (err) {
    return sendJson(res, err.statusCode || 502, {
      error: err.message || 'AI provider is temporarily unavailable.',
      code: err.code || 'provider_error',
    });
  }

  let normalized;
  try {
    normalized = normalizeAiPayload(providerPayload, body.mode);
  } catch (err) {
    return sendJson(res, 502, {
      error: err.message || 'AI provider returned invalid JSON.',
      code: 'invalid_provider_response',
    });
  }

  return sendJson(res, 200, normalized);
};

function applyCors(req, res, origin) {
  const allowed = allowedOrigins();
  const noOriginRequest = !origin;
  const isAllowed = noOriginRequest || allowed.has(origin);
  if (!isAllowed) return false;

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Analyst-Trainer-Session');
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
}

function allowedOrigins() {
  const values = new Set(DEFAULT_ALLOWED_LOCAL_ORIGINS);
  const configured = String(process.env.AI_REVIEW_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  for (const item of configured) values.add(item);
  if (process.env.VERCEL_URL) values.add(`https://${process.env.VERCEL_URL}`);
  return values;
}

function checkRateLimit(req) {
  const key = clientKey(req);
  const now = Date.now();
  sweepBuckets(minuteBuckets, now);
  sweepBuckets(dailyBuckets, now);

  const minute = incrementBucket(minuteBuckets, key, now, ONE_MINUTE_MS);
  if (minute.count > MINUTE_LIMIT) return { ok: false, kind: 'minute', resetAt: minute.resetAt };

  const daily = incrementBucket(dailyBuckets, key, now, ONE_DAY_MS);
  if (daily.count > DAY_LIMIT) return { ok: false, kind: 'daily', resetAt: daily.resetAt };

  return { ok: true };
}

function clientKey(req) {
  const session = String(req.headers['x-analyst-trainer-session'] || '').trim();
  if (session) return `session:${hashValue(session)}`;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket?.remoteAddress || 'unknown';
  return `ip:${hashValue(ip)}`;
}

function incrementBucket(map, key, now, windowMs) {
  const existing = map.get(key);
  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + windowMs };
    map.set(key, bucket);
    return bucket;
  }
  existing.count += 1;
  return existing;
}

function sweepBuckets(map, now) {
  for (const [key, bucket] of map) {
    if (bucket.resetAt <= now) map.delete(key);
  }
}

function hashValue(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = await readRawBody(req);
  if (!raw.trim()) {
    const err = new Error('Request body is empty.');
    err.statusCode = 400;
    err.code = 'empty_body';
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Request body is not valid JSON.');
    err.statusCode = 400;
    err.code = 'invalid_json';
    throw err;
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const err = new Error('Request body is too large.');
        err.statusCode = 413;
        err.code = 'body_too_large';
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request must be a JSON object.' };
  }
  if (body.provider && body.provider !== 'deepseek') {
    return { ok: false, error: 'Only provider "deepseek" is supported.' };
  }
  if (!Object.prototype.hasOwnProperty.call(MODE_LABELS, body.mode)) {
    return { ok: false, error: 'Unsupported mentor mode.' };
  }
  if (!body.context || typeof body.context !== 'object' || Array.isArray(body.context)) {
    return { ok: false, error: 'Field "context" must be an object.' };
  }
  if (body.studentAnswer !== undefined && typeof body.studentAnswer !== 'string') {
    return { ok: false, error: 'Field "studentAnswer" must be a string.' };
  }
  if (MODES_WITH_REQUIRED_ANSWER.has(body.mode) && !String(body.studentAnswer || '').trim()) {
    return { ok: false, error: 'Field "studentAnswer" is required for this mentor mode.' };
  }
  return { ok: true };
}

function resolveProviderModel(model) {
  const requested = String(model || '').trim();
  if (requested === 'deepseek-v4-flash') {
    return process.env.DEEPSEEK_MODEL_FLASH || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  }
  if (requested === 'deepseek-v4-pro' || !requested) {
    return process.env.DEEPSEEK_MODEL_PRO || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  }
  return requested;
}

async function callDeepSeek({ apiKey, model, mode, context, studentAnswer }) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), providerTimeoutMs())
    : null;
  const requestOptions = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt(mode, context) },
        { role: 'user', content: userPrompt({ mode, context, studentAnswer }) },
      ],
    }),
  };
  if (controller) requestOptions.signal = controller.signal;

  let response;
  try {
    response = await fetch(process.env.DEEPSEEK_API_URL || DEFAULT_DEEPSEEK_URL, requestOptions);
  } catch (err) {
    if (controller?.signal?.aborted || err?.name === 'AbortError') {
      throw providerTimeoutError();
    }
    const providerErr = new Error('AI provider is temporarily unavailable.');
    providerErr.statusCode = 502;
    providerErr.code = 'provider_error';
    throw providerErr;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const statusCode = response.status === 401 ? 401 : response.status === 429 ? 429 : 502;
    const err = new Error(providerErrorMessage(response.status, payload));
    err.statusCode = statusCode;
    err.code = response.status === 401
      ? 'provider_unauthorized'
      : response.status === 429
        ? 'provider_rate_limit'
        : 'provider_error';
    throw err;
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    const err = new Error('AI provider returned an empty answer.');
    err.statusCode = 502;
    err.code = 'empty_provider_response';
    throw err;
  }

  try {
    return JSON.parse(stripJsonFence(content));
  } catch {
    const err = new Error('AI provider returned invalid JSON.');
    err.statusCode = 502;
    err.code = 'invalid_provider_json';
    throw err;
  }
}

function providerTimeoutMs() {
  const configured = Number(process.env.AI_REVIEW_PROVIDER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_PROVIDER_TIMEOUT_MS;
}

function providerTimeoutError() {
  const err = new Error('AI provider request timed out. Try again later.');
  err.statusCode = 504;
  err.code = 'provider_timeout';
  return err;
}

function systemPrompt(mode, context) {
  const scoreInstruction = MODES_WITH_SCORE.has(mode) && context?.policy?.allowScore !== false
    ? 'Return score as an integer from 0 to 100.'
    : 'Return score as null.';
  return [
    'You are the Analyst Trainer AI mentor.',
    'Reply only as strict JSON, with no markdown and no extra commentary.',
    'Use only the provided context, rubric, references, and topic links.',
    'Do not claim the student is correct unless the evidence supports it.',
    'Never change progress, never invent links, never expose secrets.',
    'If context.policy.doNotRevealReference is true, do not reveal the reference solution.',
    'For readme_review, review only the provided README text, project metadata, checklist, and GitHub URL string; do not pretend to inspect repository files.',
    'For mock_interview, evaluate only the provided mock-interview notes, self-assessment, section scores, rubric, and training protocol; do not invent a transcript.',
    scoreInstruction,
    'Required JSON keys: score, verdict, strengths, issues, mentorQuestion, improvements, nextSteps.',
    'Use concise Russian text. Arrays must contain short strings.',
  ].join('\n');
}

function userPrompt({ mode, context, studentAnswer }) {
  return JSON.stringify({
    task: MODE_LABELS[mode] || mode,
    mode,
    studentAnswer,
    context,
    outputSchema: {
      score: 'number 0..100 or null',
      verdict: 'string',
      strengths: ['string'],
      issues: ['string'],
      mentorQuestion: 'string',
      improvements: ['string'],
      nextSteps: ['string'],
    },
  });
}

function normalizeAiPayload(payload, mode) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('AI provider returned a non-object response.');
  }
  const score = normalizeScore(payload.score);
  const verdict = cleanText(payload.verdict || payload.title || payload.status);
  const strengths = normalizeTextList(payload.strengths);
  const issues = normalizeTextList(payload.issues);
  const mentorQuestion = cleanText(payload.mentorQuestion || payload.mentor_question || payload.question);
  const improvements = normalizeTextList(payload.improvements);
  const nextSteps = normalizeTextList(payload.nextSteps || payload.next_steps);

  const useful = verdict || strengths.length || issues.length || mentorQuestion || improvements.length || nextSteps.length;
  if (!useful) throw new Error('AI provider returned an empty mentor response.');

  return {
    score: MODES_WITH_SCORE.has(mode) ? score : null,
    verdict,
    strengths,
    issues,
    mentorQuestion,
    improvements,
    nextSteps,
  };
}

function normalizeScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : null;
}

function normalizeTextList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).slice(0, 8);
  const text = cleanText(value);
  return text ? [text] : [];
}

function cleanText(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, 1200)
    : '';
}

function stripJsonFence(text) {
  return String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function providerErrorMessage(status) {
  if (status === 401) return 'AI provider rejected the server-side credentials.';
  if (status === 429) return 'AI provider rate limit reached.';
  return 'AI provider is temporarily unavailable.';
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
