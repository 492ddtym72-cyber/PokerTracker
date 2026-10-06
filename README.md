# PokerTracker

**Live:** https://pokertracker-b3a.pages.dev

PokerTracker is a private web app for recording the result of an entire poker evening.

It is deliberately **not** a hand tracker. Nothing needs to be entered while playing.

For every poker night, the group records:

- date / session name
- participating players
- each player's **total stake** for the complete evening
- each player's **final cash-out**

PokerTracker calculates profit/loss, checks the table balance and builds lifetime player statistics.

## MVP

- shared password-protected access
- shared Cloudflare D1 database
- add, edit and delete poker nights
- automatic profit/loss per player
- automatic session balance warning
- session history
- lifetime player standings
- mobile-first interface
- German / English interface with a device-local language preference

## Stack

- React
- TypeScript
- Vite
- Cloudflare Pages
- Cloudflare Pages Functions
- Cloudflare D1

The GitHub repository can remain public. The shared password is never stored in plaintext in the repository or Cloudflare Pages configuration. Authentication uses a salted PBKDF2-SHA256 hash stored in the private D1 database and an HttpOnly signed session cookie.

## Development

```bash
npm install
npm run dev
```

This starts the Vite frontend only. The shared API requires Pages Functions + D1.

See:

- [Deployment](docs/DEPLOYMENT.md)
- [Product scope](docs/PRODUCT.md)
- [Roadmap](docs/ROADMAP.md)

## Core rule

One evening is one record. PokerTracker does not record hands, actions, cards, blinds or live chip counts.
