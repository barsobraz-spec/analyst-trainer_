// core/mentorContext.js — безопасная сборка контекста для AI-ментора.
//
// Модуль не знает про DOM и proxy. Его задача — собрать только те поля, которые
// нужны выбранному режиму, и дать UI короткий preview перед внешним запросом.

export const MENTOR_MODES = Object.freeze({
  referenceCheck: 'reference_check',
  hint: 'hint',
  explainError: 'explain_error',
  sqlReview: 'sql_review',
  nextStep: 'next_step',
  businessReview: 'business_review',
  readmeReview: 'readme_review',
  mockInterview: 'mock_interview',
});

export const MENTOR_MODE_LABELS = Object.freeze({
  [MENTOR_MODES.referenceCheck]: 'Проверить по эталону',
  [MENTOR_MODES.hint]: 'Дать подсказку',
  [MENTOR_MODES.explainError]: 'Объяснить ошибку',
  [MENTOR_MODES.sqlReview]: 'Проверить SQL',
  [MENTOR_MODES.nextStep]: 'Что повторить дальше',
  [MENTOR_MODES.businessReview]: 'Проверить бизнес-вывод',
  [MENTOR_MODES.readmeReview]: 'Проверить README',
  [MENTOR_MODES.mockInterview]: 'Разобрать mock-интервью',
});

const MODES_WITH_REQUIRED_ANSWER = new Set([
  MENTOR_MODES.referenceCheck,
  MENTOR_MODES.businessReview,
  MENTOR_MODES.readmeReview,
  MENTOR_MODES.mockInterview,
]);

const MODES_WITH_SCORE = new Set([
  MENTOR_MODES.referenceCheck,
  MENTOR_MODES.businessReview,
  MENTOR_MODES.readmeReview,
  MENTOR_MODES.mockInterview,
]);

const MIN_ANSWER_CHARS = 40;
const MIN_ANSWER_WORDS = 6;
const MAX_TEXT = 2400;
const MAX_REFERENCE_SECTIONS = 8;
const MAX_TABLE_ROWS = 5;
const MAX_TOPICS = 6;
const MAX_MISTAKES = 8;
const MAX_CONTEXT_DEPTH = 8;
const SENSITIVE_CONTEXT_KEY_RE = /^(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|authorization|bearer|password|passwd|secret|client[_-]?secret|private[_-]?key|session[_-]?secret)$/i;

export function normalizeMentorMode(mode) {
  const value = stringOrEmpty(mode);
  return Object.values(MENTOR_MODES).includes(value) ? value : MENTOR_MODES.hint;
}

export function mentorModeSupportsScore(mode) {
  return MODES_WITH_SCORE.has(normalizeMentorMode(mode));
}

export function isSubstantialStudentAnswer(answer) {
  const text = stringOrEmpty(answer);
  if (text.length < MIN_ANSWER_CHARS) return false;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= MIN_ANSWER_WORDS;
}

export function buildMentorContext(options = {}) {
  const mode = normalizeMentorMode(options.mode);
  const referenceUnlocked = options.referenceUnlocked === true;
  const caseData = options.caseData || {};
  const payload = caseData.payload || {};
  const studentAnswer = stringOrEmpty(options.studentAnswer);
  const topicContext = buildTopicContext({
    graph: options.topicGraph,
    topics: options.topics,
    caseId: caseData.caseId,
  });
  const warnings = [];

  if (MODES_WITH_REQUIRED_ANSWER.has(mode) && !isSubstantialStudentAnswer(studentAnswer)) {
    warnings.push({
      code: 'weak_answer',
      message: 'Для проверки по эталону нужен осмысленный ответ. Можно запросить подсказку.',
      suggestedMode: MENTOR_MODES.hint,
    });
  }

  const base = {
    schemaVersion: 1,
    product: 'Analyst Trainer',
    mentorTone: 'calm_mentor',
    mode,
    case: {
      caseId: stringOrEmpty(caseData.caseId),
      module: stringOrEmpty(caseData.module),
      title: stringOrEmpty(caseData.title),
      difficulty: stringOrEmpty(caseData.difficulty),
      skillTags: normalizeStringList(caseData.skillTags),
    },
    task: compactObject({
      scenario: trimText(payload.scenario),
      question: trimText(payload.question),
    }),
    topics: topicContext,
    policy: buildModePolicy(mode, { referenceUnlocked }),
    warnings,
  };

  if (mode === MENTOR_MODES.hint) {
    return withPreview({
      ...base,
      studentAnswer: studentAnswer ? trimText(studentAnswer) : '',
      sql: buildSqlHintContext(options.sql || {}, payload),
      rubric: buildRubric(payload, caseData),
      caseDataSummary: buildCaseDataSummary(payload),
    });
  }

  if (mode === MENTOR_MODES.sqlReview) {
    const sqlContext = buildSqlContext(options.sql || {}, payload);
    if (!sqlContext.userSql || !sqlContext.referenceSql || !sqlContext.autograderMessage) {
      warnings.push({
        code: 'sql_review_unavailable',
        message: 'AI-объяснение SQL доступно после неверной автопроверки. До этого можно запросить подсказку.',
        suggestedMode: MENTOR_MODES.hint,
      });
    }
    return withPreview({
      ...base,
      warnings,
      sql: sqlContext,
      studentAnswer: studentAnswer ? trimText(studentAnswer) : '',
    });
  }

  if (mode === MENTOR_MODES.nextStep) {
    return withPreview({
      ...base,
      weakSpots: normalizeWeakSpots(options.weakSpots),
      progressSummary: compactObject(options.progressSummary || {}),
    });
  }

  const wantsReference = mode === MENTOR_MODES.referenceCheck
    || mode === MENTOR_MODES.businessReview
    || mode === MENTOR_MODES.explainError;
  const reference = wantsReference && referenceUnlocked
    ? normalizeReference(payload.reference)
    : null;

  if (wantsReference && !referenceUnlocked) {
    warnings.push({
      code: 'reference_locked',
      message: 'Эталон не отправляется до явного раскрытия. Ментор даст только формативный feedback без готового решения.',
    });
  }

  return withPreview({
    ...base,
    studentAnswer: trimText(studentAnswer),
    studentArtifacts: normalizeStudentArtifacts(options.studentArtifacts),
    reference,
    rubric: buildRubric(payload, caseData),
    errorContext: mode === MENTOR_MODES.explainError
      ? normalizeErrorContext(options.errorContext)
      : null,
    caseDataSummary: buildCaseDataSummary(payload),
  });
}

export function buildProjectReviewContext(options = {}) {
  const mode = MENTOR_MODES.readmeReview;
  const project = options.project || {};
  const progress = options.progress || {};
  const readmeDraft = stringOrEmpty(options.readmeDraft ?? progress.readmeDraft);
  const notes = stringOrEmpty(options.notes ?? progress.notes);
  const checklistItems = normalizeProjectChecklist({
    projectChecklist: project.qualityChecklist,
    globalChecklist: options.globalQualityChecklist,
    checks: progress.qualityChecklist,
  });
  const warnings = [];

  if (!isSubstantialStudentAnswer(readmeDraft) && !stringOrEmpty(progress.githubUrl)) {
    warnings.push({
      code: 'readme_missing',
      message: 'Для полноценной проверки вставьте README или краткое описание проекта. Сейчас ментор сможет оценить только готовность по метаданным.',
    });
  }

  const context = compactObject({
    schemaVersion: 1,
    product: 'Analyst Trainer',
    mentorTone: 'calm_mentor',
    mode,
    project: compactObject({
      projectId: stringOrEmpty(project.id),
      title: stringOrEmpty(project.fullTitle || project.title),
      month: Number.isFinite(project.month) ? project.month : null,
      primarySkill: stringOrEmpty(project.primarySkill),
      businessQuestion: trimText(project.businessQuestion),
      stack: normalizeStringList(project.stack),
      deliverables: normalizeStringList(project.deliverables),
      readmeStructure: normalizeStringList(project.readmeStructure),
      trainerModules: normalizeStringList(project.trainerModules),
      githubUrl: stringOrEmpty(progress.githubUrl),
      status: stringOrEmpty(progress.status),
      flags: {
        readmeReady: Boolean(progress.readmeReady),
        screenshotsReady: Boolean(progress.screenshotsReady),
        videoDemoReady: Boolean(progress.videoDemoReady),
      },
    }),
    studentAnswer: trimText(readmeDraft),
    studentArtifacts: compactObject({
      projectNotes: trimText(notes),
      qualityChecklist: checklistItems,
    }),
    rubric: buildProjectRubric(project, options.globalQualityChecklist),
    policy: {
      doNotChangeProgress: true,
      doNotInventLinks: true,
      doNotRevealReference: false,
      formativeOnly: false,
      allowScore: true,
      scoreIsSecondary: true,
      expectedTone: 'Проверь проект как портфолио Data Analyst: ясно, конкретно и без выдумывания фактов.',
      expectedOutput: 'Оцени README/описание проекта, найди пробелы для найма и предложи точечные улучшения.',
    },
    warnings,
  });

  return withPreview(context);
}

export function buildMockInterviewReviewContext(options = {}) {
  const mode = MENTOR_MODES.mockInterview;
  const mock = options.mock || {};
  const run = options.run || {};
  const sections = normalizeMockSections(mock.sections);
  const rubricItems = normalizeStringList(mock.selfAssessmentRubric);
  const studentAnswer = trimText(options.studentAnswer || buildMockInterviewAnswer({ sections, rubricItems, run }));
  const warnings = [];

  if (!isSubstantialStudentAnswer(studentAnswer)) {
    warnings.push({
      code: 'weak_answer',
      message: 'Для AI-разбора mock-интервью добавьте оценки секций, заметки по ошибкам или план следующего повтора.',
      suggestedMode: MENTOR_MODES.mockInterview,
    });
  }

  const context = compactObject({
    schemaVersion: 1,
    product: 'Analyst Trainer',
    mentorTone: 'calm_interviewer',
    mode,
    mockInterview: compactObject({
      title: stringOrEmpty(mock.title) || 'Mock-интервью аналитика',
      sections,
      commonFailures: normalizeStringList(mock.commonFailures).slice(0, MAX_MISTAKES),
      sevenDayProtocol: normalizeMockProtocol(mock.sevenDayProtocol),
    }),
    run: compactObject({
      date: stringOrEmpty(run.date),
      result: stringOrEmpty(run.result),
      durationMinutes: Number.isFinite(run.durationMinutes) ? run.durationMinutes : null,
      averageSectionScore: averageMockSectionScore(run.sectionScores),
      sectionAssessment: buildMockSectionAssessment(sections, run),
      selfAssessment: buildMockSelfAssessment(rubricItems, run.rubricChecks),
      mistakesNotes: trimText(run.mistakesNotes),
      actionPlan: trimText(run.actionPlan),
    }),
    studentAnswer,
    rubric: buildMockInterviewRubric(mock),
    policy: {
      doNotChangeProgress: true,
      doNotInventLinks: true,
      doNotRevealReference: false,
      formativeOnly: false,
      allowScore: true,
      scoreIsSecondary: true,
      expectedTone: 'Проведи разбор как интервьюер Data Analyst: конкретно, спокойно, с фокусом на следующий тренировочный шаг.',
      expectedOutput: 'Оцени готовность по секциям, назови 1-3 слабых места, задай один follow-up вопрос и предложи план повторения.',
    },
    warnings,
  });

  return withPreview(context);
}

export function buildMentorContextPreview(context = {}) {
  const mode = normalizeMentorMode(context.mode);
  const details = [];
  const includes = [];
  const excludes = [];

  addDetail(details, 'Режим', MENTOR_MODE_LABELS[mode] || mode);
  addDetail(details, 'Кейс', context.case?.title || context.case?.caseId || 'не указан');
  addDetail(details, 'Модуль', context.case?.module || 'не указан');
  if (context.project?.title) addDetail(details, 'Проект', context.project.title);
  if (context.mockInterview?.title) addDetail(details, 'Mock-интервью', context.mockInterview.title);

  if (context.task?.scenario) includes.push('условие кейса');
  if (context.task?.question) includes.push('вопрос');
  if (context.studentAnswer) includes.push('ответ пользователя');
  if (context.reference) includes.push('эталон');
  if (context.rubric?.length) includes.push('критерии');
  if (context.sql?.userSql) includes.push('SQL пользователя');
  if (context.sql?.referenceSql) includes.push('эталонный SQL');
  if (context.sql?.schema) includes.push('схема таблиц');
  if (context.topics?.items?.length) includes.push('связанные темы');
  if (context.weakSpots?.length) includes.push('слабые места');
  if (context.project?.projectId) includes.push('описание проекта');
  if (context.project?.readmeStructure?.length) includes.push('ожидаемая структура README');
  if (context.studentArtifacts?.qualityChecklist?.length) includes.push('чек-лист качества');
  if (context.mockInterview?.sections?.length) includes.push('секции mock-интервью');
  if (context.run?.sectionAssessment?.length) includes.push('оценки по секциям');
  if (context.run?.selfAssessment?.length) includes.push('самооценка');
  if (context.mockInterview?.commonFailures?.length) includes.push('типичные провалы');

  if (mode === MENTOR_MODES.hint) {
    excludes.push('полный эталон');
    excludes.push('эталонный SQL');
  }
  if (context.policy?.doNotRevealReference) {
    if (!excludes.includes('готовое решение')) excludes.push('готовое решение');
  }
  if (mode === MENTOR_MODES.nextStep) {
    excludes.push('полные тексты ответов');
    excludes.push('полная история AI-feedback');
  }
  if (mode === MENTOR_MODES.readmeReview) {
    excludes.push('код репозитория');
    excludes.push('файлы GitHub не загружаются автоматически');
  }
  if (mode === MENTOR_MODES.mockInterview) {
    excludes.push('полная запись интервью');
    excludes.push('контакты и данные работодателей');
  }
  excludes.push('секретные ключи и API-токены');
  excludes.push('персональные данные не добавляются автоматически');

  addDetail(details, 'Ответ пользователя', context.studentAnswer
    ? `${context.studentAnswer.length} символов`
    : 'не отправляется');
  addDetail(details, 'Эталон', context.reference
    ? 'отправляется для проверки'
    : 'не отправляется');
  addDetail(details, 'SQL пользователя', context.sql?.userSql
    ? 'отправляется'
    : 'не отправляется');
  addDetail(details, 'SQL-эталон', context.sql?.referenceSql
    ? 'отправляется для разбора ошибки'
    : 'не отправляется');
  if (context.policy?.formativeOnly) {
    addDetail(details, 'Тип разбора', 'без оценки и без готового решения');
  }
  if (context.run?.averageSectionScore !== undefined) {
    addDetail(details, 'Средняя самооценка', `${context.run.averageSectionScore}/5`);
  }
  addDetail(details, 'Темы', context.topics?.items?.length
    ? context.topics.items.map((topic) => topic.title || topic.id).join(', ')
    : 'нет связанных тем');
  addDetail(details, 'Privacy-фильтр', 'секретные поля удаляются, похожие на ключи значения маскируются');

  return {
    summary: `Будет отправлено: ${includes.length ? includes.join(', ') : 'минимальный контекст режима'}.`,
    details,
    excluded: excludes,
    canShowScore: mentorModeSupportsScore(mode) && context.policy?.allowScore !== false,
    warnings: Array.isArray(context.warnings) ? context.warnings : [],
  };
}

function withPreview(context) {
  const compact = compactObject(sanitizeContextValue(context, 0, new WeakSet()));
  return {
    context: compact,
    preview: buildMentorContextPreview(compact),
  };
}

function buildModePolicy(mode, { referenceUnlocked = false } = {}) {
  const canUseReference = mode !== MENTOR_MODES.hint && (
    mode === MENTOR_MODES.sqlReview || referenceUnlocked
  );
  const allowScore = mentorModeSupportsScore(mode) && canUseReference;
  const formativeOnly = mentorModeSupportsScore(mode) && !allowScore;
  return {
    doNotChangeProgress: true,
    doNotInventLinks: true,
    useOnlyProvidedTopicRefs: true,
    doNotRevealReference: mode === MENTOR_MODES.hint || formativeOnly,
    formativeOnly,
    allowScore,
    scoreIsSecondary: allowScore,
    expectedTone: 'Признай сильные места, прямо назови ошибку и задай один наводящий вопрос.',
    expectedOutput: formativeOnly
      ? 'Не ставь оценку и не раскрывай эталон. Дай, что улучшить, и один вопрос для самостоятельной доработки.'
      : 'Дай структурированный разбор по доступному контексту.',
  };
}

function buildTopicContext({ graph, topics, caseId } = {}) {
  const items = Array.isArray(topics) && topics.length
    ? topics
    : topicsFromGraph(graph, caseId);

  const normalized = items.slice(0, MAX_TOPICS).map((topic) => {
    const next = normalizeStringList(topic.next);
    const related = normalizeStringList(topic.related);
    const prerequisites = normalizeStringList(topic.prerequisites);
    return compactObject({
      id: stringOrEmpty(topic.id),
      title: stringOrEmpty(topic.title || topic.id),
      skill: stringOrEmpty(topic.skill),
      prerequisites,
      next,
      related,
      taskRefs: normalizeStringList(topic.taskRefs),
      caseRefs: normalizeStringList(topic.caseRefs),
      moduleRefs: normalizeStringList(topic.moduleRefs),
      projectRefs: normalizeStringList(topic.projectRefs),
      commonMistakes: normalizeStringList(topic.commonMistakes).slice(0, MAX_MISTAKES),
    });
  }).filter((topic) => topic.id);

  const allowedNextStepIds = uniqueStrings([
    ...normalized.map((topic) => topic.id),
    ...normalized.flatMap((topic) => topic.prerequisites || []),
    ...normalized.flatMap((topic) => topic.next || []),
    ...normalized.flatMap((topic) => topic.related || []),
    ...normalized.flatMap((topic) => topic.taskRefs || []),
    ...normalized.flatMap((topic) => topic.caseRefs || []),
    ...normalized.flatMap((topic) => topic.moduleRefs || []),
    ...normalized.flatMap((topic) => topic.projectRefs || []),
  ]);

  return {
    items: normalized,
    commonMistakes: uniqueStrings(normalized.flatMap((topic) => topic.commonMistakes || [])).slice(0, MAX_MISTAKES),
    allowedNextStepIds,
  };
}

function topicsFromGraph(graph, caseId) {
  const direct = graph?.topicsByCaseId?.get?.(caseId);
  if (Array.isArray(direct)) return direct;
  return Array.isArray(graph?.topics)
    ? graph.topics.filter((topic) => normalizeStringList(topic.caseRefs).includes(caseId))
    : [];
}

function buildRubric(payload = {}, caseData = {}) {
  if (Array.isArray(payload.rubric)) return normalizeRubric(payload.rubric);
  if (payload.reference?.rubric) return normalizeRubric(payload.reference.rubric);

  const module = stringOrEmpty(caseData.module);
  if (module === '5.2') {
    return [
      'Проверь, что гипотеза сформулирована как проверяемая связь "если → то → потому что".',
      'Оцени, есть ли понятный способ проверки и конкретная метрика.',
      'Отметь риски, guardrail-метрики и слабые места приоритизации.',
      'Не засчитывай общие идеи без механизма и данных для проверки.',
    ];
  }
  if (module === '5.3') {
    return [
      'Сначала учитывай результаты авто-вопросов и найденной аномалии.',
      'Проверь, что инсайт описывает, что произошло, почему это важно и что делать дальше.',
      'Отметь, опирается ли вывод на графики, периоды, сравнения и величины эффекта.',
      'Не засчитывай красивое описание дашборда без управленческого вывода.',
    ];
  }
  if (module === '5.4') {
    return [
      'Проверь, дошел ли разбор до корневой причины, а не остановился на симптоме.',
      'Оцени доказуемость ветвей и связь причин с фактами кейса.',
      'Отметь тупиковые, слишком общие или недоказанные ветви дерева причин.',
      'Предложи один следующий вопрос, который углубит RCA.',
    ];
  }
  if (module === '5.5') {
    return [
      'Сначала учитывай результат точной автопроверки SQL.',
      'Объясняй вероятную ошибку в JOIN, фильтрах, GROUP BY, HAVING, NULL или сортировке.',
      'Не засчитывай решение вместо автопроверки.',
    ];
  }
  if (module === '5.6') {
    return [
      'Проверь, связаны ли решения с целью симуляции и ключевыми метриками.',
      'Оцени trade-off: рост целевой метрики, риски, стоимость и побочные эффекты.',
      'Отметь, где обоснование подменяет расчет предположением.',
      'Предложи следующий управленческий шаг на основе итогового состояния.',
    ];
  }
  if (module === '5.7') {
    return [
      'Проверь, покрывает ли схема триггер, шаги, входы, выходы, исполнителей и итог.',
      'Оцени готовность к внедрению: исключения, контроль качества, метрики результата.',
      'Отметь ручные места, которые остались без автоматизации или владельца.',
      'Предложи один следующий шаг для превращения схемы в рабочий процесс.',
    ];
  }
  return [
    'Проверь точность вывода относительно условия и эталона.',
    'Отметь неподтвержденные причинно-следственные связи.',
    'Оцени полноту наблюдений и качество бизнес-рекомендации.',
    'Сформулируй один наводящий вопрос и следующий шаг.',
  ];
}

function buildProjectRubric(project = {}, globalChecklist = []) {
  const projectChecklist = normalizeStringList(project.qualityChecklist);
  const globalItems = normalizeProjectChecklist({ globalChecklist });
  return [
    'Проверь, понятно ли из README, какую бизнес-проблему решает проект и почему она важна.',
    'Оцени, видны ли методология, данные, ограничения и выбранный аналитический подход.',
    'Проверь наличие 3-5 находок с цифрами, а не только технического описания.',
    'Оцени, связаны ли рекомендации с действиями бизнеса и ожидаемым эффектом.',
    'Проверь, читается ли проект за 2 минуты и выглядит ли как рабочая задача, а не учебная тетрадка.',
    ...projectChecklist,
    ...globalItems.map((item) => item.title || item.description).filter(Boolean),
  ].filter(Boolean).slice(0, 16);
}

function buildMockInterviewRubric(mock = {}) {
  const sections = normalizeMockSections(mock.sections);
  const rubricItems = normalizeStringList(mock.selfAssessmentRubric);
  const failures = normalizeStringList(mock.commonFailures);
  return [
    'Оцени готовность к интервью по пятибалльным секциям и текстовым заметкам, а не по одному общему впечатлению.',
    'Проверь, есть ли проговаривание плана до кода, уточнение задачи и связь метрик с бизнес-решением.',
    'Отметь слабые места по SQL/pandas/statistics/product/project story, если они видны в секционных оценках или заметках.',
    'Сформулируй один follow-up вопрос как интервьюер и короткий план повторения на ближайшие 1-3 дня.',
    ...sections.map((section) => `Секция "${section.title}": ${section.format}`),
    ...rubricItems,
    ...failures.map((item) => `Типичный провал: ${item}`),
  ].filter(Boolean).slice(0, 18);
}

function normalizeMockSections(sections = []) {
  if (!Array.isArray(sections)) return [];
  return sections.slice(0, 12).map((section, index) => compactObject({
    id: stringOrEmpty(section?.id) || `section-${index + 1}`,
    title: stringOrEmpty(section?.title) || `Секция ${index + 1}`,
    format: trimText(section?.format, 360),
    skills: normalizeStringList(section?.skills),
  })).filter((section) => section.id || section.title);
}

function normalizeMockProtocol(protocol = []) {
  if (!Array.isArray(protocol)) return [];
  return protocol.slice(0, 10).map((step) => compactObject({
    day: Number.isFinite(step?.day) ? step.day : null,
    title: trimText(step?.title, 180),
    task: trimText(step?.task, 360),
  })).filter((step) => step.title || step.task);
}

function buildMockSectionAssessment(sections, run = {}) {
  const scores = run.sectionScores && typeof run.sectionScores === 'object' ? run.sectionScores : {};
  const notes = run.sectionNotes && typeof run.sectionNotes === 'object' ? run.sectionNotes : {};
  return sections.map((section) => {
    const score = Number(scores[section.id]);
    return compactObject({
      id: section.id,
      title: section.title,
      score: Number.isFinite(score) ? score : null,
      note: trimText(notes[section.id], 600),
    });
  }).filter((item) => item.score !== undefined || item.note);
}

function buildMockSelfAssessment(rubricItems = [], checks = {}) {
  const source = checks && typeof checks === 'object' ? checks : {};
  return rubricItems.map((item, index) => {
    const id = `rubric-${index + 1}`;
    return {
      id,
      title: item,
      checked: Boolean(source[id]),
    };
  }).filter((item) => item.title);
}

function buildMockInterviewAnswer({ sections = [], rubricItems = [], run = {} } = {}) {
  if (!hasMockInterviewSignal({ sections, rubricItems, run })) return '';
  const parts = [];
  if (run.date || run.result || run.durationMinutes) {
    parts.push(`Прогон: дата ${run.date || 'не указана'}, результат ${run.result || 'не указан'}, длительность ${run.durationMinutes || 'не указана'} минут.`);
  }
  const assessment = buildMockSectionAssessment(sections, run);
  if (assessment.length) {
    parts.push(`Секции: ${assessment.map((item) => {
      const score = item.score === undefined ? 'без оценки' : `${item.score}/5`;
      return `${item.title}: ${score}${item.note ? `, заметка: ${item.note}` : ''}`;
    }).join('; ')}.`);
  }
  const selfAssessment = buildMockSelfAssessment(rubricItems, run.rubricChecks);
  const checked = selfAssessment.filter((item) => item.checked).map((item) => item.title);
  const missed = selfAssessment.filter((item) => !item.checked).map((item) => item.title);
  if (checked.length) parts.push(`Получилось: ${checked.join('; ')}.`);
  if (missed.length && (checked.length || run.mistakesNotes || run.actionPlan)) {
    parts.push(`Не отмечено в самооценке: ${missed.join('; ')}.`);
  }
  if (run.mistakesNotes) parts.push(`Ошибки и наблюдения: ${run.mistakesNotes}`);
  if (run.actionPlan) parts.push(`План повтора: ${run.actionPlan}`);
  return parts.join('\n');
}

function averageMockSectionScore(scores = {}) {
  if (!scores || typeof scores !== 'object') return null;
  const values = Object.values(scores).map(Number).filter(Number.isFinite);
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function hasMockInterviewSignal({ sections = [], rubricItems = [], run = {} } = {}) {
  if (trimText(run.mistakesNotes) || trimText(run.actionPlan)) return true;
  const assessment = buildMockSectionAssessment(sections, run);
  if (assessment.length) return true;
  const selfAssessment = buildMockSelfAssessment(rubricItems, run.rubricChecks);
  return selfAssessment.some((item) => item.checked);
}

function normalizeProjectChecklist({ projectChecklist = [], globalChecklist = [], checks = {} } = {}) {
  const source = Array.isArray(projectChecklist) && projectChecklist.length
    ? projectChecklist
    : globalChecklist;
  return (source || []).slice(0, 16).map((item, index) => {
    if (item && typeof item === 'object') {
      const id = stringOrEmpty(item.id) || `quality-${index + 1}`;
      return compactObject({
        id,
        title: trimText(item.title || item.description || id, 220),
        description: trimText(item.description, 360),
        checked: Boolean(checks?.[id]),
      });
    }
    const title = trimText(item, 220);
    const id = `quality-${index + 1}`;
    return compactObject({
      id,
      title,
      checked: Boolean(checks?.[id] || checks?.[title]),
    });
  }).filter((item) => item.title || item.id);
}

function normalizeRubric(rubric) {
  return rubric.map((item) => {
    if (typeof item === 'string') return trimText(item, 400);
    return trimText(item.label || item.title || item.text || item.id, 400);
  }).filter(Boolean).slice(0, 12);
}

function normalizeReference(reference) {
  if (!reference) return null;
  if (typeof reference === 'string') return { text: trimText(reference) };
  const sections = Array.isArray(reference.sections)
    ? reference.sections.slice(0, MAX_REFERENCE_SECTIONS).map((section) => compactObject({
        heading: trimText(section.heading, 180),
        body: trimText(section.body),
      }))
    : [];
  return compactObject({
    text: trimText(reference.text || reference.body),
    sections,
  });
}

function buildCaseDataSummary(payload = {}) {
  return compactObject({
    metrics: normalizeMetrics(payload.metrics),
    table: summarizeTable(payload.table),
    subtaskCount: Array.isArray(payload.subtasks) ? payload.subtasks.length : null,
  });
}

function normalizeMetrics(metrics) {
  if (!Array.isArray(metrics)) return [];
  return metrics.slice(0, 12).map((metric) => compactObject({
    label: trimText(metric.label, 180),
    value: trimText(metric.value, 180),
  })).filter((metric) => metric.label || metric.value);
}

function summarizeTable(table) {
  if (!table || typeof table !== 'object') return null;
  const columns = Array.isArray(table.columns)
    ? table.columns.map((column) => compactObject({
        key: stringOrEmpty(column.key),
        label: stringOrEmpty(column.label || column.key),
        numeric: !!column.numeric,
      })).filter((column) => column.key)
    : [];
  const rows = Array.isArray(table.rows)
    ? table.rows.slice(0, MAX_TABLE_ROWS).map((row) => {
        const out = {};
        for (const column of columns) out[column.key] = row?.[column.key];
        return out;
      })
    : [];
  return compactObject({
    columns,
    rowCount: Array.isArray(table.rows) ? table.rows.length : 0,
    sampleRows: rows,
  });
}

function buildSqlContext(sql = {}, payload = {}) {
  const subtask = sql.subtask || {};
  return compactObject({
    userSql: trimText(sql.userSql),
    referenceSql: trimText(sql.referenceSql || subtask.referenceSql),
    schema: normalizeSqlSchema(sql.schema),
    subtask: compactObject({
      id: stringOrEmpty(subtask.id),
      prompt: trimText(sql.prompt || subtask.prompt),
      orderSensitive: !!subtask.orderSensitive,
    }),
    autograderMessage: trimText(sql.autograderMessage),
    caseQuestion: trimText(payload.question),
  });
}

function buildSqlHintContext(sql = {}, payload = {}) {
  const subtask = sql.subtask || {};
  return compactObject({
    userSql: trimText(sql.userSql),
    schema: normalizeSqlSchema(sql.schema),
    subtask: compactObject({
      id: stringOrEmpty(subtask.id),
      prompt: trimText(sql.prompt || subtask.prompt),
      orderSensitive: !!subtask.orderSensitive,
    }),
    caseQuestion: trimText(payload.question),
  });
}

function normalizeSqlSchema(schema) {
  if (!schema) return null;
  if (typeof schema === 'string') return trimText(schema);
  if (Array.isArray(schema)) {
    return schema.slice(0, 20).map((table) => compactObject({
      name: stringOrEmpty(table.name || table.tableName),
      columns: normalizeSqlColumns(table.columns),
    })).filter((table) => table.name || table.columns?.length);
  }
  if (typeof schema === 'object') {
    const tables = Array.isArray(schema.tables)
      ? schema.tables
      : Object.entries(schema).map(([name, columns]) => ({ name, columns }));
    return tables.slice(0, 20).map((table) => compactObject({
      name: stringOrEmpty(table.name || table.tableName),
      columns: normalizeSqlColumns(table.columns),
    })).filter((table) => table.name || table.columns?.length);
  }
  return null;
}

function normalizeSqlColumns(columns) {
  if (!Array.isArray(columns)) return [];
  return columns.slice(0, 50).map((column) => {
    if (typeof column === 'string') return column;
    return stringOrEmpty(column.name || column.key || column.column);
  }).filter(Boolean);
}

function normalizeStudentArtifacts(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {
    reasoningSteps: normalizeStringList(value.reasoningSteps).map((item) => trimText(item, 600)),
    queryHistoryCount: Number.isFinite(value.queryHistoryCount) ? value.queryHistoryCount : null,
  };
  const optionalKeys = [
    'hypotheses',
    'prioritization',
    'dashboardChecks',
    'anomaly',
    'rca',
    'simulation',
    'process',
    'readiness',
  ];
  for (const key of optionalKeys) {
    const normalized = normalizeArtifactValue(value[key], 0);
    if (normalized !== null) out[key] = normalized;
  }
  return compactObject(out);
}

function normalizeArtifactValue(value, depth) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return trimText(value, 800);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 12)
      .map((item) => normalizeArtifactValue(item, depth + 1))
      .filter((item) => item !== null && item !== '');
  }
  if (typeof value === 'object' && depth < 3) {
    const out = {};
    for (const [key, nested] of Object.entries(value).slice(0, 30)) {
      if (!isSafeContextKey(key)) continue;
      const normalized = normalizeArtifactValue(nested, depth + 1);
      if (normalized !== null && normalized !== '') out[key] = normalized;
    }
    return compactObject(out);
  }
  return null;
}

function normalizeErrorContext(value) {
  if (!value || typeof value !== 'object') return null;
  return compactObject({
    message: trimText(value.message),
    source: stringOrEmpty(value.source),
    expected: trimText(value.expected),
    actual: trimText(value.actual),
  });
}

function normalizeWeakSpots(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => {
    if (typeof item === 'string') return { label: trimText(item, 180) };
    return compactObject({
      topicId: stringOrEmpty(item.topicId),
      caseId: stringOrEmpty(item.caseId),
      taskId: stringOrEmpty(item.taskId),
      label: trimText(item.label || item.title, 180),
      reason: trimText(item.reason, 400),
      score: Number.isFinite(item.score) ? item.score : null,
    });
  }).filter((item) => item.label || item.topicId || item.caseId || item.taskId);
}

function addDetail(details, label, value) {
  details.push({ label, value: String(value ?? '') });
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((item) => stringOrEmpty(item)).filter(Boolean));
}

function uniqueStrings(value) {
  return Array.from(new Set((value || []).map((item) => stringOrEmpty(item)).filter(Boolean)));
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function trimText(value, max = MAX_TEXT) {
  const text = redactSensitiveText(stringOrEmpty(value).replace(/\s+/g, ' ').trim());
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function compactObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const nested = compactObject(value);
      if (nested && Object.keys(nested).length > 0) out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function sanitizeContextValue(value, depth, seen) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return trimText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= MAX_CONTEXT_DEPTH) return [];
    return value
      .map((item) => sanitizeContextValue(item, depth + 1, seen))
      .filter((item) => item !== null && item !== undefined && item !== '');
  }
  if (typeof value === 'object') {
    if (depth >= MAX_CONTEXT_DEPTH || seen.has(value)) return null;
    seen.add(value);
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      if (!isSafeContextKey(key)) continue;
      const sanitized = sanitizeContextValue(nested, depth + 1, seen);
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

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [redacted-secret]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|authorization|password|passwd|secret|client[_-]?secret|private[_-]?key))\s*[:=]\s*["']?[^"'\s,;]{8,}/gi, '$1: [redacted-secret]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted-secret]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-secret]');
}

export function smokeTest() {
  const caseData = {
    caseId: 'detective-001',
    module: '5.1',
    title: 'Падение конверсии',
    payload: {
      scenario: 'Пользователи не доходят до оплаты.',
      question: 'Где сломалась воронка?',
      reference: { sections: [{ heading: 'Сбой', body: 'Переход к оплате сломался.' }] },
    },
  };
  const graph = {
    topicsByCaseId: new Map([['detective-001', [{
      id: 'funnels',
      title: 'Воронки',
      next: ['business-conclusions'],
      caseRefs: ['detective-001'],
      commonMistakes: ['Смотреть только на итоговую конверсию.'],
    }]]]),
  };

  const hint = buildMentorContext({ mode: 'hint', caseData, topicGraph: graph });
  const check = buildMentorContext({
    mode: 'reference_check',
    caseData,
    topicGraph: graph,
    studentAnswer: 'Сбой произошел после ввода адреса: пользователи не доходят до выбора оплаты.',
    referenceUnlocked: true,
  });
  const formative = buildMentorContext({
    mode: 'reference_check',
    caseData,
    topicGraph: graph,
    studentAnswer: 'Сбой произошел после ввода адреса: пользователи не доходят до выбора оплаты.',
  });
  const projectReview = buildProjectReviewContext({
    project: {
      id: 'python-eda',
      title: 'Python EDA',
      businessQuestion: 'Найти точки роста клиентов и продаж.',
      readmeStructure: ['Бизнес-проблема', 'Методология', 'Инсайты с цифрами'],
      qualityChecklist: ['Есть бизнес-вопрос', 'Есть рекомендации'],
    },
    progress: {
      status: 'review',
      githubUrl: 'https://github.com/example/project',
      readmeDraft: 'Проект отвечает на вопрос роста продаж: описаны данные, методология, 4 инсайта с цифрами и рекомендации для бизнеса.',
      qualityChecklist: { 'quality-1': true },
    },
  });
  const mockReview = buildMockInterviewReviewContext({
    mock: {
      title: 'Mock-интервью аналитика',
      sections: [{ id: 'sql-live', title: 'SQL live', format: '2 задачи вслух', skills: ['JOIN'] }],
      selfAssessmentRubric: ['Проговорил план до кода', 'Связал цифры с бизнесом'],
      commonFailures: ['Молчать и сразу писать код'],
    },
    run: {
      result: 'needs_repeat',
      durationMinutes: 60,
      sectionScores: { 'sql-live': 2 },
      sectionNotes: { 'sql-live': 'Начал писать код без проговаривания плана.' },
      rubricChecks: { 'rubric-2': true },
      mistakesNotes: 'В SQL live не уточнил задачу и не проговорил план до кода.',
      actionPlan: 'Повторить 3 SQL-задачи вслух и записать STAR-ответ по проекту.',
    },
  });
  const secretCheck = buildMentorContext({
    mode: 'hint',
    caseData,
    studentAnswer: 'apiKey=sk-1234567890abcdef1234567890abcdef проверить не нужно',
    studentArtifacts: {
      hypotheses: {
        apiKey: 'sk-1234567890abcdef1234567890abcdef',
        note: 'проверить падение на оплате',
      },
      reasoningSteps: ['Authorization: Bearer abcdefghijklmnop1234567890'],
    },
  });

  const ok = hint.context.mode === MENTOR_MODES.hint
    && !hint.context.reference
    && hint.preview.excluded.includes('полный эталон')
    && check.context.reference
    && check.preview.canShowScore === true
    && !formative.context.reference
    && formative.preview.canShowScore === false
    && projectReview.context.mode === MENTOR_MODES.readmeReview
    && projectReview.preview.canShowScore === true
    && projectReview.preview.excluded.includes('файлы GitHub не загружаются автоматически')
    && mockReview.context.mode === MENTOR_MODES.mockInterview
    && mockReview.preview.canShowScore === true
    && mockReview.preview.excluded.includes('полная запись интервью')
    && isSubstantialStudentAnswer(check.context.studentAnswer)
    && secretCheck.context.studentArtifacts?.hypotheses?.apiKey === undefined
    && secretCheck.context.studentArtifacts?.hypotheses?.note === 'проверить падение на оплате'
    && secretCheck.context.studentArtifacts?.reasoningSteps?.[0] === 'Authorization: Bearer [redacted-secret]'
    && secretCheck.context.studentAnswer.includes('[redacted-secret]');
  console[ok ? 'info' : 'error'](`[mentorContext.smokeTest] ${ok ? 'OK' : 'FAIL'}`);
  return ok;
}
