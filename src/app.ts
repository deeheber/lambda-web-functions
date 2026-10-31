import express from 'express';
import type { ErrorRequestHandler, Express, RequestHandler } from 'express';
import { authMiddleware } from './auth/index.ts';
import type { JwtVerifier } from './auth/types.ts';
import type { Config } from './config.ts';
import { recordRequest } from './env-info.ts';
import { healthHandler } from './routes/health.ts';
import { createStreamHandler } from './routes/stream.ts';
import { whoamiHandler } from './routes/whoami.ts';

export interface AppDeps {
  readonly verifier: JwtVerifier;
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'not_found' });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(500).json({ error: 'internal' });
};

export function createApp(config: Config, deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.locals.requestCount = recordRequest();
    next();
  });
  app.use(authMiddleware(config.auth, deps.verifier));
  app.get('/health', healthHandler);
  app.get('/whoami', whoamiHandler);
  app.get('/stream', createStreamHandler(config.stream));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
