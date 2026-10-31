import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

const baseEnv = {
  AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0',
  AUTH_MODE: 'iam',
};
const jwtEnv = {
  AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0',
  AUTH_MODE: 'jwt',
  COGNITO_USER_POOL_ID: 'us-west-2_000000000',
  COGNITO_CLIENT_ID: 'local',
};

const children: ChildProcess[] = [];

interface Started {
  child: ChildProcess;
  listening: { msg: string; host: string; port: number; envId: string; authMode: string };
  exited: Promise<{ code: number | null; at: number }>;
}

async function start(env: Record<string, string>): Promise<Started> {
  const child = spawn(process.execPath, ['src/server.ts'], { cwd: root, env });
  children.push(child);
  const exited = new Promise<{ code: number | null; at: number }>((resolve) => {
    child.on('exit', (code) => resolve({ code, at: Date.now() }));
  });
  child.stderr?.resume();
  const listening = await new Promise<Started['listening']>((resolve, reject) => {
    let buf = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      buf += d;
      for (const line of buf.split('\n')) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.msg === 'listening') resolve(parsed);
        } catch {
          // not JSON, ignore
        }
      }
    });
    child.on('exit', () => reject(new Error('exited before listening')));
  });
  return { child, listening, exited };
}

async function exitCode(env: Record<string, string>): Promise<number | null> {
  const child = spawn(process.execPath, ['src/server.ts'], { cwd: root, env });
  children.push(child);
  child.stderr?.resume();
  return new Promise<number | null>((resolve) => child.on('exit', resolve));
}

afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
});

describe('server entry point', { timeout: 15000 }, () => {
  it('logs one JSON listening line with host, port, envId and authMode', async () => {
    const { listening } = await start(baseEnv);
    expect(listening.authMode).toBe('iam');
    expect(listening.host).toBe('127.0.0.1');
    expect(listening.port).toBeGreaterThan(0);
    expect(listening.envId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs authMode jwt when started in jwt mode', async () => {
    const { listening } = await start(jwtEnv);
    expect(listening.authMode).toBe('jwt');
  });

  it('starts in iam mode even with a malformed COGNITO_USER_POOL_ID', async () => {
    const { listening } = await start({ ...baseEnv, COGNITO_USER_POOL_ID: 'bad', COGNITO_CLIENT_ID: 'x' });
    expect(listening.authMode).toBe('iam');
  });

  it('exits non-zero in jwt mode with a malformed COGNITO_USER_POOL_ID', async () => {
    expect(await exitCode({ ...jwtEnv, COGNITO_USER_POOL_ID: 'bad' })).not.toBe(0);
  });

  it('serves /health on the logged port', async () => {
    const { listening } = await start(baseEnv);
    const res = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      http
        .get(
          { host: '127.0.0.1', port: listening.port, path: '/health' },
          (r) => {
            let body = '';
            r.on('data', (d) => (body += d));
            r.on('end', () => resolve({ status: r.statusCode, body }));
          },
        )
        .on('error', reject);
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });

  it('exits 0 within 1 s of SIGTERM', async () => {
    const { child, exited } = await start(baseEnv);
    const sent = Date.now();
    child.kill('SIGTERM');
    const { code, at } = await exited;
    expect(code).toBe(0);
    expect(at - sent).toBeLessThan(1000);
  });

  it('exits 0 within 1 s of SIGTERM while a /stream response is open', async () => {
    const { child, listening, exited } = await start(baseEnv);
    const req = http.get({
      host: '127.0.0.1',
      port: listening.port,
      path: '/stream',
    });
    req.on('error', () => {});
    await new Promise<void>((resolve) => {
      req.on('response', (r) => {
        r.once('data', () => resolve());
      });
    });
    const sent = Date.now();
    child.kill('SIGTERM');
    const { code, at } = await exited;
    req.destroy();
    expect(code).toBe(0);
    expect(at - sent).toBeLessThan(1000);
  });

  it('exits non-zero when AUTH_MODE is missing', async () => {
    const env: Record<string, string> = { ...baseEnv };
    delete env.AUTH_MODE;
    expect(await exitCode(env)).not.toBe(0);
  });

  it('exits non-zero when AUTH_MODE is none', async () => {
    expect(await exitCode({ ...baseEnv, AUTH_MODE: 'none' })).not.toBe(0);
  });

  it('exits non-zero in jwt mode without Cognito values', async () => {
    expect(await exitCode({ AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0', AUTH_MODE: 'jwt' })).not.toBe(0);
  });
});
