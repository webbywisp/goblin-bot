import { EmbedBuilder, SlashCommandBuilder, ThreadAutoArchiveDuration } from 'discord.js';
import type { ChatInputCommand } from '@/commands/types';
import { ClashOfClansClient } from '@/integrations/clashOfClans/client';

const command: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName('recruit')
    .setDescription('Look up a Clash of Clans player by tag')
    .addStringOption((opt) =>
      opt
        .setName('player_tag')
        .setDescription('Player tag, e.g. #ABC123')
        .setRequired(true)
    ),
  async execute(interaction) {
    await interaction.deferReply();

    const playerTag = interaction.options.getString('player_tag', true);
    const client = new ClashOfClansClient();

    try {
      const player = await client.getPlayerByTag(playerTag);

      if (!interaction.inGuild()) {
        await interaction.editReply('This command can only create threads inside a server channel.');
        return;
      }

      const threadTitle = `${player.name} (${player.tag})`;

      // Reply in-channel, then start a thread from that reply message.
      await interaction.editReply({ content: `Creating thread for \`${threadTitle}\`...` });
      const replyMessage = await interaction.fetchReply();

      if (!replyMessage.isThread() && 'startThread' in replyMessage) {
        const thread = await (replyMessage as any).startThread({
          name: threadTitle.slice(0, 100),
          autoArchiveDuration: ThreadAutoArchiveDuration.OneDay
        });

        const heroes = (player.heroes ?? []).filter((h) => (h?.name ?? '').trim().length > 0);
        const heroesValue =
          heroes.length > 0
            ? heroes
                .map((h) => {
                  const max = typeof h.maxLevel === 'number' ? `/${h.maxLevel}` : '';
                  return `${h.name}: ${h.level}${max}`;
                })
                .join('\n')
            : 'Unknown';

        const leagueName = player.league?.name ?? 'Unranked';
        const trophies = typeof player.trophies === 'number' ? `${player.trophies} trophies` : 'Unknown trophies';
        const leagueRankValue = `${leagueName} (${trophies})`;

        const embed = new EmbedBuilder()
          .setTitle(threadTitle)
          .addFields(
            { name: 'Town Hall', value: String(player.townHallLevel ?? 'Unknown'), inline: true },
            { name: 'Current league rank', value: leagueRankValue, inline: true },
            { name: 'Hero levels', value: heroesValue, inline: false }
          );

        await thread.send({ embeds: [embed] });
        await interaction.editReply({ content: `Thread created: <#${thread.id}>` });
      } else {
        await interaction.editReply('Could not create a thread in this channel.');
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to look up that player. Please try again.';
      await interaction.editReply({
        content:
          `Could not look up that player tag.\n` +
          `- Tag: \`${playerTag}\`\n` +
          `- Error: ${msg}\n\n` +
          `Make sure \`CLASH_OF_CLANS_API_TOKEN\` is set in your environment and the tag is correct.`
      });
    }
  }
};

export default command;

