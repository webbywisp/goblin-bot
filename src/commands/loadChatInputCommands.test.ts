import { describe, expect, it } from 'vitest';
import { loadChatInputCommands } from '@/commands/loadChatInputCommands';

describe('loadChatInputCommands', () => {
  it('loads the ping command', () => {
    const commands = loadChatInputCommands();
    const names = commands.map((c) => c.data.name);
    expect(names).toContain('ping');
  });
});
