# Контракт DOM-событий Analyst Trainer

Все пользовательские события распространяются через `window` (CustomEvent).
Имена — именованные константы; строковые литералы в коде запрещены.

---

## `at:progress-changed`

**Константа:** `PROGRESS_EVENT` в `core/event.js`

**Издатель:** `core/event.js → saveAndFinalize()`

**Payload (`event.detail`):**
```js
{ caseId: string, module: string }
```

**Слушатели:**
- `core/components/Sidebar.js` — обновляет кольцо цели и прогресс-бары без перезагрузки.

---

## `at:favorites-changed`

**Константа:** `FAVORITES_EVENT` в `core/favorites.js`

**Издатель:** `core/favorites.js → toggleFavorite()`

**Payload (`event.detail`):**
```js
{ caseId: string, favorite: boolean }
```

**Слушатели:**
- `modules/favorites/FavoritesView.js` — перерисовывает список избранного при изменении.
