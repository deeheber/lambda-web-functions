import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { authMiddleware } from '../src/auth/index.ts';
import type { JwtVerifier } from '../src/auth/types.ts';

let calls = 0;
const fakeVerifier: JwtVerifier = {
  async verify(token) {
    calls += 1;
    if (token === 'good-token') return { sub: 'user-123' };
    throw new Error('invalid token');
  },
};

function buildApp(mode: 'iam' | 'jwt', withVerifier = true) {
  const auth =
    mode === 'iam'
      ? ({ mode: 'iam' } as const)
      : ({ mode: 'jwt', cognito: { userPoolId: 'pool', clientId: 'client' } } as const);
  const app = express();
  app.use(authMiddleware(auth, withVerifier ? fakeVerifier : undefined));
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/probe', (_req, res) => {
    res.json(res.locals.auth);
  });
  app.get('/boom', () => {
    throw new Error('boom');
  });
  return app;
}

describe('authMiddleware', () => {
  beforeEach(() => {
    calls = 0;
  });

  it('iam mode allows a request without a token and sets subject null', async () => {
    const res = await request(buildApp('iam')).get('/probe');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authMode: 'iam', subject: null });
  });

  it('iam mode does not call the verifier', async () => {
    await request(buildApp('iam')).get('/probe').set('Authorization', 'Bearer good-token');
    expect(calls).toBe(0);
  });

  it('iam mode works without a verifier', async () => {
    const res = await request(buildApp('iam', false)).get('/probe');
    expect(res.status).toBe(200);
  });

  it('jwt mode returns 401 with WWW-Authenticate when the token is missing', async () => {
    const res = await request(buildApp('jwt')).get('/probe');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('jwt mode returns 401 on an invalid token', async () => {
    const res = await request(buildApp('jwt')).get('/probe').set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('jwt mode returns 401 on a non-Bearer Authorization header', async () => {
    const res = await request(buildApp('jwt')).get('/probe').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
    expect(calls).toBe(0);
  });

  it('jwt mode returns 200 with a valid token and sets subject to sub', async () => {
    const res = await request(buildApp('jwt')).get('/probe').set('Authorization', 'Bearer good-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authMode: 'jwt', subject: 'user-123' });
  });

  it('jwt mode allows /health without a token', async () => {
    const res = await request(buildApp('jwt')).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('jwt mode ignores a lambda-web-endpoint-name header', async () => {
    const res = await request(buildApp('jwt')).get('/probe').set('lambda-web-endpoint-name', 'iam');
    expect(res.status).toBe(401);
  });

  it('throws at construction in jwt mode without a verifier', () => {
    expect(() => buildApp('jwt', false)).toThrow();
  });

  it('does not turn downstream errors into 401', async () => {
    const res = await request(buildApp('jwt')).get('/boom').set('Authorization', 'Bearer good-token');
    expect(res.status).toBe(500);
  });
});
