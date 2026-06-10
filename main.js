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
import { APP_ROUTES } from './core/appRoutes.js?v=topic-tasks-1';
import { defineRoutes, startRouter } from './core/router.js';
import { applyStoredTheme } from './core/theme.js';
import { installNavigation } from './core/components/Sidebar.js';

// Сигнал в консоль, что фундамент поднялся. Не ошибка — обычный лог.
console.info('[Analyst Trainer] каркас загружен. Конфиг:', CONFIG);

// Роутер (T0.4) запускаем сразу и независимо от хранилища: экраны должны
// открываться, даже если IndexedDB временно недоступен.
defineRoutes(APP_ROUTES);
startRouter();

// Навигатор курса (сайдбар + нижняя навигация). Сам навигатор не зависит от
// хранилища: структуру читает из core/navigation.js, прогресс — по готовности БД.
installNavigation();

// Тему уже применил инлайн-скрипт в <head>; здесь подстраховываемся, если скрипт
// не отработал. Переключатель и импорт/экспорт живут в разделе «Настройки».
applyStoredTheme();

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
