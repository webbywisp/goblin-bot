import { z } from 'zod';
import { getEnv } from '@/utils/env';

export type RecruitLeaderPingRule = {
  minTh: number;
  maxTh: number;
  roleIds: string[];
};

const RuleSchema = z
  .object({
    minTh: z.number().int().min(1).max(20),
    maxTh: z.number().int().min(1).max(20),
    roleIds: z.array(z.string().min(1)).min(1)
  })
  .refine((r) => r.minTh <= r.maxTh, { message: 'minTh must be <= maxTh' });

const RulesSchema = z.array(RuleSchema);

let cachedRules: RecruitLeaderPingRule[] | undefined;

export function getRecruitLeaderPingRules(): RecruitLeaderPingRule[] {
  if (cachedRules) return cachedRules;

  const raw = getEnv().RECRUIT_TH_ROLE_RANGES;
  if (!raw) {
    cachedRules = [];
    return cachedRules;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    cachedRules = RulesSchema.parse(parsed);
    return cachedRules;
  } catch {
    // If config is invalid, fail closed (no pings) rather than crashing.
    cachedRules = [];
    return cachedRules;
  }
}

export function getRecruitLeaderRoleIdsForTownHall(th: number): string[] {
  if (!Number.isFinite(th) || th <= 0) return [];

  const rules = getRecruitLeaderPingRules();
  const roleIds = rules
    .filter((r) => th >= r.minTh && th <= r.maxTh)
    .flatMap((r) => r.roleIds);

  return Array.from(new Set(roleIds));
}

