import { describe, expect, it } from 'vitest';
import { parseWampEvent } from './socket';

describe('parseWampEvent', () => {
  it('parses an OnJsonApiEvent message', () => {
    const raw = JSON.stringify([8, 'OnJsonApiEvent', { uri: '/lol-gameflow/v1/gameflow-phase', eventType: 'Update', data: 'Lobby' }]);
    expect(parseWampEvent(raw)).toEqual({ uri: '/lol-gameflow/v1/gameflow-phase', eventType: 'Update', data: 'Lobby' });
  });

  it('ignores empty frames, junk and other message types', () => {
    expect(parseWampEvent('')).toBeNull();
    expect(parseWampEvent('not json')).toBeNull();
    expect(parseWampEvent(JSON.stringify([0, 'session', 1, 'x']))).toBeNull();
    expect(parseWampEvent(JSON.stringify([8, 'OnJsonApiEvent', {}]))).toBeNull();
  });
});
