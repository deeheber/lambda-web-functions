import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { sample } from '../scripts/sample.ts';
import { SAMPLE_TIMEOUT_MS } from '../src/config.ts';

afterEach(() => vi.useRealTimers());

it('counts builds separately from failures and sends authenticated requests', async () => {
  const responses = [
    Response.json({ buildId: 'baseline-v1' }), Response.json({ buildId: 'candidate-v2' }),
    Response.json({ buildId: 'baseline-v1' }), new Response('denied', { status: 401 }),
    new Response('busy', { status: 429 }), new Response('not json'), Response.json({}),
  ];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
  const result = await sample(['https://example.com', '7'], 'secret', fetcher);
  expect(result).toEqual({
    requested: 7, successful: 3,
    builds: [
      { buildId: 'baseline-v1', requests: 2, percentOfSuccessful: 66.7 },
      { buildId: 'candidate-v2', requests: 1, percentOfSuccessful: 33.3 },
    ],
    failures: { 'HTTP 401': 1, 'HTTP 429': 1, 'invalid response': 2 },
  });
  for (const [url, options] of fetcher.mock.calls) {
    expect(String(url)).toBe('https://example.com/whoami');
    expect(options).toMatchObject({ headers: { Authorization: 'Bearer secret' }, redirect: 'error' });
  }
});

it.each(['headers', 'body'])('aborts stalled %s, reports it, and continues without retrying', async (phase) => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>()
    .mockImplementationOnce(async (_url, options) => {
      if (phase === 'headers') {
        return new Promise((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => reject(new Error('secret')), { once: true });
        });
      }
      return new Response(new ReadableStream({
        start(controller) {
          options!.signal!.addEventListener('abort', () => controller.error(new Error('secret')), { once: true });
        },
      }));
    })
    .mockRejectedValueOnce(new Error('network error containing secret'));
  const result = sample(['https://example.com', '2'], 'secret', fetcher);
  await vi.advanceTimersByTimeAsync(SAMPLE_TIMEOUT_MS);
  expect(await result).toEqual({
    requested: 2, successful: 0, builds: [], failures: { timeout: 1, 'request failed': 1 },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  [[], 'token'], [['https://example.com', '1'], undefined],
  [['https://example.com', '0'], 'token'], [['https://example.com', '1.5'], 'token'],
  [['https://example.com', '9007199254740992'], 'token'],
  [['file:///tmp/example', '1'], 'token'], [['https://user:pass@example.com', '1'], 'token'],
  [['https://example.com/path', '1'], 'token'], [['https://example.com', '1', 'extra'], 'token'],
])('rejects invalid input before requesting anything: %j', async (args, token) => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(sample(args as string[], token as string | undefined, fetcher)).rejects.toThrow('usage:');
  expect(fetcher).not.toHaveBeenCalled();
});

it('the CLI rejects missing arguments without echoing credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/sample.ts', 'https://example.com'], {
    cwd: new URL('..', import.meta.url), env: { TOKEN: 'private-token' }, encoding: 'utf8',
  });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('usage:');
  expect(result.stderr).not.toContain('private-token');
  expect(result.stdout).toBe('');
});

it.each([[200, 0], [401, 1]])('the CLI reports HTTP %i with exit status %i', (status, exitCode) => {
  const fixture = `globalThis.fetch = async (_url, options) => {
    if (options.headers.Authorization !== 'Bearer private-token') throw new Error('missing credentials');
    return new Response(JSON.stringify({buildId:'fixture'}), {status:${status}});
  };`;
  const result = spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(fixture)}`,
    'scripts/sample.ts', 'https://example.com', '1',
  ], { cwd: new URL('..', import.meta.url), env: { TOKEN: 'private-token' }, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(exitCode);
  expect(JSON.parse(result.stdout)).toMatchObject({ requested: 1, successful: status === 200 ? 1 : 0 });
  expect(result.stderr).toBe('');
  expect(result.stdout).not.toContain('private-token');
});
