import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

const env = {
  AUTH_MODE: 'jwt',
  COGNITO_USER_POOL_ID: 'us-west-2_000000000',
  COGNITO_CLIENT_ID: 'local',
  STREAM_TICKS: '2',
  STREAM_INTERVAL_MS: '0',
};

const config = loadConfig(env);
const verifier = {
  async verify(token: string) {
    if (token === 'valid') return { sub: 'test-user' };
    throw new Error('invalid token');
  },
};

it.each([undefined, '', 'iam', 'none'])('rejects AUTH_MODE %s', (mode) => {
  expect(() => loadConfig({ ...env, AUTH_MODE: mode })).toThrow('AUTH_MODE');
});

it.each(['COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID'])('requires %s', (name) => {
  expect(() => loadConfig({ ...env, [name]: undefined })).toThrow(name);
});

it('serves public health even when the serving Region is unknown', async () => {
  const app = createApp(config, { verifier, region: null });
  await request(app).get('/health').expect(200, { status: 'ok' });
});

it.each(['/whoami', '/stream'])('rejects missing and invalid tokens on %s', async (path) => {
  const app = createApp(config, { verifier, region: 'us-east-1' });
  await request(app).get(path).expect(401).expect('WWW-Authenticate', 'Bearer');
  await request(app).get(path).set('Authorization', 'Bearer invalid').expect(401);
});

it('rejects a platform-looking endpoint header without a JWT', async () => {
  const app = createApp(config, { verifier, region: 'us-east-1' });
  await request(app).get('/whoami').set('lambda-web-endpoint-name', 'iam').expect(401);
});

it.each(['us-east-1', null])('reports serving Region %s to an authenticated user', async (region) => {
  const app = createApp(config, { verifier, region });
  const response = await request(app)
    .get('/whoami')
    .set('Authorization', 'Bearer valid')
    .expect(200);
  expect(response.body).toMatchObject({
    authMode: 'jwt',
    subject: 'test-user',
    region,
    envId: expect.any(String),
    startedAt: expect.any(String),
    requestCount: expect.any(Number),
  });
});

it('streams configured ticks after JWT verification', async () => {
  const app = createApp(config, { verifier, region: 'us-east-1' });
  await request(app)
    .get('/stream')
    .set('Authorization', 'Bearer valid')
    .expect('Content-Type', /^text\/event-stream/)
    .expect(200, 'data: {"tick":1}\n\ndata: {"tick":2}\n\n');
});
