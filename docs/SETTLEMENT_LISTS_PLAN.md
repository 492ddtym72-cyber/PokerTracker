# Parallel settlement lists — implementation and data safety

Status: **implemented in PR #29**, gated by the additive D1 migration `0012_parallel_settlement_lists.sql`. Tested against a SQLite fixture and verified unchanged legacy-table fingerprints in production after applying the additive schema.

## Business rules

There is **one global poker history and leaderboard**, and **several payment ledgers**. A completed game contributes once to global player profit, win rate, appearances and total buy-ins. An unfinished game contributes nothing. Imported historical baseline results contribute to lifetime profit and buy-in volume, but are not counted as played evenings.

Each game is either:
- **Standalone** (`settlement_mode='separate'`): paid within its own existing `session_settlement_payments` ledger and graph.
- **Named settlement list** (`settlement_mode='pooled'` with a row in `settlement_list_nights`): aggregated with only the other games in the same named list, with its own payment history/graph.
- **Legacy Riga** (`settlement_mode='pooled'` *without* a row in `settlement_list_nights`): the existing in-progress payout, still calculated by the existing `/api/settlements` endpoint and recorded in `settlement_payments`.

This is an **additive** approach: Riga and its old payment requests, payment reports, route preferences and game records are never backfilled, retagged or rewritten. New lists occupy their own tables, so old Riga suggestions and outstanding amounts do not change.

## New schema

`settlement_lists`: named lists, unique case-insensitive names, status `open | paying_out | closed`.
`settlement_list_nights`: one primary-key row per game, with a foreign key to the named list. Insertion trigger enforces a valid pooled session and an open list; updates are forbidden; deletions are forbidden if any payment history exists or the list is no longer open.
`settlement_list_payments`: independent recorded/voided transfers, global idempotency token, list ID foreign key, date/note, payer/receiver. No old payment rows are moved.

The D1 migration uses `CREATE ... IF NOT EXISTS` and no `DELETE`, `UPDATE` or `ALTER TABLE` statements on legacy data. It can be safely encountered again by the standard Wrangler migrations process.

## API

- `GET/POST /api/settlement-lists`: list summaries and create an open list.
- `GET/PATCH /api/settlement-lists/:id`: list-specific balance/flow/history and status transitions.
- `POST /api/settlement-lists/:id/payments`: validate payer, recipient, amount and list; record a payment; automatically mark the list as paying out after the first payment.
- `DELETE /api/settlement-lists/:id/payments/:paymentId`: void a payment only from that list.
- Existing `/api/settlements`, requests, PayPal handoff and payment history remain **Riga-only**.
- Existing `/api/nights` accepts `settlementListId` and returns it with each game. The session and its list-membership row are written atomically using D1 `batch()`. The server validates list ownership and status independently of frontend selections.

The named-list balances sum only results from completed linked games and subtract/add only that list's active payments. A player in two lists can owe in one and receive in the other without netting the two groups.

## Status / safeguards

1. **Open**: can accept new games and edits while no payments have been recorded. Opening a game in checkout defaults to standalone; choosing a list is explicit.
2. **Paying out**: no new games, result edits or reassignment. Existing recorded payments can be managed and voided.
3. **Closed**: fully settled, read-only. Can only close from paying-out status with zero outstanding transfers and zero unresolved result discrepancy.
4. Cannot start payout or record a payment while a linked game is unfinished.
5. Recording the first group payment automatically begins payout and freezes assignments.
6. Existing Riga results—including the imported baseline—are immutable while the old payout is underway, but existing Riga payment/void/request routes stay functional.
7. Named list assignments are immutable once made; existing completed or paid games cannot be silently moved. Sessions are never counted twice in separate group payouts.

## User interface

- Home shows the **all-time buy-in volume**, including the historical baseline, but does not display Riga's remaining payout amount. That balance lives inside **Abrechnung → Riga**.
- Abrechnung has an expandable **Riga** card; separate named list cards each show their own balance, payment flow, payment history and manual payment/undo functionality. Existing standalone session cards remain below.
- Game editor: choose **Nur diese Session** or **Abrechnungsliste**. For a named list, choose an open list or create one. For existing Riga games, the payout is displayed as locked.
- **Parity deliberately deferred:** named lists currently support manual payment recording but not the existing Riga-only inbox reminders and PayPal/Revolut handoff. Those are not exposed for named groups until their request validation, return flow and ledger-specific routing are built/tested.

## Validation

- Before production schema change: Cloudflare D1 SQL export completed and hashes recorded for nine legacy tables. No edits to old records.
- After schema change: all nine old table counts and content fingerprints matched exactly, including the saved payment requests and existing route preferences.
- Automated CI: TS frontend and Pages Functions builds, Node stats/settlement-flow tests, Python legacy D1 tests, SQLite migration isolation tests.
- New APIs must never be deployed before the additive D1 migration. Deployment succeeds only once the new table presence and legacy fingerprint checks pass.

## Future work

- Scoped inbox payment requests, reminders, PayPal/Revolut handoff, and payment-report confirmation for named lists, implemented only after adding explicit `list_id` validation to every affected endpoint.
- Optional player identity disambiguation when different friend groups contain different people with the same name; the current global player registry is shared.
- Group list names/management enhancements and read-only completed-list archive.

## Rollback

Old data and old endpoints remain intact. Rolling back the Pages deployment to the previous version disables new-list UI but will not remove new tables. If new groups have made payments, **do not drop their tables**; preserve them and restore the new UI later. Never rollback by merging named payments into Riga.
