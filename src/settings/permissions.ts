import { FAMILY_LEADER_ROLE_ID } from '@/config/roles';
import { getRecruitAllowedRoleIds } from '@/recruit/configStore';
import { getRoleIdsFromMember } from '@/utils/discordRoles';
import type { APIInteractionGuildMember, GuildMember } from 'discord.js';

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

/**
 * Checks if a user can manage settings based on:
 * 1. User ID (maintainer/admin)
 * 2. Family Leader role
 * 3. Configured recruit allowed roles
 */
export async function canManageSettings(
  userId: string,
  member: GuildMember | APIInteractionGuildMember | null,
  guildId: string
): Promise<boolean> {
  // Check if user is a maintainer/admin
  if (isSettingsAdmin(userId)) {
    return true;
  }

  if (!member) {
    return false;
  }

  const memberRoleIds = getRoleIdsFromMember(member);

  // Check if user has Family Leader role
  if (memberRoleIds.has(FAMILY_LEADER_ROLE_ID)) {
    return true;
  }

  // Check if user has any of the configured recruit allowed roles
  const allowedRoleIds = await getRecruitAllowedRoleIds(guildId);
  if (allowedRoleIds.some((id) => memberRoleIds.has(id))) {
    return true;
  }

  return false;
}
