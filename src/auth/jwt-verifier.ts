import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { CognitoSettings, Jwks, JwtVerifier } from "./types.ts";

/**
 * `jwks` optionally pre-loads the key set so verification needs no network.
 * Production omits it and the keys are fetched lazily on first verify.
 */
export function createJwtVerifier(
  settings: CognitoSettings,
  jwks?: Jwks,
): JwtVerifier {
  const inner = CognitoJwtVerifier.create({
    userPoolId: settings.userPoolId,
    tokenUse: "access",
    clientId: settings.clientId,
  });

  if (jwks) {
    inner.cacheJwks(jwks as unknown as Parameters<typeof inner.cacheJwks>[0]);
  }

  return {
    async verify(token: string) {
      const payload = await inner.verify(token);
      return { sub: payload.sub };
    },
  };
}
