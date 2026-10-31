import type { RequestHandler, Response } from 'express';
import type { AuthConfig } from '../config.ts';
import type { AuthContext, JwtVerifier } from './types.ts';

function unauthorized(res: Response): void {
  res.set('WWW-Authenticate', 'Bearer');
  res.status(401).json({ error: 'unauthorized' });
}

export function authMiddleware(auth: AuthConfig, verifier?: JwtVerifier): RequestHandler {
  if (auth.mode === 'iam') {
    return (_req, res, next) => {
      const ctx: AuthContext = { authMode: 'iam', subject: null };
      res.locals.auth = ctx;
      next();
    };
  }
  if (verifier === undefined) throw new Error('jwt auth mode requires a JwtVerifier');
  return async (req, res, next) => {
    if (req.path === '/health') {
      const ctx: AuthContext = { authMode: 'jwt', subject: null };
      res.locals.auth = ctx;
      next();
      return;
    }
    const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
    if (match === null) {
      unauthorized(res);
      return;
    }
    let sub: string;
    try {
      ({ sub } = await verifier.verify(match[1]!));
    } catch {
      unauthorized(res);
      return;
    }
    const ctx: AuthContext = { authMode: 'jwt', subject: sub };
    res.locals.auth = ctx;
    next();
  };
}
