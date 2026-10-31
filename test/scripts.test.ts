import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('scripts', () => {
  it('every shell script parses with bash -n', () => {
    const scripts = readdirSync(join(root, 'scripts')).filter((f) => f.endsWith('.sh'));
    expect(scripts.length).toBeGreaterThan(0);
    for (const file of scripts) {
      const r = spawnSync('bash', ['-n', join(root, 'scripts', file)], { encoding: 'utf8' });
      expect(r.status, `${file}: ${r.stderr}`).toBe(0);
    }
  });

  it.each([
    ['create-test-user.sh', 'bash'],
    ['smoke-jwt.sh', 'bash'],
    ['smoke-iam.ts', process.execPath],
  ])('%s prints usage and exits 2 without arguments', (file, command) => {
    const r = spawnSync(command, [join(root, 'scripts', file)], { env: {}, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain('usage');
    expect(r.stdout).toBe('');
  });
});

describe('env.sh', () => {
  let fixture: string;

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'envsh fixture-'));
    mkdirSync(join(fixture, 'scripts'));
    copyFileSync(join(root, 'scripts', 'env.sh'), join(fixture, 'scripts', 'env.sh'));
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it('loads configuration relative to itself and exports the configured region over the caller value', () => {
    writeFileSync(join(fixture, 'samconfig.toml'), `
version = 0.1
[default.global.parameters]
stack_name = "fixture-stack"
region = "us-east-2"
[default.deploy.parameters]
stack_name = "wrong-stack"
region = "ap-southeast-2"
`);
    const r = spawnSync('bash', [
      '-c', 'source "$1" && printf "%s\\n" "$STACK_NAME" && printenv AWS_REGION',
      'bash', join(fixture, 'scripts', 'env.sh'),
    ], {
      cwd: root,
      env: { ...process.env, STACK_NAME: 'caller-stack', AWS_REGION: 'eu-west-1' },
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('fixture-stack\nus-east-2\n');
  });

  it('fails clearly when its configuration file is missing', () => {
    const r = spawnSync('bash', ['-c', 'source "$1"', 'bash', join(fixture, 'scripts', 'env.sh')], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('could not read');
  });
});
