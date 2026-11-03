import https from 'node:https';
import type { LcuCredentials } from './credentials';

export interface LcuResponse<T = unknown> {
  status: number;
  data: T | null;
}

export function basicAuthHeader(password: string): string {
  return 'Basic ' + Buffer.from(`riot:${password}`).toString('base64');
}

/**
 * Minimal HTTPS client for the League client API.
 *
 * Why `rejectUnauthorized: false`? The client serves a self-signed certificate, so normal
 * verification fails. We turn verification off ONLY on this private agent, which is only
 * ever used for 127.0.0.1 on the lockfile port. The rest of the process keeps normal TLS.
 */
export class LcuHttp {
  private readonly agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  private readonly auth: string;

  constructor(private readonly creds: LcuCredentials) {
    this.auth = basicAuthHeader(creds.password);
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }

  request<T = unknown>(method: string, path: string, body?: unknown): Promise<LcuResponse<T>> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: '127.0.0.1',
          port: this.creds.port,
          path,
          method,
          agent: this.agent,
          timeout: 5000,
          headers: {
            Authorization: this.auth,
            Accept: 'application/json',
            ...(payload ? { 'Content-Type': 'application/json' } : {}),
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            let data: unknown = null;
            if (raw) {
              try {
                data = JSON.parse(raw);
              } catch {
                data = raw;
              }
            }
            resolve({ status: res.statusCode ?? 0, data: data as T });
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`LCU ${method} ${path} timed out`)));
      // Only pass the message on: error objects can carry request options.
      req.on('error', (err) => reject(new Error(err.message)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** GET returning the raw bytes (for images). */
  getRaw(path: string): Promise<{ status: number; contentType: string; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: '127.0.0.1',
          port: this.creds.port,
          path,
          method: 'GET',
          agent: this.agent,
          timeout: 10_000,
          headers: { Authorization: this.auth },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              contentType: String(res.headers['content-type'] ?? 'application/octet-stream'),
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error(`LCU GET ${path} timed out`)));
      req.on('error', (err) => reject(new Error(err.message)));
      req.end();
    });
  }

  close() {
    this.agent.destroy();
  }
}
