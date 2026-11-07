import { randomUUID } from "node:crypto";

export const envId: string = randomUUID();
export const startedAt: string = new Date().toISOString();

let requestCount = 0;

export function recordRequest(): number {
  requestCount += 1;
  return requestCount;
}

export function getRequestCount(): number {
  return requestCount;
}
