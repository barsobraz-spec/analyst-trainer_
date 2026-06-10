// core/i18n.js — минимальный слой интернационализации.
//
// Архитектура:
//   • словари хранятся в памяти: Map<locale, Record<key, string>>
//   • дефолтная локаль — 'ru' (зарегистрирована здесь же)
//   • t(key, vars?) возвращает строку; если ключ не найден — возвращает
//     сам ключ и пишет console.warn (обнаруживает «потерянные» ключи)
//   • переменные интерполируются через {{varName}} в шаблоне
//
// Как добавить язык — см. docs/extension-guide.md.
//
// ES-модуль: `import { t, setLocale, getLocale } from './core/i18n.js'`.

import { RU } from '../locales/ru.js';

const _dicts = new Map();
let _locale = 'ru';

// Регистрируем русский как дефолт сразу при импорте модуля.
_dicts.set('ru', RU);

// Зарегистрировать словарь для указанной локали.
// Вызывается из файла локали: registerLocale('en', EN).
export function registerLocale(lang, dict) {
  _dicts.set(lang, Object.assign({}, _dicts.get(lang) ?? {}, dict));
}

// Переключить активную локаль. Строки для нового языка должны быть
// зарегистрированы заранее через registerLocale.
export function setLocale(lang) {
  if (!_dicts.has(lang)) {
    console.warn(`[i18n] locale "${lang}" not registered — staying on "${_locale}"`);
    return;
  }
  _locale = lang;
}

export function getLocale() {
  return _locale;
}

// Перевести ключ с опциональной подстановкой переменных.
//
// Пример: t('sa.hintsCtx', { used: 2, total: 3 })
//         → 'Вы открыли 2 из 3 подсказок — учтите это при оценке.'
//
// Если ключ отсутствует в словаре — возвращает сам ключ и пишет предупреждение
// (помогает обнаружить пропущенные переводы при разработке).
export function t(key, vars = {}) {
  const dict = _dicts.get(_locale) ?? {};
  const template = dict[key];
  if (template === undefined) {
    console.warn(`[i18n] missing key "${key}" for locale "${_locale}"`);
    return key;
  }
  if (!template.includes('{{')) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const val = vars[k];
    return val !== undefined ? String(val) : `{{${k}}}`;
  });
}
