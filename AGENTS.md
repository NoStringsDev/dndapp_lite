# AGENTS.md

## Cursor Cloud specific instructions

### Overview

dndapp_lite is a Cloudflare Pages + D1 app for D&D party scheduling. Single dependency (`wrangler`). No build step, no bundler, no framework. See `README.md` for full stack description.

### Dev server

```
npm run dev          # starts Wrangler on http://localhost:8788
npm run dev:fresh    # migrate + seed + dev (clean start)
```

### D1 local database gotcha

`wrangler d1 execute --local` and `wrangler pages dev --d1=DB` create **different local SQLite files** under `.wrangler/state/v3/d1/`. The migration/seed scripts write to one hash, but the dev server reads from another. To initialise the database correctly for the dev server:

1. Start the dev server: `npm run dev &`
2. Hit the API once to create the D1 file: `curl -s -X POST http://localhost:8788/api -H 'Content-Type: application/json' -d '{"action":"getPublicBootstrap"}'`
3. Find the dev server's SQLite file: `find .wrangler -name "*.sqlite" -newer .wrangler/state/v3/d1 | head -1`
4. Apply schema + seed directly with `sqlite3`:
   ```
   sqlite3 <path-to-dev-sqlite> < migrations/0001_init.sql
   sqlite3 <path-to-dev-sqlite> < seed-dev.sql
   ```

Alternatively, delete `.wrangler/state/` entirely and the dev server will start fresh (but you still need to apply migrations via sqlite3 after the first API call).

### Lint / Test / Build

- **No linter configured** — there is no ESLint, Prettier, or similar in the project.
- **No test suite** — there are no automated tests.
- **No build step** — the frontend is a static HTML file served directly.

### Environment variables

- `GROUP_SECRET` (optional): set in `.dev.vars` to enable the password gate. Omit for name-only login.
- Copy `.dev.vars.example` to `.dev.vars` if you want to test the password gate.
