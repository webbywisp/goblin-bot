import { FAMILY_LEADER_ROLE_ID } from '@/config/roles';
import { setRecruitAllowedRoleIds, setRecruitThreadChannelId } from '@/recruit/configStore';
import { isSettingsAdmin } from '@/settings/permissions';
import { buildRecruitChannelView, buildRecruitRolesView, buildSettingsMenuView } from '@/settings/views';
import type {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction
} from 'discord.js';

type SettingsComponentInteraction =
  | RoleSelectMenuInteraction
  | ChannelSelectMenuInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction;

export async function handleSettingsComponentInteraction(interaction: SettingsComponentInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith('settings:')) return false;

  if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Settings can only be used inside a server.', ephemeral: true });
    }
    return true;
  }

  if (!isSettingsAdmin(interaction.user.id)) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Only the bot maintainer can change settings right now.',
        ephemeral: true
      });
    }
    return true;
  }

  const guild = interaction.guild;
  const guildId = interaction.guildId;
  const leaderRole =
    guild.roles.cache.get(FAMILY_LEADER_ROLE_ID) ?? (await guild.roles.fetch(FAMILY_LEADER_ROLE_ID).catch(() => null));
  const leaderRoleId = leaderRole?.id;

  const action = interaction.customId.split(':')[1];
  if (action === 'menu_select' && interaction.isStringSelectMenu()) {
    const selected = interaction.values?.[0];
    const view =
      selected === 'recruit_roles'
        ? await buildRecruitRolesView(guildId, leaderRoleId)
        : selected === 'recruit_channel'
          ? await buildRecruitChannelView(guildId)
          : await buildSettingsMenuView(guildId, leaderRoleId);
    await interaction.update(view);
    return true;
  }

  if (action === 'back' && interaction.isButton()) {
    const view = await buildSettingsMenuView(guildId, leaderRoleId);
    await interaction.update(view);
    return true;
  }

  if (action === 'recruit_roles' && interaction.isRoleSelectMenu()) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    try {
      const selected = Array.from(new Set((interaction.values ?? []).slice(0, 25)));
      await setRecruitAllowedRoleIds(guildId, selected);

      const view = await buildRecruitRolesView(guildId, leaderRoleId);
      await interaction.editReply(view);
    } catch (err) {
      await reportSettingsError(interaction, 'Failed to update recruit roles.', err);
    }
    return true;
  }

  if (action === 'recruit_channel' && interaction.isChannelSelectMenu()) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    try {
      const selected = (interaction.values ?? [])[0] ?? null;

      await setRecruitThreadChannelId(guildId, selected);

      const view = await buildRecruitChannelView(guildId);
      await interaction.editReply(view);
    } catch (err) {
      await reportSettingsError(interaction, 'Failed to update recruit channel.', err);
    }
    return true;
  }

  return false;
}

async function reportSettingsError(
  interaction: RoleSelectMenuInteraction | ChannelSelectMenuInteraction,
  message: string,
  err: unknown
) {
  const { logger } = await import('@/utils/logger');
  logger.error({ err, customId: interaction.customId, guildId: interaction.guildId }, 'Settings interaction failed');

  const payload = {
    content: `${message} Please try again.`,
    ephemeral: true
  } as const;

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}
