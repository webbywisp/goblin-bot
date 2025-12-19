import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from 'discord.js';

export type ChatInputCommandData =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

export interface ChatInputCommand {
  data: ChatInputCommandData;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

export interface MessageCommand {
  data: ContextMenuCommandBuilder;
  execute(interaction: MessageContextMenuCommandInteraction): Promise<void>;
}
