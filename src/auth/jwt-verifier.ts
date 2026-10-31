import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { CognitoSettings, JwtVerifier } from './types.ts';

export function createJwtVerifier(settings: CognitoSettings): JwtVerifier {
  const inner = CognitoJwtVerifier.create({
    userPoolId: settings.userPoolId,
    tokenUse: 'access',
    clientId: settings.clientId,
  });
  return {
    async verify(token: string) {
      const payload = await inner.verify(token);
      return { sub: payload.sub };
    },
  };
}
