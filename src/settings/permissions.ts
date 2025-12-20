const DEFAULT_ADMIN_IDS = ['169688623699066880'];

function parseIds(raw: string | undefined): string[] {
  if (!raw) return DEFAULT_ADMIN_IDS;
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

let cachedIds: string[] | undefined;

export function getSettingsAdminIds(): string[] {
  if (!cachedIds) {
    cachedIds = parseIds(process.env.SETTINGS_ADMIN_IDS);
  }
  return cachedIds;
}

export function isSettingsAdmin(userId: string): boolean {
  return getSettingsAdminIds().includes(userId);
}
