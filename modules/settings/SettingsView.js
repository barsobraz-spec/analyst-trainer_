// modules/settings/SettingsView.js — экран «Настройки» (#/settings).
//
// Переиспользует штатные компоненты темы и экспорта/импорта, чтобы настройки
// страницы и сайдбара оставались одним и тем же функционалом.

import { DataControls } from '../../core/components/DataControls.js?v=v1.7';
import { ThemeToggle } from '../../core/theme.js';
import {
  getAiReviewSettings,
  hasAiReviewConsent,
  saveAiReviewConsent,
  saveAiReviewSettings,
  reviewAnswer,
} from '../../core/aiReview.js?v=v1.7';
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

  root.append(sectionTitle('AI-проверка'));
  root.append(aiReviewCard());

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

function aiReviewCard() {
  const saved = getAiReviewSettings();
  const card = document.createElement('div');
  card.className = 'settings-card home-widget ai-review-settings';

  const endpoint = input('url', saved.endpoint, 'https://your-domain.vercel.app/api/ai-review');
  const model = input('text', saved.model, 'deepseek-v4-pro');
  const disabled = checkbox(saved.disabled);
  const save = button('Сохранить настройки', 'learning-button');
  const run = button('Проверить подключение', 'learning-button learning-button--primary');
  const status = document.createElement('p');
  status.className = 'ai-review-settings__status';
  status.setAttribute('aria-live', 'polite');

  card.append(
    settingText('AI-ментор', 'AI работает через backend-proxy; секретный ключ не хранится в браузере.'),
    formGrid([
      field('AI-proxy URL', endpoint),
      field('Модель', model),
    ]),
    field('Отключить AI-ментора', disabled),
    actions(save, run),
    status,
  );

  save.addEventListener('click', () => {
    const hadConsent = hasAiReviewConsent(getAiReviewSettings());
    const settings = saveAiReviewSettings({ endpoint: endpoint.value, model: model.value, disabled: disabled.checked });
    endpoint.value = settings.endpoint;
    model.value = settings.model;
    disabled.checked = settings.disabled;
    if (hadConsent && settings.endpoint && !hasAiReviewConsent(settings)) {
      setStatus(status, 'Настройки сохранены. Proxy URL или модель изменились, поэтому перед следующим AI-запросом нужно новое согласие.', 'info');
    } else {
      setStatus(status, 'Настройки AI-проверки сохранены.', 'success');
    }
  });

  run.addEventListener('click', async () => {
    setBusy([save, run], true);
    setStatus(status, 'Проверяю подключение…');
    const settings = saveAiReviewSettings({ endpoint: endpoint.value, model: model.value, disabled: disabled.checked });
    if (settings.disabled) {
      setStatus(status, 'AI-ментор отключен в настройках.', 'error');
      setBusy([save, run], false);
      return;
    }
    if (!settings.endpoint) {
      setStatus(status, 'Укажите URL AI-proxy перед тестовым запросом.', 'error');
      setBusy([save, run], false);
      return;
    }
    if (!hasAiReviewConsent(settings)) {
      const accepted = window.confirm(
        `Тестовый запрос будет отправлен во внешний AI-proxy:\n${settings.endpoint}\n\n`
        + `Модель: ${settings.model}\n`
        + 'Будет отправлен только короткий тестовый контекст. '
        + 'Секретный ключ в браузер не отправляется, а при смене proxy URL или модели согласие потребуется заново. Продолжить?',
      );
      if (!accepted) {
        setStatus(status, 'Тестовый AI-запрос отменен.');
        setBusy([save, run], false);
        return;
      }
      saveAiReviewConsent(true, settings);
    }
    try {
      await reviewAnswer({
        endpoint: settings.endpoint,
        model: settings.model,
        mode: 'hint',
        context: {
          schemaVersion: 1,
          product: 'Analyst Trainer',
          mode: 'hint',
          task: { scenario: 'Тест подключения AI-ментора из настроек.' },
          policy: { doNotChangeProgress: true, doNotRevealReference: true },
        },
        studentAnswer: 'Тестовый запрос настройки AI-ментора.',
      });
      setStatus(status, 'Подключение работает. AI-ментор готов к использованию в кейсах.', 'success');
    } catch (err) {
      setStatus(status, err?.message || 'AI-proxy не ответил на тестовый запрос.', 'error');
    } finally {
      setBusy([save, run], false);
    }
  });

  return card;
}

function input(type, value, placeholder) {
  const el = document.createElement('input');
  el.type = type;
  el.value = value || '';
  el.placeholder = placeholder || '';
  return el;
}

function checkbox(checked) {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = !!checked;
  return el;
}

function field(labelText, control) {
  const label = document.createElement('label');
  label.className = 'learning-field';
  const span = document.createElement('span');
  span.className = 'learning-field__label';
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

function formGrid(items) {
  const grid = document.createElement('div');
  grid.className = 'learning-form-grid';
  grid.append(...items);
  return grid;
}

function actions(...buttons) {
  const row = document.createElement('div');
  row.className = 'ai-review-settings__actions';
  row.append(...buttons);
  return row;
}

function button(label, className) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  return el;
}

function setBusy(buttons, busy) {
  for (const btn of buttons) btn.disabled = busy;
}

function setStatus(status, text, kind = 'info') {
  status.textContent = text;
  status.dataset.kind = kind;
  status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
}
