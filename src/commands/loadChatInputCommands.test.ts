import { describe, expect, it } from 'vitest';
import { loadChatInputCommands } from '@/commands/loadChatInputCommands';

describe('loadChatInputCommands', () => {
  it('loads built-in chat input commands', () => {
    const commands = loadChatInputCommands();
    const names = commands.map((c) => c.data.name);
    expect(names).toContain('ping');
    expect(names).toContain('recruit');
  });

  it('returns commands sorted by name', () => {
    const commands = loadChatInputCommands();
    const names = commands.map((c) => c.data.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
