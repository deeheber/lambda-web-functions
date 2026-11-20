import { statSync, writeFileSync } from "node:fs";

const dir = new URL("../.aws-sam/build/PublicFunction/", import.meta.url);
const bundle = new URL("server.js", dir);
if (!statSync(bundle).isFile()) {
  throw new Error(`Missing bundle: ${bundle.pathname}`);
}

writeFileSync(new URL("package.json", dir), '{"type":"module"}\n');
