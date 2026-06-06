// modules/settings/SettingsView.js — экран «Настройки» (#/settings).
//
// Переиспользует штатные компоненты темы и экспорта/импорта, чтобы настройки
// страницы и сайдбара оставались одним и тем же функционалом.

import { DataControls } from '../../core/components/DataControls.js';
import { ThemeToggle } from '../../core/theme.js';
import { pageHeader, sectionTitle } from '../shared/ui.js';

export function SettingsView() {
  const root = document.createElement('section');
  root.className = 'settings screen';
  root.append(pageHeader('Настройки', 'Тема интерфейса и локальные данные прогресса.'));

  root.append(sectionTitle('Тема'));
  const theme = document.createElement('div');
  theme.className = 'settings-card home-widget';
  const themeRow = document.createElement('div');
  themeRow.className = 'settings-row';
  themeRow.append(settingText('Тема интерфейса', 'Переключение светлого и тёмного режима.'), ThemeToggle());
  theme.append(themeRow);
  root.append(theme);

  root.append(sectionTitle('Данные'));
  const data = document.createElement('div');
  data.className = 'settings-card home-widget';
  data.append(
    settingText('Прогресс обучения', 'Экспорт и импорт локальной копии прогресса.'),
    DataControls(),
  );
  root.append(data);

  return root;
}

function settingText(title, hint) {
  const wrap = document.createElement('div');
  wrap.className = 'settings-copy';
  const h = document.createElement('h2');
  h.className = 'settings-copy__title';
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'settings-copy__hint';
  p.textContent = hint;
  wrap.append(h, p);
  return wrap;
}
