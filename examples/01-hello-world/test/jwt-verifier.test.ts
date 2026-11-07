import { createSign, generateKeyPairSync } from 'node:crypto';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJwtVerifier } from '../src/auth/jwt-verifier.ts';
import type { Jwks } from '../src/auth/types.ts';

const POOL = 'us-west-2_000000000';
const ISS = `https://cognito-idp.us-west-2.amazonaws.com/${POOL}`;
const KID = 'test-kid';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks: Jwks = {
  keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }],
};

function b64(o: object): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

function sign(claims: Record<string, unknown>): string {
  const body = `${b64({ alg: 'RS256', kid: KID, typ: 'JWT' })}.${b64({
    iss: ISS,
    token_use: 'access',
    client_id: 'local',
    sub: 'sub-123',
    username: 'someone',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  })}`;
  const sig = createSign('RSA-SHA256').update(body).sign(privateKey).toString('base64url');
  return `${body}.${sig}`;
}

describe('createJwtVerifier', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws at creation for a malformed user pool id', () => {
    expect(() => createJwtVerifier({ userPoolId: 'not-a-pool', clientId: 'local' })).toThrow();
  });

  it('creates a verifier for a well-formed pool id', () => {
    const v = createJwtVerifier({ userPoolId: POOL, clientId: 'local' });
    expect(typeof v.verify).toBe('function');
  });

  it('resolves a valid access token to its sub', async () => {
    const v = createJwtVerifier({ userPoolId: POOL, clientId: 'local' }, jwks);
    await expect(v.verify(sign({}))).resolves.toEqual({ sub: 'sub-123' });
  });

  it('rejects an id token', async () => {
    const v = createJwtVerifier({ userPoolId: POOL, clientId: 'local' }, jwks);
    await expect(v.verify(sign({ token_use: 'id', aud: 'local' }))).rejects.toThrow();
  });

  it('rejects a token for another client id', async () => {
    const v = createJwtVerifier({ userPoolId: POOL, clientId: 'local' }, jwks);
    await expect(v.verify(sign({ client_id: 'other' }))).rejects.toThrow();
  });

  it('does not fetch the JWKS at creation', async () => {
    const connect = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (
      this: net.Socket,
    ) {
      return this;
    });
    createJwtVerifier({ userPoolId: POOL, clientId: 'local' });
    await new Promise((r) => setTimeout(r, 50));
    expect(connect).not.toHaveBeenCalled();
  });
});
