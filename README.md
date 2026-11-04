# League Remote: PC bridge

Control the League of Legends client from your phone while you're away from your desk:
accept queue pops, ban, pick, lock in, change summoner spells, skins and rune pages.

This repo is the **PC side** (the "bridge"). It runs on your Windows PC, talks to the League
client's local API, and serves a small, authenticated WebSocket API to your paired phone on the
local network. The phone app (Expo / React Native) lives in `apps/mobile`.

```
 Phone app  ──Wi-Fi──▶  Bridge (this repo)  ──127.0.0.1──▶  League client (LCU API)
            ws://<pc>:4242/ws
```

## Repository layout

| Folder | What it is |
|---|---|
| `packages/protocol` | Shared message types (zod schemas + TS types) for bridge and phone: `BridgeState`, commands, errors. Platform-neutral so the Expo app can import it. |
| `packages/bridge-core` | All the logic, no UI: LCU connection, state reducer, auto-accept, phone server, pairing, champ select commands, mock mode, dev tools. Runs headless with `npm run bridge`. |
| `apps/desktop` | Electron app (Vite + React + Tailwind): window, tray, settings, pairing QR. Bundles bridge-core. Builds the Windows installer. |
| `apps/mobile` | Phone app (Expo SDK 58, Expo Router): pairing (QR or code), lobby/queue, ready check, champ select (ban, pick, lock in), spells, skins, rune pages. Same look as the desktop app. |

## Requirements

- Windows 10/11 (macOS may work, not tested)
- Node.js 20+ and Git
- League of Legends installed (default `C:\Riot Games\League of Legends`; other paths are
  detected from the running client)

## Setup

```
git clone https://github.com/MnCSD/leaguebridge.git
cd leaguebridge
npm install
npm test
```

## Running it

| Command | What it does |
|---|---|
| `npm run desktop` | The desktop app in dev mode (hot reload). Shows the pairing QR + code. |
| `npm run bridge` | Headless bridge in a terminal (records events to `recordings/`). |
| `npm run bridge:auto` | Same, with auto-accept on. |
| `npm run desktop:dist` | Builds the installer: `apps/desktop/release/squirrel-windows/League Remote Setup 0.1.0.exe` |

**Phone app:** run `npm run mobile`, install **Expo Go** on the phone (same Wi-Fi as the PC) and
scan the QR code Expo prints. In the app, scan the pairing QR from the desktop app or
`npm run bridge`, or type the PC address and 6-digit code. `npm run mobile` then `w` opens a
browser preview (no camera; images need CORS, so they only load on a phone).

**Push notifications** ("Match found", "Your turn to ban/pick", even with the phone locked):
one-time setup on the PC, signed in to your Expo account, then turn them on in the app's Settings.
```
cd apps\mobile
npx eas-cli@latest login      # or: $env:EXPO_TOKEN = "<access token from expo.dev>"
npx eas-cli@latest init       # writes the project id into app.json
```
Works in Expo Go on iPhone; Android needs a development build (Expo Go on Android has no remote
push). The bridge sends them through Expo's push service (`exp.host`) only for phones that turned
them on; what leaves the PC is the phone's push token and the alert text, nothing else.

Only one bridge can run at a time (they all use port 4242). Quit the desktop app from the tray
before running `npm run bridge`, and vice versa.

**Windows PowerShell note:** PowerShell 5.1 drops a bare `--` in `npm run x -- --flag`, so flags
never reach the script. Use the ready-made scripts above, or write `npm run x '--' --flag`.

## Testing without League or a phone

| Command | What it does |
|---|---|
| `npm run fake-lcu` | A fake League client: queue pops, Draft/Blind champ select, skins, rune pages. Keys: `p` pop, `q` queue, `a`/`d` accept/decline, `k` draft, `b` blind, `t` start turns, `o` others act, `e` end, `g` start/end a fake running game, `r` restart, `h` help. |
| `npm run fake-game` | The same, starting straight into a fake running game (live game API on port 2999, 10x speed): kills, first blood, dragons, your death, your pentakill, baron, victory. For the phone's in-game screen. |
| `npm run bridge:fake` / `npm run desktop:fake` | Bridge / desktop app connected to the fake client. |
| `npm run phone-sim pair <code>` | A pretend phone. Then type: `accept`, `decline`, `find`, `leave`, `hover <id>`, `lock [id]`, `ban <id>`, `spells <a> <b>`, `skin <id>`, `runes <pageId>`, `pages`, `newpage <name>`, `asset <path>`, `state`, `reconnect`, `quit`. |
| `npm run mock -- <recording.jsonl>` | Replays a recording through the bridge (`--speed 20`, `--loop`). |

In the fake: you own champions 1-40, others ban 41-50 and pick 20-29; after locking champion X its
skins are X000 and X001 (owned), X002 (chroma, not owned), X003 (not owned).

## How pairing and security work

- The bridge shows a 6-digit code and a QR code (`{ host, port, code, bridgeId }`). Codes work
  once, expire after 5 minutes and are thrown away after 5 wrong guesses.
- Pairing gives the phone a long random device token; the bridge stores only its SHA-256 hash.
- Every connection must authenticate within 5 seconds. "Local network only" (on by default)
  refuses non-private IP addresses.
- TLS verification is turned off only for the League client's own self-signed certificate on
  127.0.0.1. The lockfile password, tokens and JWTs are never logged or recorded.
- Settings, paired devices and logs live in `%APPDATA%\LeagueRemote` (per PC, not in git).
- Windows Firewall asks once to allow the app; allow **Private networks** so the phone can connect.
- The only internet traffic the bridge makes: push notifications to Expo's push service, and only
  for phones that turned them on (a token that Expo reports as gone is forgotten).

## LCU endpoints used

While a game runs, the bridge also reads the game's own **Live Client Data API**
(`https://127.0.0.1:2999/liveclientdata/allgamedata`, read-only, official, self-signed certificate)
once a second, for the phone's in-game screen. It only shows what the game itself shows you.


Reads: gameflow phase/session, lobby, matchmaking search and ready check, champ select session
(+ pickable/bannable/disabled champions, skin carousel), perks pages/currentpage/styles,
current summoner, summoner by puuid (party names), chat `me`, and `/lol-game-data/...` (names and
images, proxied to the phone at `/assets/...`).

Writes: ready-check accept/decline, matchmaking search start/stop (`/lol-lobby/v2/lobby/matchmaking/search`,
POST/DELETE), champ select actions (hover/complete), `my-selection` (spells, skin), perks current
page and pages. **Rule: anything else needs a decision first.**

## Status (November 2026)

| Milestone | Status |
|---|---|
| M1 Connect & record | Done, verified with real Co-op and Draft games |
| M2 Auto-accept | Done, verified on the real client |
| M3 State model + mock mode | Done, reducer tested against real recordings (anonymized fixtures in `packages/bridge-core/test/fixtures`) |
| M4 Phone server + pairing | Done, tested with phone-sim |
| M5 Champ select + runes | Done, verified on the real client (custom and normal Draft): accept, hover, ban, lock in, spells, skin, rune page. Saving a new rune page reached the client, which refused it (max pages reached), as expected |
| M6 Desktop app + installer | Done (modern restyle, tray, notifications, Squirrel installer) |
| M7 Phone app | Done, tested on an iPhone (Expo Go). Since then: rune page editor, Find Match / Leave Queue, push notifications, in-game broadcast screen (live scoreboard, gold graph, objectives, feed, big moments, death timer, desk mode) (fake client, tests and browser preview; **real-client / real-phone check pending**) |

## Next steps

1. **Real checks:** Find Match and Leave Queue in a real lobby, editing a rune page, and push
   notifications on the iPhone (after the `eas-cli init` setup above): lock the phone, queue,
   wait for "Match found". Then a real game with the in-game screen open (the live API's event
   fields aren't documented by Riot: check kills, dragons and towers land on the right team).
2. **Deferred design features** (not in the original spec, each needs new LCU endpoints approved
   first): game mode select, invite a friend, position selection, plus the
   phone's "auto-apply runes" and "alert & vibrate" toggles.

Still to click through on the installed app: tray menu, minimize/close, Open log, Start with Windows.
