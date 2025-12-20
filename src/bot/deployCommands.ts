import { loadChatInputCommands } from '@/commands/loadChatInputCommands';
import { loadMessageCommands } from '@/commands/loadMessageCommands';
import { getEnv } from '@/utils/env';
import { REST, Routes } from 'discord.js';

export async function deployCommands() {
  const env = getEnv();
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  const chatInputCommands = loadChatInputCommands();
  const messageCommands = loadMessageCommands();

  const globalBody = messageCommands.map((c) => c.data.toJSON());
  const guildBody = chatInputCommands.map((c) => c.data.toJSON());

  const promises: Promise<unknown>[] = [];

  if (globalBody.length > 0) {
    console.log(`Deploying ${globalBody.length} global message/user commands.`);
    promises.push(rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: globalBody }));
  } else {
    console.log('No global commands to deploy.');
  }

  if (guildBody.length > 0) {
    if (!env.DISCORD_GUILD_ID) {
      throw new Error('DISCORD_GUILD_ID is required to deploy slash commands. Set it and rerun deploy.');
    }
    console.log(`Deploying ${guildBody.length} slash commands to guild ${env.DISCORD_GUILD_ID}.`);
    promises.push(
      rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body: guildBody })
    );
  } else {
    console.log('No slash commands to deploy to guild.');
  }

  if (promises.length === 0) {
    console.log('Nothing to deploy.');
    return;
  }

  await Promise.all(promises);
}
