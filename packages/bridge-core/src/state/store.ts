import { EMPTY_STATE, type BridgeState } from '@league-remote/protocol';
import { applyUpdate, buildState, type LcuCache } from './reducer';

/**
 * Holds the current BridgeState and tells you when it really changed.
 * Most client events (chat, missions, store...) don't touch the state, so they're ignored cheaply.
 */
export class StateStore {
  state: BridgeState = EMPTY_STATE;
  private cache: LcuCache = {};
  private client: BridgeState['client'] = 'disconnected';
  private json = JSON.stringify(EMPTY_STATE);

  constructor(
    private readonly onChange?: (state: BridgeState, prev: BridgeState) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** `data` null = deleted / 404. `at` defaults to now; mock mode and tests pass their own. */
  update(uri: string, data: unknown, at = this.now()) {
    const next = applyUpdate(this.cache, uri, data, at);
    if (next === this.cache) return;
    this.cache = next;
    this.recompute();
  }

  setClient(client: BridgeState['client']) {
    if (client === 'disconnected') this.cache = {};
    this.client = client;
    this.recompute();
  }

  private recompute() {
    const next = buildState(this.cache, this.client, this.state);
    const json = JSON.stringify(next);
    if (json === this.json) return;
    const prev = this.state;
    this.state = next;
    this.json = json;
    this.onChange?.(next, prev);
  }
}
