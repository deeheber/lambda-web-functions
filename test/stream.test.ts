import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import type { JwtVerifier } from '../src/auth/types.ts';
import { loadConfig } from '../src/config.ts';

const verifier: JwtVerifier = {
  async verify(token) {
    if (token === 'good-token') return { sub: 'user-123' };
    throw new Error('invalid');
  },
};

function makeConfig(ticks: string, interval: string) {
  return loadConfig({
    AUTH_ENDPOINT_IAM: 'iam',
    AUTH_ENDPOINT_JWT: 'public',
    COGNITO_USER_POOL_ID: 'us-west-2_000000000',
    COGNITO_CLIENT_ID: 'local',
    STREAM_TICKS: ticks,
    STREAM_INTERVAL_MS: interval,
  });
}

const servers: http.Server[] = [];

async function start(ticks: string, interval: string): Promise<{ server: http.Server; port: number }> {
  const server = createApp(makeConfig(ticks, interval), { verifier }).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

interface Result {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  chunks: { at: number; text: string }[];
  body: string;
}

function get(port: number, headers: Record<string, string>): Promise<Result> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/stream', headers }, (res) => {
      const chunks: Result['chunks'] = [];
      res.setEncoding('utf8');
      res.on('data', (text: string) => chunks.push({ at: Date.now(), text }));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          chunks,
          body: chunks.map((c) => c.text).join(''),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
          s.closeAllConnections();
        }),
    ),
  );
});

describe('GET /stream', () => {
  it('streams stream.ticks events then ends', async () => {
    const { port } = await start('3', '5');
    const res = await get(port, { 'lambda-web-endpoint-name': 'iam' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe('data: {"tick":1}\n\ndata: {"tick":2}\n\ndata: {"tick":3}\n\n');
  });

  it('delivers ticks as separate chunks over time', async () => {
    const { port } = await start('3', '40');
    const res = await get(port, { 'lambda-web-endpoint-name': 'iam' });
    expect(res.chunks.length).toBeGreaterThanOrEqual(2);
    // Timer granularity can fire a few ms early; allow 5 ms slack on the 40 ms floor.
    expect(res.chunks[res.chunks.length - 1]!.at - res.chunks[0]!.at).toBeGreaterThanOrEqual(35);
  });

  it('stops and clears its timer when the client disconnects', async () => {
    const { server, port } = await start('1000', '10');
    const spy = vi.spyOn(globalThis, 'clearInterval');
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/stream', headers: { 'lambda-web-endpoint-name': 'iam' } },
        (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
        },
      );
      req.on('error', () => {});
      req.on('error', reject);
      req.end();
    }).catch(() => {});
    await vi.waitFor(
      async () => {
        expect(spy).toHaveBeenCalled();
        const count = await new Promise<number>((resolve, reject) => {
          server.getConnections((err, n) => (err ? reject(err) : resolve(n)));
        });
        expect(count).toBe(0);
      },
      { timeout: 1000, interval: 20 },
    );
  });

  it('requires a token on the public endpoint', async () => {
    const { port } = await start('3', '5');
    const res = await get(port, { 'lambda-web-endpoint-name': 'public' });
    expect(res.status).toBe(401);
  });
});
