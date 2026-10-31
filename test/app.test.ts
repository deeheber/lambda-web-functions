import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, errorHandler, notFoundHandler } from '../src/app.ts';
import type { JwtVerifier } from '../src/auth/types.ts';
import { loadConfig } from '../src/config.ts';

const tun = { STREAM_TICKS: '3', STREAM_INTERVAL_MS: '5' };
const iamConfig = loadConfig({ AUTH_MODE: 'iam', ...tun });
const jwtConfig = loadConfig({
  AUTH_MODE: 'jwt',
  COGNITO_USER_POOL_ID: 'us-west-2_000000000',
  COGNITO_CLIENT_ID: 'local',
  ...tun,
});

const verifier: JwtVerifier = {
  async verify(token) {
    if (token === 'good-token') return { sub: 'user-123' };
    throw new Error('invalid');
  },
};

const iamApp = () => createApp(iamConfig, {});
const jwtApp = () => createApp(jwtConfig, { verifier });

describe('createApp', () => {
  it('GET /health returns 200 status ok in iam mode', async () => {
    const res = await request(iamApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health returns 200 in jwt mode without a token', async () => {
    const res = await request(jwtApp()).get('/health');
    expect(res.status).toBe(200);
  });

  it('GET /whoami in iam mode returns the documented shape with subject null', async () => {
    const res = await request(iamApp()).get('/whoami');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['authMode', 'subject', 'envId', 'startedAt', 'requestCount']);
    expect(res.body.authMode).toBe('iam');
    expect(res.body.subject).toBeNull();
    expect(typeof res.body.envId).toBe('string');
    expect(typeof res.body.startedAt).toBe('string');
    expect(typeof res.body.requestCount).toBe('number');
  });

  it('GET /whoami in jwt mode with a valid token returns authMode jwt and the subject', async () => {
    const res = await request(jwtApp()).get('/whoami').set('Authorization', 'Bearer good-token');
    expect(res.status).toBe(200);
    expect(res.body.authMode).toBe('jwt');
    expect(res.body.subject).toBe('user-123');
  });

  it('GET /whoami in jwt mode without a token returns 401', async () => {
    const res = await request(jwtApp()).get('/whoami');
    expect(res.status).toBe(401);
  });

  it('requestCount rises by one per request', async () => {
    const a = iamApp();
    const first = await request(a).get('/whoami');
    const second = await request(a).get('/whoami');
    expect(second.body.requestCount).toBe(first.body.requestCount + 1);
  });

  it('requestCount counts rejected requests', async () => {
    const a = jwtApp();
    const first = await request(a).get('/whoami').set('Authorization', 'Bearer good-token');
    const rejected = await request(a).get('/whoami');
    expect(rejected.status).toBe(401);
    const third = await request(a).get('/whoami').set('Authorization', 'Bearer good-token');
    expect(third.body.requestCount).toBe(first.body.requestCount + 2);
  });

  it('does not send X-Powered-By', async () => {
    const res = await request(iamApp()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('unknown path returns 404 not_found in iam mode', async () => {
    const res = await request(iamApp()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('unknown path in jwt mode without a token returns 401', async () => {
    const res = await request(jwtApp()).get('/nope');
    expect(res.status).toBe(401);
  });

  it('JSON responses use Content-Type application/json', async () => {
    for (const path of ['/health', '/whoami', '/nope']) {
      const res = await request(iamApp()).get(path);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
    }
  });

  it('throws in jwt mode without a verifier', () => {
    expect(() => createApp(jwtConfig, {})).toThrow();
  });
});

describe('errorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 500 internal and never sends the stack', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = express();
    a.get('/boom', () => {
      throw new Error('secret detail');
    });
    a.use(notFoundHandler);
    a.use(errorHandler);
    const res = await request(a).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal' });
    expect(res.text).not.toContain('secret detail');
    expect(spy).toHaveBeenCalled();
  });

  it('ends the response when headers were already sent', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = express();
    a.get('/late', (_req, res, next) => {
      res.status(200);
      res.write('partial');
      next(new Error('late'));
    });
    a.use(notFoundHandler);
    a.use(errorHandler);
    const res = await request(a).get('/late');
    expect(res.status).toBe(200);
    expect(res.text).toBe('partial');
    expect(spy).toHaveBeenCalled();
  });
});
