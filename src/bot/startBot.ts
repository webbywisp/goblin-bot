import { createClient } from '@/bot/createClient';
import { registerClientEvents } from '@/bot/registerClientEvents';
import { createChatInputCommandMap, loadChatInputCommands } from '@/commands/loadChatInputCommands';
import { createMessageCommandMap, loadMessageCommands } from '@/commands/loadMessageCommands';
import { getEnv } from '@/utils/env';
import { logger } from '@/utils/logger';
import { setChatInputCommandMap, setMessageCommandMap } from '@/bot/state';

export async function startBot() {
  const client = createClient();

  const chatInputCommands = loadChatInputCommands();
  setChatInputCommandMap(createChatInputCommandMap(chatInputCommands));

  const messageCommands = loadMessageCommands();
  setMessageCommandMap(createMessageCommandMap(messageCommands));

  registerClientEvents(client);

  logger.info(
    {
      chatInputCommandCount: chatInputCommands.length,
      messageCommandCount: messageCommands.length
    },
    'Starting bot'
  );

  await client.login(getEnv().DISCORD_TOKEN);
}
