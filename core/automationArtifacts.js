// core/automationArtifacts.js — генерация артефактов автоматизации (T8.2.2).
//
// PRD §5.7 Ф4: из построенной схемы процесса формируются два готовых артефакта —
// текстовое описание процесса (по одному абзацу на шаг) и чек-лист внедрения
// (markdown). Чистые функции без DOM и без обращения к хранилищу: принимают схему
// `{ nodes: [...] }`, возвращают строку. Это единая точка истины по тому, как схема
// превращается в человекочитаемый результат, — её используют экран кейса 5.7 и
// (потенциально) экспорт.
//
// Здесь же — единый словарь подписей типов узлов (NODE_TYPE_LABELS) и их порядок
// (NODE_TYPE_ORDER). Конструктор процесса (modules/automation/ProcessBuilder.js)
// импортирует их отсюда, чтобы названия типов нигде не расходились. `core/` не
// зависит от `modules/`, поэтому словарь живёт в слое ядра.
//
// ES-модуль: `import { generateProcessDescription, generateImplementationChecklist,
//             NODE_TYPE_LABELS, NODE_TYPE_ORDER } from './core/automationArtifacts.js'`.

// Типы узлов схемы (PRD §5.7 Ф1): триггер → действия/условия → итог. Порядок —
// порядок появления кнопок добавления и сортировки в эталонных схемах.
export const NODE_TYPE_ORDER = ['trigger', 'action', 'condition', 'outcome'];

export const NODE_TYPE_LABELS = Object.freeze({
  trigger: 'Триггер',
  action: 'Действие',
  condition: 'Условие',
  outcome: 'Итог',
});

// Достаёт массив узлов из схемы в любом из допустимых видов: `{ nodes:[...] }`
// или просто массив. Возвращает только объекты-узлы (мусор отсекаем).
function normalizeNodes(schema) {
  const raw = Array.isArray(schema) ? schema : Array.isArray(schema?.nodes) ? schema.nodes : [];
  return raw.filter((n) => n && typeof n === 'object');
}

function labelFor(type) {
  return NODE_TYPE_LABELS[type] || 'Шаг';
}

// Безопасно приводит поле узла к обрезанной строке (узлы приходят и из черновика,
// и из эталона — поля могут отсутствовать).
function field(node, name) {
  const v = node && node[name];
  return typeof v === 'string' ? v.trim() : '';
}

// --- Ф4: текстовое описание процесса (plaintext) -----------------------------
// Один абзац на шаг: «N. <Тип>: <что происходит>. Вход: … Выход: … Исполнитель: …».
// Пустые поля опускаются, чтобы описание читалось естественно.
export function generateProcessDescription(schema) {
  const nodes = normalizeNodes(schema);
  if (nodes.length === 0) {
    return 'Схема процесса пока пуста — добавьте триггер, шаги и итог.';
  }

  return nodes
    .map((node, i) => {
      const title = field(node, 'title');
      const parts = [`${i + 1}. ${labelFor(node.type)}${title ? `: ${title}` : ''}.`];
      const input = field(node, 'input');
      const output = field(node, 'output');
      const actor = field(node, 'actor');
      if (input) parts.push(`Вход: ${input}.`);
      if (output) parts.push(`Выход: ${output}.`);
      if (actor) parts.push(`Исполнитель: ${actor}.`);
      return parts.join(' ');
    })
    .join('\n\n');
}

// --- Ф4: чек-лист внедрения (markdown) ---------------------------------------
// Markdown-список задач внедрения: по пункту на шаг схемы (с вложенными
// вход/выход/исполнитель) плюс типовые завершающие пункты (исключения, метрики,
// согласование и тест). Готов к копированию в задачник.
export function generateImplementationChecklist(schema) {
  const nodes = normalizeNodes(schema);
  const lines = ['# Чек-лист внедрения автоматизации', ''];

  if (nodes.length === 0) {
    lines.push('- [ ] Спроектировать схему процесса (триггер, шаги, итог)');
  } else {
    for (const node of nodes) {
      const title = field(node, 'title') || '(шаг без названия)';
      lines.push(`- [ ] ${labelFor(node.type)}: ${title}`);
      const input = field(node, 'input');
      const output = field(node, 'output');
      const actor = field(node, 'actor');
      if (input) lines.push(`  - Вход: ${input}`);
      if (output) lines.push(`  - Выход: ${output}`);
      if (actor) lines.push(`  - Исполнитель: ${actor}`);
    }
  }

  lines.push(
    '',
    '- [ ] Проверить обработку исключений и граничных случаев',
    '- [ ] Определить метрики и мониторинг измеримого результата',
    '- [ ] Согласовать процесс с владельцами и протестировать на реальных данных',
  );

  return lines.join('\n');
}

// --- Smoke-check для консоли (?smoke=automation, см. main.js) -----------------
// Проверяет, что описание и чек-лист собираются из схемы, корректно опускают
// пустые поля и обрабатывают пустую схему.
export function smokeTest() {
  const checks = [];
  const expect = (name, cond) => checks.push({ name, ok: !!cond });

  const schema = {
    nodes: [
      { type: 'trigger', title: 'Поступила заявка', input: '', output: 'Заявка', actor: 'Форма на сайте' },
      { type: 'action', title: 'Классификация', input: 'Заявка', output: 'Категория', actor: 'Правила маршрутизации' },
      { type: 'outcome', title: 'Заявка направлена в отдел', input: 'Категория', output: 'Время реакции < 1 ч', actor: '' },
    ],
  };

  const desc = generateProcessDescription(schema);
  expect('desc-paragraphs', desc.split(/\n\s*\n/).length === 3);
  expect('desc-trigger', desc.includes('1. Триггер: Поступила заявка.'));
  expect('desc-omits-empty-input', !desc.includes('Вход: .'));
  expect('desc-actor', desc.includes('Исполнитель: Форма на сайте.'));

  const md = generateImplementationChecklist(schema);
  expect('md-heading', md.startsWith('# Чек-лист внедрения автоматизации'));
  expect('md-step', md.includes('- [ ] Действие: Классификация'));
  expect('md-nested', md.includes('  - Вход: Заявка'));
  expect('md-tail', md.includes('- [ ] Определить метрики и мониторинг измеримого результата'));

  expect('empty-desc', generateProcessDescription({ nodes: [] }).includes('пуста'));
  expect('empty-md', generateImplementationChecklist({}).includes('Спроектировать схему процесса'));

  const failed = checks.filter((c) => !c.ok);
  const ok = failed.length === 0;
  console[ok ? 'info' : 'error'](
    `[automationArtifacts.smokeTest] ${ok ? 'OK — артефакты формируются' : 'FAIL'}`,
    ok ? checks.length : failed,
  );
  return ok;
}
