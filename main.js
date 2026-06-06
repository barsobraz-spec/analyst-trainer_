// main.js — bootstrap приложения (T0.1–T0.4).
// Поднимает конфиг, запускает роутер и инициализирует хранилище.

import { CONFIG } from './config.js';
import { openDB, smokeTest } from './core/db.js';
import { smokeTest as smokeCases } from './core/caseLoader.js';
import { smokeTest as smokeEvent } from './core/event.js';
import { smokeTest as smokeBackup } from './core/backup.js';
import { smokeTest as smokeSim } from './core/simulationEngine.js';
import { smokeTest as smokeAutomation } from './core/automationArtifacts.js';
import { smokeTest as smokeAnalytics } from './core/analytics.js';
import { smokeTest as smokeLearningProgress } from './core/learningProgress.js';
import { defineRoutes, startRouter } from './core/router.js';
import { HomeDashboard } from './modules/home/HomeDashboard.js';
import { ModuleCatalog } from './modules/catalog/ModuleCatalog.js';
import { CaseList } from './modules/catalog/CaseList.js';
import { CaseHost } from './modules/caseHost.js';
import { AnalyticsView } from './modules/analytics/AnalyticsView.js';
import { FavoritesView } from './modules/favorites/FavoritesView.js';
import { HistoryView } from './modules/history/HistoryView.js';
import { SkillView } from './modules/skills/SkillView.js';
import { PracticeView } from './modules/practice/PracticeView.js';
import { ResourcesView } from './modules/resources/ResourcesView.js';
import { SettingsView } from './modules/settings/SettingsView.js';
import { AboutView } from './modules/about/AboutView.js';
import { LearningTodayView } from './modules/learning/TodayView.js';
import { LearningPlanView } from './modules/learning/PlanView.js';
import { LearningTasksView } from './modules/learning/TasksView.js?v=practice-content-2';
import { LearningProjectsView } from './modules/learning/ProjectsView.js';
import { LearningCareerView } from './modules/learning/CareerView.js';
import { LearningMockInterviewView } from './modules/learning/MockInterviewView.js';
import { DataControls } from './core/components/DataControls.js';
import { ThemeToggle, applyStoredTheme } from './core/theme.js';
import { installNavigation } from './core/components/Sidebar.js';

// Сигнал в консоль, что фундамент поднялся. Не ошибка — обычный лог.
console.info('[Analyst Trainer] каркас загружен. Конфиг:', CONFIG);

// Роутер (T0.4) запускаем сразу и НЕзависимо от хранилища: экраны должны
// открываться, даже если IndexedDB временно недоступен. Карта роутов — PRD §4.
defineRoutes([
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
]);
startRouter();

// Навигатор курса (сайдбар + нижняя навигация). Заполняет каркас оболочки и создаёт
// слоты #data-controls / #theme-slot в подвале сайдбара — поэтому монтируем его ДО
// монтирования экспорта/импорта и темы ниже. Сам навигатор не зависит от хранилища
// (структуру курса читает из манифеста, прогресс — по готовности БД).
installNavigation();

// Экспорт/импорт прогресса (T2.1) — постоянная точка входа в подвале сайдбара.
// Монтируем независимо от хранилища: сами операции откроют БД по требованию.
const dataSlot = document.getElementById('data-controls');
if (dataSlot) dataSlot.append(DataControls());

// Переключатель темы (T10.3). Тему уже применил инлайн-скрипт в <head>; здесь
// подстраховываемся applyStoredTheme (если скрипт не отработал) и вешаем кнопку.
applyStoredTheme();
const themeSlot = document.getElementById('theme-slot');
if (themeSlot) themeSlot.append(ThemeToggle());

// Инициализируем хранилище прогресса (создаст БД и применит миграции при первом запуске).
openDB()
  .then(() => {
    console.info('[Analyst Trainer] хранилище IndexedDB готово.');
    // Ручные smoke-check'и: открыть страницу с ?smoke=db или ?smoke=cases
    const smoke = new URLSearchParams(location.search).get('smoke');
    if (smoke === 'db') return smokeTest();
    if (smoke === 'cases') return smokeCases();
    if (smoke === 'event') return smokeEvent();
    if (smoke === 'backup') return smokeBackup();
    if (smoke === 'sim') return smokeSim();
    if (smoke === 'automation') return smokeAutomation();
    if (smoke === 'analytics') return smokeAnalytics();
    if (smoke === 'learning-progress') return smokeLearningProgress();
  })
  .catch((err) => {
    // StorageError несёт понятное сообщение и признак offerRawBackup (PRD §4).
    console.error('[Analyst Trainer] ошибка хранилища:', err.code || err.name, err.message, err);
  });
