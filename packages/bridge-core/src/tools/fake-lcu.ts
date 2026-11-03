/**
 * `npm run fake-lcu` — an interactive fake League client. Run the bridge against it in a second
 * terminal with `npm run bridge:fake` (add `-- --auto-accept` to test auto-accept).
 */
import { emitKeypressEvents } from 'node:readline';
import { FakeLcu } from '../dev/fakeLcu';

export const FAKE_LEAGUE_DIR = '.fake-league';

const stamp = () => new Date().toTimeString().slice(0, 8);
const fake = new FakeLcu({ dir: FAKE_LEAGUE_DIR, log: (m) => console.log(`${stamp()}  ${m}`) });

const HELP = `
Fake League client. Keys:
  l  go to Lobby          q  queue (match found after 3s)     p  match found NOW
  a  accept (as you)      d  decline (as you)
  k  champ select: draft (you are cell 2, mid; starts in PLANNING)
  b  champ select: blind (Co-op style, everyone picks at once)
  t  start turns (PLANNING -> bans)     o  everyone else acts     e  end champ select
  r  restart client (new port + password)                     c  close / reopen client
  h  help                 Ctrl+C  quit

  You own champions 1-40; others ban 41-50 and pick 20-29. Skins after locking X: X000, X001 (owned).
`;

async function main() {
  await fake.start();
  fake.setPhase('Lobby');
  console.log(HELP);

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
