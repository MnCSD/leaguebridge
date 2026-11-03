import pino, { type Logger } from 'pino';

const REDACT = {
  // Belt and braces: even if a secret-named field is ever passed to the logger, hide it.
  paths: ['password', '*.password', 'token', '*.token', 'authorization', '*.authorization', 'headers'],
  censor: '[REDACTED]',
};

/**
 * Terminal: pretty, coloured output (via pino-pretty in a worker thread).
 * `file`: plain JSON lines appended to that file instead (the desktop app; no worker threads,
 * so it also works when bundled).
 */
export function createLogger(level = 'info', opts: { file?: string } = {}): Logger {
  if (opts.file) {
    return pino({ level, redact: REDACT }, pino.destination({ dest: opts.file, mkdir: true, sync: false }));
  }
  return pino({
    level,
    redact: REDACT,
    transport: process.stdout.isTTY
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' /* SYS: = local time, not UTC */, ignore: 'pid,hostname' } }
      : undefined,
  });
}
