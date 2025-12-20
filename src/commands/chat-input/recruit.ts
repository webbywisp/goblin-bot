import type { ChatInputCommand } from '@/commands/types';
import { FAMILY_LEADER_ROLE_ID } from '@/config/roles';
import { ClashOfClansClient, isValidPlayerTag } from '@/integrations/clashOfClans/client';
import { getRecruitAllowedRoleIds } from '@/recruit/configStore';
import { getRoleIdsFromMember } from '@/utils/discordRoles';
import { SlashCommandBuilder } from 'discord.js';
import { populateRecruitThread, ensureRecruitThreadFromMessage } from '@/recruit/createRecruitThread';

const command: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName('recruit')
    .setDescription('Look up a Clash of Clans player by tag')
    .addStringOption((opt) => opt.setName('player_tag').setDescription('Player tag, e.g. #ABC123').setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('source')
        .setDescription('Where this applicant came from')
        .addChoices(
          { name: 'Reddit', value: 'reddit' },
          { name: 'Discord', value: 'discord' },
          { name: 'Other', value: 'other' }
        )
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) {
      await interaction.reply({
        content: 'This command can only create threads inside a server channel.',
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

    await interaction.deferReply();

    const playerTag = interaction.options.getString('player_tag', true);
    if (!isValidPlayerTag(playerTag)) {
      await interaction.editReply(
        `Invalid player tag.\n` +
          `- Tag: \`${playerTag}\`\n` +
          `Expected something like \`#ABC123\` (letters/numbers only).`
      );
      return;
    }
    const client = new ClashOfClansClient();

    try {
      const source = interaction.options.getString('source') ?? 'unknown';
      const player = await client.getPlayerByTag(playerTag);

      const thValue = typeof player.townHallLevel === 'number' && player.townHallLevel > 0 ? player.townHallLevel : '?';
      const threadName = `${player.name} TH ${thValue} ${source}.`;

      // Reply in-channel, then start a thread from that reply message.
      await interaction.editReply({ content: `Creating thread for \`${threadName}\`...` });
      const replyMessage = await interaction.fetchReply();

      const thread = await ensureRecruitThreadFromMessage(replyMessage, threadName);

      if (thread) {
        await populateRecruitThread({
          thread,
          player,
          client,
          customBaseId: `recruit:${interaction.id}`,
          replyMessageId: replyMessage.id
        });
        await interaction.editReply({ content: `Thread created: <#${thread.id}>` });
      } else {
        await interaction.editReply('Could not create a thread in this channel.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to look up that player. Please try again.';
      await interaction.editReply({
        content: `Could not look up that player tag.\n` + `- Tag: \`${playerTag}\`\n` + `- Error: ${msg}\n`
      });
    }
  }
};

export default command;
