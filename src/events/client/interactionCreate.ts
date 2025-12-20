import type { ClientEvent } from '@/events/types';
import { logger } from '@/utils/logger';
import { getChatInputCommandMap, getMessageCommandMap } from '@/bot/state';
import { handleRecruitComponentInteraction } from '@/recruit/handleRecruitComponentInteraction';
import { handleSettingsComponentInteraction } from '@/settings/handleSettingsComponentInteraction';
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

    // Handle /recruit buttons/selects (Accept/Close) globally so they keep working
    // even after the short-lived per-message collectors expire.
    if (
      interaction.isButton() ||
      interaction.isStringSelectMenu() ||
      interaction.isRoleSelectMenu() ||
      interaction.isChannelSelectMenu()
    ) {
      try {
        const handled = await handleSettingsComponentInteraction(interaction);
        if (handled) return;
      } catch (err) {
        logger.error({ err, customId: interaction.customId }, 'Settings component interaction failed');

        const payload = {
          content: 'Something went wrong while handling that settings menu.',
          flags: MessageFlags.Ephemeral
        } as const;

        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
        return;
      }

      try {
        const handled = await handleRecruitComponentInteraction(interaction);
        if (handled) return;
      } catch (err) {
        logger.error({ err, customId: interaction.customId }, 'Component interaction failed');

        const payload = {
          content: 'Something went wrong while handling that button/menu.',
          flags: MessageFlags.Ephemeral
        } as const;

        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
        return;
      }
    }

    if (interaction.isMessageContextMenuCommand()) {
      const command = getMessageCommandMap().get(interaction.commandName);
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
        logger.error({ err, command: interaction.commandName }, 'Message command failed');

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
