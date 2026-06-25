import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../api/ai-review.js');

function makeReq({ method = 'POST', headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = {
    origin: 'http://localhost:8080',
    'x-analyst-trainer-session': Math.random().toString(36).slice(2),
    ...headers,
  };
  req.socket = { remoteAddress: '127.0.0.1' };
  req.body = body;
  req.destroy = () => {};
  return req;
}

function makeRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    ended: false,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    end(chunk = '') {
      this.body += chunk;
      this.ended = true;
    },
    json() {
      return JSON.parse(this.body || '{}');
    },
  };
}

async function call(reqOptions) {
  const req = makeReq(reqOptions);
  const res = makeRes();
  await handler(req, res);
  return res;
}

function validBody(overrides = {}) {
  return {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    mode: 'reference_check',
    context: {
      schemaVersion: 1,
      policy: { allowScore: true, doNotRevealReference: false },
      task: { scenario: 'Проверить вывод по падению конверсии.' },
    },
    studentAnswer: 'Конверсия снизилась на шаге оплаты, нужно проверить ошибки платежей.',
    ...overrides,
  };
}

async function testMissingKey() {
  delete process.env.DEEPSEEK_API_KEY;
  const res = await call({ body: validBody() });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().code, 'missing_provider_key');
}

async function testSuccessfulProviderResponse() {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  let requestedModel = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requestedModel = body.model;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            score: 84,
            verdict: 'Хороший разбор, но нужен следующий шаг.',
            strengths: ['Нашел проблемный этап'],
            issues: ['Не указал проверку гипотезы'],
            mentorQuestion: 'Какой лог проверить первым?',
            improvements: ['Добавь проверку ошибок оплаты'],
            nextSteps: ['Повтори воронки'],
          }),
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const res = await call({ body: validBody() });
    const json = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(requestedModel, 'deepseek-chat');
    assert.equal(json.score, 84);
    assert.equal(json.verdict, 'Хороший разбор, но нужен следующий шаг.');
    assert.deepEqual(json.nextSteps, ['Повтори воронки']);
    assert.equal(json.raw, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testProviderUnauthorized() {
  process.env.DEEPSEEK_API_KEY = 'wrong-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: 'invalid api key' },
  }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  try {
    const res = await call({ body: validBody() });
    assert.equal(res.statusCode, 401);
    const json = res.json();
    assert.equal(json.code, 'provider_unauthorized');
    assert.equal(json.error.includes('invalid api key'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testInvalidProviderJson() {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'not json' } }],
  }), { status: 200 });

  try {
    const res = await call({ body: validBody() });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().code, 'invalid_provider_json');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testEmptyAnswerRejectedForReviewModes() {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  const res = await call({ body: validBody({ studentAnswer: '' }) });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'invalid_request');
}

async function testHintSuppressesScore() {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ score: 99, verdict: 'Подсказка', nextSteps: ['Посмотри на фильтр'] }) } }],
  }), { status: 200 });

  try {
    const res = await call({ body: validBody({ mode: 'hint', model: 'deepseek-v4-flash' }) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().score, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testReadmeReviewKeepsScore() {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.messages[1].content.includes('readme_review'), true);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        score: 71,
        verdict: 'README понятен, но не хватает цифр.',
        strengths: ['Есть бизнес-вопрос'],
        issues: ['Мало измеримых находок'],
        mentorQuestion: 'Какая рекомендация даст измеримый эффект?',
        improvements: ['Добавь 3-5 инсайтов с цифрами'],
        nextSteps: ['Доработай раздел Findings'],
      }) } }],
    }), { status: 200 });
  };

  try {
    const res = await call({
      body: validBody({
        mode: 'readme_review',
        context: {
          schemaVersion: 1,
          policy: { allowScore: true },
          project: { projectId: 'python-eda', title: 'Python EDA' },
        },
        studentAnswer: 'README описывает бизнес-проблему, методологию, основные инсайты и рекомендации.',
      }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().score, 71);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testMockInterviewReviewKeepsScore() {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.messages[1].content.includes('mock_interview'), true);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        score: 68,
        verdict: 'Mock показывает рабочую базу, но проседает структура ответа.',
        strengths: ['Есть заметки по SQL и продуктовому кейсу'],
        issues: ['Не зафиксирован follow-up вопрос'],
        mentorQuestion: 'Как бы ты проговорил план до SQL-кода?',
        improvements: ['Добавь план повторения по слабой секции'],
        nextSteps: ['Повтори SQL live и STAR-рассказ проекта'],
      }) } }],
    }), { status: 200 });
  };

  try {
    const res = await call({
      body: validBody({
        mode: 'mock_interview',
        context: {
          schemaVersion: 1,
          policy: { allowScore: true },
          mockInterview: { title: 'Mock-интервью аналитика' },
          run: { averageSectionScore: 3.2 },
        },
        studentAnswer: 'В SQL live я сначала молчал и писал код, в продуктовом кейсе забыл связать метрику с решением, планирую повторить STAR и проговаривание плана.',
      }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().score, 68);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testSessionRateLimit() {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ verdict: 'OK', nextSteps: ['Дальше'] }) } }],
  }), { status: 200 });

  try {
    const session = 'rate-limit-test';
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await call({
        headers: { 'x-analyst-trainer-session': session },
        body: validBody({ mode: 'hint' }),
      });
      statuses.push(res.statusCode);
    }
    assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(statuses[5], 429);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testDifferentSessionsHaveIndependentLimits() {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ verdict: 'OK', nextSteps: ['Дальше'] }) } }],
  }), { status: 200 });

  try {
    const firstSession = 'rate-limit-session-a';
    const secondSession = 'rate-limit-session-b';
    for (let i = 0; i < 5; i += 1) {
      const res = await call({
        headers: { 'x-analyst-trainer-session': firstSession },
        body: validBody({ mode: 'hint' }),
      });
      assert.equal(res.statusCode, 200);
    }

    const limited = await call({
      headers: { 'x-analyst-trainer-session': firstSession },
      body: validBody({ mode: 'hint' }),
    });
    const independent = await call({
      headers: { 'x-analyst-trainer-session': secondSession },
      body: validBody({ mode: 'hint' }),
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().code, 'minute_rate_limit');
    assert.equal(independent.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testProviderTimeout() {
  process.env.DEEPSEEK_API_KEY = 'secret-provider-key';
  process.env.AI_REVIEW_PROVIDER_TIMEOUT_MS = '5';
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.DEEPSEEK_API_URL;
  process.env.DEEPSEEK_API_URL = 'https://provider.example/chat/completions';
  globalThis.fetch = async (_url, options) => {
    assert.ok(options.signal);
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('Abort leaked secret-provider-key provider.example');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
  };

  try {
    const res = await call({
      headers: { 'x-analyst-trainer-session': 'provider-timeout-test' },
      body: validBody(),
    });
    const json = res.json();
    assert.equal(res.statusCode, 504);
    assert.equal(json.code, 'provider_timeout');
    assert.match(json.error, /timed out/i);
    assert.equal(json.error.includes('secret-provider-key'), false);
    assert.equal(json.error.includes('provider.example'), false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.AI_REVIEW_PROVIDER_TIMEOUT_MS;
    if (originalUrl === undefined) delete process.env.DEEPSEEK_API_URL;
    else process.env.DEEPSEEK_API_URL = originalUrl;
  }
}

async function testCorsRejectsUnknownOrigin() {
  process.env.DEEPSEEK_API_KEY = 'test-key';
  const res = await call({
    headers: { origin: 'https://evil.example' },
    body: validBody(),
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'cors_forbidden');
}

await testMissingKey();
await testSuccessfulProviderResponse();
await testProviderUnauthorized();
await testInvalidProviderJson();
await testEmptyAnswerRejectedForReviewModes();
await testHintSuppressesScore();
await testReadmeReviewKeepsScore();
await testMockInterviewReviewKeepsScore();
await testSessionRateLimit();
await testDifferentSessionsHaveIndependentLimits();
await testProviderTimeout();
await testCorsRejectsUnknownOrigin();

console.log('api-ai-review tests passed.');
