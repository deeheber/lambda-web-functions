import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

const config = loadConfig({
  AUTH_MODE: 'jwt',
  COGNITO_USER_POOL_ID: 'us-west-2_000000000',
  COGNITO_CLIENT_ID: 'local',
  STREAM_TICKS: '1',
  STREAM_INTERVAL_MS: '1',
});
const verifier = {
  async verify(token: string) {
    if (token === 'good-token') return { sub: 'user-123' };
    throw new Error('invalid');
  },
};
const app = () => createApp(config, { verifier });

describe('JWT app behind CloudFront', () => {
  it('serves health without authentication', async () => {
    const res = await request(app()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it.each(['/whoami', '/stream', '/missing'])('protects %s before routing', async (path) => {
    for (const authorization of ['', 'Bearer invalid', 'AWS4-HMAC-SHA256 signature']) {
      const res = await request(app()).get(path).set('Authorization', authorization);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'unauthorized' });
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('rejects a non-Bearer header before consulting the verifier', async () => {
    const verify = vi.fn(verifier.verify);
    const res = await request(createApp(config, { verifier: { verify } }))
      .get('/whoami').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('returns the verified subject and counts rejected requests', async () => {
    const a = app();
    const first = await request(a).get('/whoami').auth('good-token', { type: 'bearer' });
    await request(a).get('/whoami');
    const third = await request(a).get('/whoami').auth('good-token', { type: 'bearer' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ authMode: 'jwt', subject: 'user-123', envId: expect.any(String), startedAt: expect.any(String) });
    expect(third.body.requestCount).toBe(first.body.requestCount + 2);
    expect(first.headers['cache-control']).toBe('no-store');
  });

  it('keeps authenticated 404 responses uncacheable', async () => {
    const res = await request(app()).get('/missing').auth('good-token', { type: 'bearer' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('does not trust endpoint or forwarded host headers', async () => {
    const a = app();
    expect(a.get('trust proxy')).toBe(false);
    const res = await request(a).get('/whoami')
      .set('lambda-web-endpoint-name', 'iam').set('X-Forwarded-Host', 'trusted.example.com');
    expect(res.status).toBe(401);
  });

  it('keeps downstream failures as uncacheable 500 responses', async () => {
    const a = app();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const json = vi.spyOn(a.response, 'json').mockImplementationOnce(() => {
      throw new Error('private detail');
    });
    try {
      const res = await request(a).get('/whoami').auth('good-token', { type: 'bearer' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'internal' });
      expect(res.text).not.toContain('private detail');
      expect(res.headers['cache-control']).toBe('no-store');
    } finally {
      json.mockRestore();
      spy.mockRestore();
    }
  });
});
