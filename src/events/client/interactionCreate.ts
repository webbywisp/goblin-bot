import type { ClientEvent } from '@/events/types';
import { logger } from '@/utils/logger';
import { getChatInputCommandMap } from '@/bot/state';
import { MessageFlags } from 'discord.js';

const event: ClientEvent<'interactionCreate'> = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isAutocomplete()) {
      const command = getChatInputCommandMap().get(interaction.commandName);
      if (command?.autocomplete) {
        await command.autocomplete(interaction);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = getChatInputCommandMap().get(interaction.commandName);
    if (!command) {
      await interaction.reply({
        content: 'Unknown command. (Try redeploying commands.)',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error({ err, command: interaction.commandName }, 'Command failed');

      const payload = {
        content: 'Something went wrong while running that command.',
        flags: MessageFlags.Ephemeral
      } as const;

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    }
  }
};

export default event;
