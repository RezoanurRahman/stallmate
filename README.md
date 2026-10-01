# Stallmate

**A local-first weekend market operations desk.**

Stallmate keeps one market day in a single place: which vendors are booked, which stall each of
them stands in, what still has to be set up, and whether the site is actually ready to open. It
pairs a Hyperapp 2 dashboard with an Express 5 API and deterministic in-memory storage, so the
whole desk starts in a second and looks the same on every machine.

No database, no accounts, no API keys, no network calls: clone it, build it, run it.

## Key features

- **Vendor roster** — every booked vendor with its category, contact, and setup notes.
- **Stall assignments** — the stall map with zones and the vendor assigned to each stall, so you
  can see who stands where before the gates open.
- **Setup checklist** — the day's setup tasks with owner, priority, and status.
- **Readiness view** — a rollup of open items that answers "can this market open yet?".
- **Deterministic seed data** — the same sample market on every start, which makes the dashboard,
  the API, and the tests reproducible.
- **One command dev loop** — `npm run dev` runs the Vite client and the API together, with
  `/api` proxied so the browser sees a single origin.

## Stack

| Layer         | Choice                                                       |
| ------------- | ------------------------------------------------------------ |
| Frontend      | Hyperapp 2 + Vite 7                                          |
| Backend       | Express 5 on Node 20+                                        |
| Language      | TypeScript 5 in strict mode, ES modules everywhere           |
| Storage       | In-memory, deterministic seed data (no database)             |
| Tests         | Vitest 4 in a node environment, Supertest for the API        |
| Lint & format | ESLint 9 flat config + Prettier 3, wired into `npm run lint` |

## Requirements

- Node.js 20 or newer — Vite 7 asks for 20.19+, and CI runs the latest Node 20
- npm 10 or newer

## Quick start

Three commands, no configuration:

```bash
npm install
npm run build
npm start
```

Then open <http://127.0.0.1:3000>. `npm start` runs the Express server, which serves the built
client from `dist/` and the JSON API under `/api`.

Check that the API is alive at any time:

```bash
curl http://127.0.0.1:3000/api/health
```

## Development workflow

```bash
npm run dev
```

That starts both processes together (via `concurrently`):

- the Vite dev server on <http://localhost:5173> with hot module reloading, and
- the API on <http://127.0.0.1:3000> with `tsx watch`, so the server restarts on save.

Requests to `/api` from the Vite dev server are proxied to `http://127.0.0.1:3000`, so the client
always talks to a relative `/api` path and never needs a hard-coded host.

Prefer separate terminals? Use `npm run dev:client` and `npm run dev:server`.

## Quality commands

| Command             | What it does                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| `npm run lint`      | ESLint over the repository, then `prettier --check .`                     |
| `npm run typecheck` | `tsc --noEmit` with strict checking for the client, the server, and tests |
| `npm test`          | `vitest run` (node environment, `tests/**/*.test.ts`)                     |
| `npm run build`     | Production client build into `dist/`                                      |

Keep the tree formatted with `npx prettier --write .` before you push; generated output
(`dist/`, `coverage/`, `package-lock.json`, `node_modules/`) is ignored by `.prettierignore`.

## API

The server is a small JSON API mounted at `/api`. Start it with `npm start` (or `npm run dev`),
then use <http://localhost:5173/api/...> behind the Vite proxy or
<http://127.0.0.1:3000/api/...> directly.

- `GET /api/health` — liveness probe used by the dev proxy and the CI smoke test. It answers
  `{"status":"ok", ...}` as soon as the process is listening; this is the URL to poll from a
  script.
- `/api/vendors`, `/api/stalls`, `/api/tasks` — the collections the desk is built around: the
  vendor roster, stall assignments, and setup tasks. They follow the conventional REST shape:
  `GET` for the collection, `GET /api/<collection>/:id` for one record, `POST` to create,
  `PATCH` to update, and `DELETE` to remove.
- Every response is JSON, and every write lands in the in-memory store, so restarting the server
  puts the desk back to its seed state.

The server source in `src/server/` is the authoritative list of routes and payload shapes.

## Deterministic seed data

On start, the API loads a fixed sample market: the same records, with the same ids, in the same
order. Nothing is random and nothing is read from the clock or the file system, which means:

- the dashboard shows a realistic market day the first time you open it,
- `curl` calls and screenshots are identical on every machine,
- tests can assert exact ids and counts instead of fuzzy matches,
- restarting the process is also "resetting the demo" — writes never persist.

There is no migration step, no seed script to run, and no database to install.

## No external services

Stallmate is self-contained by design. There is no database to install, no third-party API to
call, no account to create, and no environment variables or API keys to set. `npm install` is the
only step that touches the network, and everything runs offline from there.

## Project structure

```text
stallmate/
├─ index.html              # app shell: title, meta tags, #app mount point, loads the client entry
├─ src/
│  ├─ client/              # Hyperapp 2 dashboard (main.ts entry, views, styles)
│  │  └─ vite-env.d.ts     # Vite client types
│  └─ server/              # Express 5 API (index.ts entry, routes, in-memory store, seed data)
├─ tests/                  # Vitest specs, run in the node environment
├─ dist/                   # build output from `npm run build` (generated, not committed)
├─ vite.config.ts          # Vite root/entry, dev server, /api proxy to 127.0.0.1:3000
├─ vitest.config.ts        # test environment and include patterns
├─ tsconfig.json           # one strict config covering browser and node files
├─ eslint.config.js        # ESLint 9 flat config (TypeScript + Prettier compatible)
├─ .prettierrc.json        # 100 columns, single quotes, semicolons, trailing commas
└─ .github/workflows/ci.yml
```

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request with Node 20 and no external
services. The steps are the same gates you can run locally, in the same order: `npm install`,
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npm start` with a `curl`
poll of <http://127.0.0.1:3000/api/health> until the server answers (and a shutdown afterwards).

## Conventions

- Conventional Commits for every change, for example `feat(api): add vendor roster endpoint`.
- Strict TypeScript everywhere; the client and the server share one `tsconfig.json`.
- ES modules only (`"type": "module"`), Node 20+ on the server, no CommonJS.
- Prettier decides formatting (100 columns, single quotes, semicolons, trailing commas) and
  ESLint enforces the rest; `npm run lint` fails if either is unhappy.

## License

[MIT](LICENSE) © 2026 Stallmate
