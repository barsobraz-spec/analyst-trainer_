// core/appRoutes.js — карта экранов приложения.
//
// Bootstrap только запускает роутер, а этот модуль отвечает за состав маршрутов.

import { HomeDashboard } from '../modules/home/HomeDashboard.js';
import { ModuleCatalog } from '../modules/catalog/ModuleCatalog.js';
import { CaseList } from '../modules/catalog/CaseList.js';
import { CaseHost } from '../modules/caseHost.js';
import { AnalyticsView } from '../modules/analytics/AnalyticsView.js';
import { FavoritesView } from '../modules/favorites/FavoritesView.js';
import { HistoryView } from '../modules/history/HistoryView.js';
import { SkillView } from '../modules/skills/SkillView.js';
import { PracticeView } from '../modules/practice/PracticeView.js';
import { ResourcesView } from '../modules/resources/ResourcesView.js';
import { SettingsView } from '../modules/settings/SettingsView.js?v=v1.9';
import { AboutView } from '../modules/about/AboutView.js';
import { LearningTodayView } from '../modules/learning/TodayView.js';
import { LearningPlanView } from '../modules/learning/PlanView.js?v=v1.9';
// Cache-bust version — менять через scripts/bump-cache-version.sh (источник: config.js APP_CACHE_VERSION)
import { LearningTasksView } from '../modules/learning/TasksView.js?v=v1.9';
import { LearningProjectsView } from '../modules/learning/ProjectsView.js';
import { LearningCareerView } from '../modules/learning/CareerView.js';
import { LearningMockInterviewView } from '../modules/learning/MockInterviewView.js';

export const APP_ROUTES = [
  { path: '/', component: HomeDashboard },
  { path: '/modules', component: ModuleCatalog },
  { path: '/module/:id', component: CaseList },
  { path: '/module/:id/case/:caseId', component: CaseHost },
  { path: '/analytics', component: AnalyticsView },
  { path: '/practice', component: PracticeView },
  { path: '/favorites', component: FavoritesView },
  { path: '/history', component: HistoryView },
  { path: '/skill/:id', component: SkillView },
  { path: '/resources', component: ResourcesView },
  { path: '/settings', component: SettingsView },
  { path: '/about', component: AboutView },
  { path: '/learning/today', component: LearningTodayView },
  { path: '/learning/plan', component: LearningPlanView },
  { path: '/learning/tasks', component: LearningTasksView },
  { path: '/learning/projects', component: LearningProjectsView },
  { path: '/learning/career', component: LearningCareerView },
  { path: '/learning/mock-interview', component: LearningMockInterviewView },
];
