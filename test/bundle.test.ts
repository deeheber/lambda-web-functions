import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

it('the packaged app starts and serves /health', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lwf-bundle-'));
  let child: ReturnType<typeof spawn> | undefined;
  let closed: Promise<void> | undefined;
  try {
    const copy = join(dir, 'server.js');
    copyFileSync(join(root, '.aws-sam/build/PublicFunction/server.js'), copy);
    child = spawn(process.execPath, [copy], {
      env: {
        AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0',
        AUTH_MODE: 'jwt',
        COGNITO_USER_POOL_ID: 'us-west-2_000000000',
        COGNITO_CLIENT_ID: 'local',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    closed = new Promise((resolve) => child!.once('close', () => resolve()));
    let stderr = '';
    child.stderr!.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const lines = createInterface({ input: child.stdout! });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const port = await new Promise<number>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Bundle startup timed out: ${stderr}`)), 10_000);
      child!.once('error', reject);
      child!.once('exit', (code) => reject(new Error(`Bundle exited (${code}): ${stderr}`)));
      lines.on('line', (line) => {
        let message;
        try {
          message = JSON.parse(line) as { msg?: string; port?: number };
        } catch {
          return;
        }
        if (message.msg === 'listening' && typeof message.port === 'number') resolve(message.port);
      });
    }).finally(() => clearTimeout(timer));
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  } finally {
    child?.kill('SIGKILL');
    await closed;
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
