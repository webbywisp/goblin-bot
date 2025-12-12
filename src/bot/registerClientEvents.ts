import type { Client } from 'discord.js';
import { loadClientEvents } from '@/events/loadClientEvents';

export function registerClientEvents(client: Client) {
  const events = loadClientEvents();

  for (const event of events) {
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }
}
