export type AuthMode = 'iam' | 'jwt';

export interface AuthContext {
  readonly endpoint: string;
  readonly authMode: AuthMode;
  readonly subject: string | null;
}

export interface AuthEndpoints {
  readonly iamEndpointName: string;
  readonly jwtEndpointName: string;
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

/** A JSON Web Key Set document; types only, the JWT library stays in the adapter. */
export interface Jwks {
  keys: Array<{ kty?: string; kid?: string; alg?: string; use?: string; [k: string]: unknown }>;
}
