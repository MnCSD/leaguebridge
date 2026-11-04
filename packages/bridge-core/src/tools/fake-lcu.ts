/**
 * `npm run fake-lcu` — an interactive fake League client. Run the bridge against it in a second
 * terminal with `npm run bridge:fake` (add `-- --auto-accept` to test auto-accept).
 *
 * `npm run fake-lcu game [speed] [startMinute]` starts straight into a fake running game (for the
 * phone's in-game screen); speed = game seconds per real second (default 10), startMinute jumps
 * ahead (e.g. 19 for the pentakill, 20 for baron).
 */
import { emitKeypressEvents } from 'node:readline';
import { FakeLcu } from '../dev/fakeLcu';
import { FakeLiveGame } from '../dev/fakeLiveGame';

export const FAKE_LEAGUE_DIR = '.fake-league';

const stamp = () => new Date().toTimeString().slice(0, 8);
const fake = new FakeLcu({ dir: FAKE_LEAGUE_DIR, log: (m) => console.log(`${stamp()}  ${m}`) });
const [mode, speedArg, startArg] = process.argv.slice(2);
let game: FakeLiveGame | null = null;

/** Starts (or ends) a fake running game: phase InProgress + the live game API on port 2999. */
async function toggleGame() {
  if (game) {
    await game.stop();
    game = null;
    fake.setPhase('EndOfGame');
    return fake.setPhase('Lobby');
  }
  game = new FakeLiveGame({ speed: Number(speedArg) || 10, startAt: (Number(startArg) || 0) * 60 });
  try {
    await game.start();
  } catch (err) {
    game = null;
    return console.log(`${stamp()}  Couldn't start the fake game on port 2999 (is a real game running?): ${(err as Error).message}`);
  }
  fake.setPhase('InProgress');
  console.log(`${stamp()}  Fake game running (${Number(speedArg) || 10}x speed). Press g to end it.`);
}

const HELP = `
Fake League client. Keys:
  l  go to Lobby          q  queue (match found after 3s)     p  match found NOW
  a  accept (as you)      d  decline (as you)
  k  champ select: draft (you are cell 2, mid; starts in PLANNING)
  b  champ select: blind (Co-op style, everyone picks at once)
  t  start turns (PLANNING -> bans)     o  everyone else acts     e  end champ select
  g  start / end a fake running game (live game API on port 2999, 10x speed)
  r  restart client (new port + password)                     c  close / reopen client
  h  help                 Ctrl+C  quit

  You own champions 1-40; others ban 41-50 and pick 20-29. Skins after locking X: X000, X001 (owned).
`;

async function main() {
  await fake.start();
  fake.setPhase('Lobby');
  console.log(HELP);
  if (mode === 'game') await toggleGame();

  if (!process.stdin.isTTY) {
    console.log('(stdin is not a terminal: keyboard controls disabled)');
    return;
  }
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  process.stdin.on('keypress', async (_str, key: { name?: string; ctrl?: boolean }) => {
    if (key.ctrl && key.name === 'c') {
      await fake.stop();
      process.exit(0);
    }
    if (!fake.running && key.name !== 'c') return console.log('(client is closed: press c to reopen)');
    switch (key.name) {
      case 'l':
        return fake.setPhase('Lobby');
      case 'q':
        return fake.queue();
      case 'p':
        return fake.pop();
      case 'a':
        if (!fake.respond('Accepted')) console.log('(no pop to accept)');
        return;
      case 'd':
        if (!fake.respond('Declined')) console.log('(no pop to decline)');
        return;
      case 'k':
        fake.champ.start({ mode: 'draft' });
        return console.log(`${stamp()}  Champ select (draft): PLANNING. Press t to start bans.`);
      case 'b':
        fake.champ.start({ mode: 'blind' });
        return console.log(`${stamp()}  Champ select (blind): everyone picks now.`);
      case 't':
        fake.champ.beginTurns();
        return console.log(`${stamp()}  Bans started.`);
      case 'o':
        fake.champ.othersAct();
        return console.log(`${stamp()}  Others acted.`);
      case 'e':
        return fake.champ.end();
      case 'g':
        return toggleGame();
      case 'r':
        return fake.restart();
      case 'c':
        if (fake.running) return fake.stop();
        await fake.start();
        return fake.setPhase('Lobby');
      case 'h':
        return console.log(HELP);
    }
  });
}

main();
