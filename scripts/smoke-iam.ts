import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { SignatureV4 } from '@smithy/signature-v4';

const [baseUrl, region] = process.argv.slice(2);
if (!baseUrl || !baseUrl.startsWith('https://') || !region) {
  console.error('usage: node scripts/smoke-iam.ts <IamEndpointUrl> <region>');
  process.exit(2);
}

const { hostname } = new URL(baseUrl);
const base = baseUrl.replace(/\/$/, '');
const signer = new SignatureV4({
  service: 'lambda',
  region,
  credentials: defaultProvider(),
  sha256: Sha256,
});

let failed = false;
function report(ok: boolean, check: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${check}`);
  if (!ok) failed = true;
}

interface Json {
  status?: string;
  endpoint?: string;
  authMode?: string;
  subject?: string | null;
}

async function signedGet(path: string): Promise<Response> {
  const signed = await signer.sign({
    method: 'GET',
    protocol: 'https:',
    hostname,
    path,
    query: {},
    headers: { host: hostname, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
  });
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(signed.headers)) {
    if (name.toLowerCase() !== 'host') headers[name] = value;
  }
  return fetch(base + path, { headers });
}

try {
  const health = await signedGet('/health');
  const healthBody = (await health.json()) as Json;
  report(health.status === 200 && healthBody.status === 'ok', 'signed /health');

  const whoami = await signedGet('/whoami');
  const who = whoami.status === 200 ? ((await whoami.json()) as Json) : null;
  report(
    who !== null && who.endpoint === 'iam' && who.authMode === 'iam' && who.subject === null,
    'signed /whoami',
  );

  const stream = await signedGet('/stream');
  const text = await stream.text();
  const lines = text.split('\n').filter((l) => l.startsWith('data: '));
  report(
    stream.status === 200 &&
      (stream.headers.get('content-type') ?? '').startsWith('text/event-stream') &&
      lines.length >= 1 &&
      lines.every((l, i) => (JSON.parse(l.slice(6)) as { tick?: number }).tick === i + 1),
    'signed /stream',
  );

  const unsigned = await fetch(`${base}/health`);
  report(unsigned.status === 403, 'unsigned /health is 403');
} catch (err) {
  console.error(err);
  failed = true;
}

process.exit(failed ? 1 : 0);
