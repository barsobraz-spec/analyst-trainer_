#!/usr/bin/env python3
"""
tests/smoke.py — smoke-проверка всех роутов Analyst Trainer.

Запуск (сервер запустится автоматически):
    python3 tests/smoke.py

Запуск с уже работающим сервером на другом порту:
    python3 tests/smoke.py --port 9090

Критерии прохождения роута:
    • #app содержит дочерние элементы (экран отрендерился)
    • h1 в #app НЕ содержит «Экран не найден» / «Не удалось открыть экран»
    • Нет console.error за время жизни роута
    • Обязательные элементы (кнопки, карточки) присутствуют на ключевых экранах

Зависимость: pip3 install playwright && python3 -m playwright install chromium
"""

import sys
import socket
import subprocess
import time
import argparse
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DEFAULT_PORT = 8080
RENDER_TIMEOUT_MS = 8_000   # ждём рендера #app
EXTRA_WAIT_MS     = 600     # буфер для async IndexedDB/fetch после рендера

# (hash_path, description)  — порядок совпадает с APP_ROUTES
ROUTES = [
    ('/',                           'Главная'),
    ('/modules',                    'Каталог'),
    ('/module/5.1',                 'Список кейсов 5.1'),
    ('/module/5.1/case/detective-001', 'Кейс detective-001'),
    ('/module/5.6/case/simulator-001', 'Кейс simulator-001'),
    ('/module/5.7/case/automation-001', 'Кейс automation-001'),
    ('/analytics',                  'Аналитика'),
    ('/practice',                   'Практика'),
    ('/favorites',                  'Избранное'),
    ('/history',                    'История'),
    ('/skill/analytics',            'Навык: Аналитика'),
    ('/resources',                  'Ресурсы'),
    ('/settings',                   'Настройки'),
    ('/about',                      'О проекте'),
    ('/learning/today',             'Сегодня'),
    ('/learning/plan',              'План обучения'),
    ('/learning/tasks',             'Задачи'),
    ('/learning/projects',          'Проекты'),
    ('/learning/career',            'Карьера'),
    ('/learning/mock-interview',    'Mock Interview'),
]

# Обязательные CSS-селекторы для ключевых экранов (проверяются в #app)
MANDATORY = {
    '/':        'h1',
    '/modules': '.module-card, [class*="module"]',
    '/settings': 'button',
}

# Тексты, которые НЕ должны появляться в h1 (экраны-заглушки роутера)
ERROR_H1_TEXTS = ('Экран не найден', 'Не удалось открыть экран')


def port_open(port: int) -> bool:
    for host, family in (('127.0.0.1', socket.AF_INET), ('::1', socket.AF_INET6)):
        with socket.socket(family) as s:
            s.settimeout(0.5)
            if s.connect_ex((host, port)) == 0:
                return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description='Smoke-тест роутов Analyst Trainer')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT,
                        help=f'Порт сервера (по умолчанию {DEFAULT_PORT})')
    parser.add_argument('--headed', action='store_true',
                        help='Запустить браузер в видимом режиме (отладка)')
    args = parser.parse_args()

    port = args.port
    base_url = f'http://localhost:{port}'

    # Запускаем встроенный сервер, если порт свободен
    server_proc = None
    if not port_open(port):
        print(f'  Сервер не запущен — стартую python3 -m http.server {port}...')
        server_proc = subprocess.Popen(
            ['python3', '-m', 'http.server', str(port)],
            cwd=BASE_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(30):
            time.sleep(0.2)
            if port_open(port):
                break
        else:
            print('ОШИБКА: сервер не поднялся за 6 секунд', file=sys.stderr)
            server_proc.terminate()
            sys.exit(2)
        print(f'  Сервер запущен на порту {port}.\n')

    results: list[tuple[str, str, str, list[str]]] = []

    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=not args.headed)
            ctx = browser.new_context()
            page = ctx.new_page()

            for route, label in ROUTES:
                errors: list[str] = []
                console_errors: list[str] = []

                def _on_console(msg, _buf=console_errors):
                    if msg.type == 'error':
                        _buf.append(msg.text[:120])

                page.on('console', _on_console)

                # Полная перезагрузка для чистого состояния
                try:
                    page.goto(
                        f'{base_url}/#{route}',
                        wait_until='networkidle',
                        timeout=30_000,
                    )
                except Exception as e:
                    errors.append(f'goto timeout/error: {e}')
                    page.remove_listener('console', _on_console)
                    results.append(('FAIL', route, label, errors))
                    continue

                # Ждём, пока #app получит дочерние элементы
                try:
                    page.wait_for_function(
                        "document.querySelector('#app') && document.querySelector('#app').children.length > 0",
                        timeout=RENDER_TIMEOUT_MS,
                    )
                except Exception:
                    errors.append(f'#app пустой через {RENDER_TIMEOUT_MS} мс')

                # Небольшой буфер для async-данных (IndexedDB, fetch)
                page.wait_for_timeout(EXTRA_WAIT_MS)

                page.remove_listener('console', _on_console)

                # Проверка: нет экрана-заглушки
                h1_text = page.text_content('#app h1') or ''
                for bad in ERROR_H1_TEXTS:
                    if bad in h1_text:
                        errors.append(f'Экран-ошибка: «{h1_text.strip()}»')

                # Проверка обязательных элементов
                if route in MANDATORY:
                    sel = MANDATORY[route]
                    found = any(
                        page.query_selector(f'#app {s.strip()}')
                        for s in sel.split(',')
                    )
                    if not found:
                        errors.append(f'Обязательный элемент не найден: {sel}')

                # Проверка ошибок консоли
                if console_errors:
                    for ce in console_errors[:2]:
                        errors.append(f'console.error: {ce}')

                status = 'PASS' if not errors else 'FAIL'
                results.append((status, route, label, errors))

            browser.close()

    finally:
        if server_proc:
            server_proc.terminate()

    # --- Вывод результатов ---
    print()
    max_label = max(len(r[2]) for r in results)
    for status, route, label, errs in results:
        mark = '✓' if status == 'PASS' else '✗'
        print(f'  {mark} {label:<{max_label}}  {route}')
        for e in errs:
            print(f'    → {e}')

    passed = sum(1 for r in results if r[0] == 'PASS')
    total  = len(results)
    print()
    print(f'  Итого: {passed}/{total} роутов прошли.')
    print()

    sys.exit(0 if passed == total else 1)


if __name__ == '__main__':
    main()
