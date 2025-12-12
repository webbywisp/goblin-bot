import { REST, Routes } from 'discord.js';
import { getEnv } from '@/utils/env';
import { loadChatInputCommands } from '@/commands/loadChatInputCommands';

export async function deployCommands() {
  const env = getEnv();
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  const body = loadChatInputCommands().map((c) => c.data.toJSON());

  if (env.DISCORD_GUILD_ID) {
    return await rest.put(
      Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
      { body }
    );
  }

  return await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
}
