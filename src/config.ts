export type Env = Readonly<Record<string, string | undefined>>;

export type AuthConfig =
  | { readonly mode: 'iam' }
  | {
      readonly mode: 'jwt';
      readonly cognito: { readonly userPoolId: string; readonly clientId: string };
    };

export interface Config {
  readonly listen: { readonly host: string; readonly port: number };
  readonly auth: AuthConfig;
  readonly stream: { readonly ticks: number; readonly intervalMs: number };
}

const DEFAULT_LISTEN = '127.0.0.1:3000';
// ⚠️ ASSUMPTION: stream defaults
const DEFAULT_STREAM_TICKS = '5';
const DEFAULT_STREAM_INTERVAL_MS = '500';

function optional(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

function required(env: Env, name: string): string {
  const value = optional(env, name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function parseInteger(name: string, value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer, got "${value}"`);
  return Number(value);
}

function parseListen(value: string): { host: string; port: number } {
  const idx = value.lastIndexOf(':');
  if (idx < 0) throw new Error(`AWS_LAMBDA_HTTP_ENDPOINT must be host:port, got "${value}"`);
  let host = value.slice(0, idx);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === '') throw new Error(`AWS_LAMBDA_HTTP_ENDPOINT has an empty host: "${value}"`);
  const portText = value.slice(idx + 1);
  if (!/^\d+$/.test(portText)) {
    throw new Error(`AWS_LAMBDA_HTTP_ENDPOINT has an invalid port: "${value}"`);
  }
  const port = Number(portText);
  if (port > 65535) throw new Error(`AWS_LAMBDA_HTTP_ENDPOINT port out of range: "${value}"`);
  return { host, port };
}

function parseAuth(env: Env): AuthConfig {
  const mode = required(env, 'AUTH_MODE');
  if (mode === 'iam') return Object.freeze({ mode });
  if (mode === 'jwt') {
    const userPoolId = required(env, 'COGNITO_USER_POOL_ID');
    const clientId = required(env, 'COGNITO_CLIENT_ID');
    return Object.freeze({ mode, cognito: Object.freeze({ userPoolId, clientId }) });
  }
  throw new Error(`AUTH_MODE must be "iam" or "jwt", got "${mode}"`);
}

export function loadConfig(env: Env = process.env): Config {
  const listen = parseListen(optional(env, 'AWS_LAMBDA_HTTP_ENDPOINT') ?? DEFAULT_LISTEN);
  const auth = parseAuth(env);
  const ticks = parseInteger('STREAM_TICKS', optional(env, 'STREAM_TICKS') ?? DEFAULT_STREAM_TICKS);
  if (ticks < 1) throw new Error('STREAM_TICKS must be at least 1');
  const intervalMs = parseInteger(
    'STREAM_INTERVAL_MS',
    optional(env, 'STREAM_INTERVAL_MS') ?? DEFAULT_STREAM_INTERVAL_MS,
  );

  return Object.freeze({
    listen: Object.freeze(listen),
    auth,
    stream: Object.freeze({ ticks, intervalMs }),
  });
}
