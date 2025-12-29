import type { ChatInputCommand } from '@/commands/types';
import { FAMILY_LEADER_ROLE_ID } from '@/config/roles';
import { getRecruitAllowedRoleIds } from '@/recruit/configStore';
import { getRoleIdsFromMember } from '@/utils/discordRoles';
import { SlashCommandBuilder } from 'discord.js';

const command: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName('recruit-list')
    .setDescription('Show all open recruit threads in this server')
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used inside a server channel.',
        ephemeral: true
      });
      return;
    }

    const guild = interaction.guild;
    const guildId = interaction.guildId;

    const leaderRole =
      guild.roles.cache.get(FAMILY_LEADER_ROLE_ID) ??
      (await guild.roles.fetch(FAMILY_LEADER_ROLE_ID).catch(() => null));

    if (!leaderRole) {
      await interaction.reply({
        content: `The Family Leader role (<@&${FAMILY_LEADER_ROLE_ID}>) is missing in this server. Create it to use this command.`,
        ephemeral: true
      });
      return;
    }

    const memberRoleIds = getRoleIdsFromMember(interaction.member);
    const allowedIds = await getRecruitAllowedRoleIds(guildId);
    const hasLeaderRole = memberRoleIds.has(FAMILY_LEADER_ROLE_ID);
    const hasAllowedRole = allowedIds.some((id) => memberRoleIds.has(id));

    if (!hasLeaderRole && !hasAllowedRole) {
      await interaction.reply({
        content: 'Only Family Leaders or configured roles can use this command.',
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const botId = interaction.client.user?.id;
    if (!botId) {
      await interaction.editReply('Bot user is unavailable. Please try again.');
      return;
    }

    try {
      const fetched = await guild.channels.fetchActiveThreads();
      const openThreads = fetched.threads.filter(
        (thread) => !thread.archived && !thread.locked && thread.ownerId === botId
      );

      if (openThreads.size === 0) {
        await interaction.editReply('No open recruit threads found.');
        return;
      }

      const sorted = Array.from(openThreads.values()).sort(
        (a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0)
      );

      const lines: string[] = [];
      let hiddenCount = 0;
      let runningLength = 0;

      for (const thread of sorted) {
        const parentSuffix = thread.parentId ? ` (in <#${thread.parentId}>)` : '';
        const name = thread.name ?? 'Recruit thread';
        const createdDate = thread.createdAt
          ? thread.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'Unknown date';
        const line = `- <#${thread.id}> — ${name}${parentSuffix} — Created: ${createdDate}`;
        const nextLength = runningLength + line.length + (lines.length ? 1 : 0);

        if (nextLength > 1800) {
          hiddenCount += 1;
          continue;
        }

        lines.push(line);
        runningLength = nextLength;
      }

      let content = `Open recruit threads (${openThreads.size}):\n${lines.join('\n')}`;
      if (hiddenCount > 0) {
        content += `\n…and ${hiddenCount} more not shown to stay under Discord message limits.`;
      }

      await interaction.editReply({ content });
    } catch {
      await interaction.editReply('Could not load open recruit threads right now. Please try again.');
    }
  }
};

export default command;
