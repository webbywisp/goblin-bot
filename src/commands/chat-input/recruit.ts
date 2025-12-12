import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
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

      const embed = new EmbedBuilder()
        .setTitle(`${player.name} (${player.tag})`)
        .setDescription(player.clan ? `Clan: ${player.clan.name} (${player.clan.tag})` : 'Clan: None')
        .addFields(
          {
            name: 'Town Hall',
            value: String(player.townHallLevel ?? 'Unknown'),
            inline: true
          },
          {
            name: 'Trophies',
            value: String(player.trophies ?? 'Unknown'),
            inline: true
          },
          {
            name: 'League',
            value: String(player.league?.name ?? 'Unknown'),
            inline: true
          },
          {
            name: 'War stars',
            value: String(player.warStars ?? 'Unknown'),
            inline: true
          },
          {
            name: 'Attack wins',
            value: String(player.attackWins ?? 'Unknown'),
            inline: true
          },
          {
            name: 'Defense wins',
            value: String(player.defenseWins ?? 'Unknown'),
            inline: true
          }
        );

      await interaction.editReply({ embeds: [embed] });
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

