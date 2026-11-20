import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/get-jwt.sh', import.meta.url));

it('loads and exports the deployment Region when sourced in zsh from another folder', () => {
  const envScript = fileURLToPath(new URL('../scripts/env.sh', import.meta.url));
  const result = spawnSync('zsh', [
    '-fc',
    'source "$1" && printf "%s\\n" "$STACK_NAME" && printenv AWS_REGION',
    'zsh',
    envScript,
  ], {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, AWS_REGION: 'us-east-1', STACK_NAME: 'caller-stack' },
  });

  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(result.stdout).toBe('lwf-multiregion\nus-west-2\n');
});

it('fetches a lab access token using the Stage 5 stack and home Region', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'lwf-multiregion-jwt-'));
  try {
    writeFileSync(join(fixture, 'aws'), `#!/bin/bash
set -euo pipefail
[[ "$AWS_REGION" == us-west-2 ]]
case "$1 $2" in
  "cloudformation describe-stacks")
    [[ "$3 $4" == "--stack-name lwf-multiregion" ]]
    case "$6" in
      *UserPoolId*) echo fixture-pool ;;
      *UserPoolClientId*) echo fixture-client ;;
      *) exit 1 ;;
    esac
    ;;
  "cognito-idp admin-create-user"|"cognito-idp admin-set-user-password")
    [[ "$3 $4" == "--user-pool-id fixture-pool" ]]
    ;;
  "cognito-idp initiate-auth")
    [[ "$3 $4" == "--auth-flow USER_PASSWORD_AUTH" ]]
    [[ "$5 $6" == "--client-id fixture-client" ]]
    shift 8
    [[ "$1 $2" == "--query AuthenticationResult.AccessToken" ]]
    echo fake.jwt.token
    ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });

    const result = spawnSync('/bin/bash', [script, 'user@example.com'], {
      cwd: fixture,
      encoding: 'utf8',
      env: {
        PATH: `${fixture}:/usr/bin:/bin`,
        AWS_REGION: 'us-east-1',
        TEST_USER_PASSWORD: 'Fixture1!password',
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('fake.jwt.token\n');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
