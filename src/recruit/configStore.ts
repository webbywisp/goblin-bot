import { promises as fs } from 'node:fs';
import path from 'node:path';

type RecruitGuildConfig = {
  // Town Hall => role IDs
  thRoleIds: Record<string, string[]>;
  // Roles allowed to run /recruit (Family Leader role always allowed separately)
  allowedRecruitRoleIds?: string[];
  // Channel where message-based recruits create threads
  recruitThreadChannelId?: string;
};

type RecruitConfigFile = {
  version: 1;
  guilds: Record<string, RecruitGuildConfig>;
};

const DEFAULT_CONFIG: RecruitConfigFile = {
  version: 1,
  guilds: {}
};

const CONFIG_PATH = path.resolve(process.cwd(), 'recruit-config.json');

let cached: RecruitConfigFile | undefined;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<RecruitConfigFile> {
  if (cached) return cached;

  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as RecruitConfigFile;
    if (parsed?.version !== 1 || typeof parsed.guilds !== 'object' || !parsed.guilds) {
      cached = { ...DEFAULT_CONFIG };
      return cached;
    }
    cached = parsed;
    return cached;
  } catch {
    cached = { ...DEFAULT_CONFIG };
    return cached;
  }
}

async function save(next: RecruitConfigFile): Promise<void> {
  const dir = path.dirname(CONFIG_PATH);
  await fs.mkdir(dir, { recursive: true });

  const tmp = `${CONFIG_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await fs.rename(tmp, CONFIG_PATH);
}

function normalizeRoleIds(roleIds: string[]): string[] {
  return Array.from(new Set(roleIds.filter((r) => typeof r === 'string' && r.trim().length > 0)));
}

function normalizeChannelId(channelId: string | null | undefined): string | undefined {
  const cleaned = typeof channelId === 'string' ? channelId.trim() : '';
  return cleaned.length > 0 ? cleaned : undefined;
}

function assertTownHall(th: number): asserts th is number {
  if (!Number.isInteger(th) || th < 1 || th > 18) {
    throw new Error(`Town Hall must be an integer 1-18 (got ${th})`);
  }
}

export async function getRecruitRoleIdsForTownHall(guildId: string, th: number): Promise<string[]> {
  assertTownHall(th);
  const cfg = await load();
  const guild = cfg.guilds[guildId];
  return normalizeRoleIds(guild?.thRoleIds?.[String(th)] ?? []);
}

export async function setRecruitRoleIdsForTownHall(guildId: string, th: number, roleIds: string[]): Promise<void> {
  assertTownHall(th);

  const cleaned = normalizeRoleIds(roleIds);
  const cfg = await load();
  const prevGuild = cfg.guilds[guildId] ?? { thRoleIds: {} };

  const next: RecruitConfigFile = {
    ...cfg,
    guilds: {
      ...cfg.guilds,
      [guildId]: {
        ...prevGuild,
        thRoleIds: {
          ...(prevGuild.thRoleIds ?? {}),
          [String(th)]: cleaned
        }
      }
    }
  };

  cached = next;
  // Serialize writes to avoid corrupting the file.
  writeChain = writeChain.then(() => save(next));
  await writeChain;
}

export async function getRecruitRoleMappingSummary(guildId: string): Promise<string> {
  const cfg = await load();
  const guild = cfg.guilds[guildId];
  const thRoleIds = guild?.thRoleIds ?? {};

  const lines: string[] = [];
  for (let th = 1; th <= 18; th++) {
    const roles = normalizeRoleIds(thRoleIds[String(th)] ?? []);
    if (roles.length === 0) continue;
    lines.push(`- TH${th}: ${roles.map((r) => `<@&${r}>`).join(' ')}`);
  }

  return lines.length > 0 ? lines.join('\n') : '_No leader roles configured yet._';
}

export async function getRecruitAllowedRoleIds(guildId: string): Promise<string[]> {
  const cfg = await load();
  const guild = cfg.guilds[guildId];
  return normalizeRoleIds(guild?.allowedRecruitRoleIds ?? []);
}

export async function setRecruitAllowedRoleIds(guildId: string, roleIds: string[]): Promise<void> {
  const cleaned = normalizeRoleIds(roleIds);
  const cfg = await load();
  const prevGuild = cfg.guilds[guildId] ?? { thRoleIds: {} };

  const next: RecruitConfigFile = {
    ...cfg,
    guilds: {
      ...cfg.guilds,
      [guildId]: {
        ...prevGuild,
        thRoleIds: prevGuild.thRoleIds ?? {},
        allowedRecruitRoleIds: cleaned
      }
    }
  };

  cached = next;
  // Serialize writes to avoid corrupting the file.
  writeChain = writeChain.then(() => save(next));
  await writeChain;
}

export async function getRecruitAllowedRoleSummary(guildId: string): Promise<string> {
  const ids = await getRecruitAllowedRoleIds(guildId);
  return ids.length > 0
    ? ids.map((id) => `<@&${id}>`).join(' ')
    : '_No additional roles configured (only Family Leaders can use /recruit)._';
}

export async function getRecruitThreadChannelId(guildId: string): Promise<string | undefined> {
  const cfg = await load();
  const guild = cfg.guilds[guildId];
  return normalizeChannelId(guild?.recruitThreadChannelId);
}

export async function setRecruitThreadChannelId(guildId: string, channelId: string | null): Promise<void> {
  const cleaned = normalizeChannelId(channelId);
  const cfg = await load();
  const prevGuild = cfg.guilds[guildId] ?? { thRoleIds: {} };

  const nextGuild: RecruitGuildConfig = {
    ...prevGuild,
    thRoleIds: prevGuild.thRoleIds ?? {},
    allowedRecruitRoleIds: prevGuild.allowedRecruitRoleIds ?? []
  };

  if (cleaned) {
    nextGuild.recruitThreadChannelId = cleaned;
  } else {
    delete nextGuild.recruitThreadChannelId;
  }

  const next: RecruitConfigFile = {
    ...cfg,
    guilds: {
      ...cfg.guilds,
      [guildId]: nextGuild
    }
  };

  cached = next;
  writeChain = writeChain.then(() => save(next));
  await writeChain;
}

export async function getRecruitThreadChannelSummary(guildId: string): Promise<string> {
  const channelId = await getRecruitThreadChannelId(guildId);
  return channelId ? `<#${channelId}>` : '_Not configured yet._';
}

export async function findRecruitThreadDestination(): Promise<{ guildId: string; channelId: string } | null> {
  const cfg = await load();
  for (const [guildId, guild] of Object.entries(cfg.guilds)) {
    const channelId = normalizeChannelId(guild.recruitThreadChannelId);
    if (channelId) {
      return { guildId, channelId };
    }
  }
  return null;
}
