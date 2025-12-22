import { describe, expect, it, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import { handleClose } from '@/recruit/handleRecruitComponentInteraction';

describe('handleClose', () => {
  it('mentions the closer when closing a recruit thread', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    const deferReplyMock = vi.fn().mockResolvedValue(undefined);
    const editReplyMock = vi.fn().mockResolvedValue(undefined);
    const replyMock = vi.fn().mockResolvedValue(undefined);

    const interaction = {
      inGuild: () => true,
      guildId: 'guild',
      memberPermissions: {
        has: () => true
      },
      user: { id: 'closer', tag: 'Closer#0001' },
      deferReply: deferReplyMock,
      editReply: editReplyMock,
      reply: replyMock,
      channel: {
        isThread: () => false,
        send: sendMock
      },
      message: {
        editable: false
      }
    } as unknown as ButtonInteraction;

    await handleClose(interaction, '1234');

    expect(sendMock).toHaveBeenCalledWith('Recruit thread closed by <@closer> for `#1234`.');
  });
});
