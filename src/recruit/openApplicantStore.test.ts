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

  it('tracks threads by player tag', async () => {
    const store = await loadStore();

    store.registerOpenApplicantThread({
      applicantId: 'user1',
      applicantTag: 'User1#1234',
      threadId: 'thread1',
      threadUrl: 'https://discord.com/channels/1/2/3',
      playerTag: '#ABC123',
      guildId: 'guild'
    });

    expect(store.getOpenThreadByPlayerTag('#ABC123')).toMatchObject({ threadId: 'thread1' });
    expect(store.getOpenThreadByPlayerTag('#abc123')).toMatchObject({ threadId: 'thread1' }); // case insensitive
    expect(store.getOpenThreadByPlayerTag('ABC123')).toMatchObject({ threadId: 'thread1' }); // without #
    expect(store.getOpenThreadByPlayerTag('#XYZ999')).toBeUndefined();
  });

  it('prevents duplicate player tag locks until released', async () => {
    const store = await loadStore();

    expect(store.tryLockPlayerTag('#ABC123')).toBe(true);
    expect(store.tryLockPlayerTag('#ABC123')).toBe(false);
    expect(store.tryLockPlayerTag('#abc123')).toBe(false); // case insensitive
    expect(store.tryLockPlayerTag('ABC123')).toBe(false); // without #

    store.releasePlayerTagLock('#ABC123');
    expect(store.tryLockPlayerTag('#ABC123')).toBe(true);
  });

  it('clears player tag tracking when thread is cleared', async () => {
    const store = await loadStore();

    store.registerOpenApplicantThread({
      applicantId: 'user',
      applicantTag: 'User#1234',
      threadId: 'thread',
      threadUrl: 'https://discord.com/channels/1/2/3',
      playerTag: '#ABC123',
      guildId: 'guild'
    });

    expect(store.getOpenThreadByPlayerTag('#ABC123')).toMatchObject({ threadId: 'thread' });
    expect(store.clearOpenApplicantThreadByThreadId('thread')).toBe(true);
    expect(store.getOpenThreadByPlayerTag('#ABC123')).toBeUndefined();
  });

  it('handles multiple threads with different player tags', async () => {
    const store = await loadStore();

    store.registerOpenApplicantThread({
      applicantId: 'user1',
      applicantTag: 'User1#1234',
      threadId: 'thread1',
      threadUrl: 'https://discord.com/channels/1/2/3',
      playerTag: '#ABC123',
      guildId: 'guild'
    });

    store.registerOpenApplicantThread({
      applicantId: 'user2',
      applicantTag: 'User2#5678',
      threadId: 'thread2',
      threadUrl: 'https://discord.com/channels/1/2/4',
      playerTag: '#XYZ999',
      guildId: 'guild'
    });

    expect(store.getOpenThreadByPlayerTag('#ABC123')).toMatchObject({ threadId: 'thread1' });
    expect(store.getOpenThreadByPlayerTag('#XYZ999')).toMatchObject({ threadId: 'thread2' });
    expect(store.getAllOpenApplicantEntries()).toHaveLength(2);
  });

  it('releases player tag lock when thread is registered', async () => {
    const store = await loadStore();

    expect(store.tryLockPlayerTag('#ABC123')).toBe(true);
    store.registerOpenApplicantThread({
      applicantId: 'user',
      applicantTag: 'User#1234',
      threadId: 'thread',
      threadUrl: 'https://discord.com/channels/1/2/3',
      playerTag: '#ABC123',
      guildId: 'guild'
    });

    // Lock should be released, but thread should be registered
    expect(store.getOpenThreadByPlayerTag('#ABC123')).toMatchObject({ threadId: 'thread' });
    // Can't lock again because thread exists
    expect(store.tryLockPlayerTag('#ABC123')).toBe(false);
  });
});
