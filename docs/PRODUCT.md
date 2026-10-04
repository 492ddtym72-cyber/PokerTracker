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
- **More** — password and session settings

## History rules

History records user-meaningful actions, not raw SQL operations.

Each create, update or delete stores a before/after snapshot so the UI can show concise changes such as:

- player added or removed
- stake changed
- cash-out changed
- title or date changed

Deleted poker nights remain visible in history but are excluded from active statistics.

## Explicitly out of scope

- hand histories
- per-hand actions
- live chip tracking
- blinds / positions / cards
- poker strategy or odds tools
- payments or money transfer
- public profiles

## Product principle

Entering an evening should take roughly one or two minutes after the game is finished.
