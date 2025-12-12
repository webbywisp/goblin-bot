import type { ClientEvent } from '@/events/types';

type EventModule = { default: ClientEvent };

export function loadClientEvents(): ClientEvent[] {
  const modules = import.meta.glob<EventModule>('./client/**/*.ts', { eager: true });

  const events = Object.values(modules)
    .map((m) => m.default)
    .filter(Boolean);

  events.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return events;
}
