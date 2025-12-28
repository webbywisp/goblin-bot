import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecruitAllowedRoleIds } from '@/recruit/configStore';
import { getRoleIdsFromMember } from '@/utils/discordRoles';
import { FAMILY_LEADER_ROLE_ID } from '@/config/roles';

// Mock dependencies
vi.mock('@/recruit/configStore', () => ({
  getRecruitAllowedRoleIds: vi.fn()
}));

vi.mock('@/utils/discordRoles', () => ({
  getRoleIdsFromMember: vi.fn()
}));

const SAVED_ENV: Record<string, string | undefined> = {};

async function importFreshPermissionsModule() {
  vi.resetModules();
  return await import('@/settings/permissions');
}

beforeEach(() => {
  SAVED_ENV.SETTINGS_ADMIN_IDS = process.env.SETTINGS_ADMIN_IDS;
  vi.clearAllMocks();
});

afterEach(() => {
  if (SAVED_ENV.SETTINGS_ADMIN_IDS !== undefined) {
    process.env.SETTINGS_ADMIN_IDS = SAVED_ENV.SETTINGS_ADMIN_IDS;
  } else {
    delete process.env.SETTINGS_ADMIN_IDS;
  }
  vi.resetModules();
});

describe('isSettingsAdmin', () => {
  it('returns true for default admin ID', async () => {
    delete process.env.SETTINGS_ADMIN_IDS;
    const { isSettingsAdmin } = await importFreshPermissionsModule();
    expect(isSettingsAdmin('169688623699066880')).toBe(true);
  });

  it('returns false for non-admin ID', async () => {
    delete process.env.SETTINGS_ADMIN_IDS;
    const { isSettingsAdmin } = await importFreshPermissionsModule();
    expect(isSettingsAdmin('123456789')).toBe(false);
  });

  it('uses SETTINGS_ADMIN_IDS env var when set', async () => {
    process.env.SETTINGS_ADMIN_IDS = '111,222,333';
    const { isSettingsAdmin } = await importFreshPermissionsModule();
    expect(isSettingsAdmin('111')).toBe(true);
    expect(isSettingsAdmin('222')).toBe(true);
    expect(isSettingsAdmin('333')).toBe(true);
    expect(isSettingsAdmin('444')).toBe(false);
  });

  it('handles whitespace in SETTINGS_ADMIN_IDS', async () => {
    process.env.SETTINGS_ADMIN_IDS = ' 111 , 222 , 333 ';
    const { isSettingsAdmin } = await importFreshPermissionsModule();
    expect(isSettingsAdmin('111')).toBe(true);
    expect(isSettingsAdmin('222')).toBe(true);
    expect(isSettingsAdmin('333')).toBe(true);
  });
});

describe('canManageSettings', () => {
  const mockGetRecruitAllowedRoleIds = vi.mocked(getRecruitAllowedRoleIds);
  const mockGetRoleIdsFromMember = vi.mocked(getRoleIdsFromMember);

  const createMockMember = (roleIds: string[]) => {
    return {
      roles: roleIds
    } as unknown;
  };

  beforeEach(() => {
    mockGetRecruitAllowedRoleIds.mockResolvedValue([]);
    mockGetRoleIdsFromMember.mockReturnValue(new Set());
  });

  it('returns true for maintainer/admin user ID', async () => {
    delete process.env.SETTINGS_ADMIN_IDS;
    const { canManageSettings } = await importFreshPermissionsModule();
    const result = await canManageSettings('169688623699066880', null, 'guild123');
    expect(result).toBe(true);
    expect(mockGetRoleIdsFromMember).not.toHaveBeenCalled();
  });

  it('returns true for user ID in SETTINGS_ADMIN_IDS', async () => {
    process.env.SETTINGS_ADMIN_IDS = '111,222';
    const { canManageSettings } = await importFreshPermissionsModule();
    const result = await canManageSettings('111', null, 'guild123');
    expect(result).toBe(true);
  });

  it('returns false when member is null and user is not admin', async () => {
    delete process.env.SETTINGS_ADMIN_IDS;
    const { canManageSettings } = await importFreshPermissionsModule();
    const result = await canManageSettings('regular-user', null, 'guild123');
    expect(result).toBe(false);
  });

  it('returns true when member has Family Leader role', async () => {
    delete process.env.SETTINGS_ADMIN_IDS;
    const { canManageSettings } = await importFreshPermissionsModule();
    const member = createMockMember([FAMILY_LEADER_ROLE_ID, 'other-role']);
    mockGetRoleIdsFromMember.mockReturnValue(new Set([FAMILY_LEADER_ROLE_ID, 'other-role']));

    const result = await canManageSettings('regular-user', member as any, 'guild123');
    expect(result).toBe(true);
    // When Family Leader role is present, it returns early and doesn't call getRecruitAllowedRoleIds
    expect(mockGetRecruitAllowedRoleIds).not.toHaveBeenCalled();
  });

  it('returns true when member has configured recruit allowed role', async () => {
    delete process.env.SETTINGS_ADMIN_IDS;
    const { canManageSettings } = await importFreshPermissionsModule();
    const member = createMockMember(['leader-role-1', 'other-role']);
    mockGetRoleIdsFromMember.mockReturnValue(new Set(['leader-role-1', 'other-role']));
    mockGetRecruitAllowedRoleIds.mockResolvedValue(['leader-role-1', 'leader-role-2']);

    const result = await canManageSettings('regular-user', member as any, 'guild123');
    expect(result).toBe(true);
    expect(mockGetRecruitAllowedRoleIds).toHaveBeenCalledWith('guild123');
  });

  it('returns false when member has no matching roles', async () => {
    delete process.env.SETTINGS_ADMIN_IDS;
    const { canManageSettings } = await importFreshPermissionsModule();
    const member = createMockMember(['regular-role']);
    mockGetRoleIdsFromMember.mockReturnValue(new Set(['regular-role']));
    mockGetRecruitAllowedRoleIds.mockResolvedValue(['leader-role-1', 'leader-role-2']);

    const result = await canManageSettings('regular-user', member as any, 'guild123');
    expect(result).toBe(false);
  });

  it('returns false when no leader roles are configured', async () => {
    delete process.env.SETTINGS_ADMIN_IDS;
    const { canManageSettings } = await importFreshPermissionsModule();
    const member = createMockMember(['regular-role']);
    mockGetRoleIdsFromMember.mockReturnValue(new Set(['regular-role']));
    mockGetRecruitAllowedRoleIds.mockResolvedValue([]);

    const result = await canManageSettings('regular-user', member as any, 'guild123');
    expect(result).toBe(false);
  });

  it('checks Family Leader role before checking configured roles', async () => {
    delete process.env.SETTINGS_ADMIN_IDS;
    const { canManageSettings } = await importFreshPermissionsModule();
    const member = createMockMember([FAMILY_LEADER_ROLE_ID]);
    mockGetRoleIdsFromMember.mockReturnValue(new Set([FAMILY_LEADER_ROLE_ID]));
    mockGetRecruitAllowedRoleIds.mockResolvedValue([]);

    const result = await canManageSettings('regular-user', member as any, 'guild123');
    expect(result).toBe(true);
    // When Family Leader role is present, it returns early and doesn't call getRecruitAllowedRoleIds
    expect(mockGetRecruitAllowedRoleIds).not.toHaveBeenCalled();
  });

  it('handles APIInteractionGuildMember format', async () => {
    delete process.env.SETTINGS_ADMIN_IDS;
    const { canManageSettings } = await importFreshPermissionsModule();
    const member = {
      roles: ['leader-role-1']
    } as any;
    mockGetRoleIdsFromMember.mockReturnValue(new Set(['leader-role-1']));
    mockGetRecruitAllowedRoleIds.mockResolvedValue(['leader-role-1']);

    const result = await canManageSettings('regular-user', member, 'guild123');
    expect(result).toBe(true);
  });
});
