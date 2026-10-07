# PokerTracker product definition

## Purpose

PokerTracker records the financial result of a complete private poker evening.

It is not a hand tracker and is not intended to be used during play.

## Core unit

One poker night contains:

- date
- optional descriptive title
- participating players
- each player's total amount put into the game
- each player's final cash-out

For each player:

`profit/loss = cash-out - total stake`

For each night, PokerTracker compares total stakes with total cash-outs. A difference is shown as a warning rather than blocking the save.

## Current product structure

- **Home** — overview and recent poker nights
- **History** — append-only audit trail for created, changed and deleted poker nights
- **New poker night** — fast end-of-evening entry
- **Players** — lifetime standings derived from saved nights
- **More** — device-local identity, language, password and session settings
- **Settle up** — current player balances, personalized suggested transfers, list/flow views, PayPal handoff, partial payments and payment history

## History rules

History records user-meaningful actions, not raw SQL operations.

Each create, update or delete stores a before/after snapshot so the UI can show concise changes such as:

- player added or removed
- stake changed
- cash-out changed
- title or date changed

Deleted poker nights remain visible in history but are excluded from active statistics.

## Settlement rules

Poker results and real-world payments are separate ledgers.

- Poker results remain unchanged after a payment.
- Each payment is stored in cents with payer, recipient, date and optional note.
- Partial payments are supported.
- Active payments reduce the outstanding balances; voided payments remain in history but no longer affect balances.
- Suggested transfers are recalculated from current open balances.
- A payment cannot exceed either the payer's open debt or the recipient's open winnings.
- Unresolved poker-night differences are shown separately because payments cannot make an imbalanced set of results sum to zero.
- The optional "this device is..." player identity is stored only in localStorage and never changes settlement mathematics or permissions.
- Payment-account identifiers are not stored. Before PayPal or Revolut is opened, the server recalculates the currently valid suggested transfer; the current amount is copied to the clipboard and the user chooses the recipient in the payment app.
- The flow view is a visualization of optimized settlement transfers, not a claim that one player directly owes another for a specific poker night.

## Explicitly out of scope

- hand histories
- per-hand actions
- live chip tracking
- blinds / positions / cards
- poker strategy or odds tools
- public profiles

## Product principle

Entering an evening should take roughly one or two minutes after the game is finished.
