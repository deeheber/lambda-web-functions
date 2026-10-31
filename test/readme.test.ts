import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const readme = readFileSync(`${root}README.md`, 'utf8');

describe('README.md', () => {
  it('documents every npm script', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { scripts: Record<string, string> };
    for (const name of Object.keys(pkg.scripts)) {
      const documented = name === 'test' ? readme.includes('npm test') : readme.includes(`npm run ${name}`);
      expect(documented, name).toBe(true);
    }
  });

  it('links issues 1 to 4', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(readme).toContain(`https://github.com/deeheber/lambda-web-functions/issues/${n}`);
    }
  });

  it('lists the prerequisites', () => {
    expect(readme).toContain('Node 24');
    expect(readme).toContain('AWS CLI v2');
    expect(readme).toContain('cfn-lint');
    expect(readme).toContain('SAM CLI');
    expect(readme).toContain('1.170');
  });

  it('explains the two functions and AUTH_MODE', () => {
    for (const word of ['IamAuth', 'ApplicationManaged', 'AUTH_MODE']) expect(readme).toContain(word);
  });

  it('names the template lint command and the log groups', () => {
    expect(readme).toContain('cfn-lint template.yaml');
    expect(readme).toContain('/aws/lambda/web/lwf-iam');
    expect(readme).toContain('/aws/lambda/web/lwf-public');
  });

  it('has no 0.1 leftovers', () => {
    for (const word of ['lambda-web-endpoint-name', 'infra/', 'AUTH_ENDPOINT', 'artifacts', 'app.zip', "Don't deploy this version"]) {
      expect(readme, word).not.toContain(word);
    }
  });
});
