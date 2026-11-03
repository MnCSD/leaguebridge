# League Remote: PC bridge

Control the League of Legends client from your phone while you're away from your desk:
accept queue pops, ban, pick, lock in, change summoner spells, skins and rune pages.

This repo is the **PC side** (the "bridge"). It runs on your Windows PC, talks to the League
client's local API, and serves a small, authenticated WebSocket API to your paired phone on the
local network. The phone app (Expo / React Native) comes next.

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

Only one bridge can run at a time (they all use port 4242). Quit the desktop app from the tray
before running `npm run bridge`, and vice versa.

**Windows PowerShell note:** PowerShell 5.1 drops a bare `--` in `npm run x -- --flag`, so flags
never reach the script. Use the ready-made scripts above, or write `npm run x '--' --flag`.

## Testing without League or a phone

| Command | What it does |
|---|---|
| `npm run fake-lcu` | A fake League client: queue pops, Draft/Blind champ select, skins, rune pages. Keys: `p` pop, `q` queue, `a`/`d` accept/decline, `k` draft, `b` blind, `t` start turns, `o` others act, `e` end, `r` restart, `h` help. |
| `npm run bridge:fake` / `npm run desktop:fake` | Bridge / desktop app connected to the fake client. |
| `npm run phone-sim pair <code>` | A pretend phone. Then type: `accept`, `decline`, `hover <id>`, `lock [id]`, `ban <id>`, `spells <a> <b>`, `skin <id>`, `runes <pageId>`, `pages`, `newpage <name>`, `asset <path>`, `state`, `reconnect`, `quit`. |
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

## LCU endpoints used

Reads: gameflow phase/session, lobby, matchmaking search and ready check, champ select session
(+ pickable/bannable/disabled champions, skin carousel), perks pages/currentpage/styles,
current summoner, summoner by puuid (party names), chat `me`, and `/lol-game-data/...` (names and
images, proxied to the phone at `/assets/...`).

Writes: ready-check accept/decline, champ select actions (hover/complete), `my-selection`
(spells, skin), perks current page and pages. **Rule: anything else needs a decision first.**

## Status (November 2026)

| Milestone | Status |
|---|---|
| M1 Connect & record | Done, verified with real Co-op and Draft games |
| M2 Auto-accept | Done, verified on the real client |
| M3 State model + mock mode | Done, reducer tested against real recordings (anonymized fixtures in `packages/bridge-core/test/fixtures`) |
| M4 Phone server + pairing | Done, tested with phone-sim |
| M5 Champ select + runes | Done, tested against the fake client. **Real-client check pending** |
| M6 Desktop app + installer | Done (modern restyle, tray, notifications, Squirrel installer) |

## Next steps

1. **M5 real-client check.** Custom Game, Blind Pick vs bots (no queue, no dodge penalty): run
   `npm run bridge` + `npm run phone-sim pair <code>`, then `hover`, `lock`, `spells`, `skin`,
   `pages`, `runes`, `newpage`. Then one `ban` in a normal Draft game. Watch for `CLIENT_ERROR`
   lines: the real request bodies and error messages were never recorded.
2. **The Expo phone app** (designs: League Remote canvas).
3. **Deferred design features** (not in the original spec, each needs new LCU endpoints approved
   first): game mode select, Find Match, Leave Queue, invite a friend, position selection, plus the
   phone's "auto-apply runes" and "alert & vibrate" toggles.

Still to click through on the installed app: tray menu, minimize/close, Open log, Start with Windows.
