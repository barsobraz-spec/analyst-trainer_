// modules/learning/ReadinessLevelPanel.js — визуальный индикатор уровня готовности (T7.3).

import {
  getAllCareerApplications,
  getAllMonthlyExamProgress,
  getAllProjectProgress,
  getAllTaskProgress,
} from '../../core/db.js';
import { calculateReadinessLevel } from '../../core/learningProgress.js';
import { card, progressBar, text } from './learningUi.js';

const LEVEL_LABELS = Object.freeze({
  novice: 'Новичок',
  junior_ready: 'Junior Ready',
  interview_ready: 'Interview Ready',
  job_search_mode: 'Job Search Mode',
});

export async function ReadinessLevelPanel(content) {
  const [taskProgress, projectProgress, monthlyExamProgress, careerApplications] = await Promise.all([
    getAllTaskProgress().catch(() => []),
    getAllProjectProgress().catch(() => []),
    getAllMonthlyExamProgress().catch(() => []),
    getAllCareerApplications().catch(() => []),
  ]);

  const snapshot = calculateReadinessLevel({
    tasks: content.allTasks,
    taskProgress,
    projects: content.projects.projects || [],
    projectProgress,
    globalQualityChecklist: content.projects.globalQualityChecklist || [],
    months: content.plan.months || [],
    monthlyExamProgress,
    careerApplications,
  });

  const box = card('learning-level');
  box.dataset.level = snapshot.level.id;
  const head = document.createElement('div');
  head.className = 'learning-level__head';
  head.append(
    text('span', 'learning-month__badge', 'Уровень готовности'),
    text('h2', 'learning-card__title', LEVEL_LABELS[snapshot.level.id] || snapshot.level.title),
    text('p', 'learning-muted', snapshot.level.description),
  );

  const score = document.createElement('div');
  score.className = 'learning-level__score';
  score.append(text('strong', '', `${snapshot.percent}%`));
  if (snapshot.nextLevel) {
    score.append(text('span', 'learning-muted', `До ${LEVEL_LABELS[snapshot.nextLevel.id] || snapshot.nextLevel.title}: ${Math.max(0, snapshot.nextLevel.minPercent - snapshot.percent)}%`));
  } else {
    score.append(text('span', 'learning-muted', 'Максимальный уровень'));
  }

  const components = document.createElement('div');
  components.className = 'learning-level__components';
  for (const item of snapshot.components) {
    const row = document.createElement('section');
    row.className = 'learning-level__component';
    row.append(
      text('h3', 'learning-subtitle', `${item.title} · ${Math.round(item.weight * 100)}%`),
      progressBar(item.progress, `${item.progress.percent}%`),
    );
    components.append(row);
  }

  box.append(head, score, components);
  return box;
}
