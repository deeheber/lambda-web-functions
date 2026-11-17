import { isIP } from "node:net";
import type { RequestHandler } from "express";
import type { Config } from "../config.ts";

export function createPrivatePingHandler(
  config: Config["privateService"],
  fetchService: typeof globalThis.fetch = globalThis.fetch,
): RequestHandler {
  return async (_req, res) => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.timeoutMs);
    const onClose = () => controller.abort();
    res.once("close", onClose);
    let failure = "request_failed";
    try {
      const response = await fetchService(config.url, {
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        failure = "upstream_status";
        await response.body?.cancel();
        throw new Error("Private service returned an unsuccessful status");
      }
      failure = "invalid_response";
      const body: unknown = await response.json();
      if (
        typeof body !== "object" || body === null ||
        !("service" in body) || body.service !== "private-http" ||
        !("callerIp" in body) || typeof body.callerIp !== "string" || !isIP(body.callerIp)
      ) {
        throw new Error("Invalid private service response");
      }
      res.json({ service: body.service, callerIp: body.callerIp });
    } catch (error) {
      if (res.destroyed) return;
      const cause = error instanceof Error ? error.cause : undefined;
      const refused = typeof cause === "object" && cause !== null &&
        "code" in cause && cause.code === "ECONNREFUSED";
      console.error(JSON.stringify({
        msg: "private_service_failed",
        reason: timedOut ? "timeout" : refused ? "connection_refused" : failure,
      }));
      res.status(timedOut ? 504 : 502).json({
        error: timedOut ? "private_service_timeout" : "private_service_unavailable",
      });
    } finally {
      clearTimeout(timer);
      res.off("close", onClose);
    }
  };
}
