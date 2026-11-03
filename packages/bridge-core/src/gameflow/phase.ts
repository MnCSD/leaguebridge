/**
 * Phases seen in real recordings so far: None, Lobby, Matchmaking, ReadyCheck, ChampSelect,
 * GameStart, InProgress, Reconnect. Others exist (WaitingForStats, PreEndOfGame, EndOfGame, ...),
 * so this stays a plain string rather than a closed union.
 */
export type GameflowPhase = string;

export const PHASE_URI = '/lol-gameflow/v1/gameflow-phase';

/** Remembers the current gameflow phase and reports changes. */
export class PhaseTracker {
  phase: GameflowPhase | null = null;

  constructor(private readonly onChange: (phase: GameflowPhase, previous: GameflowPhase | null) => void) {}

  set(phase: unknown) {
    if (typeof phase !== 'string' || phase === this.phase) return;
    const previous = this.phase;
    this.phase = phase;
    this.onChange(phase, previous);
  }

  /** Called on disconnect: we no longer know the phase. */
  reset() {
    this.phase = null;
  }
}
