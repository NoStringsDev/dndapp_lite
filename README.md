# dndapp_lite

A small **Cloudflare Pages + D1** web app for one D&D party: mark availability on a rolling calendar, see **full-table** dates for **The Green Hunger**, book **Arcadia** sessions with a subset of players, and share a **subscribable ICS** feed of confirmed games. No admin UI — you sign in by **picking your name** from the roster (honour system). An optional **`GROUP_SECRET`** env var adds a shared password before the name step.

## Stack

- Static UI: `public/index.html`
- API: `functions/api.js` → `POST /api` with JSON `{ action, payload }`
- Calendar feed: `GET /calendar/<token>.ics`
- Database: SQLite on **D1** (`migrations/0001_init.sql`)

## Local development

1. `npm install`
2. Create D1 (once): `npm run db:create` — paste the returned `database_id` into `wrangler.toml` (replace the placeholder UUID).
3. `npm run db:migrate:local`
4. Optionally copy `.dev.vars.example` to `.dev.vars` and set `GROUP_SECRET` if you want to test the password gate locally.
5. `npm run dev` and open the URL Wrangler prints (usually `http://localhost:8788`).

Default roster (Chris, Emil, Jose, Aidan) is created by the migration. Add more players later with `INSERT` into `players` in the D1 console or a SQL file.

## Production

See [SETUP.md](./SETUP.md) for Cloudflare Pages and D1 binding.

## Privacy

Anyone who can open the app can pick any name unless you set **`GROUP_SECRET`**. Player selection is not cryptographically bound to identity — suitable for a trusted group of friends.
