# Analyst Trainer

Локальное офлайн-приложение для тренировки навыков аналитика. Восемь модулей:
семь с кейсами (Data Detective, Hypothesis Trainer, Dashboard Analysis, Root Cause
Analysis, SQL Investigation, Business Simulator, Automation Designer) и Learning
Analytics — анализ собственного прогресса по данным всех модулей.

Приложение полностью статическое: нативные ES-модули, без шага сборки, без сервера
и без внешних API. Сторонние библиотеки лежат локально в `vendor/`, прогресс
хранится в IndexedDB браузера.

## Деплой

Проект подготовлен для публикации как статическое приложение на бесплатном тарифе
Vercel. Сборка не требуется: точка входа — `index.html`, маршруты работают через
hash-router (`#/...`), а все зависимости для браузера лежат внутри проекта.

Коротко для Vercel:

- Framework Preset: `Other`
- Build Command: пусто
- Output Directory: пусто или `.`
- Install Command: пусто
- Root Directory: `analyst-trainer`, если репозиторий содержит несколько папок

Подробная инструкция: [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Запуск

Приложению нужен **локальный HTTP-сервер**. Запустите из корня проекта (папка с
`index.html`) любую из команд ниже и откройте показанный адрес в браузере.

### Python (рекомендуется — есть на macOS/Linux «из коробки»)

```sh
python3 -m http.server 8080
```

Откройте <http://localhost:8080>.

### Node.js

```sh
# одноразово, без установки:
npx serve -l 8080
# или, если установлен http-server:
npx http-server -p 8080
```

### PHP

```sh
php -S localhost:8080
```

Любой другой статический файловый сервер тоже подойдёт — приложению не нужны ни
бэкенд, ни особые заголовки (sql.js собран без `SharedArrayBuffer`, поэтому
COOP/COEP не требуются).

### Почему нельзя открыть `index.html` напрямую (`file://`)

По протоколу `file://` приложение **не работает**. Браузеры применяют
same-origin policy и блокируют:

- загрузку ES-модулей (`<script type="module">`);
- `fetch()` к соседним JSON-файлам (манифест и кейсы загружаются динамически);
- загрузку WASM для `sql.js` (модуль SQL Investigation).

Поэтому нужен именно HTTP-сервер (`http://localhost:…`). Это локальный сервер на
вашей машине — приложение остаётся офлайн и никуда не отправляет данные.

---

## Где что лежит

```
index.html        — точка входа
main.js           — роутер и монтирование экранов
config.js         — все настраиваемые константы (лимиты, веса score, пороги)
core/             — общая логика: загрузка/валидация кейсов, БД, статистика, компоненты
modules/          — по папке на модуль (detective, hypothesis, … , analytics)
workers/          — Web Worker для sql.js
vendor/           — сторонние библиотеки локально (chart.js, codemirror, expr-eval, sql.js)
cases/            — контент: JSON-кейсы
  index.json      — манифест: список всех кейсов
  datasets/       — датасеты для SQL-кейсов (отдельными файлами)
```

Прогресс (события, самооценки, заметки, пользовательские кейсы Automation Designer)
хранится в IndexedDB. Его можно выгрузить и загрузить одним JSON-файлом через
блок «Экспорт/импорт» в шапке и на экране Learning Analytics.

---

## Как добавить кейс

**Код приложения менять не нужно.** Кейс — это данные:

1. Создайте JSON-файл в `cases/` (для SQL — ещё датасет в `cases/datasets/`).
2. Добавьте запись о нём в массив `cases` файла `cases/index.json`.
3. Обновите страницу — кейс появится в каталоге.

Если кейс не проходит валидацию (битая структура, неизвестный модуль или тег,
файл больше 5 MB), он не ломает каталог: показывается как «ошибка контента» с
причиной и не открывается. Один плохой кейс не влияет на остальные.

### Запись в `cases/index.json`

```json
{
  "schemaVersion": 1,
  "cases": [
    {
      "caseId": "detective-001",
      "module": "5.1",
      "path": "cases/detective-001.json",
      "title": "Падение конверсии в корзине",
      "difficulty": "basic"
    }
  ]
}
```

- `caseId` — уникальный идентификатор; **должен совпадать** с полем `caseId`
  внутри самого файла и (по соглашению) с его именем без `.json`.
- `module` — один из `5.1`–`5.7` (см. таблицу ниже).
- `path` — путь к файлу кейса от корня приложения.
- `difficulty` — `basic` | `intermediate` | `advanced`.

### Общая обёртка любого кейса

Все кейсы имеют одинаковый каркас; различается только содержимое `payload`.

```json
{
  "caseId": "detective-001",
  "module": "5.1",
  "schemaVersion": 1,
  "title": "Падение конверсии в корзине",
  "difficulty": "basic",
  "skillTags": ["analytical-thinking"],
  "payload": { /* зависит от модуля — см. ниже */ }
}
```

| Поле            | Тип      | Требования                                                        |
| --------------- | -------- | ---------------------------------------------------------------- |
| `caseId`        | string   | непустой; совпадает с записью в `index.json`                      |
| `module`        | string   | `5.1`–`5.7`                                                       |
| `schemaVersion` | number   | сейчас `1`                                                        |
| `title`         | string   | непустой                                                         |
| `difficulty`    | string   | `basic` \| `intermediate` \| `advanced`                          |
| `skillTags`     | string[] | непустой; только теги из закрытого словаря (ниже)                |
| `payload`       | object   | модуль-специфичные данные кейса                                   |

### Модули и теги навыков

| `module` | Модуль              | Типичный `skillTag`  |
| -------- | ------------------- | -------------------- |
| `5.1`    | Data Detective      | `analytical-thinking`|
| `5.2`    | Hypothesis Trainer  | `hypotheses`         |
| `5.3`    | Dashboard Analysis  | `data-viz`           |
| `5.4`    | Root Cause Analysis | `root-cause`         |
| `5.5`    | SQL Investigation   | `sql`                |
| `5.6`    | Business Simulator  | `business-thinking`  |
| `5.7`    | Automation Designer | `automation-design`  |

Словарь тегов **закрытый** (7 значений, свободный ввод запрещён):
`analytical-thinking`, `hypotheses`, `data-viz`, `root-cause`, `sql`,
`business-thinking`, `automation-design`. Кейсу можно проставить несколько тегов —
по ним Learning Analytics агрегирует прогресс по трём группам навыков.

---

## JSON-схемы `payload` по модулям

Ниже — краткая схема `payload` для каждого из семи модулей. Поля показаны на
сокращённых примерах; полные рабочие образцы лежат в `cases/` (`*-001.json` —
базовая сложность каждого модуля).

### 5.1 — Data Detective (`cases/detective-001.json`)

Текстовый сценарий + небольшая таблица; пользователь рассуждает по шагам и
сверяется с эталонным разбором. Автопроверки нет — оценка по самооценке.

```json
{
  "payload": {
    "scenario": "Контекст задачи (текст).",
    "question": "Что нужно выяснить.",
    "table": {
      "columns": [
        { "key": "step", "label": "Шаг воронки" },
        { "key": "curr", "label": "Эта неделя, чел.", "numeric": true }
      ],
      "rows": [
        { "step": "Открыли корзину", "curr": 11800 }
      ]
    },
    "metrics": [
      { "label": "Конверсия, эта неделя", "value": "25,3%" }
    ],
    "reasoning": {
      "stepPrompts": ["Что я вижу?", "Что это значит?", "Вывод"]
    },
    "hints": ["Подсказка 1", "Подсказка 2"],
    "reference": {
      "sections": [
        { "heading": "Где сломалось", "body": "Эталонный разбор." }
      ]
    }
  }
}
```

`metrics`, `hints` — опциональны. `reasoning.stepPrompts` задаёт поля для
свободного рассуждения. `reference.sections` — раскрываемый эталон.

### 5.2 — Hypothesis Trainer (`cases/hypothesis-001.json`)

Сценарий + список фактов; пользователь формулирует `count` гипотез (по шаблону
если/то/потому что + способ проверки + метрика), оценивает их качество и
расставляет по матрице «эффект × усилия». Оценка по самооценке.

```json
{
  "payload": {
    "scenario": "Контекст.",
    "question": "Сформулируйте N гипотез…",
    "facts": ["Факт 1", "Факт 2"],
    "count": 3,
    "templates": [
      {
        "if": "механизм",
        "then": "наблюдаемое следствие",
        "because": "почему",
        "test": "как проверить",
        "metric": "по какой метрике"
      }
    ],
    "reference": {
      "hypotheses": [
        { "statement": "Эталонная гипотеза.", "why": "Почему сильная." }
      ],
      "note": "Что отличает сильную гипотезу от слабой."
    }
  }
}
```

`templates` — необязательная заготовка-подсказка. `count` — сколько гипотез
ожидается от пользователя.

### 5.3 — Dashboard Analysis (`cases/dashboard-001.json`)

Набор графиков (рисуются Chart.js) + вопросы с **автопроверкой** (числовые/выбор),
отметка аномальной точки и свободный инсайт. Итоговый score = авто-проверка +
самооценка (веса в `config.js`).

```json
{
  "payload": {
    "scenario": "Контекст.",
    "question": "Изучите дашборд…",
    "charts": [
      {
        "id": "revenue",
        "title": "Выручка по месяцам",
        "type": "line",                     // line | bar | pie
        "labels": ["Янв", "Фев", "Мар"],
        "valueSuffix": " тыс ₽",
        "yLabel": "Выручка, тыс ₽",
        "datasets": [
          { "label": "Выручка", "data": [1200, 1250, 1320] }
        ]
      }
    ],
    "questions": [
      {
        "id": "q1",
        "type": "numeric",                  // numeric: answer + tolerance
        "prompt": "Выручка в марте?",
        "answer": 1320,
        "tolerance": 50,
        "unit": " тыс ₽",
        "explanation": "Пояснение к ответу."
      },
      {
        "id": "q2",
        "type": "mcq",                      // mcq: options + answerIndex
        "prompt": "Где был максимум?",
        "options": ["Янв", "Фев", "Мар"],
        "answerIndex": 2,
        "explanation": "Пояснение."
      }
    ],
    "anomaly": {
      "chartId": "revenue",
      "index": 2,
      "tolerance": 0,
      "prompt": "Отметьте аномальную точку.",
      "explanation": "Почему это выброс."
    },
    "reference": {
      "charts": [{ "title": "…", "text": "Разбор графика." }],
      "anomaly": "Разбор аномалии.",
      "insightSample": "Пример сильного инсайта."
    }
  }
}
```

### 5.4 — Root Cause Analysis (`cases/rca-001.json`)

Проблема + факты + категории причин; пользователь строит дерево причин (5 Whys /
Fishbone), отмечает корневую и сверяется с эталоном. Оценка по самооценке.

```json
{
  "payload": {
    "problem": "Короткая формулировка проблемы.",
    "scenario": "Контекст.",
    "question": "Постройте дерево причин…",
    "facts": ["Факт 1", "Факт 2"],
    "categories": ["Трафик и маркетинг", "Конверсия сайта", "…"],
    "solution": {
      "tree": [
        {
          "label": "Корень проблемы",
          "children": [
            {
              "label": "Ветвь причины",
              "children": [
                { "label": "Корневая причина", "root": true }
              ]
            }
          ]
        }
      ],
      "rootCause": "Текст корневой причины.",
      "note": "Как рассуждать к корневой причине."
    }
  }
}
```

Узел дерева: `label` + опциональный массив `children`; корневая причина помечается
`"root": true`.

### 5.5 — SQL Investigation (`cases/sql-001.json` + `cases/datasets/sql-001.json`)

Серия подзадач: пользователь пишет SQL в редакторе, движок sql.js (в Web Worker)
выполняет запрос, результат **автоматически** сверяется с эталонным. Датасет —
отдельным файлом, на который ссылается `datasetPath`.

```json
{
  "payload": {
    "scenario": "Контекст и описание таблиц.",
    "question": "Решите подзадачи…",
    "datasetPath": "cases/datasets/sql-001.json",
    "starterSql": "SELECT * FROM returns;",
    "subtasks": [
      {
        "id": "s1",
        "prompt": "Сколько всего возвратов?",
        "orderSensitive": false,
        "referenceSql": "SELECT COUNT(*) AS returns_count FROM returns;",
        "explanation": "Пояснение к решению."
      }
    ]
  }
}
```

`orderSensitive: true` — порядок строк результата важен (есть `ORDER BY`), иначе
сравнение игнорирует порядок строк.

**Датасет** (`cases/datasets/sql-001.json`) — схема и данные таблиц:

```json
{
  "tables": [
    {
      "name": "returns",
      "columns": [
        { "name": "return_id", "type": "INTEGER" },
        { "name": "order_id", "type": "INTEGER" },
        { "name": "reason", "type": "TEXT" }
      ],
      "rows": [
        [1, 1, "Брак"],
        [2, 3, "Брак"]
      ]
    }
  ]
}
```

`rows` — массив массивов значений в порядке `columns`. Размер файла кейса/датасета
не должен превышать 5 MB.

### 5.6 — Business Simulator (`cases/simulator-001.json`)

Многораундовый сценарий с числовой моделью: пользователь принимает решения, формулы
(вычисляются через expr-eval) пересчитывают метрики, в конце score зависит от
достижения цели. Полностью автоматическая оценка.

```json
{
  "payload": {
    "scenario": "Контекст и описание модели.",
    "question": "Проведите бизнес через N раундов…",
    "metrics": [
      { "key": "customers", "label": "Клиенты", "format": "int" },
      { "key": "revenue", "label": "Выручка", "format": "money" }
    ],
    "startState": { "customers": 1000, "revenue": 2000000 },
    "target": {
      "metric": "revenue",
      "value": 2200000,
      "direction": "max",
      "label": "Месячная выручка"
    },
    "rounds": [
      {
        "title": "Раунд 1",
        "prompt": "Выберите стратегию.",
        "decisions": [
          {
            "id": "channel",
            "type": "choice",
            "label": "Канал привлечения",
            "options": [
              {
                "value": "content",
                "label": "Контент-маркетинг",
                "desc": "Описание варианта.",
                "params": { "acquired": 80, "channelCac": 1300 }
              }
            ]
          },
          {
            "id": "discount",
            "type": "number",
            "label": "Скидка",
            "suffix": "%",
            "min": 0, "max": 30, "step": 5, "default": 0
          }
        ],
        "model": [
          { "key": "customers", "formula": "round(customers * (1 - churn/100)) + acquired" },
          { "key": "revenue", "formula": "round(customers * arpu * (1 - discount/100))" }
        ],
        "explanation": "Разбор раунда."
      }
    ],
    "reference": ["Вывод 1", "Вывод 2"]
  }
}
```

В `formula` доступны текущие метрики, параметры выбранного варианта (`params`) и
значения `number`-решений по их `id`. `format`: `int` | `money` | `percent`.
`target.direction`: `max` | `min`.

### 5.7 — Automation Designer (`cases/automation-001.json`)

Пользователь строит схему процесса «Триггер → Шаги → Результат», заполняет карточки
шагов, проходит чек-лист готовности и сверяется с эталоном. Оценка по самооценке.
(Пользователь также может создавать собственные кейсы этого модуля — они хранятся в
IndexedDB и входят в экспорт/импорт.)

```json
{
  "payload": {
    "scenario": "Контекст: что автоматизируем.",
    "question": "Постройте схему автоматизации…",
    "hints": ["Подсказка 1", "Подсказка 2"],
    "solution": {
      "nodes": [
        {
          "type": "trigger",            // trigger | action | condition | outcome
          "title": "Поступила заявка",
          "input": "",
          "output": "Заявка: контакт, текст, время",
          "actor": "Форма на сайте"
        },
        {
          "type": "outcome",
          "title": "Заявка назначена",
          "input": "Назначенная задача",
          "output": "Время первого ответа < 1 часа",
          "actor": "Система уведомлений"
        }
      ],
      "note": "Что отличает сильную схему."
    }
  }
}
```

Узел схемы: `type` (`trigger` | `action` | `condition` | `outcome`), `title`,
`input`, `output`, `actor`. `hints` — опционально.

---

## Технические заметки

- **Без сборки.** Все скрипты — нативные ES-модули; сторонние библиотеки грузятся
  лениво из `vendor/` по мере надобности (на стартовой странице они не загружаются).
- **Прогресс — в IndexedDB.** `localStorage` используется только для мелких
  UI-настроек (например, тема). Выгрузка/загрузка всего хранилища — одним JSON.
- **Константы — в `config.js`.** Лимит датасета (5 MB), веса score, таймаут SQL,
  пороги Learning Analytics. Менять значения только там.
- **Поддерживаемые браузеры:** современные Chromium/Firefox/Safari с поддержкой
  ES-модулей, IndexedDB и WebAssembly.
