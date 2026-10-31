import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const buildDir = (id: string) => join(root, '.aws-sam', 'build', id);

interface Started {
  child: ChildProcess;
  port: number;
  exited: Promise<{ code: number | null; at: number }>;
}

function get(port: number, path: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (r) => {
        r.resume();
        resolve(r.statusCode);
      })
      .on('error', reject);
  });
}

describe('npm run build (sam build)', () => {
  let build: ReturnType<typeof spawnSync>;
  const tmpDirs: string[] = [];
  const children: ChildProcess[] = [];

  beforeAll(() => {
    build = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
  }, 300_000);

  afterEach(() => {
    for (const c of children.splice(0)) c.kill('SIGKILL');
  });

  afterAll(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  });

  function startCopy(id: string, env: Record<string, string>): Promise<Started> {
    const dir = mkdtempSync(join(tmpdir(), 'lwf-bundle-'));
    tmpDirs.push(dir);
    const copy = join(dir, 'server.js');
    copyFileSync(join(buildDir(id), 'server.js'), copy);
    const child = spawn(process.execPath, [copy], { env });
    children.push(child);
    child.stderr.resume();
    const exited = new Promise<{ code: number | null; at: number }>((resolve) => {
      child.on('exit', (code) => resolve({ code, at: Date.now() }));
    });
    return new Promise<Started>((resolve, reject) => {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d: string) => {
        for (const line of d.split('\n')) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.msg === 'listening') resolve({ child, port: parsed.port, exited });
          } catch {
            // not JSON
          }
        }
      });
      child.on('exit', () => reject(new Error('bundle exited before listening')));
    });
  }

  it('exits 0', () => {
    expect(build.status, String(build.stderr)).toBe(0);
  });

  it("writes only server.js to each function's build directory", () => {
    for (const id of ['IamFunction', 'PublicFunction']) {
      expect(readdirSync(buildDir(id))).toEqual(['server.js']);
    }
  });

  it('emits a CommonJS bundle', () => {
    for (const id of ['IamFunction', 'PublicFunction']) {
      const lines = readFileSync(join(buildDir(id), 'server.js'), 'utf8').split('\n');
      expect(lines.filter((l) => /^(import|export)\s/.test(l))).toEqual([]);
    }
  });

  it('the IamFunction bundle, copied to a temp dir, serves /health and exits 0 within 1 s of SIGTERM', async () => {
    const { child, port, exited } = await startCopy('IamFunction', {
      AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0',
      AUTH_MODE: 'iam',
    });
    expect(await get(port, '/health')).toBe(200);
    const sent = Date.now();
    child.kill('SIGTERM');
    const { code, at } = await exited;
    expect(code).toBe(0);
    expect(at - sent).toBeLessThan(1000);
  }, 15_000);

  it('the PublicFunction bundle, copied to a temp dir, starts in jwt mode and returns 401 on /whoami without a token', async () => {
    const { port } = await startCopy('PublicFunction', {
      AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0',
      AUTH_MODE: 'jwt',
      COGNITO_USER_POOL_ID: 'us-west-2_000000000',
      COGNITO_CLIENT_ID: 'local',
    });
    expect(await get(port, '/health')).toBe(200);
    expect(await get(port, '/whoami')).toBe(401);
  }, 15_000);
});
