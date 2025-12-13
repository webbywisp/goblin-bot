import type { ClientEvent } from '@/events/types';
import { logger } from '@/utils/logger';
import { getInstanceLabel } from '@/utils/instance';

const event: ClientEvent<'clientReady'> = {
  name: 'clientReady',
  once: true,
  execute(client) {
    const instance = getInstanceLabel();
    try {
      client.user?.setPresence({
        activities: [{ name: `instance: ${instance}` }],
        status: 'online'
      });
    } catch {
      // ignore
    }
    logger.info(
      {
        user: client.user?.tag,
        id: client.user?.id,
        instance
      },
      'Bot ready'
    );
  }
};

export default event;
