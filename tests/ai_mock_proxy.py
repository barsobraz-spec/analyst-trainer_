#!/usr/bin/env python3
"""
Tiny local AI proxy mock for Analyst Trainer browser smoke checks.

Run:
    python3 tests/ai_mock_proxy.py --port 8091
"""

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class MockAiHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != '/api/ai-review':
            self.send_error(404)
            return

        length = int(self.headers.get('content-length') or 0)
        raw = self.rfile.read(length).decode('utf-8') if length else '{}'
        try:
            request = json.loads(raw)
        except json.JSONDecodeError:
            self._json(400, {'error': 'invalid json'})
            return

        mode = request.get('mode') or 'hint'
        score = None if mode in ('hint', 'next_step', 'sql_review') else 76
        self._json(200, {
            'score': score,
            'verdict': 'Mock feedback готов',
            'strengths': ['Ты выделил главное наблюдение'],
            'issues': ['Нужно точнее связать вывод с метрикой'],
            'mentorQuestion': 'Какой показатель подтвердит этот вывод?',
            'improvements': ['Добавь одно числовое доказательство'],
            'nextSteps': ['Повтори тему воронок', 'Открой связанный SQL-кейс'],
        })

    def log_message(self, _format, *_args):
        return

    def _cors(self):
        origin = self.headers.get('origin') or '*'
        self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description='Mock AI proxy for Analyst Trainer')
    parser.add_argument('--port', type=int, default=8091)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), MockAiHandler)
    print(f'Mock AI proxy listening on http://127.0.0.1:{args.port}/api/ai-review')
    server.serve_forever()


if __name__ == '__main__':
    main()
