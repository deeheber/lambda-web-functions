import type { RequestHandler } from "express";
import type { AuthContext } from "../auth/types.ts";
import { envId, startedAt } from "../env-info.ts";

export function createWhoamiHandler(region: string | null): RequestHandler {
  return (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    res.json({
      authMode: auth.authMode,
      subject: auth.subject,
      region,
      envId,
      startedAt,
      requestCount: res.locals.requestCount as number,
    });
  };
}
