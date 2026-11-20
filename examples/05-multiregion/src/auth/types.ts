export interface AuthContext {
  readonly authMode: 'jwt';
  readonly subject: string;
}

export interface CognitoSettings {
  readonly userPoolId: string;
  readonly clientId: string;
}

export interface VerifiedToken {
  readonly sub: string;
}

export interface JwtVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

export interface Jwks {
  keys: Array<{ kty?: string; kid?: string; alg?: string; use?: string; [k: string]: unknown }>;
}
