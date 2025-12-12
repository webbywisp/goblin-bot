import { getEnv } from '@/utils/env';

export type CocPlayer = {
  tag: string;
  name: string;
  townHallLevel?: number;
  townHallWeaponLevel?: number;
  expLevel?: number;
  trophies?: number;
  bestTrophies?: number;
  warStars?: number;
  attackWins?: number;
  defenseWins?: number;
  builderHallLevel?: number;
  builderBaseTrophies?: number;
  clan?: { tag: string; name: string };
  league?: { name: string };
  heroes?: Array<{
    name: string;
    level: number;
    maxLevel?: number;
    village?: 'home' | 'builderBase';
  }>;
  role?: string;
};

export type CocWarAttack = {
  attackerTag: string;
  defenderTag: string;
  stars: number;
  destructionPercentage: number;
  order?: number;
};

export type CocWarMember = {
  tag: string;
  name: string;
  townhallLevel?: number;
  attacks?: CocWarAttack[];
};

export type CocClanWarSide = {
  tag: string;
  name: string;
  attacks?: number;
  stars?: number;
  destructionPercentage?: number;
  members?: CocWarMember[];
};

export type CocCurrentWar = {
  state?: string; // e.g. "notInWar" | "inWar" | "preparation" | "warEnded"
  teamSize?: number;
  attacksPerMember?: number;
  startTime?: string;
  endTime?: string;
  clan: CocClanWarSide;
  opponent: CocClanWarSide;
};

export type CocWarLeagueGroup = {
  state?: string;
  season?: string;
  rounds?: Array<{
    warTags: string[];
  }>;
};

export type CocCwlWar = {
  state?: string;
  teamSize?: number;
  attacksPerMember?: number;
  startTime?: string;
  endTime?: string;
  clan: CocClanWarSide;
  opponent: CocClanWarSide;
};

type CocApiError = {
  reason?: string;
  message?: string;
};

export function normalizePlayerTag(input: string): string {
  const trimmed = input.trim().toUpperCase().replace(/\s+/g, '');
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

export class ClashOfClansClient {
  private async request<T>(path: string): Promise<T> {
    const env = getEnv();
    if (!env.CLASH_OF_CLANS_API_TOKEN) {
      throw new Error('Missing CLASH_OF_CLANS_API_TOKEN');
    }

    const url = `${env.CLASH_OF_CLANS_API_BASE_URL}${path}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${env.CLASH_OF_CLANS_API_TOKEN}`
      }
    });

    if (!res.ok) {
      let err: CocApiError | undefined;
      try {
        err = (await res.json()) as CocApiError;
      } catch {
        // ignore
      }

      const msg =
        err?.message ||
        err?.reason ||
        `Clash of Clans API request failed (${res.status} ${res.statusText})`;
      const e = new Error(msg);
      (e as any).status = res.status;
      throw e;
    }

    return (await res.json()) as T;
  }

  async getPlayerByTag(playerTag: string): Promise<CocPlayer> {
    const tag = normalizePlayerTag(playerTag);
    if (!tag || tag === '#') {
      throw new Error('Invalid player tag');
    }

    return await this.request<CocPlayer>(`/players/${encodeURIComponent(tag)}`);
  }

  async getCurrentWarByClanTag(clanTag: string): Promise<CocCurrentWar> {
    const tag = normalizePlayerTag(clanTag);
    if (!tag || tag === '#') {
      throw new Error('Invalid clan tag');
    }

    return await this.request<CocCurrentWar>(`/clans/${encodeURIComponent(tag)}/currentwar`);
  }

  async getWarLeagueGroupByClanTag(clanTag: string): Promise<CocWarLeagueGroup> {
    const tag = normalizePlayerTag(clanTag);
    if (!tag || tag === '#') {
      throw new Error('Invalid clan tag');
    }

    return await this.request<CocWarLeagueGroup>(
      `/clans/${encodeURIComponent(tag)}/currentwar/leaguegroup`
    );
  }

  async getCwlWarByTag(warTag: string): Promise<CocCwlWar> {
    const tag = normalizePlayerTag(warTag);
    if (!tag || tag === '#') {
      throw new Error('Invalid war tag');
    }

    return await this.request<CocCwlWar>(`/clanwarleagues/wars/${encodeURIComponent(tag)}`);
  }
}

