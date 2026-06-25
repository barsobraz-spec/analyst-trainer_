#!/usr/bin/env python3
"""
Browser smoke for successful AI mentor feedback via a local mock proxy.

Run:
    python3 tests/smoke_ai_mock.py
"""

import argparse
import json
import socket
import subprocess
import sys
import time
from pathlib import Path


BASE_DIR = Path(__file__).parent.parent
DEFAULT_APP_PORT = 8080
DEFAULT_PROXY_PORT = 8091


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(('127.0.0.1', port)) == 0


def start_process(cmd, cwd):
    return subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def wait_for_port(port: int, label: str) -> None:
    for _ in range(40):
        if port_open(port):
            return
        time.sleep(0.2)
    raise RuntimeError(f'{label} did not open port {port}')


def main() -> None:
    parser = argparse.ArgumentParser(description='AI mentor mock smoke test')
    parser.add_argument('--app-port', type=int, default=DEFAULT_APP_PORT)
    parser.add_argument('--proxy-port', type=int, default=DEFAULT_PROXY_PORT)
    parser.add_argument('--headed', action='store_true')
    args = parser.parse_args()

    app_proc = None
    proxy_proc = None
    if not port_open(args.app_port):
        app_proc = start_process(
            ['python3', '-m', 'http.server', str(args.app_port), '--bind', '127.0.0.1'],
            BASE_DIR,
        )
        wait_for_port(args.app_port, 'app server')
    if not port_open(args.proxy_port):
        proxy_proc = start_process(['python3', 'tests/ai_mock_proxy.py', '--port', str(args.proxy_port)], BASE_DIR)
        wait_for_port(args.proxy_port, 'mock proxy')

    try:
        from playwright.sync_api import sync_playwright

        app_url = f'http://localhost:{args.app_port}'
        proxy_url = f'http://127.0.0.1:{args.proxy_port}/api/ai-review'
        settings = {
            'endpoint': proxy_url,
            'model': 'deepseek-v4-pro',
            'disabled': False,
        }
        settings_json = json.dumps(settings)

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=not args.headed)
            context = browser.new_context()
            context.add_init_script(f"""
                localStorage.setItem('at-ai-review-settings', {settings_json!r});
                localStorage.setItem('at-ai-review-consent-accepted', '1');
            """)
            page = context.new_page()
            page.goto(f'{app_url}/#/module/5.1/case/detective-001', wait_until='networkidle', timeout=30000)
            page.wait_for_selector('.ai-mentor button', timeout=10000)
            page.locator('.reasoning-chain__input').first.fill(
                'Вижу резкое падение на шаге оплаты и сравниваю его с предыдущим шагом.'
            )
            page.locator('#final-answer').fill(
                'Падение конверсии связано с шагом оплаты. Нужно проверить платежные ошибки, '
                'изменения в способах оплаты и долю пользователей, которые дошли до этого шага.'
            )
            page.locator('.ai-mentor__mode', has_text='Проверить по эталону').click()
            page.locator('.ai-mentor__actions .learning-button--primary').click()
            page.wait_for_selector('.ai-mentor__choice', timeout=5000)
            page.locator('.ai-mentor__choice .learning-button--primary').click()
            page.wait_for_selector('.ai-mentor__result:not([hidden])', timeout=10000)
            result_text = page.locator('.ai-mentor__result').inner_text(timeout=5000)
            page.wait_for_selector('.ai-mentor__history-details', timeout=5000)
            page.locator('.ai-mentor__history-details summary').click()
            history_text = page.locator('.ai-mentor__history-details').inner_text(timeout=5000)
            page.locator('.ai-mentor__history-delete', has_text='Удалить').click()
            page.wait_for_function(
                "document.querySelectorAll('.ai-mentor__history-row').length === 0",
                timeout=5000,
            )
            deleted_history_text = page.locator('.ai-mentor__history-details').inner_text(timeout=5000)
            browser.close()

        required = ['Mock feedback готов', 'Оценка: 76/100', 'Повтори тему воронок']
        missing = [item for item in required if item not in result_text]
        if missing:
            print('AI mock smoke failed: missing text:', ', '.join(missing), file=sys.stderr)
            print(result_text, file=sys.stderr)
            sys.exit(1)
        if 'Mock feedback готов' not in history_text or 'История AI-проверок (1)' not in history_text:
            print('AI mock smoke failed: review was not saved to history', file=sys.stderr)
            print(history_text, file=sys.stderr)
            sys.exit(1)
        if 'Mock feedback готов' in deleted_history_text or 'История AI-проверок (1)' in deleted_history_text:
            print('AI mock smoke failed: review history delete did not update UI', file=sys.stderr)
            print(deleted_history_text, file=sys.stderr)
            sys.exit(1)

        print('AI mock smoke passed.')
    finally:
        if proxy_proc:
            proxy_proc.terminate()
        if app_proc:
            app_proc.terminate()


if __name__ == '__main__':
    main()
