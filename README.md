# PokerTracker

A simple private web app for recording the result of a complete poker night.

## What it tracks

For each poker night:

- date / title of the session
- participating players
- each player's total stake for the evening
- each player's final cash-out
- automatic profit / loss per player
- automatic session balance check

PokerTracker is intentionally **not** a hand tracker and is not meant to stay open during play.

## Foundation

- React + TypeScript + Vite
- mobile-first browser UI
- local browser persistence for the first version
- password gate prepared for Cloudflare Pages
- deployment secrets are kept outside this public repository

## Local development

```bash
npm install
npm run dev
```

For the password-protected Cloudflare Pages version, copy `.dev.vars.example` to `.dev.vars` and set private values.

## Current scope

This is the initial foundation. Visual design, shared cloud storage, statistics and additional poker-night features will be added next.
