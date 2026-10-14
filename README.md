# Minus — game server

The backend for **Minus**, a Call Break style card game for Android and iOS.

- **Sign-in:** checks Google, Apple and mobile-number (OTP) logins through Firebase Authentication.
- **Server-run games:** every rule is checked on the server, and each player only ever receives their own cards, so a modified app cannot cheat.
- **Rooms:** friends join a table with a 6-letter code; computer players fill empty seats.
- **Bots for absent players:** if a player runs out of time (30 s by default) or leaves, the computer plays their turn.
- **Saved results:** games, wins and a leaderboard are stored in PostgreSQL.

## Game rules implemented

| Rule | Value |
|---|---|
| Bids | 1 to 10 |
| Scoring | Make your bid → **+bid** (extra tricks add nothing). Miss it → **−bid** |
| Game end | Play to a target score (10–500, e.g. 51, 61, 71). The game ends after the round where someone reaches it; highest score wins. A tie at the top plays one more round. |
| Trump modes | `spades` (always), `random` (each round), `none`, `bidder` (5-card auction) |
| 5-card auction | Everyone gets 5 cards. The first player must bid at least 5. Others may raise (6, 7 …) or pass. The highest bidder names trump, the other 8 cards are dealt, the caller's bid is locked in, the other three bid normally, and the caller leads. |
| Must beat the table (`strict`) | On by default: play a higher card of the led suit if you can; if you have none, trump (and over-trump) if you can. |
| Big bid bonus (`bigBid`) | Off by default. When on, making a bid of 8+ scores 13. |

## Making sure it belongs only to you

The code is written for you. To keep it that way:

1. **Put your name in `LICENSE`** (replace the placeholder). The project is marked `"private": true` and `"license": "UNLICENSED"`, so it can't be published to npm by accident.
2. **Store it in a private GitHub repository** under your own account. Turn on two-factor sign-in for GitHub.
3. **Create every service in your own name:** Firebase / Google Cloud project, Apple Developer account, Google Play Console account, database and hosting. Don't let a freelancer or agency own these accounts. Add them as team members instead, so you can remove their access.
4. **Keep secrets out of the code.** Passwords and keys go in `.env` (already ignored by git) or your hosting provider's secret settings. Never commit `.env` or a Firebase service-account file.
5. **Protect the name.** If "Minus" matters to your brand, check and register the trademark and app name in your country before launch; a lawyer can advise on this.

## Run it on your computer

You need [Node.js 20+](https://nodejs.org).

```bash
npm install
cp .env.example .env      # then edit .env
npm test                  # 14 tests: rules, full games, and a live socket game
npm run dev               # starts on http://localhost:8080
```

Without `DATABASE_URL` the server keeps data in memory (lost on restart). To run with a real database, install [Docker](https://www.docker.com) and run:

```bash
docker compose up --build
```

With `DEV_AUTH=true` you can sign in during testing with a fake token like `dev:alice:Alice`. **Set `DEV_AUTH=false` in production** (the server refuses to start in production with it on).

## Set up sign-in (Firebase)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com) with your own Google account.
2. **Authentication → Sign-in method:** enable **Google**, **Apple** and **Phone**.
   - Apple needs an Apple Developer account ($99/year) and a "Sign in with Apple" service ID.
   - Phone OTP: add test phone numbers while developing; real SMS has a cost after the free quota.
3. **Project settings → Service accounts → Generate new private key.** Copy `project_id`, `client_email` and `private_key` into `.env`.
4. Add your Android and iOS apps in Firebase. The mobile app signs the player in with the Firebase SDK, then sends the Firebase **ID token** to this server.

Apple's App Store rules require "Sign in with Apple" when an iOS app offers Google sign-in.

## How the app talks to the server

### REST (`Authorization: Bearer <Firebase ID token>`)

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Server is up |
| GET | `/api/rules` | Allowed settings (public) |
| GET | `/api/me` | Signed-in player |
| PATCH | `/api/me` | Change display name `{ "displayName": "Rajat" }` |
| GET | `/api/me/stats` | Games played, wins, best score |
| GET | `/api/leaderboard` | Top 20 players by wins |

### Live game (Socket.IO)

Connect with `io(SERVER_URL, { auth: { token: firebaseIdToken } })`. Every request takes a reply callback that receives `{ ok: true, ... }` or `{ ok: false, error, message }`.

| Send | Data | Notes |
|---|---|---|
| `room:create` | `{ rules: { target, trump, strict, bigBid } }` | You become host. Reply has `state.code`. |
| `room:join` | `{ code }` | Join a waiting table, or reconnect to your seat. |
| `room:start` | `{ code }` | Host only. Empty seats become computer players. |
| `room:leave` | `{ code }` | During a game, the computer takes over your seat. |
| `room:state` | `{ code }` | Fetch your current view (after reconnecting). |
| `game:action` | `{ code, action }` | See actions below. |

Actions:

```js
{ type: 'auctionBid', value: 6 }          // 5-card auction
{ type: 'auctionPass' }
{ type: 'chooseTrump', suit: 'H' }         // S, H, C or D
{ type: 'bid', value: 3 }                  // 1–10
{ type: 'play', card: { s: 'H', r: 14 } }  // r: 2–10, J=11, Q=12, K=13, A=14
```

The server pushes **`room:state`** `{ events, state }` to each player after every change. `state.game.hand` is only your own cards; `state.game.legal` lists the cards you may play now; `state.turnDeadline` is when the computer will play for you.

## Project layout

```
src/
  server.js      HTTP + Socket.IO server
  config.js      settings from .env
  auth.js        Firebase token checks
  db.js          PostgreSQL (or in-memory) storage
  routes.js      REST endpoints
  rooms.js       tables, bots, turn timers, saving results
  game/
    rules.js     cards, legal moves, scoring
    Game.js      the game itself (phases, auction, bidding, tricks)
    ai.js        computer players
db/schema.sql    database tables
test/            automated tests
```

## Deploying

Any Node.js host works, for example Google Cloud Run, Render, Railway, or your own server with the included `Dockerfile`. Use a managed PostgreSQL database, set the variables from `.env.example` as secrets, set `NODE_ENV=production` and `DEV_AUTH=false`, and limit `CORS_ORIGINS` to your own domains.

This version runs on a single server. That is fine for launch and early growth; running several servers at once would later need a shared Socket.IO adapter (for example Redis).
