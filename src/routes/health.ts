import type { RequestHandler } from 'express';

export const healthHandler: RequestHandler = (_req, res) => {
  res.json({ status: 'ok' });
};
