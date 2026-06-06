# Deployment

Analyst Trainer is a static browser application. It does not use a backend,
server functions, database service, or a build step. It is suitable for the
free Vercel plan as a static project.

## Stack

- HTML entry point: `index.html`
- JavaScript: native ES modules
- Routing: client-side hash routes, for example `#/learning/today`
- Styles: `styles.css`
- Static content: JSON files in `cases/` and `learning-plan/data/`
- Local third-party assets: `vendor/`
- Web Worker: `workers/sql.worker.js`
- WASM asset: `vendor/sql.js/sql-wasm.wasm`
- User data: browser IndexedDB

## Vercel Settings

Use these settings when importing the GitHub repository into Vercel:

| Setting | Value |
| --- | --- |
| Framework Preset | Other |
| Root Directory | repository root if the repo contains only `analyst-trainer`; otherwise `analyst-trainer` |
| Build Command | empty |
| Output Directory | empty or `.` |
| Install Command | empty |

The included `vercel.json` keeps the project static, sets the WASM content type,
and provides a fallback to `index.html` for non-file paths. The app itself uses
hash routing, so normal refreshes on routes like `/#/learning/tasks` work without
server-side routing.

## Local Pre-Deployment Check

Run from the `analyst-trainer` directory:

```sh
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080
http://localhost:8080/#/learning/today
http://localhost:8080/#/modules
http://localhost:8080/#/module/5.6/case/simulator-008
```

Refresh each page. The app should stay available because routes after `#` are
handled in the browser.

## GitHub To Vercel

1. Create a new GitHub repository.
2. Upload the contents of the `analyst-trainer` folder.
3. In Vercel, choose Add New Project.
4. Import the GitHub repository.
5. Confirm the settings above.
6. Deploy.
7. Open the public Vercel URL and test the routes listed in the local check.

## Notes

- Do not deploy via `file://`; the app needs HTTP for ES modules, `fetch()`,
  worker files, JSON data, and WASM.
- No environment variables are required for the current static version.
- No paid Vercel resources are required.
