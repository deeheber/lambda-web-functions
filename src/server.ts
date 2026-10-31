import type { AddressInfo } from "node:net";
import { createApp } from "./app.ts";
import { createJwtVerifier } from "./auth/jwt-verifier.ts";
import { loadConfig } from "./config.ts";
import { envId } from "./env-info.ts";

// Half of the platform's 1 s SIGTERM limit; not a section 5 tunable.
const SHUTDOWN_DEADLINE_MS = 500;

const config = loadConfig();
const verifier =
  config.auth.mode === "jwt"
    ? createJwtVerifier(config.auth.cognito)
    : undefined;
const app = createApp(config, { verifier });

const server = app.listen(
  config.listen.port,
  config.listen.host,
  (err?: Error) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }

    const { port } = server.address() as AddressInfo;
    console.log(
      JSON.stringify({
        msg: "listening",
        host: config.listen.host,
        port,
        envId,
        authMode: config.auth.mode,
      }),
    );
  },
);

process.on("SIGTERM", () => {
  setTimeout(() => process.exit(0), SHUTDOWN_DEADLINE_MS).unref();
  server.close(() => process.exit(0));
  server.closeIdleConnections();
});
