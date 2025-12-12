import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder
} from 'discord.js';

export interface ChatInputCommand {
  data: SlashCommandBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}
