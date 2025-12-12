import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommand } from '@/commands/types';

const command: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong!'),
  async execute(interaction) {
    const sentAt = Date.now();
    await interaction.reply({ content: 'Pong!', flags: MessageFlags.Ephemeral });

    // Optional: try to provide a follow-up with rough latency
    const latencyMs = Date.now() - sentAt;
    await interaction.followUp({
      content: `Latency: ~${latencyMs}ms`,
      flags: MessageFlags.Ephemeral
    });
  }
};

export default command;
