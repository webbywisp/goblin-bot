import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, StringSelectMenuInteraction, ModalSubmitInteraction } from 'discord.js';
import {
  handleSettingsComponentInteraction,
  handleSettingsModalInteraction
} from '@/settings/handleSettingsComponentInteraction';
import { canManageSettings } from '@/settings/permissions';
import { buildSettingsMenuView, buildRecruitRolesView } from '@/settings/views';
import { FAMILY_LEADER_ROLE_ID } from '@/config/roles';

// Mock dependencies
vi.mock('@/settings/permissions', () => ({
  canManageSettings: vi.fn()
}));

vi.mock('@/settings/views', () => ({
  buildSettingsMenuView: vi.fn(),
  buildRecruitRolesView: vi.fn(),
  buildRecruitChannelView: vi.fn(),
  buildRecruitDmTemplatesView: vi.fn(),
  buildClansView: vi.fn()
}));

const mockCanManageSettings = vi.mocked(canManageSettings);
const mockBuildSettingsMenuView = vi.mocked(buildSettingsMenuView);
const mockBuildRecruitRolesView = vi.mocked(buildRecruitRolesView);

describe('handleSettingsComponentInteraction', () => {
  const createMockInteraction = (overrides: Record<string, unknown> = {}) => {
    return {
      customId: 'settings:test',
      inGuild: vi.fn().mockReturnValue(true),
      guild: {
        id: 'guild123',
        roles: {
          cache: {
            get: vi.fn().mockReturnValue({ id: FAMILY_LEADER_ROLE_ID })
          },
          fetch: vi.fn()
        }
      },
      guildId: 'guild123',
      user: { id: 'user123' },
      member: {
        roles: ['role1']
      },
      replied: false,
      deferred: false,
      reply: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      ...overrides
    } as unknown as ButtonInteraction;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildSettingsMenuView.mockResolvedValue({
      content: 'Settings menu',
      components: []
    });
    mockBuildRecruitRolesView.mockResolvedValue({
      content: 'Recruit roles',
      components: []
    });
  });

  it('returns false for non-settings customId', async () => {
    const interaction = createMockInteraction({
      customId: 'not-settings:test'
    });
    const result = await handleSettingsComponentInteraction(interaction as ButtonInteraction);
    expect(result).toBe(false);
    expect(mockCanManageSettings).not.toHaveBeenCalled();
  });

  it('rejects when not in guild', async () => {
    const interaction = createMockInteraction({
      inGuild: vi.fn().mockReturnValue(false) as unknown as () => this is ButtonInteraction<'cached' | 'raw'>,
      guild: null,
      guildId: null
    });
    const replyMock = vi.fn().mockResolvedValue(undefined);
    interaction.reply = replyMock;

    const result = await handleSettingsComponentInteraction(interaction as ButtonInteraction);

    expect(result).toBe(true);
    expect(replyMock).toHaveBeenCalledWith({
      content: 'Settings can only be used inside a server.',
      ephemeral: true
    });
  });

  it('rejects when user cannot manage settings', async () => {
    const interaction = createMockInteraction() as unknown as ButtonInteraction;
    mockCanManageSettings.mockResolvedValue(false);
    const replyMock = vi.fn().mockResolvedValue(undefined);
    interaction.reply = replyMock;

    const result = await handleSettingsComponentInteraction(interaction);

    expect(result).toBe(true);
    expect(mockCanManageSettings).toHaveBeenCalledWith('user123', interaction.member, 'guild123');
    expect(replyMock).toHaveBeenCalledWith({
      content: 'Only owners or leader roles can change settings.',
      ephemeral: true
    });
  });

  it('does not reply if already replied when user cannot manage settings', async () => {
    const interaction = createMockInteraction({
      replied: true
    });
    mockCanManageSettings.mockResolvedValue(false);
    const replyMock = vi.fn().mockResolvedValue(undefined);
    interaction.reply = replyMock;

    const result = await handleSettingsComponentInteraction(interaction as ButtonInteraction);

    expect(result).toBe(true);
    expect(replyMock).not.toHaveBeenCalled();
  });

  it('handles menu_select action', async () => {
    const baseInteraction = createMockInteraction({
      customId: 'settings:menu_select',
      isStringSelectMenu: vi.fn().mockReturnValue(true) as unknown as () => this is StringSelectMenuInteraction,
      values: ['recruit_roles']
    });
    const interaction = {
      ...baseInteraction,
      isStringSelectMenu: vi.fn().mockReturnValue(true) as unknown as () => this is StringSelectMenuInteraction,
      values: ['recruit_roles']
    } as unknown as StringSelectMenuInteraction;
    mockCanManageSettings.mockResolvedValue(true);
    const updateMock = vi.fn().mockResolvedValue(undefined);
    interaction.update = updateMock;

    const result = await handleSettingsComponentInteraction(interaction);

    expect(result).toBe(true);
    expect(mockBuildRecruitRolesView).toHaveBeenCalledWith('guild123', FAMILY_LEADER_ROLE_ID);
    expect(updateMock).toHaveBeenCalled();
  });

  it('handles back button action', async () => {
    const baseInteraction = createMockInteraction({
      customId: 'settings:back',
      isButton: vi.fn().mockReturnValue(true) as unknown as () => this is ButtonInteraction
    });
    const interaction = {
      ...baseInteraction,
      isButton: vi.fn().mockReturnValue(true) as unknown as () => this is ButtonInteraction
    } as unknown as ButtonInteraction;
    mockCanManageSettings.mockResolvedValue(true);
    const updateMock = vi.fn().mockResolvedValue(undefined);
    interaction.update = updateMock;

    const result = await handleSettingsComponentInteraction(interaction);

    expect(result).toBe(true);
    expect(mockBuildSettingsMenuView).toHaveBeenCalledWith('guild123', FAMILY_LEADER_ROLE_ID);
    expect(updateMock).toHaveBeenCalled();
  });
});

describe('handleSettingsModalInteraction', () => {
  const createMockModalInteraction = (overrides: Record<string, unknown> = {}) => {
    return {
      customId: 'settings:test:mode:id',
      inGuild: vi.fn().mockReturnValue(true),
      guildId: 'guild123',
      user: { id: 'user123' },
      member: {
        roles: ['role1']
      },
      reply: vi.fn().mockResolvedValue(undefined),
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      ...overrides
    } as unknown as ModalSubmitInteraction;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false for non-settings customId', async () => {
    const interaction = createMockModalInteraction({
      customId: 'not-settings:test'
    });
    const result = await handleSettingsModalInteraction(interaction as ModalSubmitInteraction);
    expect(result).toBe(false);
  });

  it('rejects when not in guild', async () => {
    const interaction = createMockModalInteraction({
      inGuild: vi.fn().mockReturnValue(false) as unknown as () => this is ModalSubmitInteraction<'cached' | 'raw'>,
      guildId: null
    });
    const replyMock = vi.fn().mockResolvedValue(undefined);
    interaction.reply = replyMock;

    const result = await handleSettingsModalInteraction(interaction as ModalSubmitInteraction);

    expect(result).toBe(true);
    expect(replyMock).toHaveBeenCalledWith({
      content: 'Settings can only be used inside a server.',
      ephemeral: true
    });
  });

  it('rejects when user cannot manage settings', async () => {
    const interaction = createMockModalInteraction();
    mockCanManageSettings.mockResolvedValue(false);
    const replyMock = vi.fn().mockResolvedValue(undefined);
    interaction.reply = replyMock;

    const result = await handleSettingsModalInteraction(interaction as ModalSubmitInteraction);

    expect(result).toBe(true);
    expect(mockCanManageSettings).toHaveBeenCalledWith('user123', interaction.member, 'guild123');
    expect(replyMock).toHaveBeenCalledWith({
      content: 'Only owners or leader roles can change settings.',
      ephemeral: true
    });
  });
});
