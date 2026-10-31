import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('build runs sam build', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toBe('sam build');
  });

  it('esbuild is a devDependency, not a dependency', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies.esbuild).toBeDefined();
    expect(pkg.dependencies.esbuild).toBeUndefined();
  });

  it('package.json wires build, deploy and teardown to the SAM CLI', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toBe('sam build');
    expect(pkg.scripts.deploy).toBe('sam build && sam deploy');
    expect(pkg.scripts.teardown).toBe('sam delete --no-prompts');
  });

  it('the 0.1 infra and build scripts are gone', () => {
    for (const path of ['infra', 'scripts/build.sh', 'scripts/deploy.sh', 'scripts/teardown.sh']) {
      expect(existsSync(`${root}${path}`), path).toBe(false);
    }
  });

  it('env.sh no longer defines ARTIFACTS_STACK_NAME', () => {
    expect(readFileSync(`${root}scripts/env.sh`, 'utf8')).not.toContain('ARTIFACTS_STACK_NAME');
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

  it('env.sh takes the stack name and Region from samconfig.toml', () => {
    const r = spawnSync('bash', ['-c', 'source scripts/env.sh && printf "%s %s" "$STACK_NAME" "$AWS_REGION"'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(r.stdout).toBe('lwf us-west-2');
  });

  it('smoke-iam.ts no longer reads an endpoint field', () => {
    expect(readFileSync(`${root}scripts/smoke-iam.ts`, 'utf8')).not.toMatch(/\.endpoint\b/);
  });

  it('no script references infra/ or the artifacts stack', () => {
    for (const file of readdirSync(`${root}scripts`)) {
      const text = readFileSync(`${root}scripts/${file}`, 'utf8');
      for (const word of ['infra/', 'artifacts', 'ARTIFACTS_STACK_NAME']) {
        expect(text, `${file}: ${word}`).not.toContain(word);
      }
    }
  });

  it('env.sh overrides a caller AWS_REGION with samconfig.toml', () => {
    const r = spawnSync('bash', ['-c', 'export AWS_REGION=eu-west-1; source scripts/env.sh && printf %s "$AWS_REGION"'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(r.stdout).toBe('us-west-2');
  });

  it('env.sh exports AWS_REGION', () => {
    const r = spawnSync('bash', ['-c', 'source scripts/env.sh && printenv AWS_REGION'], { cwd: root, encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('us-west-2');
  });

  it('env.sh fails clearly without a readable samconfig.toml', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'envsh-'));
    try {
      mkdirSync(join(tmp, 'scripts'));
      copyFileSync(`${root}scripts/env.sh`, join(tmp, 'scripts', 'env.sh'));
      const r = spawnSync('bash', ['-c', `source ${join(tmp, 'scripts', 'env.sh')}`], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('could not read');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('env.sh finds samconfig.toml from its own location, not the cwd', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'envsh-cwd-'));
    try {
      const r = spawnSync(
        'bash',
        ['-c', `source ${root}scripts/env.sh && printf "%s %s" "$STACK_NAME" "$AWS_REGION"`],
        { cwd: tmp, encoding: 'utf8' },
      );
      expect(r.stdout).toBe('lwf us-west-2');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
