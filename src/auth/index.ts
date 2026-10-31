import type { RequestHandler, Response } from 'express';
import type { AuthContext, AuthEndpoints, JwtVerifier } from './types.ts';

function unauthorized(res: Response, challenge: boolean): void {
  if (challenge) res.set('WWW-Authenticate', 'Bearer');
  res.status(401).json({ error: 'unauthorized' });
}

export function authMiddleware(endpoints: AuthEndpoints, verifier: JwtVerifier): RequestHandler {
  return async (req, res, next) => {
    const endpoint = req.get('lambda-web-endpoint-name');

    if (endpoint === undefined || endpoint === '') {
      unauthorized(res, false);
      return;
    }

    if (endpoint === endpoints.iamEndpointName) {
      const auth: AuthContext = { endpoint, authMode: 'iam', subject: null };
      res.locals.auth = auth;
      next();
      return;
    }

    if (endpoint === endpoints.jwtEndpointName) {
      if (req.path === '/health') {
        const auth: AuthContext = { endpoint, authMode: 'jwt', subject: null };
        res.locals.auth = auth;
        next();
        return;
      }
      const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
      if (match === null) {
        unauthorized(res, true);
        return;
      }
      let sub: string;
      try {
        ({ sub } = await verifier.verify(match[1]!));
      } catch {
        unauthorized(res, true);
        return;
      }
      const auth: AuthContext = { endpoint, authMode: 'jwt', subject: sub };
      res.locals.auth = auth;
      next();
      return;
    }

    unauthorized(res, false);
  };
}
