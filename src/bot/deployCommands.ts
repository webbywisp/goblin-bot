import { loadChatInputCommands } from '@/commands/loadChatInputCommands';
import { loadMessageCommands } from '@/commands/loadMessageCommands';
import { getEnv } from '@/utils/env';
import { REST, Routes } from 'discord.js';

export async function deployCommands() {
  const env = getEnv();
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  const chatInputCommands = loadChatInputCommands();
  const messageCommands = loadMessageCommands();
  const body = [...chatInputCommands.map((c) => c.data.toJSON()), ...messageCommands.map((c) => c.data.toJSON())];

  console.log(
    `Deploying ${chatInputCommands.length} slash commands and ${messageCommands.length} message commands globally.`
  );

  const deployments = [rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body })];

  if (env.DISCORD_GUILD_ID) {
    console.log(`Also deploying the same commands to guild ${env.DISCORD_GUILD_ID} for instant updates.`);
    deployments.push(rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body }));
  } else {
    console.log(
      'Set DISCORD_GUILD_ID to deploy to a test guild instantly; global commands alone can take up to an hour to propagate.'
    );
  }

  return await Promise.all(deployments);
}
