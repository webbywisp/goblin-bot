import type { ChatInputCommand } from '@/commands/types';

type CommandModule = { default: ChatInputCommand };

export function loadChatInputCommands(): ChatInputCommand[] {
  const modules = import.meta.glob<CommandModule>('./chat-input/**/*.ts', {
    eager: true
  });

  const commands = Object.values(modules)
    .map((m) => m.default)
    .filter(Boolean);

  commands.sort((a, b) => a.data.name.localeCompare(b.data.name));
  return commands;
}

export function createChatInputCommandMap(commands: ChatInputCommand[]) {
  return new Map(commands.map((c) => [c.data.name, c] as const));
}
