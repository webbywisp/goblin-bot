import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import settingsCommand from '@/commands/chat-input/settings';
import { canManageSettings } from '@/settings/permissions';
import { buildSettingsMenuView } from '@/settings/views';
import { FAMILY_LEADER_ROLE_ID } from '@/config/roles';

// Mock dependencies
vi.mock('@/settings/permissions', () => ({
  canManageSettings: vi.fn()
}));

vi.mock('@/settings/views', () => ({
  buildSettingsMenuView: vi.fn()
}));

const mockCanManageSettings = vi.mocked(canManageSettings);
const mockBuildSettingsMenuView = vi.mocked(buildSettingsMenuView);

describe('/settings command', () => {
  const createMockInteraction = (overrides: Partial<ChatInputCommandInteraction> = {}) => {
    return {
      inGuild: vi.fn().mockReturnValue(true),
      guild: {
        id: 'guild123',
        roles: {
          cache: {
            get: vi.fn().mockReturnValue({ id: FAMILY_LEADER_ROLE_ID }),
            has: vi.fn()
          },
          fetch: vi.fn()
        }
      },
      guildId: 'guild123',
      user: { id: 'user123' },
      member: {
        roles: ['role1']
      },
      reply: vi.fn().mockResolvedValue(undefined),
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      ...overrides
    } as unknown as ChatInputCommandInteraction;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildSettingsMenuView.mockResolvedValue({
      content: 'Settings menu',
      components: []
    });
  });

  it('rejects when not in guild', async () => {
    const interaction = createMockInteraction({
      inGuild: vi.fn().mockReturnValue(false)
    });
    const replyMock = vi.fn().mockResolvedValue(undefined);
    interaction.reply = replyMock;

    await settingsCommand.execute(interaction);

    expect(replyMock).toHaveBeenCalledWith({
      content: 'This command can only be used inside a server.',
      ephemeral: true
    });
    expect(mockCanManageSettings).not.toHaveBeenCalled();
  });

  it('rejects when user cannot manage settings', async () => {
    const interaction = createMockInteraction();
    mockCanManageSettings.mockResolvedValue(false);
    const replyMock = vi.fn().mockResolvedValue(undefined);
    interaction.reply = replyMock;

    await settingsCommand.execute(interaction);

    expect(mockCanManageSettings).toHaveBeenCalledWith('user123', interaction.member, 'guild123');
    expect(replyMock).toHaveBeenCalledWith({
      content: 'Only owners or leader roles can change settings.',
      ephemeral: true
    });
    expect(mockBuildSettingsMenuView).not.toHaveBeenCalled();
  });

  it('allows access when user can manage settings', async () => {
    const interaction = createMockInteraction();
    mockCanManageSettings.mockResolvedValue(true);
    const deferReplyMock = vi.fn().mockResolvedValue(undefined);
    const editReplyMock = vi.fn().mockResolvedValue(undefined);
    interaction.deferReply = deferReplyMock;
    interaction.editReply = editReplyMock;

    await settingsCommand.execute(interaction);

    expect(mockCanManageSettings).toHaveBeenCalledWith('user123', interaction.member, 'guild123');
    expect(deferReplyMock).toHaveBeenCalledWith({ ephemeral: true });
    expect(mockBuildSettingsMenuView).toHaveBeenCalledWith('guild123', FAMILY_LEADER_ROLE_ID);
    expect(editReplyMock).toHaveBeenCalledWith({
      content: 'Settings menu',
      components: []
    });
  });

  it('handles missing leader role gracefully', async () => {
    const interaction = createMockInteraction({
      guild: {
        id: 'guild123',
        roles: {
          cache: {
            get: vi.fn().mockReturnValue(null),
            has: vi.fn()
          },
          fetch: vi.fn().mockResolvedValue(null)
        }
      }
    } as any);
    mockCanManageSettings.mockResolvedValue(true);
    const deferReplyMock = vi.fn().mockResolvedValue(undefined);
    const editReplyMock = vi.fn().mockResolvedValue(undefined);
    interaction.deferReply = deferReplyMock;
    interaction.editReply = editReplyMock;

    await settingsCommand.execute(interaction);

    expect(mockBuildSettingsMenuView).toHaveBeenCalledWith('guild123', undefined);
  });

  it('fetches leader role when not in cache', async () => {
    const leaderRole = { id: FAMILY_LEADER_ROLE_ID };
    const interaction = createMockInteraction({
      guild: {
        id: 'guild123',
        roles: {
          cache: {
            get: vi.fn().mockReturnValue(null),
            has: vi.fn()
          },
          fetch: vi.fn().mockResolvedValue(leaderRole)
        }
      }
    } as any);
    mockCanManageSettings.mockResolvedValue(true);
    const deferReplyMock = vi.fn().mockResolvedValue(undefined);
    const editReplyMock = vi.fn().mockResolvedValue(undefined);
    interaction.deferReply = deferReplyMock;
    interaction.editReply = editReplyMock;

    await settingsCommand.execute(interaction);

    expect(interaction.guild.roles.fetch).toHaveBeenCalledWith(FAMILY_LEADER_ROLE_ID);
    expect(mockBuildSettingsMenuView).toHaveBeenCalledWith('guild123', FAMILY_LEADER_ROLE_ID);
  });
});
