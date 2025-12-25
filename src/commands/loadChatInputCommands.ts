import type { ChatInputCommand } from '@/commands/types';

type CommandModule = { default: ChatInputCommand };

export function loadChatInputCommands(): ChatInputCommand[] {
  // Use negative glob patterns to exclude test files at the glob level
  // This prevents vite-node from processing test files during deploy
  // Pattern: match all .ts files but exclude .test.ts files
  const modules = import.meta.glob<CommandModule>(
    ['./chat-input/**/*.ts', '!./chat-input/**/*.test.ts', '!./chat-input/**/__tests__/**'],
    {
      eager: true
    }
  );

  const commands = Object.values(modules)
    .map((m) => m.default)
    .filter(Boolean);

  commands.sort((a, b) => a.data.name.localeCompare(b.data.name));
  return commands;
}

export function createChatInputCommandMap(commands: ChatInputCommand[]) {
  return new Map(commands.map((c) => [c.data.name, c] as const));
}
