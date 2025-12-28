import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findExistingThreadByPlayerTag } from './createRecruitThread';

describe('findExistingThreadByPlayerTag', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockChannel: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockGuild: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockThread1: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockThread2: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockMessage1: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockMessage2: any;

  beforeEach(() => {
    mockMessage1 = {
      content: 'Some message content',
      embeds: [
        {
          title: 'Player Name (#ABC123)',
          description: 'Some description',
          fields: []
        }
      ]
    };

    mockMessage2 = {
      content: 'Another message',
      embeds: [
        {
          title: 'Different Player (#XYZ999)',
          description: 'Different description',
          fields: [
            {
              name: 'Player Tag',
              value: '#ABC123'
            }
          ]
        }
      ]
    };

    mockThread1 = {
      id: 'thread1',
      parentId: 'channel1',
      archived: false,
      messages: {
        fetch: vi.fn().mockResolvedValue(
          new Map([
            ['msg1', mockMessage1],
            ['msg2', mockMessage2]
          ])
        )
      }
    };

    mockThread2 = {
      id: 'thread2',
      parentId: 'channel1',
      archived: false,
      messages: {
        fetch: vi.fn().mockResolvedValue(
          new Map([
            [
              'msg3',
              {
                content: 'No tag here',
                embeds: []
              }
            ]
          ])
        )
      }
    };

    mockGuild = {
      channels: {
        fetchActiveThreads: vi.fn().mockResolvedValue({
          threads: new Map([
            ['thread1', mockThread1],
            ['thread2', mockThread2]
          ])
        })
      }
    };

    mockChannel = {
      id: 'channel1',
      isTextBased: () => true,
      isDMBased: () => false,
      guild: mockGuild
    };
  });

  it('finds thread by player tag in embed title', async () => {
    const result = await findExistingThreadByPlayerTag(mockChannel, '#ABC123');
    expect(result).toBe(mockThread1);
  });

  it('finds thread by player tag in embed field', async () => {
    const result = await findExistingThreadByPlayerTag(mockChannel, '#ABC123');
    expect(result).toBe(mockThread1);
  });

  it('returns null when no thread contains the player tag', async () => {
    const result = await findExistingThreadByPlayerTag(mockChannel, '#NOTFOUND');
    expect(result).toBeNull();
  });

  it('returns null for DM channels', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dmChannel: any = {
      isTextBased: () => true,
      isDMBased: () => true
    };
    const result = await findExistingThreadByPlayerTag(dmChannel, '#ABC123');
    expect(result).toBeNull();
  });

  it('returns null when channel has no guild', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noGuildChannel: any = {
      isTextBased: () => true,
      isDMBased: () => false,
      guild: null
    };
    const result = await findExistingThreadByPlayerTag(noGuildChannel, '#ABC123');
    expect(result).toBeNull();
  });

  it('ignores archived threads', async () => {
    mockThread1.archived = true;
    const result = await findExistingThreadByPlayerTag(mockChannel, '#ABC123');
    expect(result).toBeNull();
  });

  it('ignores threads from different channels', async () => {
    mockThread1.parentId = 'different-channel';
    const result = await findExistingThreadByPlayerTag(mockChannel, '#ABC123');
    expect(result).toBeNull();
  });

  it('handles case-insensitive player tags', async () => {
    const result = await findExistingThreadByPlayerTag(mockChannel, '#abc123');
    expect(result).toBe(mockThread1);
  });

  it('handles player tags without hash', async () => {
    const result = await findExistingThreadByPlayerTag(mockChannel, 'ABC123');
    expect(result).toBe(mockThread1);
  });

  it('searches message content for player tag', async () => {
    const messageWithTagInContent = {
      content: 'Player tag is #ABC123 in content',
      embeds: []
    };
    mockThread1.messages = {
      fetch: vi.fn().mockResolvedValue(new Map([['msg1', messageWithTagInContent]]))
    };

    const result = await findExistingThreadByPlayerTag(mockChannel, '#ABC123');
    expect(result).toBe(mockThread1);
  });

  it('handles threads with no messages gracefully', async () => {
    mockThread1.messages = {
      fetch: vi.fn().mockResolvedValue(new Map())
    };
    const result = await findExistingThreadByPlayerTag(mockChannel, '#ABC123');
    expect(result).toBeNull();
  });

  it('handles fetch errors gracefully', async () => {
    mockGuild.channels = {
      fetchActiveThreads: vi.fn().mockRejectedValue(new Error('Network error'))
    };
    const result = await findExistingThreadByPlayerTag(mockChannel, '#ABC123');
    expect(result).toBeNull();
  });

  it('handles message fetch errors gracefully', async () => {
    mockThread1.messages = {
      fetch: vi.fn().mockRejectedValue(new Error('Cannot read messages'))
    };
    const result = await findExistingThreadByPlayerTag(mockChannel, '#ABC123');
    expect(result).toBeNull();
  });
});
