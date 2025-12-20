import type { ChatInputCommand } from '@/commands/types';
import { FAMILY_LEADER_ROLE_ID } from '@/config/roles';
import { isSettingsAdmin } from '@/settings/permissions';
import { buildSettingsMenuView } from '@/settings/views';
import { SlashCommandBuilder } from 'discord.js';

const command: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure Goblin Bot settings')
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true
      });
      return;
    }

    if (!isSettingsAdmin(interaction.user.id)) {
      await interaction.reply({
        content: 'Only the bot maintainer can change settings right now.',
        ephemeral: true
      });
      return;
    }

    const guild = interaction.guild;
    const leaderRole =
      guild.roles.cache.get(FAMILY_LEADER_ROLE_ID) ??
      (await guild.roles.fetch(FAMILY_LEADER_ROLE_ID).catch(() => null));

    await interaction.deferReply({ ephemeral: true });

    const view = await buildSettingsMenuView(interaction.guildId, leaderRole?.id);
    await interaction.editReply(view);
  }
};

export default command;
