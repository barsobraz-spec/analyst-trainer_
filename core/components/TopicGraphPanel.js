// core/components/TopicGraphPanel.js — компактный UI связанных тем.

import { moduleButton, resolveTrainerModule } from '../learningLinks.js';
import { topicTitle } from '../topicGraph.js';

export function TopicGraphPanel({
  title = 'Что повторить',
  topics = [],
  graph,
  content,
  casesById = new Map(),
  maxTopics = 3,
  className = '',
  showEmpty = false,
  emptyText = 'Связанные темы пока не настроены.',
  errorText = 'Связи тем сейчас недоступны.',
} = {}) {
  if (graph?.error) {
    return showEmpty ? statePanel(title, errorText, className, 'is-error') : null;
  }

  const visibleTopics = (topics || []).filter(Boolean).slice(0, maxTopics);
  if (visibleTopics.length === 0) {
    return showEmpty ? statePanel(title, emptyText, className, 'is-empty') : null;
  }

  const panel = document.createElement('section');
  panel.className = ['topic-graph-panel', className].filter(Boolean).join(' ');
  panel.append(el('h2', 'topic-graph-panel__title', title));

  const list = document.createElement('div');
  list.className = 'topic-graph-panel__list';
  for (const topic of visibleTopics) {
    const card = topicCard(topic, { graph, content, casesById });
    if (card) list.append(card);
  }
  if (list.children.length === 0) {
    return showEmpty ? statePanel(title, emptyText, className, 'is-empty') : null;
  }
  panel.append(list);
  return panel;
}

function topicCard(topic, context) {
  const article = document.createElement('article');
  article.className = 'topic-graph-topic';
  article.append(el('h3', 'topic-graph-topic__title', topic.title || topic.id));
  const meta = topicMeta(topic, context.content);
  if (meta) article.append(meta);

  const groups = [
    linkGroup('Перед этим стоит повторить', topic.prerequisites, (id) => topicChip(id, context.graph)),
    linkGroup('Связанные практики', [
      ...taskLinks(topic.taskRefs, context.content),
      ...caseLinks(topic.caseRefs, context.casesById),
      ...moduleLinks(topic.moduleRefs),
      ...projectLinks(topic.projectRefs, context.content),
    ]),
    linkGroup('Следующий шаг', topic.next, (id) => topicChip(id, context.graph)),
  ];

  let visibleGroups = 0;
  for (const group of groups) {
    if (group) {
      visibleGroups++;
      article.append(group);
    }
  }

  const hasMistakes = topic.commonMistakes?.length > 0;
  if (topic.commonMistakes?.length > 0) {
    article.append(mistakes(topic.commonMistakes.slice(0, 2)));
  }

  return visibleGroups > 0 || hasMistakes ? article : null;
}

function topicMeta(topic, content) {
  const bits = [];
  const skillTitle = content?.skillsById?.get(topic.skill)?.title;
  if (skillTitle) bits.push(skillTitle);
  if (topic.month) bits.push(`месяц ${topic.month}`);
  if (bits.length === 0) return null;
  return el('p', 'topic-graph-topic__meta', bits.join(' · '));
}

function linkGroup(label, items, build = null) {
  const nodes = [];
  for (const item of items || []) {
    const node = build ? build(item) : item;
    if (node) nodes.push(node);
  }
  if (nodes.length === 0) return null;

  const group = document.createElement('div');
  group.className = 'topic-graph-group';
  group.append(el('h4', 'topic-graph-group__title', label));
  const links = document.createElement('div');
  links.className = 'topic-graph-links';
  for (const node of nodes.slice(0, 5)) links.append(node);
  group.append(links);
  return group;
}

function taskLinks(taskRefs = [], content) {
  const tasksById = new Map((content?.allTasks || []).map((task) => [task.id, task]));
  return taskRefs.map((taskId) => {
    const task = tasksById.get(taskId);
    if (!task) return null;
    return link(
      `#${task.number || task.id}: ${task.title}`,
      `#/learning/tasks?skill=${encodeURIComponent(task.skill)}&task=${encodeURIComponent(task.id)}`,
    );
  }).filter(Boolean);
}

function caseLinks(caseRefs = [], casesById) {
  return caseRefs.map((caseId) => {
    const item = casesById?.get(caseId);
    if (!item?.module) return null;
    return link(
      item.title || caseId,
      `#/module/${encodeURIComponent(item.module)}/case/${encodeURIComponent(caseId)}`,
    );
  }).filter(Boolean);
}

function moduleLinks(moduleRefs = []) {
  return moduleRefs.map((moduleId) => {
    const resolved = resolveTrainerModule(moduleId);
    if (!resolved.href) return null;
    return moduleButton(moduleId, 'Модуль');
  }).filter(Boolean);
}

function projectLinks(projectRefs = [], content) {
  const projectsById = content?.projectsById || new Map();
  return projectRefs.map((projectId) => {
    const project = projectsById.get(projectId);
    if (!project) return null;
    return link(project.title || projectId, `#/learning/projects?project=${encodeURIComponent(projectId)}`);
  }).filter(Boolean);
}

function topicChip(topicId, graph) {
  if (!graph?.topicsById?.has(topicId)) return null;
  const span = document.createElement('span');
  span.className = 'topic-graph-chip';
  span.textContent = topicTitle(graph, topicId);
  return span;
}

function mistakes(items = []) {
  const details = document.createElement('details');
  details.className = 'topic-graph-mistakes';
  const summary = document.createElement('summary');
  summary.textContent = 'Типичные ошибки';
  const ul = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  details.append(summary, ul);
  return details;
}

function link(label, href) {
  const a = document.createElement('a');
  a.className = 'topic-graph-link';
  a.href = href;
  a.textContent = label;
  return a;
}

function statePanel(title, message, className, stateClass) {
  const panel = document.createElement('section');
  panel.className = ['topic-graph-panel', className, stateClass].filter(Boolean).join(' ');
  panel.append(
    el('h2', 'topic-graph-panel__title', title),
    el('p', 'topic-graph-topic__meta', message),
  );
  return panel;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
