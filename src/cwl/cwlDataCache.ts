import type { CocCwlWar } from '@/integrations/clashOfClans/client';
import { normalizePlayerTag } from '@/integrations/clashOfClans/client';
import { logger } from '@/utils/logger';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve data directory relative to the file location
// In production: dist/cwl/cwlDataCache.js -> go up 2 levels to project root -> src/data
// In development: src/cwl/cwlDataCache.ts -> go up 2 levels to project root -> src/data
const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
// Go up 2 levels from current file (dist/cwl or src/cwl) to project root, then to src/data
const projectRoot = path.resolve(currentFileDir, '..', '..');
const DATA_DIR = path.resolve(projectRoot, 'src', 'data');

/**
 * Normalize clan tag for use in file paths (remove # and uppercase)
 */
function normalizeClanTagForPath(clanTag: string): string {
  const normalized = normalizePlayerTag(clanTag);
  return normalized.slice(1).toUpperCase(); // Remove # and uppercase
}

/**
 * Get the date key from a war end time (YYYY-MM format)
 */
function getDateKeyFromWar(war: CocCwlWar): string | null {
  if (!war.endTime) return null;
  // Parse ISO format like "20251203T081925.000Z"
  const match = war.endTime.match(/^(\d{4})(\d{2})\d{2}T/);
  if (!match) return null;
  const year = match[1];
  const month = match[2];
  return `${year}-${month}`;
}

/**
 * Get the date key from a date string (YYYY-MM format)
 */
function getDateKeyFromDate(dateStr: string): string {
  const match = dateStr.match(/^(\d{4})(\d{2})\d{2}T/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  // Fallback: try parsing as Date
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get the day number from a war end time (1-7 for CWL)
 * This extracts the day of month, but for CWL we need the round number
 * For now, we'll use the day of month as a proxy (CWL wars are typically 7 days)
 */
function getDayFromWar(war: CocCwlWar, roundIndex?: number): number | null {
  // If roundIndex is provided, use it (1-indexed)
  if (roundIndex !== undefined) {
    return roundIndex + 1;
  }
  // Fallback: try to extract from date
  if (!war.endTime) return null;
  // Parse ISO format like "20251203T081925.000Z"
  const match = war.endTime.match(/^\d{4}\d{2}(\d{2})T/);
  if (!match) return null;
  const dayOfMonth = parseInt(match[1], 10);
  // CWL typically runs for 7 days, so we can use day of month modulo 7
  // But this is not reliable - better to pass roundIndex
  return dayOfMonth;
}

/**
 * Get file path for a cached CWL war
 */
function getWarCachePath(clanTag: string, dateKey: string, day: number): string {
  const clanPath = normalizeClanTagForPath(clanTag);
  return path.join(DATA_DIR, clanPath, dateKey, `day${day}.json`);
}

/**
 * Ensure the cache directory exists
 */
async function ensureCacheDir(clanTag: string, dateKey: string): Promise<void> {
  const clanPath = normalizeClanTagForPath(clanTag);
  const dir = path.join(DATA_DIR, clanPath, dateKey);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Check if a war has finished (state is "warEnded")
 */
export function isWarFinished(war: CocCwlWar): boolean {
  return war.state === 'warEnded';
}

/**
 * Load a cached CWL war from disk
 */
export async function loadCachedWar(clanTag: string, dateKey: string, day: number): Promise<CocCwlWar | null> {
  try {
    const filePath = getWarCachePath(clanTag, dateKey, day);
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as CocCwlWar;
  } catch {
    return null;
  }
}

/**
 * Save a CWL war to cache (only if war has finished)
 * @param war The war data to cache
 * @param clanTag The clan tag this war belongs to
 * @param roundIndex The round index (0-based, will be converted to 1-based day number)
 */
export async function saveWarToCache(war: CocCwlWar, clanTag: string, roundIndex?: number): Promise<void> {
  try {
    if (!isWarFinished(war)) {
      // Don't cache ongoing wars
      return;
    }

    const dateKey = getDateKeyFromWar(war);
    const day = getDayFromWar(war, roundIndex);

    if (!dateKey || !day) {
      // Can't determine date/day, skip caching
      return;
    }

    await ensureCacheDir(clanTag, dateKey);
    const filePath = getWarCachePath(clanTag, dateKey, day);
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(war, null, 2), 'utf8');
    await fs.rename(tmp, filePath);
  } catch {
    // Silently fail caching - don't break the command if cache fails
    // Log if needed but don't throw
  }
}

/**
 * Load all cached wars for a clan in a specific month
 */
export async function loadCachedWarsForMonth(clanTag: string, dateKey: string): Promise<Map<number, CocCwlWar>> {
  const wars = new Map<number, CocCwlWar>();

  try {
    // Try to read all day files
    for (let day = 1; day <= 7; day++) {
      const war = await loadCachedWar(clanTag, dateKey, day);
      if (war) {
        wars.set(day, war);
      }
    }
  } catch {
    // Directory doesn't exist or other error, return empty map
  }

  return wars;
}

/**
 * Get date key from a date string or Date object
 */
export function getDateKey(date: string | Date): string {
  if (typeof date === 'string') {
    return getDateKeyFromDate(date);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * List available date keys (months) for a clan
 */
export async function listAvailableMonths(clanTag: string): Promise<string[]> {
  try {
    const clanPath = normalizeClanTagForPath(clanTag);
    const clanDir = path.join(DATA_DIR, clanPath);

    // Log for debugging
    logger.debug({ clanTag, clanPath, clanDir, dataDir: DATA_DIR, cwd: process.cwd() }, 'Listing months for clan');

    // Check if directory exists
    try {
      await fs.access(clanDir);
    } catch (accessErr) {
      // Directory doesn't exist, log and return empty array
      logger.warn(
        { clanTag, clanPath, clanDir, dataDir: DATA_DIR, cwd: process.cwd(), err: accessErr },
        'Clan data directory does not exist'
      );
      return [];
    }

    const entries = await fs.readdir(clanDir, { withFileTypes: true });
    const months = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => /^\d{4}-\d{2}$/.test(name)) // Only include valid YYYY-MM format
      .sort()
      .reverse();

    logger.debug({ clanTag, clanPath, months, entryCount: entries.length }, 'Found months for clan');
    return months;
  } catch (err) {
    // Log error for debugging but still return empty array
    logger.error(
      { err, clanTag, clanPath: normalizeClanTagForPath(clanTag), dataDir: DATA_DIR, cwd: process.cwd() },
      'Error listing months for clan'
    );
    return [];
  }
}
