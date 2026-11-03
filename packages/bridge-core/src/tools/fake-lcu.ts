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
  r  restart client (new port + password)                     c  close / reopen client
  h  help                 Ctrl+C  quit
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
