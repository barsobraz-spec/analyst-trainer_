// core/topicGraph.js — загрузка и нормализация графа учебных тем.

import { APP_CACHE_VERSION } from '../config.js';

export const TOPIC_GRAPH_PATH = './learning-plan/data/topicGraph.json';

let graphPromise = null;

function withVersion(path) {
  return `${path}${path.includes('?') ? '&' : '?'}v=${APP_CACHE_VERSION}`;
}

export function emptyTopicGraph(error = null) {
  return normalizeTopicGraph({ schemaVersion: 1, topics: [] }, error);
}

export function loadTopicGraph() {
  if (graphPromise) return graphPromise;
  graphPromise = fetch(withVersion(TOPIC_GRAPH_PATH))
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((raw) => normalizeTopicGraph(raw))
    .catch((err) => {
      console.warn('[topicGraph] граф тем недоступен, связи скрыты:', err.message || err);
      graphPromise = null;
      return emptyTopicGraph(err);
    });
  return graphPromise;
}

export function normalizeTopicGraph(raw = {}, error = null) {
  const topics = (Array.isArray(raw.topics) ? raw.topics : [])
    .map(normalizeTopic)
    .filter((topic) => topic.id);
  const topicsById = new Map();
  const topicsBySkill = new Map();
  const topicsByTaskId = new Map();
  const topicsByCaseId = new Map();

  for (const topic of topics) {
    topicsById.set(topic.id, topic);
    addToMap(topicsBySkill, topic.skill, topic);
    for (const taskId of topic.taskRefs) addToMap(topicsByTaskId, taskId, topic);
    for (const caseId of topic.caseRefs) addToMap(topicsByCaseId, caseId, topic);
  }

  return {
    schemaVersion: Number(raw.schemaVersion) || 1,
    title: raw.title || '',
    description: raw.description || '',
    topics,
    topicsById,
    topicsBySkill,
    topicsByTaskId,
    topicsByCaseId,
    error,
  };
}

export function topicsForSkill(graph, skillId, limit = Infinity) {
  return uniqueTopics(graph?.topicsBySkill?.get(skillId)).slice(0, limit);
}

export function topicsForTask(graph, taskId, limit = Infinity) {
  return uniqueTopics(graph?.topicsByTaskId?.get(taskId)).slice(0, limit);
}

export function topicsForCase(graph, caseId, limit = Infinity) {
  return uniqueTopics(graph?.topicsByCaseId?.get(caseId)).slice(0, limit);
}

export function topicTitle(graph, topicId) {
  return graph?.topicsById?.get(topicId)?.title || topicId;
}

function normalizeTopic(topic = {}) {
  return {
    ...topic,
    id: stringOrEmpty(topic.id),
    title: stringOrEmpty(topic.title || topic.id),
    skill: stringOrEmpty(topic.skill),
    month: Number.isInteger(topic.month) ? topic.month : null,
    prerequisites: normalizeStringList(topic.prerequisites),
    next: normalizeStringList(topic.next),
    related: normalizeStringList(topic.related),
    taskRefs: normalizeStringList(topic.taskRefs),
    caseRefs: normalizeStringList(topic.caseRefs),
    moduleRefs: normalizeStringList(topic.moduleRefs),
    projectRefs: normalizeStringList(topic.projectRefs),
    commonMistakes: normalizeStringList(topic.commonMistakes),
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => stringOrEmpty(item)).filter(Boolean)));
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function addToMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function uniqueTopics(topics = []) {
  const seen = new Set();
  const result = [];
  for (const topic of topics || []) {
    if (!topic?.id || seen.has(topic.id)) continue;
    seen.add(topic.id);
    result.push(topic);
  }
  return result;
}

export function smokeTest() {
  const graph = normalizeTopicGraph({
    schemaVersion: 1,
    topics: [{
      id: 'sql-select',
      title: 'SQL SELECT',
      skill: 'sql',
      taskRefs: ['task-016'],
      caseRefs: ['sql-001'],
    }],
  });
  const ok = topicsForSkill(graph, 'sql')[0]?.id === 'sql-select'
    && topicsForTask(graph, 'task-016')[0]?.id === 'sql-select'
    && topicsForCase(graph, 'sql-001')[0]?.id === 'sql-select';
  console[ok ? 'info' : 'error'](`[topicGraph.smokeTest] ${ok ? 'OK' : 'FAIL'}`);
  return ok;
}
