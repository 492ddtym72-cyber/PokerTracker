# Deployment

PokerTracker runs on Cloudflare Pages + Pages Functions + D1.

## Cloudflare Pages

Connect the GitHub repository to Pages.

Build settings:

- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `main`

The root-level `functions/` directory is deployed as Pages Functions.

## D1

Create a D1 database and bind it to the Pages project as:

- Binding name: `DB`

Apply `migrations/0001_initial.sql` to the database.

## Authentication

PokerTracker does not keep a plaintext password in GitHub or Pages environment variables.

The shared password is stored only as a PBKDF2-SHA256 derived hash plus a random salt in the private D1 database. The same derived key signs the HttpOnly session cookie.

Changing the stored password hash automatically invalidates existing sessions.

## Local development

The Vite-only command:

```bash
npm run dev
```

runs only the frontend.

A complete local stack requires a Wrangler Pages development environment with a D1 binding named `DB`.
