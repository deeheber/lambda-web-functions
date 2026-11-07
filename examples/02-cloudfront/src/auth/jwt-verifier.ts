import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { CognitoSettings, Jwks, JwtVerifier } from "./types.ts";

/* Inject JWKS for offline tests; production fetches keys lazily. */
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
