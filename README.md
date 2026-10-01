# Stallmate

**A local-first weekend market operations desk.**

Stallmate keeps one market day in a single place: which vendors are booked, which stall each of
them stands in, what still has to be set up, and whether the site is actually ready to open. It
pairs a Hyperapp 2 dashboard with an Express 5 API and an in-memory store seeded with the same
sample market on every start, so the whole desk is up in a second with no database to set up.

No database, no accounts, no API keys, no network calls: clone it, build it, run it.

## Key features

- **Market selector** — pick the weekend market you are working on; the roster, setup plan, and
  readiness view all follow the selection.
- **Vendor roster** — every booked vendor with its category, contact, stall code, fee, status,
  and check-in state.
- **Setup checklist** — the market's setup tasks grouped by area, with assignee, due time, and a
  completion toggle.
- **Readiness metrics** — stall allocation against capacity, checked-in vendors, open tasks, and
  setup progress, so "can this market open yet?" has a visible answer.
- **Status workflows** — market status moves through planning → confirmed → live → complete;
  vendors are confirmed, pending, or waitlisted, and are checked in or out on the roster.
- **Creation forms** — add a market from the header or a vendor from the roster without leaving
  the dashboard.
- **Deterministic seed data** — fixed sample records, with fixed ids and order on every start,
  which makes the dashboard, the API, and the tests predictable. Mutations stay in memory, so
  writes reset on restart and only the timestamps they generate differ between runs.
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

## User interface

The Hyperapp client is one operations desk with a **market selector** in the header. The selected
market scopes the vendor roster, the setup plan, and the readiness metrics.

- **Overview** — the selected market's venue, neighborhood, date, notes, and status; stall
  allocation against capacity; market status controls; "Today's brief" with open tasks and
  pending or waitlisted vendors; setup progress; vendor status breakdown; and the recent activity
  feed.
- **Vendors** — the vendor roster table (category, stall, contact, fee, status, check-in) with a
  search box, status filter chips, an inline check-in toggle, and an add-vendor form.
- **Setup** — setup tasks grouped by area with per-area progress and a checkbox to mark each task
  complete.

Those are the status workflows: market status controls, vendor check-in, and task completion;
a vendor's status (confirmed, pending, or waitlist) is chosen in the add-vendor form. Every
change goes straight to the API and the dashboard re-fetches afterwards, so the screen always
shows what the server stored. "New market" opens a modal form (name, date, venue, neighborhood,
capacity, notes); "Add vendor" opens a form (market, name, category, stall, contact, fee, status).

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

| Route                    | What it does                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`        | Liveness probe used by the CI smoke test. Answers `{"status":"ok","service":"stallmate"}` once the process is listening.       |
| `GET /api/dashboard`     | The whole desk in one payload: `markets`, `vendors`, `tasks`, `activity`, and derived `metrics`.                               |
| `GET /api/markets`       | All markets.                                                                                                                   |
| `POST /api/markets`      | Creates a market and returns it with HTTP 201.                                                                                 |
| `PATCH /api/markets/:id` | Moves a market's status: `planning`, `confirmed`, `live`, or `complete`. `status` is required and the only accepted field.     |
| `GET /api/vendors`       | All vendors, or one market's vendors with `?marketId=<id>`.                                                                    |
| `POST /api/vendors`      | Creates a vendor on an existing market and returns it with HTTP 201.                                                           |
| `PATCH /api/vendors/:id` | Updates `status` (`confirmed`, `pending`, `waitlist`) and/or `checkedIn` (boolean); at least one is required, no other fields. |
| `GET /api/tasks`         | All setup tasks, or one market's tasks with `?marketId=<id>`.                                                                  |
| `PATCH /api/tasks/:id`   | Sets `completed` (boolean), the required and only accepted field.                                                              |
| `GET /api/activity`      | The activity feed, newest first.                                                                                               |

### Payloads

- **Market** — `id`, `name`, `date` (`YYYY-MM-DD`), `venue`, `neighborhood`, `status`, `capacity`,
  `notes`, and `createdAt`. `POST` requires `name`, `date`, `venue`, and `neighborhood`; `capacity`
  defaults to `20`, `notes` to `""`, and `status` to `"planning"`. A market with the same name and
  date is rejected.
- **Vendor** — `id`, `marketId`, `name`, `category`, `stall`, `contact`, `fee`, `status`,
  `checkedIn`, and `createdAt`. `POST` requires `marketId`, `name`, `category`, `stall`, and
  `contact`; the market must exist and the stall code must be free on that market. `fee` defaults
  to `0`, `status` to `"pending"`, and `checkedIn` to `false`.
- **Setup task** — `id`, `marketId`, `title`, `area`, `dueTime`, `assignee`, `completed`, and
  `createdAt`. Tasks come from the seed data; the API only toggles `completed`.
- **Activity** — `id`, `kind` (`market`, `vendor`, `task`, or `system`), `message`, and an ISO 8601
  `timestamp`. Creating or updating a market, vendor, or task appends an entry.
- **Dashboard metrics** — `upcomingMarkets` (markets that are not `complete`), `totalVendors`,
  `openTasks`, and `readiness` (the percentage of setup tasks completed).

There is no `GET /api/<collection>/:id`, no `DELETE`, and no `/api/stalls` route: the desk reads
collections and supports the creations and updates above. Unknown ids answer 404, invalid bodies
answer 400 as `{"error":"..."}`, and any other `/api/*` path answers 404.

The server source in `src/server/` is the authoritative list of routes and payload shapes.

## Deterministic seed data

On start, the API loads a fixed sample desk: the same seed records, with the same ids, in the same
order, and with the same seed timestamps. That means:

- the dashboard shows a realistic market day the first time you open it,
- `curl` calls and screenshots of the seeded records are identical on every machine,
- tests can assert exact seed ids and counts instead of fuzzy matches.

Only mutations vary: markets and vendors created after start, and the activity entries the API
appends for changes, are stamped with the current clock, so those timestamps differ between runs.
Everything still lives in memory, so restarting the process is also "resetting the demo" — writes
never persist.

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
