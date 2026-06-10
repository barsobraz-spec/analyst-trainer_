#!/usr/bin/env bash
# scripts/bump-cache-version.sh — синхронизирует ?v=… во всех ассетах.
#
# Использование:
#   1. Измени APP_CACHE_VERSION в config.js (одна строка).
#   2. Запусти этот скрипт из корня проекта:
#          bash scripts/bump-cache-version.sh
#
# Скрипт читает новое значение из config.js и обновляет четыре места:
#   index.html      — styles.css?v=…  и  main.js?v=…
#   main.js         — appRoutes.js?v=…
#   core/appRoutes.js — TasksView.js?v=…

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

# index.html: оба ?v=
eval "$SED 's/?v=[^\"'\'']*/?v=$VERSION/g' index.html"

# main.js
eval "$SED 's/?v=[^\"'\'']*/?v=$VERSION/g' main.js"

# core/appRoutes.js
eval "$SED 's/?v=[^\"'\'']*/?v=$VERSION/g' core/appRoutes.js"

echo "Готово. Проверь: grep -n '?v=' index.html main.js core/appRoutes.js"
