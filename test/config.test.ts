import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

const base = { AUTH_MODE: 'iam' };
const jwt = { AUTH_MODE: 'jwt', COGNITO_USER_POOL_ID: 'pool', COGNITO_CLIENT_ID: 'client' };

describe('loadConfig', () => {
  it('applies defaults when optional values are unset', () => {
    const c = loadConfig(base);
    expect(c.listen).toEqual({ host: '127.0.0.1', port: 3000 });
    expect(c.stream).toEqual({ ticks: 5, intervalMs: 500 });
    expect(c.auth).toEqual({ mode: 'iam' });
  });

  it('parses iam mode and ignores Cognito values', () => {
    const c = loadConfig({ ...base, COGNITO_USER_POOL_ID: 'pool', COGNITO_CLIENT_ID: 'client' });
    expect(c.auth).toEqual({ mode: 'iam' });
  });

  it('parses jwt mode with Cognito values', () => {
    expect(loadConfig(jwt).auth).toEqual({
      mode: 'jwt',
      cognito: { userPoolId: 'pool', clientId: 'client' },
    });
  });

  it('throws when AUTH_MODE is missing or empty', () => {
    expect(() => loadConfig({})).toThrow('AUTH_MODE is required');
    expect(() => loadConfig({ AUTH_MODE: '' })).toThrow('AUTH_MODE is required');
  });

  it.each(['none', 'off', 'skip', 'disabled', 'IAM', 'JWT', ' iam', 'both'])(
    'throws on an unknown AUTH_MODE: %s',
    (mode) => {
      expect(() => loadConfig({ AUTH_MODE: mode })).toThrow(/AUTH_MODE.*/);
      expect(() => loadConfig({ AUTH_MODE: mode })).toThrow(mode);
    },
  );

  it.each(['COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID'])(
    'throws in jwt mode when %s is missing',
    (name) => {
      const env: Record<string, string | undefined> = { ...jwt };
      delete env[name];
      expect(() => loadConfig(env)).toThrow(name);
      expect(() => loadConfig({ ...jwt, [name]: '' })).toThrow(name);
    },
  );

  it('treats an empty string as unset', () => {
    const c = loadConfig({ ...base, STREAM_TICKS: '', STREAM_INTERVAL_MS: '', AWS_LAMBDA_HTTP_ENDPOINT: '' });
    expect(c.stream).toEqual({ ticks: 5, intervalMs: 500 });
    expect(c.listen.port).toBe(3000);
  });

  it('throws when STREAM_TICKS is not a number', () => {
    for (const v of ['abc', '5x', '-1', '1.5']) {
      expect(() => loadConfig({ ...base, STREAM_TICKS: v })).toThrow('STREAM_TICKS');
    }
  });

  it('throws when STREAM_TICKS is zero', () => {
    expect(() => loadConfig({ ...base, STREAM_TICKS: '0' })).toThrow('STREAM_TICKS');
  });

  it('throws when STREAM_INTERVAL_MS is not a number', () => {
    for (const v of ['abc', '5x', '-1', '1.5']) {
      expect(() => loadConfig({ ...base, STREAM_INTERVAL_MS: v })).toThrow('STREAM_INTERVAL_MS');
    }
    expect(loadConfig({ ...base, STREAM_INTERVAL_MS: '0' }).stream.intervalMs).toBe(0);
  });

  it('parses host and port from AWS_LAMBDA_HTTP_ENDPOINT', () => {
    expect(loadConfig({ ...base, AWS_LAMBDA_HTTP_ENDPOINT: '0.0.0.0:8080' }).listen).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
    expect(loadConfig({ ...base, AWS_LAMBDA_HTTP_ENDPOINT: '[::1]:9000' }).listen).toEqual({
      host: '::1',
      port: 9000,
    });
  });

  it('throws when AWS_LAMBDA_HTTP_ENDPOINT has no valid port', () => {
    for (const v of ['localhost', 'localhost:abc', 'localhost:70000']) {
      expect(() => loadConfig({ ...base, AWS_LAMBDA_HTTP_ENDPOINT: v })).toThrow('AWS_LAMBDA_HTTP_ENDPOINT');
    }
  });

  it('returns a deeply frozen object', () => {
    const c = loadConfig(base);
    for (const o of [c, c.listen, c.auth, c.stream]) {
      expect(Object.isFrozen(o)).toBe(true);
    }
    const j = loadConfig(jwt);
    for (const o of [j, j.listen, j.auth, j.stream]) {
      expect(Object.isFrozen(o)).toBe(true);
    }
    expect(Object.isFrozen((j.auth as { cognito: object }).cognito)).toBe(true);
  });
});
