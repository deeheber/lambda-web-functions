import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

const base = {
  AUTH_ENDPOINT_IAM: 'iam',
  AUTH_ENDPOINT_JWT: 'public',
  COGNITO_USER_POOL_ID: 'pool',
  COGNITO_CLIENT_ID: 'client',
};

describe('loadConfig', () => {
  it('applies defaults when optional values are unset', () => {
    const c = loadConfig(base);
    expect(c.listen).toEqual({ host: '127.0.0.1', port: 3000 });
    expect(c.stream).toEqual({ ticks: 5, intervalMs: 500 });
    expect(c.auth.iamEndpointName).toBe('iam');
    expect(c.auth.cognito).toEqual({ userPoolId: 'pool', clientId: 'client' });
  });

  it.each(['AUTH_ENDPOINT_IAM', 'AUTH_ENDPOINT_JWT', 'COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID'])(
    'throws when %s is missing',
    (name) => {
      const env: Record<string, string | undefined> = { ...base };
      delete env[name];
      expect(() => loadConfig(env)).toThrow(name);
    },
  );

  it('treats an empty string as unset', () => {
    expect(() => loadConfig({ ...base, AUTH_ENDPOINT_IAM: '' })).toThrow('AUTH_ENDPOINT_IAM');
    const c = loadConfig({ ...base, STREAM_TICKS: '', STREAM_INTERVAL_MS: '', AWS_LAMBDA_HTTP_ENDPOINT: '' });
    expect(c.stream).toEqual({ ticks: 5, intervalMs: 500 });
    expect(c.listen.port).toBe(3000);
  });

  it('throws when the two endpoint names are equal', () => {
    expect(() => loadConfig({ ...base, AUTH_ENDPOINT_JWT: 'iam' })).toThrow('AUTH_ENDPOINT');
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
    for (const o of [c, c.listen, c.auth, c.auth.cognito, c.stream]) {
      expect(Object.isFrozen(o)).toBe(true);
    }
  });
});
