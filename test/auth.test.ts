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

function buildApp() {
  const app = express();
  app.use(authMiddleware({ iamEndpointName: 'iam', jwtEndpointName: 'public' }, fakeVerifier));
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

const ENDPOINT = 'lambda-web-endpoint-name';

describe('authMiddleware', () => {
  beforeEach(() => {
    calls = 0;
  });

  it('returns 401 when the endpoint header is missing', async () => {
    const res = await request(buildApp()).get('/probe');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 for an unknown endpoint name', async () => {
    const res = await request(buildApp()).get('/probe').set(ENDPOINT, 'other');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('matches endpoint names exactly', async () => {
    // Trailing whitespace ('iam ') is stripped by the HTTP parser, so it cannot be sent; use case and suffix variants.
    for (const name of ['IAM', 'iam2', 'Public']) {
      const res = await request(buildApp()).get('/probe').set(ENDPOINT, name);
      expect(res.status).toBe(401);
    }
  });

  it('allows the iam endpoint without a token and sets subject null', async () => {
    const res = await request(buildApp()).get('/probe').set(ENDPOINT, 'iam');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ endpoint: 'iam', authMode: 'iam', subject: null });
  });

  it('does not call the verifier on the iam endpoint', async () => {
    await request(buildApp()).get('/probe').set(ENDPOINT, 'iam').set('Authorization', 'Bearer good-token');
    expect(calls).toBe(0);
  });

  it('returns 401 with WWW-Authenticate on public without a token', async () => {
    const res = await request(buildApp()).get('/probe').set(ENDPOINT, 'public');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 on public with an invalid token', async () => {
    const res = await request(buildApp())
      .get('/probe')
      .set(ENDPOINT, 'public')
      .set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('returns 401 on public with a non-Bearer Authorization header', async () => {
    const res = await request(buildApp())
      .get('/probe')
      .set(ENDPOINT, 'public')
      .set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
    expect(calls).toBe(0);
  });

  it('returns 200 on public with a valid token and sets subject to sub', async () => {
    const res = await request(buildApp())
      .get('/probe')
      .set(ENDPOINT, 'public')
      .set('Authorization', 'Bearer good-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ endpoint: 'public', authMode: 'jwt', subject: 'user-123' });
  });

  it('allows /health on public without a token', async () => {
    const res = await request(buildApp()).get('/health').set(ENDPOINT, 'public');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not turn downstream errors into 401', async () => {
    const res = await request(buildApp())
      .get('/boom')
      .set(ENDPOINT, 'public')
      .set('Authorization', 'Bearer good-token');
    expect(res.status).toBe(500);
  });
});
