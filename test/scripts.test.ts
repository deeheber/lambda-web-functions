import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const shellScripts = readdirSync(`${root}scripts`).filter((f) => f.endsWith('.sh'));

describe('scripts', () => {
  it('every shell script parses with bash -n', () => {
    expect(shellScripts.length).toBeGreaterThan(0);
    for (const file of shellScripts) {
      const r = spawnSync('bash', ['-n', `${root}scripts/${file}`], { encoding: 'utf8' });
      expect(r.status, `${file}: ${r.stderr}`).toBe(0);
    }
  });

  it('every runnable shell script starts with set -euo pipefail', () => {
    for (const file of shellScripts.filter((f) => f !== 'env.sh')) {
      const head = readFileSync(`${root}scripts/${file}`, 'utf8').split('\n').slice(0, 5);
      expect(head, file).toContain('set -euo pipefail');
    }
  });

  it('dev bundles src/server.ts as CJS and runs it in iam mode', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { scripts: Record<string, string> };
    const dev = pkg.scripts.dev!;
    expect(dev).toContain('--format=cjs');
    expect(dev).toContain('dist/package.json');
    expect(dev).toContain('AUTH_MODE=iam');
    expect(dev).toContain('node dist/index.js');
    expect(dev).not.toContain('AWS_LAMBDA_HTTP_ENDPOINT');
    expect(dev).not.toContain('COGNITO_');
  });

  it('dev:public runs jwt mode on 127.0.0.1:3001 with a well-formed local pool id', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { scripts: Record<string, string> };
    const dev = pkg.scripts['dev:public']!;
    for (const part of [
      '--format=cjs',
      'AUTH_MODE=jwt',
      'AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:3001',
      'COGNITO_USER_POOL_ID=us-west-2_000000000',
      'COGNITO_CLIENT_ID=local',
    ]) {
      expect(dev).toContain(part);
    }
  });

  it('package.json wires deploy and teardown to the scripts', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.deploy).toBe('bash scripts/deploy.sh');
    expect(pkg.scripts.teardown).toBe('bash scripts/teardown.sh');
  });

  it('package.json wires create-test-user and smoke:jwt to the scripts', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['create-test-user']).toBe('bash scripts/create-test-user.sh');
    expect(pkg.scripts['smoke:jwt']).toBe('bash scripts/smoke-jwt.sh');
  });

  it('create-test-user.sh prints usage and exits 2 without an email', () => {
    const r = spawnSync('bash', [`${root}scripts/create-test-user.sh`], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage');
    expect(r.stdout).toBe('');
  });

  it('smoke-jwt.sh prints usage and exits 2 without a token', () => {
    const r = spawnSync('bash', [`${root}scripts/smoke-jwt.sh`], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage');
  });

  it('smoke-iam.ts prints usage and exits 2 without arguments', () => {
    const r = spawnSync(process.execPath, [`${root}scripts/smoke-iam.ts`], { env: {}, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage');
  });

  it('smoke-iam.ts signs for service lambda and sets x-amz-content-sha256', () => {
    const text = readFileSync(`${root}scripts/smoke-iam.ts`, 'utf8');
    expect(text).toContain("service: 'lambda'");
    expect(text).toContain('x-amz-content-sha256');
  });

  it('package.json wires smoke:iam through env.sh', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['smoke:iam']).toContain('source scripts/env.sh');
    expect(pkg.scripts['smoke:iam']).toContain('node scripts/smoke-iam.ts');
  });
});
