// core/router.js — клиентский hash-роутер (T0.4.1).
//
// Реализует навигацию без перезагрузки страницы (PRD §4, «Навигация»). Почему
// hash, а не History API: приложение запускается со статического файлового
// сервера (python -m http.server) без серверного рантайма — при History API
// прямое открытие/обновление по пути `/module/5.1` вернуло бы 404. Hash-роуты
// (`#/module/5.1`) полностью клиентские и работают на любом статик-сервере.
//
// Поддержка «Назад»/«Вперёд» — бесплатно: смена хеша пишется в history,
// событие `hashchange` перерисовывает экран.
//
// ES-модуль: `import { defineRoutes, startRouter, navigate } from './core/router.js'`.

// --- Реестр роутов -----------------------------------------------------------
// Каждый роут — { path, parts, component }. `path` вида '/module/:id/case/:caseId';
// `component(params)` возвращает DOM-узел или view-контроллер, синхронно или Promise.

const routes = [];
let rootEl = null;

// Токен последней перерисовки: защищает от гонок, когда хеш сменился, пока
// предыдущий async-компонент ещё резолвится (показываем только актуальный экран).
let renderToken = 0;

// Контроллер активного экрана, если компонент вернул { element, destroy }.
// Это единственная точка жизненного цикла: перед заменой экрана роутер вызывает
// destroy() предыдущего, чтобы тот освободил ресурсы (таймеры, Web Worker'ы,
// инстансы графиков), которые иначе «висят» на отцепленном DOM (см. T1.6 NB).
let currentView = null;

export function defineRoutes(defs) {
  for (const def of defs) {
    routes.push({
      path: def.path,
      parts: def.path.split('/').filter(Boolean),
      component: def.component,
    });
  }
}

// --- Сопоставление текущего хеша с роутом ------------------------------------

// Текущий путь без префикса '#'. Пустой хеш трактуется как корень '/'.
function currentPath() {
  const hash = location.hash.replace(/^#/, '');
  const path = hash.split('?')[0];
  return path === '' ? '/' : path;
}

// Возвращает { route, params } или null. Сегменты сравниваются по длине и
// позиционно; `:name` захватывает значение сегмента (с decodeURIComponent).
function matchRoute(path) {
  const segments = path.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.parts.length !== segments.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < route.parts.length; i++) {
      const part = route.parts[i];
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[i]);
      } else if (part !== segments[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

// --- Перерисовка экрана ------------------------------------------------------

async function render() {
  if (!rootEl) return;
  const path = currentPath();
  const match = matchRoute(path);
  const token = ++renderToken;

  let result;
  try {
    result = match
      ? await Promise.resolve(match.route.component(match.params))
      : notFoundScreen(path);
  } catch (err) {
    console.error('[router] ошибка рендера экрана:', path, err);
    result = errorScreen(err);
  }

  // Пока ждали async-компонент, пользователь мог уйти на другой роут. Этот экран
  // уже не покажем — но если он успел захватить ресурсы (Web Worker, таймеры),
  // освобождаем их сразу, чтобы они не «утекли» вместе с невидимым узлом.
  if (token !== renderToken) {
    disposeView(result);
    return;
  }

  // Сворачиваем предыдущий экран (его таймеры/воркер/графики) перед заменой.
  disposeView(currentView);
  currentView = isView(result) ? result : null;

  const node = isView(result) ? result.element : result;
  rootEl.replaceChildren(node instanceof Node ? node : document.createTextNode(String(node)));
}

// Компонент может вернуть либо DOM-узел/строку, либо контроллер
// { element, destroy } — последний даёт роутеру шанс на unmount.
function isView(x) {
  return !!x && typeof x === 'object' && 'element' in x && typeof x.destroy === 'function';
}

function disposeView(view) {
  if (!isView(view)) return;
  try {
    view.destroy();
  } catch (err) {
    console.error('[router] ошибка очистки экрана:', err);
  }
}

// --- Запуск (T0.4.1: hashchange + старт при готовности DOM) -------------------

export function startRouter({ mount = '#app' } = {}) {
  const begin = () => {
    rootEl = document.querySelector(mount);
    if (!rootEl) {
      console.error(`[router] точка монтирования «${mount}» не найдена`);
      return;
    }
    window.addEventListener('hashchange', render);
    render(); // первичная отрисовка текущего роута
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', begin, { once: true });
  } else {
    begin();
  }
}

// Программная навигация. Принимает '/analytics' или '#/analytics'. Если хеш уже
// равен целевому, перерисовываем вручную (события hashchange не будет).
export function navigate(path) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (location.hash === target) render();
  else location.hash = target;
}

// --- Встроенные служебные экраны ---------------------------------------------

function notFoundScreen(path) {
  const wrap = document.createElement('section');
  const h1 = document.createElement('h1');
  h1.textContent = 'Экран не найден';
  const p = document.createElement('p');
  p.textContent = `Маршрут «${path}» не существует.`;
  const back = document.createElement('a');
  back.href = '#/modules';
  back.textContent = '← К каталогу';
  wrap.append(h1, p, back);
  return wrap;
}

function errorScreen(err) {
  const wrap = document.createElement('section');
  const h1 = document.createElement('h1');
  h1.textContent = 'Не удалось открыть экран';
  const p = document.createElement('p');
  p.textContent = err?.message || String(err);
  wrap.append(h1, p);
  return wrap;
}
