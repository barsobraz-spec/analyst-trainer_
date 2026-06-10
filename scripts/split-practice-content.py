#!/usr/bin/env python3
"""
scripts/split-practice-content.py — разбивает practiceContent.json на чанки по навыку.

Создаёт:
  learning-plan/data/practice-index.json       — легковесный индекс (навыки + метаданные)
  learning-plan/data/chunks/practice-{skill}.json — полные данные по навыку

Запуск из корня проекта:
  python3 scripts/split-practice-content.py

Обратная совместимость: practiceContent.json остаётся нетронутым.
"""
import json
import pathlib
import sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).parent.parent
SRC  = ROOT / 'learning-plan' / 'data' / 'practiceContent.json'
DST_INDEX  = ROOT / 'learning-plan' / 'data' / 'practice-index.json'
DST_CHUNKS = ROOT / 'learning-plan' / 'data' / 'chunks'

DST_CHUNKS.mkdir(parents=True, exist_ok=True)

with open(SRC, encoding='utf-8') as f:
    data = json.load(f)

items = data.get('items', [])
if not items:
    print('ОШИБКА: items не найдены в practiceContent.json', file=sys.stderr)
    sys.exit(1)

# Группируем по skill.id (или строке skill, на случай обоих форматов).
by_skill = defaultdict(list)
for item in items:
    skill_raw = item.get('skill', {})
    if isinstance(skill_raw, dict):
        skill_id = skill_raw.get('id', 'unknown')
    else:
        skill_id = str(skill_raw) if skill_raw else 'unknown'
    by_skill[skill_id].append(item)

# Порядок навыков из tasks.json (если доступен)
tasks_path = ROOT / 'learning-plan' / 'data' / 'tasks.json'
skill_order = []
if tasks_path.exists():
    with open(tasks_path, encoding='utf-8') as f:
        tasks_data = json.load(f)
    skill_order = [s['id'] for s in tasks_data.get('skills', [])]

# Дополняем skill_order навыками, не попавшими из tasks.json
for skill_id in by_skill:
    if skill_id not in skill_order:
        skill_order.append(skill_id)

# Записываем чанки и собираем индекс
chunks_meta = []
total_written = 0
for skill_id in skill_order:
    if skill_id not in by_skill:
        continue
    chunk_items = by_skill[skill_id]
    chunk_path = DST_CHUNKS / f'practice-{skill_id}.json'
    chunk_data = {
        'schemaVersion': 1,
        'skill': skill_id,
        'items': chunk_items,
    }
    with open(chunk_path, 'w', encoding='utf-8') as f:
        json.dump(chunk_data, f, ensure_ascii=False, indent=2)

    # Раздел берём из первого элемента (все в одном навыке — один раздел)
    section = chunk_items[0].get('section', '') if chunk_items else ''

    chunks_meta.append({
        'skill': skill_id,
        'section': section,
        'count': len(chunk_items),
        'path': f'learning-plan/data/chunks/practice-{skill_id}.json',
    })
    total_written += len(chunk_items)
    print(f'  {skill_id:30s} {len(chunk_items):3d} items → chunks/practice-{skill_id}.json')

# Записываем индекс
index_data = {
    'schemaVersion': 1,
    'totalItems': total_written,
    'chunks': chunks_meta,
}
with open(DST_INDEX, 'w', encoding='utf-8') as f:
    json.dump(index_data, f, ensure_ascii=False, indent=2)

print(f'\nИндекс: {DST_INDEX.name}  ({len(chunks_meta)} навыков, {total_written} items)')
print('Готово.')
