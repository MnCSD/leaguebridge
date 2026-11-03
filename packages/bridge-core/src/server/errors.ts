import type { ErrorCode } from '@league-remote/protocol';

/** Thrown by command handlers; turned into an `error` message for the phone. */
export class CommandError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
