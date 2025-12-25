import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFs = {
  readFile: vi.fn().mockRejectedValue(new Error('missing')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined)
};

vi.mock('node:fs', () => ({
  promises: mockFs
}));

async function loadStore() {
  return await import('@/recruit/openApplicantStore');
}

describe('openApplicantStore', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFs.readFile.mockRejectedValue(new Error('missing'));
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.readFile.mockClear();
    mockFs.writeFile.mockClear();
    mockFs.rename.mockClear();
    mockFs.mkdir.mockClear();
  });

  it('prevents duplicate locks until released or cleared', async () => {
    const store = await loadStore();

    expect(store.tryLockApplicant('user')).toBe(true);
    expect(store.tryLockApplicant('user')).toBe(false);

    store.releaseApplicantLock('user');
    expect(store.tryLockApplicant('user')).toBe(true);
  });

  it('tracks registered applicants and clears by thread', async () => {
    const store = await loadStore();

    store.registerOpenApplicantThread({
      applicantId: 'user',
      applicantTag: 'User#1234',
      threadId: 'thread',
      threadUrl: 'https://discord.com/channels/1/2/3',
      playerTag: '#AAA111',
      guildId: 'guild'
    });

    expect(store.getAllOpenApplicantEntries()).toHaveLength(1);
    expect(store.getOpenApplicantThread('user')).toMatchObject({ threadId: 'thread' });
    expect(store.clearOpenApplicantThreadByThreadId('thread')).toBe(true);
    expect(store.getOpenApplicantThread('user')).toBeUndefined();
    expect(store.getAllOpenApplicantEntries()).toHaveLength(0);
  });
});
