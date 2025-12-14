import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SAVED: Record<string, string | undefined> = {};
const KEYS = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'LOG_LEVEL'] as const;

async function importFreshLoadClientEvents() {
  vi.resetModules();
  return await import('@/events/loadClientEvents');
}

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? 'test-token';
  process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? 'test-client-id';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
});

afterEach(() => {
  for (const k of KEYS) {
    const v = SAVED[k];
    if (typeof v === 'string') process.env[k] = v;
    else delete process.env[k];
  }
});

describe('loadClientEvents', () => {
  it('loads built-in client events', async () => {
    const { loadClientEvents } = await importFreshLoadClientEvents();
    const events = loadClientEvents();
    const names = events.map((e) => e.name);

    expect(names).toContain('clientReady');
    expect(names).toContain('interactionCreate');
  });

  it('returns events sorted by name', async () => {
    const { loadClientEvents } = await importFreshLoadClientEvents();
    const events = loadClientEvents();
    const names = events.map((e) => String(e.name));
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

