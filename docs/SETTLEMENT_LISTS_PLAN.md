# Settlement lists: independently payable friend groups

Status: design specification. **Only the Riga section, the safe default and the home-volume fix are implemented in the initial PR.** Parallel-list APIs and database migration described below are NOT yet shipped.

## Product contract

PokerTracker has one global game history and leaderboard, but multiple independent payment ledgers.

- Every **completed** game contributes once to player lifetime statistics, regardless of payment destination. An ongoing game contributes nothing until finalized; historical baseline records contribute to cumulative player profit, not to games played or played volume.
- Every session belongs to exactly one settlement destination:
  1. **Single session** — existing `settlement_mode='separate'`, existing per-session payment table/diagram.
  2. **Named settlement list** — pooled with other selected sessions in the same list. Lists exist in parallel, and payments in one cannot offset debt in another.
- A settlement list may contain sessions involving different overlapping sets of players; only those involved have balances in that list.
- **Riga** is the initial named settlement list built from the existing shared pool. Its outstanding amounts, manually recorded payments, payment requests and route preferences must remain financially identical after migration. Riga is *paying out*, so new sessions cannot silently join it.
- Lists have statuses `open` (accept more sessions), `paying_out` (no new sessions or result edits; existing payments can be recorded/voided), and `closed` (read-only; manual confirmation to close once reconciled). Never auto-close because a fully paid list may need reconciliation.
- An existing completed game must not be reassigned if it has payments or has already entered a paying-out/closed list, absent an explicit audited reversal workflow. No double membership.

## UI workflow

**Abrechnung landing page:** section `Abrechnungslisten` with cards for Riga and every new named list (e.g. `Hamburg`, `Freunde`). Each card shows list name, status, session count, number of participating players, and outstanding amount; click to expand into the familiar list/flow payment diagram, open balances, payment history, reminders, PayPal handoff, and pay/undo actions. Each list has its own local state and API requests. Below: existing `Separate Sessions` section with their own expandable diagrams.

**Checkout / new night:** choose `Einzelne Session` (standalone) or `Zur Abrechnungsliste`, then a second selector listing **only open lists** with option `Neue Liste erstellen`. Show selection clearly in the session details. A finalized session enters its selected ledger once. For an ongoing game, destination can be edited until finalized. Do not offer Riga, or any paying-out/closed list, as a destination. In the interim, until list creation ships, the UI defaults new sessions to standalone and requires an explicit confirmation before adding to legacy Riga.

**Creation:** name a new list, optional description, optional initial participants; actual financial membership is defined by assigned session results. Allow renaming with audit trail, prohibit deletion while sessions/payments exist. Show `Archiviert` filter separately, never mix closed lists with outstanding ones.

**Home summary:** `Einsätze gesamt` sums buy-ins across ALL completed real sessions, regardless of destination; exclude baseline records and ongoing sessions. The home settlement shortcut must identify its actual scope (currently Riga), not imply a group-agnostic global debt. Once lists exist, use outstanding lists count or a list chooser, not a sum that permits cross-list netting.

## Persistence and data migration (Cloudflare D1)

1. Take a backup/export and record **before** snapshots for the old main settlement: result sum per player, outstanding sum, every recorded payment/void, pending request and current route preference. Use consistent transaction/snapshot, and verify against current API response.
2. Create `settlement_lists(id PRIMARY KEY, name NOT NULL, description, status CHECK(...), created_at, updated_at, closed_at)`; insert a **stable** Riga legacy ID with status `paying_out`.
3. Add `poker_nights.settlement_list_id` nullable FK. Backfill **all existing pooled sessions** to Riga (including ongoing, then require explicit action before finalization); standalone ones must remain NULL. Add CHECK at application level: `separate` implies NULL, `pooled` requires a valid list, then add DB constraints via table rebuild if needed. Unique assignment is guaranteed by a single FK column, not a many-to-many table.
4. Add `settlement_payments.settlement_list_id` and backfill every existing shared payment to Riga, preserving IDs, tokens, void status, amounts and dates. Create list-aware indexes. No attempt to convert local session payments.
5. Bind existing `payment_requests` and related inbox reporting to their exact list (requests must never be considered evidence of payment in a different list). Backfill old requests to Riga. Review all APIs that infer payer/recipient balances from the legacy endpoint.
6. Preserve `settlement_route_priorities` for Riga, including its original v1 snapshot key, so its current diagram/order is not disturbed by a mere UI/data migration. New lists use a list-ID-prefixed, versioned snapshot key; route preferences are never shared across lists.
7. Make list assignment immutable for sessions that have any payments, or whose list is `paying_out`/`closed`. Lock Riga's completed source results as part of payout protection; allow audited corrections only through a purpose-built reversal process.
8. Pre/post-assert identical Riga per-player poker balances, open balances, total outstanding, transfers/order, payment IDs and amounts, active/voided history, and inbox requests. Abort or restore if any mismatch. Test local D1 migration with realistic fixtures before applying to production.

## API contract

- `GET /api/settlement-lists`: headers and counts; `POST`: create one (open).
- `GET /api/settlement-lists/:id`: list-scoped player balances, payments and suggested transfers; `PATCH`: rename/status transition with validation.
- `POST /api/settlement-lists/:id/payments`, `DELETE .../payments/:paymentId` (void): authorize list membership and cap payments to that list's current outstanding balances.
- `POST /api/nights`, `PUT /api/nights/:id`: accept a discriminated `destination: {kind:'session'} | {kind:'list',listId}`. Validate server-side; do not trust the frontend; legacy request formats map explicitly to Riga only for historical compatibility and should be deprecated after migration.
- `GET /api/settlements` remains a compatibility alias **for Riga only** during rollout. Existing payment and PayPal-hand-off routes must either explicitly resolve Riga or accept a validated list ID; they must never combine lists.
- Settlement suggestions compute SQL aggregates using `WHERE settlement_list_id = ? AND status='completed'`, with payments also filtered by the same list ID, including void semantics. Use consistent/read-safe snapshots, validate in the same transaction as mutations, and retain idempotent client tokens.
- Each reminder/request and external payment-app preparation must be scoped to the selected list. Notify/report/confirm actions must never apply across list boundaries.

## Acceptance / regression tests

- Migration: identical Riga snapshot and payment histories before/after; overlapping players across Riga and Hamburg produce independent debts; legacy route preferences unchanged.
- List isolation: A pays B in Hamburg; Riga suggestions and open balances remain byte-for-byte unchanged, and vice versa. Two independently open lists and a standalone session may exist concurrently.
- Lifecycle: open -> paying_out -> closed; no new games added once payout begins; payment/undo allowed while paying_out; closed immutable.
- Enrollment: selecting a list requires an explicit choice; duplicate session membership impossible; changing assignment after a payment fails; concurrent finalization cannot double-count.
- Leaderboard: all completed sessions from every destination included exactly once; baseline excluded from game count/volume; ongoing excluded; payment recording does not change leaderboard.
- API integrity: invalid IDs, unauthorized transitions, stale snapshot and replayed tokens, cross-list request IDs and handoffs rejected.
- End-to-end: checkout creates new list, add two games, inspect diagram, record partial payment, add independent game to separate list, settle it, reopen both, compare values after refresh.

## Proposed implementation sequence

1. **Shipped foundation:** Riga card scoped to current pooled settlement; new sessions default to standalone; home volume and counts cover all completed sessions; no DB/payment API change.
2. **Migration & read-only list-scoped snapshots:** D1 tables and backfill with golden-snapshot tests, read API for Riga + second fixture list; release with existing payment UI unchanged behind compatibility route.
3. **Write isolation:** list-scoped payment, preferences, reminders, PayPal and undo endpoints; integration tests for no cross-list effects.
4. **Checkout & management UI:** create lists, select destination, status transitions; show list cards and diagrams with updated payment flows.
5. **Migration verification & rollout:** back up, verify pre/post hashes and cents, activate UI after CI and D1 checks, monitor and preserve rollback path. Keep legacy Riga out of the set of selectable open lists throughout payout.
