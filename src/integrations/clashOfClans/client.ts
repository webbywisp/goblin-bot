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
  role?: string;
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
  async getPlayerByTag(playerTag: string): Promise<CocPlayer> {
    const env = getEnv();
    if (!env.CLASH_OF_CLANS_API_TOKEN) {
      throw new Error('Missing CLASH_OF_CLANS_API_TOKEN');
    }

    const tag = normalizePlayerTag(playerTag);
    if (!tag || tag === '#') {
      throw new Error('Invalid player tag');
    }

    const url = `${env.CLASH_OF_CLANS_API_BASE_URL}/players/${encodeURIComponent(tag)}`;
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

    return (await res.json()) as CocPlayer;
  }
}

