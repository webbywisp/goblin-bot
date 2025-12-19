import { loadMessageCommands } from '@/commands/loadMessageCommands';
import { describe, expect, it } from 'vitest';

describe('loadMessageCommands', () => {
  it('loads built-in message commands', () => {
    const commands = loadMessageCommands();
    const names = commands.map((c) => c.data.name);
    expect(names).toContain('recruit');
  });

  it('returns commands sorted by name', () => {
    const commands = loadMessageCommands();
    const names = commands.map((c) => c.data.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
