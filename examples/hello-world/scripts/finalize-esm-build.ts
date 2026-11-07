import { statSync, writeFileSync } from 'node:fs';

const artifactDirs = ['IamFunction', 'PublicFunction'].map(
  (name) => new URL(`../.aws-sam/build/${name}/`, import.meta.url),
);

for (const dir of artifactDirs) {
  if (!statSync(new URL('server.js', dir)).isFile()) {
    throw new Error(`Missing bundle: ${new URL('server.js', dir).pathname}`);
  }
}

for (const dir of artifactDirs) {
  writeFileSync(new URL('package.json', dir), '{"type":"module"}\n');
}
