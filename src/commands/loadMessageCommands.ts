import type { MessageCommand } from '@/commands/types';

type CommandModule = { default: MessageCommand };

export function loadMessageCommands(): MessageCommand[] {
  const modules = import.meta.glob<CommandModule>('./message/**/*.ts', {
    eager: true
  });

  const commands = Object.values(modules)
    .map((m) => m.default)
    .filter(Boolean);

  commands.sort((a, b) => a.data.name.localeCompare(b.data.name));
  return commands;
}

export function createMessageCommandMap(commands: MessageCommand[]) {
  return new Map(commands.map((c) => [c.data.name, c] as const));
}
