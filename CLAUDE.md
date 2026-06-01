# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

KubeKosh runs a real single-node **K3s** cluster inside one Docker container, paired with a browser terminal (`xterm.js` ⇄ `node-pty` WebSocket PTY) and automated scenario validation. The curriculum is data, not code: scenarios live in JSON.

## Layout

- `backend/` — Express API + WebSocket PTY (`server.js`), CommonJS, SQLite via `better-sqlite3`. Listens on port **4000**.
- `frontend/` — React 18 + Vite SPA, plain JS (no TypeScript), CSS Modules.
- `scenarios/` — `scenarios.json` (the exercises), `bundles.json` (learning tracks/exams), `SCHEMA.md` (authoritative schema — read it before touching either JSON).
- `scripts/` — `entrypoint.sh` (starts K3s + backend + nginx), `nginx.conf`.
- `Dockerfile` — single Ubuntu 22.04 image, Node 20, bundles K3s.

## Running & verifying changes

The K3s cluster **only exists inside the container**, so scenario validation, setup/teardown, and the terminal cannot be exercised outside Docker. To actually test a change:

```bash
docker build -t kubekosh . && docker run --rm -itd --privileged -p 7554:80 kubekosh
```

`--privileged` is required (K3s needs kernel namespaces/cgroups). Open http://localhost:7554 and wait ~30s for *Cluster Ready*.

`frontend/` and `backend/` have **separate** `package.json` files — `npm install` in each. Local servers (`npm run dev` in `frontend`, `npm start` in `backend`, Vite proxies `/api` → `:4000`) give UI-only iteration with **no live cluster** — don't use them to confirm scenario/validation behavior.

There is **no test runner, linter, or formatter** configured. Don't invent `npm test`/`npm run lint`. Verification is the Docker run above.

## Authoring scenarios (most common change — see `scenarios/SCHEMA.md`)

- `id`s must be unique and kebab-case; every `scenario_ids` entry in `bundles.json` must resolve to a real scenario.
- MCQ: `correct_option` **must** match one of the `options[].id` values, and always include an `explanation`.
- Task: include `validation.commands` with idempotent **`kubectl`** commands and a `match` mode (`exact` | `contains` | `not_contains` | `regex`).
- `setup_commands` / `teardown_commands` are arrays of **objects** with a `command` key — `kubectl` or native Ubuntu only. They run as **root**, and non-zero exit codes are tolerated (won't halt the pipeline).

## Conventions & gotchas

- Conventional Commits (`feat:`, `fix:`, …); branch `feat/<short-name>`; PRs target `main`.
- **No `.gitignore` exists.** After `npm install`, never `git add .` blindly — it would commit `node_modules/` and `frontend/dist/`. Stage files explicitly.
- Progress persists at `/data/progress.db`; unmounted `/data` means progress resets on restart.
- `VITE_APP_VERSION` is injected at Docker build time (defaults to `dev`).
