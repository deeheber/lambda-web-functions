import { SAMPLE_TIMEOUT_MS } from '../src/config.ts';

export async function sample(args: string[], token: string | undefined, fetcher: typeof fetch = fetch) {
  const [base, countText] = args;
  const usage = 'usage: TOKEN=<access-token> npm run sample -- <base-url> <positive-count>';
  let url: URL;
  try {
    url = new URL(base!);
  } catch {
    throw new Error(usage);
  }
  const count = Number(countText);
  if (args.length !== 2 || !token?.trim() || /[\r\n]/.test(token) ||
      !/^\d+$/.test(countText!) || !Number.isSafeInteger(count) || count < 1 ||
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error(usage);
  }
  url.pathname = '/whoami';
  const builds = new Map<string, number>();
  const failures = new Map<string, number>();
  let successful = 0;
  for (let i = 0; i < count; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SAMPLE_TIMEOUT_MS);
    let failure: string | undefined;
    try {
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status !== 200) {
        failure = `HTTP ${response.status}`;
        await response.body?.cancel();
      } else {
        const body: unknown = await response.json();
        if (typeof body !== 'object' || body === null || !('buildId' in body) ||
            typeof body.buildId !== 'string' || !body.buildId.trim()) {
          failure = 'invalid response';
        } else {
          builds.set(body.buildId, (builds.get(body.buildId) ?? 0) + 1);
          successful++;
        }
      }
    } catch (error) {
      failure = controller.signal.aborted ? 'timeout' :
        error instanceof SyntaxError ? 'invalid response' : 'request failed';
    } finally {
      clearTimeout(timer);
    }
    if (failure) failures.set(failure, (failures.get(failure) ?? 0) + 1);
  }
  return {
    requested: count,
    successful,
    builds: [...builds].sort(([a], [b]) => a.localeCompare(b)).map(([buildId, requests]) => ({
      buildId, requests, percentOfSuccessful: Number((100 * requests / successful).toFixed(1)),
    })),
    failures: Object.fromEntries(failures),
  };
}

if (import.meta.main) {
  try {
    const result = await sample(process.argv.slice(2), process.env.TOKEN);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.successful === result.requested ? 0 : 1;
  } catch {
    console.error('usage: TOKEN=<access-token> npm run sample -- <base-url> <positive-count>');
    process.exitCode = 2;
  }
}
