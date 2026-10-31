import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, errorHandler, notFoundHandler } from '../src/app.ts';
import type { JwtVerifier } from '../src/auth/types.ts';
import { loadConfig } from '../src/config.ts';

const config = loadConfig({
  AUTH_ENDPOINT_IAM: 'iam',
  AUTH_ENDPOINT_JWT: 'public',
  COGNITO_USER_POOL_ID: 'us-west-2_000000000',
  COGNITO_CLIENT_ID: 'local',
  STREAM_TICKS: '3',
  STREAM_INTERVAL_MS: '5',
});

const verifier: JwtVerifier = {
  async verify(token) {
    if (token === 'good-token') return { sub: 'user-123' };
    throw new Error('invalid');
  },
};

const ENDPOINT = 'lambda-web-endpoint-name';
const app = () => createApp(config, { verifier });

describe('createApp', () => {
  it('GET /health returns 200 status ok on the iam endpoint', async () => {
    const res = await request(app()).get('/health').set(ENDPOINT, 'iam');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health returns 200 on the public endpoint without a token', async () => {
    const res = await request(app()).get('/health').set(ENDPOINT, 'public');
    expect(res.status).toBe(200);
  });

  it('GET /health returns 401 without an endpoint header', async () => {
    const res = await request(app()).get('/health');
    expect(res.status).toBe(401);
  });

  it('GET /whoami on iam returns the documented shape with subject null', async () => {
    const res = await request(app()).get('/whoami').set(ENDPOINT, 'iam');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual([
      'endpoint',
      'authMode',
      'subject',
      'envId',
      'startedAt',
      'requestCount',
    ]);
    expect(res.body.endpoint).toBe('iam');
    expect(res.body.authMode).toBe('iam');
    expect(res.body.subject).toBeNull();
    expect(typeof res.body.envId).toBe('string');
    expect(typeof res.body.startedAt).toBe('string');
    expect(typeof res.body.requestCount).toBe('number');
  });

  it('GET /whoami on public with a valid token returns authMode jwt and the subject', async () => {
    const res = await request(app())
      .get('/whoami')
      .set(ENDPOINT, 'public')
      .set('Authorization', 'Bearer good-token');
    expect(res.status).toBe(200);
    expect(res.body.authMode).toBe('jwt');
    expect(res.body.subject).toBe('user-123');
  });

  it('GET /whoami on public without a token returns 401', async () => {
    const res = await request(app()).get('/whoami').set(ENDPOINT, 'public');
    expect(res.status).toBe(401);
  });

  it('requestCount rises by one per request', async () => {
    const a = app();
    const first = await request(a).get('/whoami').set(ENDPOINT, 'iam');
    const second = await request(a).get('/whoami').set(ENDPOINT, 'iam');
    expect(second.body.requestCount).toBe(first.body.requestCount + 1);
  });

  it('unknown path returns 404 not_found on a known endpoint', async () => {
    const res = await request(app()).get('/nope').set(ENDPOINT, 'iam');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('unknown path without an endpoint header returns 401', async () => {
    const res = await request(app()).get('/nope');
    expect(res.status).toBe(401);
  });

  it('JSON responses use Content-Type application/json', async () => {
    for (const path of ['/health', '/whoami', '/nope']) {
      const res = await request(app()).get(path).set(ENDPOINT, 'iam');
      expect(res.headers['content-type']).toMatch(/^application\/json/);
    }
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
});
