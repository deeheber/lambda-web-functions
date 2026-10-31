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

  it('package.json wires deploy and teardown to the scripts', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.deploy).toBe('bash scripts/deploy.sh');
    expect(pkg.scripts.teardown).toBe('bash scripts/teardown.sh');
  });
});
