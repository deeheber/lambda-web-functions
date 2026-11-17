import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'lwf-cloudfront-smoke-'));
  mkdirSync(join(fixture, 'scripts'));
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

describe('JWT checker with fake AWS CLI and HTTP transport', () => {
  function run(scenario: string) {
    for (const name of ['check-jwt.sh', 'env.sh']) copyFileSync(join(root, 'scripts', name), join(fixture, 'scripts', name));
    copyFileSync(join(root, 'samconfig.toml'), join(fixture, 'samconfig.toml'));
    writeFileSync(join(fixture, 'aws'), `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.CALL_LOG, process.argv.slice(2).join(' ') + '\\n');
console.log('https://distribution.invalid');
`, { mode: 0o700 });
    writeFileSync(join(fixture, 'curl'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
const url = args.at(-1);
const valid = args.includes('Authorization: Bearer good-token');
if (url.endsWith('/stream')) {
  fs.writeFileSync(args[args.indexOf('-D') + 1], 'HTTP/2 200\\r\\ncontent-type: text/event-stream\\r\\ncache-control: no-store\\r\\n\\r\\n');
  console.log('data: {"tick":1}\\n');
} else {
  const health = url.endsWith('/health');
  const status = health || (valid && process.env.SCENARIO !== 'lost-header') ? 200 : 401;
  const body = health ? {status:'ok'} : status === 200 ? {authMode:'jwt',subject:'user-123'} : {error:'unauthorized'};
  console.log(JSON.stringify(body) + '\\n' + status);
}
`, { mode: 0o700 });
    return spawnSync('bash', [join(fixture, 'scripts/check-jwt.sh'), 'good-token'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fixture}:${process.env.PATH}`, CALL_LOG: join(fixture, 'calls'), SCENARIO: scenario },
    });
  }

  it('checks the distribution URL, invalid tokens, and anonymous access after a valid token', () => {
    const result = run('ok');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('PASS anonymous request after authenticated request is 401');
    expect(result.stdout).toContain('PASS stream with token');
    const log = readFileSync(join(fixture, 'calls'), 'utf8');
    expect(log).toContain('CloudFrontEndpointUrl');
    expect(log).not.toContain('PublicEndpointUrl');
    expect(log).toContain('Authorization: Bearer invalid');
    expect(log).toContain('https://distribution.invalid/stream');
  });

  it('fails when a valid token does not reach the app', () => {
    const result = run('lost-header');
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain('FAIL whoami with token (401)');
  });
});

describe('IAM checker with a fake fetch and static test credentials', () => {
  it.each([['ok', 0], ['unexpected-access', 1]] as const)('reports %s correctly without AWS calls', (scenario, status) => {
    writeFileSync(join(fixture, 'transport.mjs'), `
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  const signed = options?.headers?.authorization?.startsWith('AWS4-');
  appendFileSync(process.env.CALL_LOG, JSON.stringify({url, signed: !!signed}) + '\\n');
  const status = !signed ? 403 : url.endsWith('/health') || process.env.SCENARIO === 'unexpected-access' ? 200 : 401;
  return new Response(JSON.stringify(status === 200 ? {status:'ok'} : {error:'unauthorized'}), {status});
};
`);
    const result = spawnSync(process.execPath, ['--import', join(fixture, 'transport.mjs'), join(root, 'scripts/smoke-iam.ts'), 'https://origin.invalid', 'us-west-2'], {
      encoding: 'utf8',
      env: { AWS_ACCESS_KEY_ID: 'test-access-key', AWS_SECRET_ACCESS_KEY: 'test-secret', AWS_EC2_METADATA_DISABLED: 'true', CALL_LOG: join(fixture, 'calls'), SCENARIO: scenario },
    });
    expect(result.status, result.stderr).toBe(status);
    expect(result.stdout).toContain('signed /whoami still requires a JWT');
    const calls = readFileSync(join(fixture, 'calls'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(calls).toEqual([
      { url: 'https://origin.invalid/health', signed: true },
      { url: 'https://origin.invalid/whoami', signed: true },
      { url: 'https://origin.invalid/health', signed: false },
    ]);
  });
});
