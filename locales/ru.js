// locales/ru.js — русскоязычный словарь (язык по умолчанию).
//
// Чистый модуль данных: только экспорт объекта, никаких импортов.
// Ключи — точечная нотация, значения — строки с опциональными
// интерполируемыми переменными в виде {{varName}}.
//
// Подключается автоматически через core/i18n.js (зарегистрирован как
// дефолтная локаль «ru»). Добавление нового языка — см. docs/extension-guide.md.

export const RU = {

  // ----- SelfAssessment (core/components/SelfAssessment.js) -----
  'sa.title':       'Самооценка',
  'sa.hintsCtx':    'Вы открыли {{used}} из {{total}} подсказок — учтите это при оценке.',
  'sa.total':       'Итоговый балл: {{score}} / 100',
  'sa.submit':      'Завершить попытку',
  'sa.saving':      'Записываем результат…',
  'sa.saved':       'Попытка записана. Итоговый балл: {{score}} / 100.',
  'sa.error':       'Не удалось сохранить результат. Проверьте хранилище и попробуйте ещё раз.',

  // ----- CaseHost (modules/caseHost.js) -----
  'caseHost.notFound':     'Кейс не найден',
  'caseHost.loadFailed':   'Кейс не загружен',
  'caseHost.inDev':        'Модуль в разработке',
  'caseHost.checkRef':     'Сверить с эталоном',
  'caseHost.returnList':   'Вернуться к списку',

  // ----- DataControls (core/components/DataControls.js) -----
  'dc.export':         'Экспорт',
  'dc.import':         'Импорт',
  'dc.confirmReplace': 'Импорт заменит весь текущий прогресс',
  'dc.replace':        'Заменить',
  'dc.cancel':         'Отмена',
  'dc.exportOk':       'Экспорт выполнен.',
  'dc.importOk':       'Импорт выполнен. Записей: {{count}}.',
  'dc.importErr':      'Ошибка импорта: {{msg}}',

  // ----- Общие UI-строки -----
  'common.loading':    'Загрузка…',
  'common.notFound':   'Экран не найден',
  'common.error':      'Произошла ошибка',
  'common.back':       'Назад',
  'common.save':       'Сохранить',
  'common.close':      'Закрыть',
  'common.attempt':    'Попытка №{{n}}',
};
