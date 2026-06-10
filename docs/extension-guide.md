# Руководство по расширению: язык / тип контента / проверяющий

Документ описывает три точки расширения Analyst Trainer. Каждая не требует правок
роутера, хоста кейсов или валидатора — только добавление новых файлов и одной-двух
строк регистрации.

---

## 1. Как добавить язык (i18n)

**Инфраструктура:** `core/i18n.js` + `locales/ru.js`.  
**Функция:** `t(key, vars?)` — перевод с интерполяцией переменных `{{varName}}`.

### Шаги

1. Создать файл `locales/<lang>.js` (например, `locales/en.js`):

```js
// locales/en.js — pure data, no imports
export const EN = {
  'sa.title':   'Self-assessment',
  'sa.submit':  'Finish attempt',
  'sa.saving':  'Saving result…',
  // ... all keys from locales/ru.js
};
```

2. В точке входа приложения (`main.js`) импортировать и зарегистрировать:

```js
import { EN } from './locales/en.js';
import { registerLocale, setLocale } from './core/i18n.js';

registerLocale('en', EN);
setLocale('en'); // переключает язык UI
```

3. Переключатель языка (UI) вызывает `setLocale(lang)` из `core/i18n.js`.

### Контракт словаря

- Каждый ключ из `locales/ru.js` должен присутствовать в новом словаре.
- Значения могут содержать `{{varName}}` — те же переменные, что в русском.
- Перевод не затрагивает контент кейсов (поля `payload`) и прогресс пользователя.

### Диагностика отсутствующих ключей

Если компонент вызывает `t('missing.key')` и ключа нет в словаре, `i18n.js`
пишет `console.warn('[i18n] missing key ...')` и возвращает сам ключ как fallback.
При разработке смотрите консоль после переключения языка.

---

## 2. Как добавить тип контента (новый модуль)

**Реестр:** `core/modules.js`.  
**Диспетчер:** `modules/caseHost.js`.

### Контракт типа контента

```js
// Запись в MODULES (core/modules.js)
{
  id:          string,       // уникальный, формат '5.N' или произвольный
  title:       string,       // отображаемое название
  description: string,       // краткое описание для каталога
  skillGroup:  string|null,  // 'analytical' | 'practical' | 'business' | null
  hasCases:    boolean,      // false — модуль без кейсов (как 5.8)
}

// После регистрации в реестре появляются слоты:
{
  view:      Function | null,  // registerModuleView(id, ViewFn)
  grader:    Grader   | null,  // registerModuleGrader(id, grader)
  validator: Function | null,  // зарезервировано для схем-валидации payload
}
```

### Шаги

1. **Добавить запись в `core/modules.js`** (массив `MODULES`):

```js
{
  id: '5.9',
  title: 'A/B Test Analyzer',
  description: 'Анализ результатов A/B-тестов и принятие решений.',
  skillGroup: 'analytical',
  hasCases: true,
}
```

2. **Создать View** — async-функция `({ caseData, attemptNo }) → HTMLElement`:

```js
// modules/abtest/CaseView.js
export async function AbTestCaseView({ caseData, attemptNo }) {
  const root = document.createElement('div');
  // ... логика экрана
  return root;
}
```

3. **Зарегистрировать View** из `modules/caseHost.js`:

```js
import { AbTestCaseView } from './abtest/CaseView.js';
registerModuleView('5.9', AbTestCaseView);
```

4. **Добавить первый кейс** в `cases/<slug>.json` и зарегистрировать в `cases/index.json`:

```json
{
  "caseId": "abtest-001",
  "module": "5.9",
  "title": "Первый A/B-тест",
  "difficulty": "basic",
  "skillTags": ["analytical-thinking"]
}
```

5. *Опционально:* зарегистрировать grader (шаг 3 этого документа).

**Минимальный набор правок:** 2 файла (`modules.js`, `caseHost.js`) + новые файлы View и кейсов.
Роутер, валидатор кейсов и каталог адаптируются автоматически.

### Схема payload кейса

Поле `payload` в JSON-кейсе полностью контролируется View: структуру определяет
автор модуля. Будущий slot `validator` позволит объявить JSON Schema для автоматической
проверки при загрузке кейса (аналог `caseValidator.js` для метаданных).

---

## 3. Как добавить проверяющего (Grader)

**Модуль:** `core/grader.js`.  
**Реестр:** `registerModuleGrader(id, grader)` из `core/modules.js`.

### Интерфейс Grader

```js
// Grader — объект с одним методом:
const MyGrader = {
  grade(answer, reference, options = {}) {
    // answer    — ответ пользователя (тип зависит от модуля)
    // reference — эталон (из payload кейса или вычисленный)
    // options   — дополнительные параметры (напр. { orderSensitive: true })
    return {
      fraction: 0.85,      // число от 0 до 1 включительно
      feedback: 'Хорошо',  // опционально — текст для пользователя
      details:  {},        // опционально — произвольные данные для UI
    };
  },
};
```

### Встроенные плагины

| Плагин       | Использование            | Описание                                        |
|--------------|--------------------------|--------------------------------------------------|
| `SqlGrader`  | модуль 5.5               | Точное совпадение SQL-выборок (bool → 0 или 1)   |
| `SelfGrader` | 5.1, 5.2, 5.4, 5.7       | Взвешенная самооценка по критериям               |
| `ScoreGrader(fn)` | 5.3, 5.6, 5.7       | Фабрика для числовой оценки (fn возвращает 0..1) |

Импорт: `import { SqlGrader, SelfGrader, ScoreGrader } from './core/grader.js'`.

### Шаги

1. Реализовать grader (новый файл или экспорт из файла модуля):

```js
// modules/abtest/grader.js
export const AbTestGrader = {
  grade(answer, reference) {
    // answer: { decision: 'A' | 'B', confidence: number }
    // reference: { correct: 'A' | 'B', minConfidence: number }
    const correct = answer.decision === reference.correct;
    const confident = answer.confidence >= reference.minConfidence;
    return {
      fraction: correct ? (confident ? 1 : 0.7) : 0,
      feedback: correct ? 'Верное решение' : 'Выбор варианта ошибочен',
    };
  },
};
```

2. Зарегистрировать из `modules/caseHost.js`:

```js
import { AbTestGrader } from './abtest/grader.js';
import { registerModuleGrader } from '../core/modules.js';

registerModuleGrader('5.9', AbTestGrader);
```

3. Вызвать из View при финализации попытки:

```js
import { getModuleGrader } from '../../core/modules.js';

const grader = getModuleGrader('5.9');
const { fraction } = grader.grade(userAnswer, caseData.payload.reference);
const score = Math.round(fraction * 100); // 0–100 для saveAndFinalize
```

### AI-grader

AI-grader реализуется как отдельный плагин за тем же интерфейсом. Офлайн-инвариант
(PRD §2): локальный детерминированный grader всегда присутствует как fallback;
AI — опциональный слой поверх:

```js
export const AiGrader = {
  async grade(answer, reference, { fallback = SelfGrader } = {}) {
    try {
      const result = await callAiApi(answer, reference);
      return { fraction: result.score / 100, feedback: result.explanation };
    } catch {
      return fallback.grade(answer, reference);
    }
  },
};
```

---

## Сводная таблица точек расширения

| Что добавить    | Правки в существующих файлах                 | Новые файлы                    |
|-----------------|----------------------------------------------|--------------------------------|
| Новый язык      | `main.js` (registerLocale + setLocale)        | `locales/<lang>.js`            |
| Новый модуль    | `core/modules.js` (запись в MODULES)          | `modules/<name>/CaseView.js`   |
|                 | `modules/caseHost.js` (registerModuleView)    | `cases/<slug>.json`            |
| Новый grader    | `modules/caseHost.js` (registerModuleGrader)  | `modules/<name>/grader.js`     |

Изменение роутера, хоста кейсов (логика), валидатора или IndexedDB **не требуется**.
