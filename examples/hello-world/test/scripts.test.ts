import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    ['get-jwt.sh', 'bash'],
    ['smoke-jwt.sh', 'bash'],
    ['check-jwt.sh', 'bash'],
    ['smoke-iam.ts', process.execPath],
  ])('%s prints usage and exits 2 without arguments', (file, command) => {
    const r = spawnSync(command, [join(root, 'scripts', file)], { env: {}, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain('usage');
    expect(r.stdout).toBe('');
  });
});

describe('JWT commands with a fake AWS CLI', () => {
  let fixture: string;

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'lwf-jwt-'));
    mkdirSync(join(fixture, 'scripts'));
    for (const file of ['env.sh', 'get-jwt.sh', 'smoke-jwt.sh']) {
      copyFileSync(join(root, 'scripts', file), join(fixture, 'scripts', file));
    }
    copyFileSync(join(root, 'samconfig.toml'), join(fixture, 'samconfig.toml'));
    writeFileSync(join(fixture, 'aws'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const operation = args[1];
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
if (operation === 'describe-stacks') console.log(args.join(' ').includes('UserPoolClientId') ? 'fixture-client' : 'fixture-pool');
else if (operation === 'admin-create-user' && process.env.SCENARIO !== 'new') {
  console.error('An error occurred (' + (process.env.SCENARIO === 'denied' ? 'AccessDeniedException' : 'UsernameExistsException') + ')');
  process.exit(1);
} else if (operation === 'initiate-auth') {
  if (process.env.SCENARIO === 'auth-failed') { console.error('NotAuthorizedException'); process.exit(1); }
  console.log(process.env.SCENARIO === 'challenge' ? 'None' : 'fake.jwt.token');
}
`, { mode: 0o700 });
    writeFileSync(join(fixture, 'scripts/check-jwt.sh'), 'printf "checked:%s\\n" "$1"\n');
  });

  afterEach(() => rmSync(fixture, { recursive: true, force: true }));

  function run(script: string, scenario: string) {
    return spawnSync('bash', [join(fixture, 'scripts', script), 'user@example.com'], {
      cwd: tmpdir(), encoding: 'utf8',
      env: { ...process.env, PATH: `${fixture}:${process.env.PATH}`, CALL_LOG: join(fixture, 'calls'), SCENARIO: scenario, TEST_USER_PASSWORD: 'Fixture1!password' },
    });
  }

  it.each(['new', 'existing'])('returns only a JWT for a %s user', (scenario) => {
    const r = run('get-jwt.sh', scenario);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('fake.jwt.token\n');
    const calls: string[][] = readFileSync(join(fixture, 'calls'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const create = calls.find((args) => args[1] === 'admin-create-user');
    const reset = calls.find((args) => args[1] === 'admin-set-user-password');
    const auth = calls.find((args) => args[1] === 'initiate-auth');
    expect(create).toEqual(expect.arrayContaining(['--user-pool-id', 'fixture-pool', '--username', 'user@example.com']));
    expect(reset).toEqual(expect.arrayContaining(['--user-pool-id', 'fixture-pool', '--username', 'user@example.com', '--password', 'Fixture1!password', '--permanent']));
    expect(auth).toEqual(expect.arrayContaining(['--client-id', 'fixture-client', '--auth-flow', 'USER_PASSWORD_AUTH', '--auth-parameters', 'USERNAME=user@example.com,PASSWORD=Fixture1!password', '--query', 'AuthenticationResult.AccessToken']));
  });

  it('stops before resetting a password when creation fails for another reason', () => {
    const r = run('get-jwt.sh', 'denied');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('AccessDeniedException');
    expect(readFileSync(join(fixture, 'calls'), 'utf8')).not.toContain('admin-set-user-password');
  });

  it('passes the token to the HTTP checker', () => {
    const r = run('smoke-jwt.sh', 'existing');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('checked:fake.jwt.token\n');
  });

  it.each(['auth-failed', 'challenge'])('does not run HTTP checks when sign-in returns %s', (scenario) => {
    const r = run('smoke-jwt.sh', scenario);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(scenario === 'auth-failed' ? 'NotAuthorizedException' : 'Sign-in did not return an access token');
  });
});

describe('ESM build finalization', () => {
  let fixture: string;

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'lwf-esm-build-'));
    mkdirSync(join(fixture, 'scripts'));
    copyFileSync(join(root, 'scripts/finalize-esm-build.ts'), join(fixture, 'scripts/finalize-esm-build.ts'));
    for (const name of ['IamFunction', 'PublicFunction']) {
      mkdirSync(join(fixture, '.aws-sam/build', name), { recursive: true });
      writeFileSync(join(fixture, '.aws-sam/build', name, 'server.js'), 'export {};');
    }
  });

  afterEach(() => rmSync(fixture, { recursive: true, force: true }));

  it('marks both packages as ESM relative to the script rather than the working directory', () => {
    const r = spawnSync(process.execPath, [join(fixture, 'scripts/finalize-esm-build.ts')], {
      cwd: tmpdir(), encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    for (const name of ['IamFunction', 'PublicFunction']) {
      expect(JSON.parse(readFileSync(join(fixture, '.aws-sam/build', name, 'package.json'), 'utf8')))
        .toEqual({ type: 'module' });
    }
  });

  it('fails before writing package markers when a bundle is missing', () => {
    rmSync(join(fixture, '.aws-sam/build/PublicFunction/server.js'));
    const r = spawnSync(process.execPath, [join(fixture, 'scripts/finalize-esm-build.ts')], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('PublicFunction/server.js');
    for (const name of ['IamFunction', 'PublicFunction']) {
      expect(existsSync(join(fixture, '.aws-sam/build', name, 'package.json'))).toBe(false);
    }
  });
});

describe.each(['bash', 'zsh'])('env.sh sourced in %s', (shell) => {
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
    const r = spawnSync(shell, [
      '-c', 'source "$1" && printf "%s\\n" "$STACK_NAME" && printenv AWS_REGION',
      shell, join(fixture, 'scripts', 'env.sh'),
    ], {
      cwd: root,
      env: { ...process.env, STACK_NAME: 'caller-stack', AWS_REGION: 'eu-west-1' },
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('fixture-stack\nus-east-2\n');
  });

  it('fails clearly when its configuration file is missing', () => {
    const r = spawnSync(shell, ['-c', 'source "$1"', shell, join(fixture, 'scripts', 'env.sh')], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('could not read');
  });
});
