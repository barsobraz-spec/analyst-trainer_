#!/usr/bin/env python3
"""Прогон референсных SQL по датасету.

Использование:
    python3 scripts/verify-sql-cases.py                       # все sql-m2* кейсы
    python3 scripts/verify-sql-cases.py sql-m2w1d2-select     # конкретный кейс
    python3 scripts/verify-sql-cases.py --probe "SELECT ..."  # одноразовый запрос

Создаёт временную SQLite в памяти, заливает датасет, выполняет referenceSql
каждой подзадачи. Если запрос падает — печатает ошибку.
"""

import glob
import json
import os
import sqlite3
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
DATASET = os.path.join(ROOT, "cases", "datasets", "sql-m2-olist.json")


def build_db():
    with open(DATASET, "r", encoding="utf-8") as f:
        ds = json.load(f)
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    for table in ds["tables"]:
        cols = ", ".join(f'"{c["name"]}" {c["type"]}' for c in table["columns"])
        cur.execute(f'CREATE TABLE "{table["name"]}" ({cols})')
        ph = ", ".join("?" for _ in table["columns"])
        cur.executemany(f'INSERT INTO "{table["name"]}" VALUES ({ph})', table["rows"])
    conn.commit()
    return conn


def run(conn, sql, label=""):
    try:
        cur = conn.execute(sql)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description] if cur.description else []
        print(f"-- {label} ({len(rows)} rows)")
        if cols:
            print("  ", cols)
        for r in rows[:8]:
            print("  ", r)
        if len(rows) > 8:
            print(f"   ... +{len(rows) - 8} more")
        return True
    except Exception as e:
        print(f"!! {label}\n   SQL: {sql}\n   ERROR: {e}")
        return False


def verify_case(conn, path):
    with open(path, "r", encoding="utf-8") as f:
        case = json.load(f)
    print(f"\n=== {case['caseId']} — {case['title']} ===")
    ok = True
    for sub in case["payload"]["subtasks"]:
        r = run(conn, sub["referenceSql"], label=f"{sub['id']}: {sub['prompt'][:80]}")
        ok = ok and r
    return ok


def main():
    args = sys.argv[1:]
    conn = build_db()
    if args and args[0] == "--probe":
        run(conn, args[1], label="probe")
        return
    if args:
        for cid in args:
            verify_case(conn, os.path.join(ROOT, "cases", f"{cid}.json"))
        return
    pattern = os.path.join(ROOT, "cases", "sql-m2*.json")
    files = sorted(glob.glob(pattern))
    if not files:
        print("Нет файлов по шаблону", pattern)
        return
    failed = 0
    for p in files:
        if not verify_case(conn, p):
            failed += 1
    print(f"\nГотово. Файлов: {len(files)}, провалов: {failed}")


if __name__ == "__main__":
    main()
