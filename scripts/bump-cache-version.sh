#!/usr/bin/env bash
# scripts/bump-cache-version.sh — синхронизирует ?v=… во всех ассетах.
#
# Использование:
#   1. Измени APP_CACHE_VERSION в config.js (одна строка).
#   2. Запусти этот скрипт из корня проекта:
#          bash scripts/bump-cache-version.sh
#
# Скрипт читает новое значение из config.js и обновляет все места, где уже есть ?v=….

set -euo pipefail
cd "$(dirname "$0")/.."

# Читаем APP_CACHE_VERSION из config.js
VERSION=$(grep "APP_CACHE_VERSION\s*=" config.js | sed "s/.*'\(.*\)'.*/\1/")
if [[ -z "$VERSION" ]]; then
  echo "ОШИБКА: не удалось прочитать APP_CACHE_VERSION из config.js" >&2
  exit 1
fi

echo "Применяю версию: $VERSION"

# macOS-совместимая замена (sed -i '' вместо sed -i)
SED="sed -i ''"

FILES=$(grep -RIl --include='*.html' --include='*.js' '?v=' .)
for file in $FILES; do
  eval "$SED 's/?v=[^\"'\'']*/?v=$VERSION/g' \"$file\""
done

echo "Готово. Проверь: grep -R \"?v=\" -n --include='*.html' --include='*.js' ."
