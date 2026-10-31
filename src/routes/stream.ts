import type { RequestHandler } from "express";
import type { Config } from "../config.ts";

export function createStreamHandler(
  settings: Config["stream"],
): RequestHandler {
  return (_req, res) => {
    res.status(200);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    res.flushHeaders();

    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      res.write(`data: ${JSON.stringify({ tick })}\n\n`);
      if (tick >= settings.ticks) {
        clearInterval(timer);
        res.end();
      }
    }, settings.intervalMs);

    res.on("close", () => {
      clearInterval(timer);
    });
  };
}
