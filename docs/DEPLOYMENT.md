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

Apply all SQL files in `migrations/` to the database in numeric order. Existing installations should apply only migrations that have not yet been run.

Before deploying payment requests, apply `migrations/0008_payment_requests.sql` to the existing D1 database **once**, after obtaining a backup or time-travel bookmark. This migration is additive, but must precede deploying its API code.

The inbox is currently profile-filtered, **not access-controlled per person**: anyone with the shared group password can switch to any player profile. Use only within a trusted group until individual player authentication exists. External payment links are unverified and do not trigger automatic settlement.

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

## Ongoing poker sessions (migration 0010)

Before deploying code that uses session statuses, create a D1 Time Travel bookmark
or export the production database. Apply `migrations/0010_ongoing_sessions.sql`
**once** to the existing database. The migration adds a status column, defaults
historical records to completed, and marks sessions with stakes but zero
cash-outs as ongoing; it never deletes or edits individual results or payments.

Ongoing sessions remain in the night list and are fully editable, but do not
contribute to balances, payment requests, payouts, leaderboard statistics, or
the saved settlement route snapshot. Finalizing requires a balanced session
(including any recorded cent adjustments). Do not rerun the migration.

## Separate session settlements (migration 0011)

Before deploying code supporting session-only accounting, back up the production D1
or create a Time Travel bookmark, then apply `migrations/0011_session_settlements.sql`
**once**. This adds a `settlement_mode` column defaulting to `pooled` so all
historical nights, totals and payments remain unchanged. A new
`session_settlement_payments` table holds local transfers separately from the
existing overall ledger.

A completed night can be reclassified only while no active global settlement
payments or newer outstanding requests would be invalidated. Once a separate
session has recorded payments, changing its results or mode is blocked until
those payments are voided. Every local transfer remains in its own session's
history, even after cancellation.

The migration was applied to the production D1 binding on 2026-10-15 after a
Time Travel bookmark and row-count check.
