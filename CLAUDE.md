# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service is

The Glowra Search API — the primary backend. It serves procedure/clinic search, clinic
management, and the blog (public + admin). Express + `mssql` (SQL Server).

## Project context

Glowra is a website platform for plastic surgery information: a landing page, a search page
that displays procedures, and clinic pages.

The project spans three repositories, normally cloned as siblings in the same parent directory:

| Repo | Role | Local port |
|---|---|---|
| `glowra-FE` | Frontend (Create React App) | 3000 |
| `glowra-search-api` | Search / clinics / blog backend (this repo) | 3001 |
| `glowra-contact-request-api` | Consultation + clinic listing requests | 3002 |

**This repo and `glowra-FE` frequently require coordinated changes.** Any change to a response
shape, query parameter, or endpoint path likely needs a matching frontend change. See Rule 1 in
`.cursorrules` for how to hand those changes off to the frontend.

## Commands

- Start server: `npm start` (listens on `PORT`, default 3001)
- Run tests: `npm test` (Node built-in test runner against `test/`)
- Run clinic-management migrations: `npm run migrate:clinic-management`

## Setup

Copy `.env.example` to `.env` and fill in real values. Database credentials are not in the repo —
get them from Rob. The API will fail to start without a reachable database.

## Architecture

- `app.js` — large monolithic Express app; most search and clinic endpoints are defined inline
  here. Mounted routers are attached near the bottom of the file.
- `routes/` — extracted routers (`blogPublicRoutes`, `blogAdminRoutes`, `blogSeoRoutes`), mounted
  at `/api/blog`, `/api/blog-posts`, `/api/admin/blog`, `/api/admin`
- `clinic-management/` — self-contained clinic management module with its own docs and
  `swagger.js`, mounted at `/api/clinic-management`
- `services/` — business logic and database access
- `schema/` — field definitions and validation rules
- `utils/` — shared helpers
- `migrations/` — hand-written `.sql` files, named `[action][TableName].sql`
- `db.js` — connection pooling (already configured; use it, don't create new connections)
- `jobs/` — scheduled work via `node-cron`

Route ordering in `app.js` matters — more specific routes must be declared before parameterized
ones (e.g. a literal path before `/api/clinics/:clinicId`) or they will be shadowed.

## Conventions

Detailed rules live in `.cursorrules` and apply to Claude Code equally. The most load-bearing:

- **Migrations**: every schema change gets a new file in `migrations/`. Document manual steps in
  SQL comments, including any commands that need to be run by hand.
- **Layering**: routes handle HTTP and validation; services hold business logic and DB access.
- **Transactions**: use them for multi-table writes, with rollback handling. Follow
  `services/clinicCreationService.js`.
- **SQL**: always parameterized queries. Never string-concatenate user input.
- **Docs**: update existing documentation rather than writing "what changed" summaries — git is
  the change log. New endpoints need Swagger updates in `clinic-management/swagger.js`.

## Docs

- `docs/` — general feature guides
- `docs/FE communications/` — handoff documents for frontend work
- `docs/Future Work/` — planned and partial work
- `clinic-management/docs/` — clinic management specifics, including `TEST_CHECKLIST.md`

## Deploys

Pushing to `main` triggers an automatic production deploy. Do not push until the change has been
reviewed running locally.

## Task tracking

Linear workspace `Glowra` (linear.app/glowra) is the primary tracker. A JIRA project `GLOW` at
`rob-zajac-glowra.atlassian.net` also exists and is mirrored.
