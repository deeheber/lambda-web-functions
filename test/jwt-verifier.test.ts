import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJwtVerifier } from '../src/auth/jwt-verifier.ts';

describe('createJwtVerifier', () => {
  const realFetch = globalThis.fetch;
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchStub = vi.fn().mockRejectedValue(new Error('network disabled'));
    globalThis.fetch = fetchStub as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('throws at creation for a malformed user pool id', () => {
    expect(() => createJwtVerifier({ userPoolId: 'not-a-pool', clientId: 'local' })).toThrow();
  });

  it('creates a verifier for a well-formed pool id', () => {
    const v = createJwtVerifier({ userPoolId: 'us-west-2_000000000', clientId: 'local' });
    expect(typeof v.verify).toBe('function');
  });

  it('rejects a malformed token without fetching a JWKS', async () => {
    const v = createJwtVerifier({ userPoolId: 'us-west-2_000000000', clientId: 'local' });
    await expect(v.verify('not-a-jwt')).rejects.toThrow();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
