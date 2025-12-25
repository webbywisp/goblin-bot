import type { ClientEvent } from '@/events/types';

type EventModule = { default: ClientEvent };

export function loadClientEvents(): ClientEvent[] {
  // Exclude test files from being loaded
  const modules = import.meta.glob<EventModule>(
    ['./client/**/*.ts', '!./client/**/*.test.ts', '!./client/**/__tests__/**'],
    { eager: true }
  );

  const events = Object.values(modules)
    .map((m) => m.default)
    .filter(Boolean);

  events.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return events;
}
