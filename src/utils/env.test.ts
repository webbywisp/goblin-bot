import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const SAVED: Record<string, string | undefined> = {};
const KEYS = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'CLASH_OF_CLANS_API_TOKEN',
  'CLASH_OF_CLANS_API_BASE_URL',
  'CLASH_OF_CLANS_API_TIMEOUT_MS',
  'BOT_INSTANCE_LABEL',
  'LOG_LEVEL'
] as const;

async function importFreshEnvModule() {
  vi.resetModules();
  return await import('@/utils/env');
}

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    const v = SAVED[k];
    if (typeof v === 'string') process.env[k] = v;
    else delete process.env[k];
  }
});

describe('getEnv', () => {
  it('applies defaults for optional values', async () => {
    process.env.DISCORD_TOKEN = 't';
    process.env.DISCORD_CLIENT_ID = 'c';
    delete process.env.CLASH_OF_CLANS_API_BASE_URL;
    delete process.env.CLASH_OF_CLANS_API_TIMEOUT_MS;
    delete process.env.LOG_LEVEL;

    const { getEnv } = await importFreshEnvModule();
    const env = getEnv();

    expect(env.CLASH_OF_CLANS_API_BASE_URL).toBe('https://api.clashofclans.com/v1');
    expect(env.CLASH_OF_CLANS_API_TIMEOUT_MS).toBe(10_000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('coerces CLASH_OF_CLANS_API_TIMEOUT_MS to a number', async () => {
    process.env.DISCORD_TOKEN = 't';
    process.env.DISCORD_CLIENT_ID = 'c';
    process.env.CLASH_OF_CLANS_API_TIMEOUT_MS = '5000';

    const { getEnv } = await importFreshEnvModule();
    const env = getEnv();
    expect(env.CLASH_OF_CLANS_API_TIMEOUT_MS).toBe(5000);
  });

  it('caches parsed env values', async () => {
    process.env.DISCORD_TOKEN = 't';
    process.env.DISCORD_CLIENT_ID = 'c';
    process.env.LOG_LEVEL = 'info';

    const { getEnv } = await importFreshEnvModule();
    const first = getEnv();

    process.env.LOG_LEVEL = 'debug';
    const second = getEnv();

    expect(first.LOG_LEVEL).toBe('info');
    expect(second.LOG_LEVEL).toBe('info');
  });
});

