# dndapp_lite — deployment

Target: **Cloudflare Pages** with **D1** and one **secret** (`GROUP_SECRET`).

## 1. Create the D1 database

```bash
npm run db:create
```

Copy the database id into `wrangler.toml` as `database_id` for `dndapp-lite-db`. You can print it anytime with `npm run db:info` (after `wrangler login`). **Git-based Pages deploys read this file**—if `database_id` is still the placeholder UUID, the build fails with **Error 8000022 / Invalid database UUID**.

## 2. Apply schema (remote)

```bash
npm run db:migrate:remote
```

## 3. Cloudflare Pages project

- **Build command**: leave empty (static site).
- **Build output directory**: `public`
- **Functions**: repository root includes `functions/`; Wrangler uses it automatically when deploying with `wrangler pages deploy public` from this repo root (or configure the project to attach the same `functions` folder).

Bind **D1**:

- Variable name: `DB`
- Database: `dndapp-lite-db`

## 4. Secret

In **Pages → Settings → Environment variables** (production and preview if needed):

| Name           | Type   | Value                                      |
|----------------|--------|--------------------------------------------|
| `GROUP_SECRET` | Secret | A long random string only your party knows |

Do not commit `GROUP_SECRET` to git.

## 5. Deploy

From the repo:

```bash
npm run deploy
```

## 6. Calendar feed URL

After login, the app shows an **https://…/calendar/&lt;token&gt;.ics** URL. Subscribers can use **Subscribe** / **From URL** in Apple Calendar or Google Calendar. Use **Rotate link** if the URL leaks.

## Optional: local secrets file

For `wrangler pages dev`, create `.dev.vars` (gitignored):

```
GROUP_SECRET=your-local-test-secret
```

See `.dev.vars.example`.
