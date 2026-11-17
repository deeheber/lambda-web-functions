import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

const config = loadConfig({
  AUTH_MODE: 'jwt', COGNITO_USER_POOL_ID: 'us-west-2_000000000', COGNITO_CLIENT_ID: 'local',
  PRIVATE_SERVICE_URL: 'http://127.0.0.1:8080/ping',
});
const verifier = {
  async verify(token: string) {
    if (token === 'good') return { sub: 'user' };
    throw new Error('invalid');
  },
};
const payload = { service: 'private-http', callerIp: '10.42.1.12' };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GET /private-ping', () => {
  it('does not contact the service at startup or before successful authentication', async () => {
    const fetchService = vi.fn<typeof fetch>();
    const app = createApp(config, { verifier, fetch: fetchService });
    await request(app).get('/health').expect(200);
    for (const token of ['', 'Bearer bad']) {
      await request(app).get('/private-ping').set('Authorization', token).expect(401);
    }
    expect(fetchService).not.toHaveBeenCalled();
  });

  it('uses only the configured URL, omits user headers, and returns service observations without caching', async () => {
    const fetchService = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...payload, secret: 'private detail' }));
    const app = createApp(config, { verifier, fetch: fetchService });
    const res = await request(app).get('/private-ping?url=http://attacker.invalid')
      .set('Authorization', 'Bearer good').set('X-Forwarded-For', '203.0.113.1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(fetchService).toHaveBeenCalledExactlyOnceWith(config.privateService.url, {
      signal: expect.any(AbortSignal), redirect: 'error',
    });
  });

  it.each([
    () => Promise.reject(new Error('connection details')),
    () => Promise.resolve(new Response('private detail', { status: 503 })),
    () => Promise.resolve(new Response('not JSON')),
    () => Promise.resolve(Response.json(null)),
    () => Promise.resolve(Response.json({ ...payload, callerIp: 'not-an-ip' })),
    () => Promise.resolve(Response.json({ ...payload, service: 'wrong-service' })),
  ])('returns a fixed 502 for an unavailable or invalid service', async (fetchService) => {
    const res = await request(createApp(config, { verifier, fetch: fetchService }))
      .get('/private-ping').set('Authorization', 'Bearer good');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'private_service_unavailable' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('aborts a stalled response body using the real HTTP transport', async () => {
    let received!: () => void;
    const headersReceived = new Promise<void>((resolve) => { received = resolve; });
    let disconnected!: () => void;
    const aborted = new Promise<void>((resolve) => { disconnected = resolve; });
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{');
      res.on('close', disconnected);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        upstream.once('error', reject);
        upstream.listen(0, '127.0.0.1', resolve);
      });
      const port = (upstream.address() as AddressInfo).port;
      const settings = { ...config, privateService: { url: `http://127.0.0.1:${port}/ping`, timeoutMs: 100 } };
      const fetchService: typeof fetch = async (...args) => {
        const response = await fetch(...args);
        received();
        return response;
      };
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const pending = request(createApp(settings, { verifier, fetch: fetchService }))
        .get('/private-ping').set('Authorization', 'Bearer good').then((res) => res);
      await headersReceived;
      await vi.advanceTimersByTimeAsync(settings.privateService.timeoutMs);
      const res = await pending;
      expect(res.status).toBe(504);
      expect(res.body).toEqual({ error: 'private_service_timeout' });
      expect(res.headers['cache-control']).toBe('no-store');
      await aborted;
    } finally {
      vi.useRealTimers();
      await new Promise<void>((resolve) => {
        upstream.close(() => resolve());
        upstream.closeAllConnections();
      });
    }
  });

  it('refuses upstream redirects', async () => {
    let calls = 0;
    const upstream = http.createServer((_req, res) => {
      calls++;
      res.writeHead(302, { Location: '/other-destination' }).end();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        upstream.once('error', reject);
        upstream.listen(0, '127.0.0.1', resolve);
      });
      const port = (upstream.address() as AddressInfo).port;
      const settings = { ...config, privateService: { ...config.privateService, url: `http://127.0.0.1:${port}/ping` } };
      const res = await request(createApp(settings, { verifier }))
        .get('/private-ping').set('Authorization', 'Bearer good');
      expect(res.status).toBe(502);
      expect(calls).toBe(1);
    } finally {
      await new Promise<void>((resolve) => {
        upstream.close(() => resolve());
        upstream.closeAllConnections();
      });
    }
  });
});
