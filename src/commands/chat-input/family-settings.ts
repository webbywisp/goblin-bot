import { ActionRowBuilder, PermissionFlagsBits, RoleSelectMenuBuilder, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommand } from '@/commands/types';
import { FAMILY_LEADER_ROLE_ID } from '@/config/roles';
import { getRoleIdsFromMember } from '@/utils/discordRoles';
import { getRecruitAllowedRoleSummary, getRecruitRoleMappingSummary } from '@/recruit/configStore';

const command: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName('family-settings')
    .setDescription('Family leader settings (roles, recruitment config)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true
      });
      return;
    }

    const leaderRole =
      interaction.guild.roles.cache.get(FAMILY_LEADER_ROLE_ID) ??
      (await interaction.guild.roles.fetch(FAMILY_LEADER_ROLE_ID).catch(() => null));

    if (!leaderRole) {
      await interaction.reply({
        content: `The Family Leader role (<@&${FAMILY_LEADER_ROLE_ID}>) is missing in this server. Create it to use this command.`,
        ephemeral: true
      });
      return;
    }

    const memberRoleIds = getRoleIdsFromMember(interaction.member);
    if (!memberRoleIds.has(leaderRole.id)) {
      await interaction.reply({
        content: 'Only members with the Family Leader role can use this command.',
        ephemeral: true
      });
      return;
    }

    const recruitSummary = await getRecruitRoleMappingSummary(interaction.guildId);
    const rolesSelect = new RoleSelectMenuBuilder()
      .setCustomId('family-settings:recruit_roles')
      .setPlaceholder('Select roles allowed to use /recruit')
      .setMinValues(0)
      .setMaxValues(25);

    const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(rolesSelect);
    const allowedSummary = await getRecruitAllowedRoleSummary(interaction.guildId);

    await interaction.reply({
      content:
        `**Family settings**\n` +
        `- Leader role: <@&${leaderRole.id}>\n` +
        `- Recruit leader role mapping:\n${recruitSummary}\n\n` +
        `**/recruit access**\n` +
        `- Family Leaders are always allowed.\n` +
        `- Additional allowed roles: ${allowedSummary}\n\n` +
        `Select roles below to allow them to run /recruit.\n` +
        `To edit per-TH leader roles, use the ⚙️ Settings button on a /recruit thread. (Future settings can live here.)`,
      components: [row],
      ephemeral: true
    });
  }
};

export default command;
