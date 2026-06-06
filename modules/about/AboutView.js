// modules/about/AboutView.js — экран «О проекте» (#/about).
//
// Короткая страница: что это за приложение, как им пользоваться, версия и кнопки
// «Экспорт»/«Импорт» прогресса (переиспользуем DataControls из T2.1 — единственную
// реализацию резервного копирования). Контент статический; хранилище трогается
// только штатным экспортом/импортом.
//
// ES-модуль: `import { AboutView } from './modules/about/AboutView.js'`.

import { APP_VERSION } from '../../config.js';
import { CASE_MODULES } from '../../core/modules.js';
import { DataControls } from '../../core/components/DataControls.js';
import { pageHeader, sectionTitle } from '../shared/ui.js';

// Шаги «как пользоваться» (короткой памяткой).
const STEPS = [
  {
    title: 'Выбирайте модуль',
    text: 'В каталоге собраны навыки аналитика: детектив данных, гипотезы, дашборды, поиск причин, SQL, бизнес-симулятор и автоматизация.',
  },
  {
    title: 'Проходите кейсы',
    text: 'Каждый кейс — реалистичная задача с разбором и эталоном. В конце вы ставите себе оценку по критериям.',
  },
  {
    title: 'Следите за прогрессом',
    text: 'История, избранное и аналитика по навыкам помогают видеть сильные стороны и слабые места.',
  },
  {
    title: 'Сохраняйте данные',
    text: 'Весь прогресс хранится локально в браузере. Экспортируйте его в файл, чтобы перенести на другое устройство.',
  },
];

export function AboutView() {
  const root = document.createElement('section');
  root.className = 'about screen';
  root.append(pageHeader('О проекте', 'Analyst Trainer — тренажёр навыков аналитика данных.'));

  // --- Что это -----------------------------------------------------------------
  const intro = document.createElement('div');
  intro.className = 'about-card home-widget';
  const p1 = document.createElement('p');
  p1.className = 'about-card__lead';
  p1.textContent =
    'Это локальное офлайн-приложение для тренировки навыков аналитика на реалистичных кейсах. ' +
    'Оно работает прямо в браузере, без регистрации и без отправки данных в сеть: весь ваш прогресс ' +
    'остаётся только на вашем устройстве.';
  const p2 = document.createElement('p');
  p2.className = 'about-card__text';
  p2.textContent =
    `Сейчас доступно ${CASE_MODULES.length} обучающих модулей и отдельный раздел аналитики обучения. ` +
    'Кейсы можно проходить в любом порядке, повторять и отмечать звёздочкой избранные.';
  intro.append(p1, p2);
  root.append(intro);

  // --- Как пользоваться --------------------------------------------------------
  root.append(sectionTitle('Как пользоваться'));
  const steps = document.createElement('ol');
  steps.className = 'about-steps';
  STEPS.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'about-step';
    const num = document.createElement('span');
    num.className = 'about-step__num';
    num.textContent = String(i + 1);
    const body = document.createElement('div');
    body.className = 'about-step__body';
    const h3 = document.createElement('h3');
    h3.className = 'about-step__title';
    h3.textContent = s.title;
    const text = document.createElement('p');
    text.className = 'about-step__text';
    text.textContent = s.text;
    body.append(h3, text);
    li.append(num, body);
    steps.append(li);
  });
  root.append(steps);

  // --- Экспорт / импорт прогресса ---------------------------------------------
  root.append(sectionTitle('Экспорт и импорт прогресса'));
  const backup = document.createElement('div');
  backup.className = 'about-backup home-widget';
  const hint = document.createElement('p');
  hint.className = 'about-backup__hint';
  hint.textContent =
    'Сохраните весь прогресс в файл или восстановите его из ранее сохранённой копии. ' +
    'Импорт заменяет текущий прогресс — приложение спросит подтверждение.';
  backup.append(hint, DataControls());
  root.append(backup);

  // --- Версия ------------------------------------------------------------------
  const footer = document.createElement('div');
  footer.className = 'about-version';
  footer.append(label('Версия', APP_VERSION), label('Данные', 'Локально в браузере (IndexedDB)'));
  root.append(footer);

  return root;
}

function label(name, value) {
  const wrap = document.createElement('div');
  wrap.className = 'about-version__item';
  const n = document.createElement('span');
  n.className = 'about-version__name';
  n.textContent = name;
  const v = document.createElement('span');
  v.className = 'about-version__value';
  v.textContent = value;
  wrap.append(n, v);
  return wrap;
}
