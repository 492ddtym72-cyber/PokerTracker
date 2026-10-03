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

For each night, PokerTracker also compares total stakes with total cash-outs. A difference is shown as a warning rather than blocking the save.

## MVP

1. Shared password-protected access
2. Shared persistent database
3. Create a poker night
4. Edit a poker night
5. Delete a poker night
6. Session history
7. Lifetime player statistics
8. Mobile-first UI
9. Clear balance warning

## Explicitly out of scope for MVP

- hand histories
- per-hand actions
- live chip tracking
- blinds / positions / cards
- poker strategy or odds tools
- payments or money transfer
- public profiles

## Product principle

Entering an evening should take roughly one or two minutes after the game is finished.
