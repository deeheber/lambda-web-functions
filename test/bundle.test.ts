import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('scripts/build.sh', () => {
  let outDir: string;
  let extracted: string;
  let zip: string;
  let build: ReturnType<typeof spawnSync>;
  const children: ChildProcess[] = [];

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'lwf-build-'));
    extracted = mkdtempSync(join(tmpdir(), 'lwf-unzip-'));
    zip = join(outDir, 'app.zip');
    build = spawnSync('bash', ['scripts/build.sh', outDir], { cwd: root, encoding: 'utf8' });
    if (build.status === 0) spawnSync('unzip', ['-q', zip, '-d', extracted]);
  }, 120_000);

  afterEach(() => {
    for (const c of children.splice(0)) c.kill('SIGKILL');
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(extracted, { recursive: true, force: true });
  });

  it('exits 0 and writes app.zip containing only index.js at the root', () => {
    expect(build.status, String(build.stderr)).toBe(0);
    const list = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
    expect(list.stdout.trim().split('\n')).toEqual(['index.js']);
  });

  it('prints the sha256 of the zip', () => {
    const match = /sha256: ([0-9a-f]{64})/.exec(String(build.stdout));
    expect(match).not.toBeNull();
    expect(match![1]).toBe(createHash('sha256').update(readFileSync(zip)).digest('hex'));
  });

  it('emits a CommonJS bundle', () => {
    const lines = readFileSync(join(outDir, 'index.js'), 'utf8').split('\n');
    expect(lines.filter((l) => /^(import|export)\s/.test(l))).toEqual([]);
  });

  it('the unzipped bundle listens, serves /health and exits 0 within 1 s of SIGTERM', async () => {
    const child = spawn(process.execPath, [join(extracted, 'index.js')], {
      env: {
        AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0',
        AUTH_ENDPOINT_IAM: 'iam',
        AUTH_ENDPOINT_JWT: 'public',
        COGNITO_USER_POOL_ID: 'us-west-2_000000000',
        COGNITO_CLIENT_ID: 'local',
      },
    });
    children.push(child);
    child.stderr.resume();
    const exited = new Promise<{ code: number | null; at: number }>((resolve) => {
      child.on('exit', (code) => resolve({ code, at: Date.now() }));
    });
    const port = await new Promise<number>((resolve, reject) => {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d: string) => {
        for (const line of d.split('\n')) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.msg === 'listening') resolve(parsed.port);
          } catch {
            // not JSON
          }
        }
      });
      child.on('exit', () => reject(new Error('bundle exited before listening')));
    });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/health', headers: { 'lambda-web-endpoint-name': 'iam' } }, (r) => {
          r.resume();
          resolve(r.statusCode);
        })
        .on('error', reject);
    });
    expect(status).toBe(200);
    const sent = Date.now();
    child.kill('SIGTERM');
    const { code, at } = await exited;
    expect(code).toBe(0);
    expect(at - sent).toBeLessThan(1000);
  }, 15_000);
});
