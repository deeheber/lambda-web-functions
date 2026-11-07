import { describe, expect, it } from 'vitest';
import { envId, getRequestCount, recordRequest, startedAt } from '../src/env-info.ts';

describe('env-info', () => {
  it('envId is a UUID', () => {
    expect(envId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('startedAt is an ISO timestamp', () => {
    expect(new Date(startedAt).toISOString()).toBe(startedAt);
  });

  it('recordRequest increments and returns the new count', () => {
    const before = getRequestCount();
    expect(recordRequest()).toBe(before + 1);
    expect(getRequestCount()).toBe(before + 1);
  });
});
