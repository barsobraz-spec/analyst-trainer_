// main.js — bootstrap приложения (T0.1–T0.4).
// Поднимает конфиг, запускает роутер и инициализирует хранилище.

import { CONFIG } from './config.js';
import { openDB } from './core/db.js';
// Cache-bust version — менять через scripts/bump-cache-version.sh (источник: config.js APP_CACHE_VERSION)
import { APP_ROUTES } from './core/appRoutes.js?v=v1.6';
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
  .then(async () => {
    console.info('[Analyst Trainer] хранилище IndexedDB готово.');
    // Ручные smoke-check'и: открыть страницу с ?smoke=db или ?smoke=cases
    const smoke = new URLSearchParams(location.search).get('smoke');
    if (smoke) {
      const SMOKE_MODULES = {
        'db':               './core/db.js',
        'cases':            './core/caseLoader.js',
        'event':            './core/event.js',
        'backup':           './core/backup.js',
        'sim':              './core/simulationEngine.js',
        'automation':       './core/automationArtifacts.js',
        'analytics':        './core/analytics.js',
        'learning-progress':'./core/learningProgress.js',
        'topic-graph':      './core/topicGraph.js',
        'dom':              './core/dom.js',
      };
      const path = SMOKE_MODULES[smoke];
      if (!path) { console.warn('[smoke] неизвестный режим:', smoke); return; }
      const { smokeTest } = await import(path);
      return smokeTest();
    }
  })
  .catch((err) => {
    // StorageError несёт понятное сообщение и признак offerRawBackup (PRD §4).
    console.error('[Analyst Trainer] ошибка хранилища:', err.code || err.name, err.message, err);
  });
