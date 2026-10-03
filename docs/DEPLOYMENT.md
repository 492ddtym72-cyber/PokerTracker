# Deployment

PokerTracker is designed for Cloudflare Pages + Pages Functions + D1.

## 1. Create the Pages project

Connect this GitHub repository to Cloudflare Pages.

Build settings:

- Build command: `npm run build`
- Output directory: `dist`

The root-level `functions/` directory is deployed as Pages Functions.

## 2. Create a D1 database

Create a D1 database, for example `pokertracker`.

Apply:

```bash
npx wrangler d1 migrations apply pokertracker --remote
```

The SQL migration is in `migrations/0001_initial.sql`.

## 3. Bind D1 to the Pages project

In Cloudflare Pages settings add a D1 binding:

- Variable name: `DB`
- Database: your PokerTracker D1 database

Use the same binding name for preview if you want preview deployments to have database access.

## 4. Set secrets

Add these as encrypted environment variables / secrets in the Pages project:

- `APP_PASSWORD`: the shared password for your poker group
- `SESSION_SECRET`: a long random secret used to sign the authentication cookie

Never commit either value.

## 5. Redeploy

Bindings and secret changes require a new deployment.

## Local full-stack development

Copy:

```bash
cp .dev.vars.example .dev.vars
```

Set real local values in `.dev.vars`.

For local D1 development, configure a local Pages D1 binding with Wrangler and then run:

```bash
npm run build
npx wrangler pages dev dist
```

The Vite-only `npm run dev` command runs the frontend but does not provide Pages Functions or D1.
