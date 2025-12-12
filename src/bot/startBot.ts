import { createClient } from '@/bot/createClient';
import { registerClientEvents } from '@/bot/registerClientEvents';
import { createChatInputCommandMap, loadChatInputCommands } from '@/commands/loadChatInputCommands';
import { getEnv } from '@/utils/env';
import { logger } from '@/utils/logger';
import { setChatInputCommandMap } from '@/bot/state';

export async function startBot() {
  const client = createClient();

  const commands = loadChatInputCommands();
  setChatInputCommandMap(createChatInputCommandMap(commands));

  registerClientEvents(client);

  logger.info(
    {
      commandCount: commands.length
    },
    'Starting bot'
  );

  await client.login(getEnv().DISCORD_TOKEN);
}
