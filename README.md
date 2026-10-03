# PokerTracker

PokerTracker is a small private web app for recording the result of an entire poker evening.

It is deliberately **not** a hand tracker. Nothing needs to be entered while playing.

For every poker night, the group records:

- date / session name
- participating players
- each player's **total stake** for the complete evening
- each player's **final cash-out**

PokerTracker then calculates profit/loss, checks the table balance and builds lifetime player statistics.

## MVP

- shared password-protected access
- shared Cloudflare D1 database
- add, edit and delete poker nights
- automatic profit/loss per player
- automatic session balance warning
- session history
- lifetime player standings
- mobile-first interface

## Stack

- React
- TypeScript
- Vite
- Cloudflare Pages
- Cloudflare Pages Functions
- Cloudflare D1

The GitHub repository can remain public. The shared password and session-signing secret are deployment secrets and are never committed to the repository.

## Local frontend

```bash
npm install
npm run dev
```

This starts Vite only. The shared API requires Pages Functions + D1.

## Full-stack / deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Database schema:

```
migrations/0001_initial.sql
```

Product scope and roadmap:

- [docs/PRODUCT.md](docs/PRODUCT.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)

## Core rule

One evening is one record. PokerTracker does not record hands, actions, cards, blinds or live chip counts.
