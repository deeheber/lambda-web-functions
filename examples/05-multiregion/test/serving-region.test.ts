import { format } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { readServingRegion } from '../src/serving-region.ts';

const env = {
  AWS_LAMBDA_METADATA_API: '127.0.0.1:9001',
  AWS_LAMBDA_METADATA_TOKEN: 'metadata-token',
  AWS_REGION: 'us-west-2',
};

afterEach(() => vi.restoreAllMocks());

it.each([
  ['usw2-az4', 'us-west-2'],
  ['use1-az2', 'us-east-1'],
])('reads the Region from metadata AZ %s', async (azId, region) => {
  const fetchMetadata = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({ AvailabilityZoneID: azId }),
  );

  await expect(readServingRegion(env, fetchMetadata)).resolves.toBe(region);
  expect(fetchMetadata).toHaveBeenCalledOnce();
  expect(fetchMetadata).toHaveBeenCalledWith(
    'http://127.0.0.1:9001/2026-01-15/metadata/execution-environment',
    expect.objectContaining({
      headers: { Authorization: 'Bearer metadata-token' },
      redirect: 'error',
    }),
  );
});

it('reports null locally even if AWS_REGION is set', async () => {
  const fetchMetadata = vi.fn<typeof fetch>();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(readServingRegion({ AWS_REGION: 'us-west-2' }, fetchMetadata)).resolves.toBeNull();
  expect(fetchMetadata).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});

it('requires both metadata variables before making a request', async () => {
  const fetchMetadata = vi.fn<typeof fetch>();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { AWS_LAMBDA_METADATA_API: address } = env;
  await expect(readServingRegion({ AWS_LAMBDA_METADATA_API: address }, fetchMetadata)).resolves.toBeNull();
  expect(fetchMetadata).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledOnce();
});

it.each([
  ['unknown AZ', () => Response.json({ AvailabilityZoneID: 'euw1-az1' })],
  ['malformed AZ', () => Response.json({ AvailabilityZoneID: 'use1-unknown' })],
  ['HTTP error', () => Response.json({ AvailabilityZoneID: 'use1-az2' }, { status: 403 })],
  ['invalid JSON', () => new Response('not JSON')],
] as const)('reports null and warns for %s', async (_name, response) => {
  const fetchMetadata = vi.fn<typeof fetch>().mockResolvedValue(response());
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(readServingRegion(env, fetchMetadata)).resolves.toBeNull();
  expect(warn).toHaveBeenCalledOnce();
});

it('warns on transport failure without logging the metadata token', async () => {
  const fetchMetadata = vi.fn<typeof fetch>().mockRejectedValue(new Error('metadata-token'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(readServingRegion(env, fetchMetadata)).resolves.toBeNull();
  expect(warn).toHaveBeenCalledOnce();
  expect(format(...warn.mock.calls[0]!)).not.toContain(env.AWS_LAMBDA_METADATA_TOKEN);
});

it('bounds metadata lookup to one second and reports null when it aborts', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(
    AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')),
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const fetchMetadata: typeof fetch = async (_url, init) => {
    init?.signal?.throwIfAborted();
    return Response.json({ AvailabilityZoneID: 'use1-az2' });
  };

  await expect(readServingRegion(env, fetchMetadata)).resolves.toBeNull();
  expect(timeout).toHaveBeenCalledExactlyOnceWith(1000);
  expect(warn).toHaveBeenCalledOnce();
});
