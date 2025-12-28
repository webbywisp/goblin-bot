import { promises as fs } from 'node:fs';
import path from 'node:path';

export type OpenApplicantEntry = {
  applicantId: string;
  applicantTag: string;
  threadId: string;
  threadUrl: string;
  playerTag: string;
  guildId?: string;
  openedAt: number;
};

const STORE_PATH = path.resolve(process.cwd(), 'tmp', 'open-recruit-applicants.json');
const openByApplicant = new Map<string, OpenApplicantEntry>();
const openByThread = new Map<string, OpenApplicantEntry>();
const openByPlayerTag = new Map<string, OpenApplicantEntry>();
const pendingApplicants = new Set<string>();
const pendingPlayerTags = new Set<string>();

type StorePayload = {
  version: 1;
  entries: OpenApplicantEntry[];
};

async function ensureStoreDir() {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true }).catch(() => undefined);
}

async function persist() {
  await ensureStoreDir();
  const payload: StorePayload = {
    version: 1,
    entries: Array.from(openByApplicant.values())
  };
  const tmp = `${STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8').catch(() => undefined);
  await fs.rename(tmp, STORE_PATH).catch(() => undefined);
}

async function loadFromDisk() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StorePayload;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
    openByApplicant.clear();
    openByThread.clear();
    openByPlayerTag.clear();
    for (const entry of parsed.entries) {
      openByApplicant.set(entry.applicantId, entry);
      openByThread.set(entry.threadId, entry);
      openByPlayerTag.set(entry.playerTag.toUpperCase(), entry);
    }
  } catch {
    // ignore missing/corrupt files
  }
}

export function getOpenApplicantThread(applicantId: string): OpenApplicantEntry | undefined {
  return openByApplicant.get(applicantId);
}

export function getOpenThreadByPlayerTag(playerTag: string): OpenApplicantEntry | undefined {
  // Normalize to uppercase and ensure # prefix for consistency
  const normalized = playerTag.toUpperCase().trim();
  const withHash = normalized.startsWith('#') ? normalized : `#${normalized}`;
  return openByPlayerTag.get(withHash);
}

export function getAllOpenApplicantEntries(): OpenApplicantEntry[] {
  return Array.from(openByApplicant.values());
}

export function tryLockApplicant(applicantId: string): boolean {
  if (openByApplicant.has(applicantId)) return false;
  if (pendingApplicants.has(applicantId)) return false;
  pendingApplicants.add(applicantId);
  return true;
}

export function tryLockPlayerTag(playerTag: string): boolean {
  // Normalize to uppercase and ensure # prefix for consistency
  const normalized = playerTag.toUpperCase().trim();
  const withHash = normalized.startsWith('#') ? normalized : `#${normalized}`;
  if (openByPlayerTag.has(withHash)) return false;
  if (pendingPlayerTags.has(withHash)) return false;
  pendingPlayerTags.add(withHash);
  return true;
}

export function releaseApplicantLock(applicantId: string): void {
  pendingApplicants.delete(applicantId);
}

export function releasePlayerTagLock(playerTag: string): void {
  // Normalize to uppercase and ensure # prefix for consistency
  const normalized = playerTag.toUpperCase().trim();
  const withHash = normalized.startsWith('#') ? normalized : `#${normalized}`;
  pendingPlayerTags.delete(withHash);
}

export function registerOpenApplicantThread(entry: Omit<OpenApplicantEntry, 'openedAt'>): OpenApplicantEntry {
  pendingApplicants.delete(entry.applicantId);
  const normalizedPlayerTag = entry.playerTag.toUpperCase();
  pendingPlayerTags.delete(normalizedPlayerTag);
  const record: OpenApplicantEntry = {
    ...entry,
    openedAt: Date.now()
  };
  openByApplicant.set(record.applicantId, record);
  openByThread.set(record.threadId, record);
  openByPlayerTag.set(normalizedPlayerTag, record);
  void persist();
  return record;
}

export function clearOpenApplicantThreadByThreadId(threadId: string): boolean {
  const existing = openByThread.get(threadId);
  if (!existing) return false;
  openByThread.delete(threadId);
  openByApplicant.delete(existing.applicantId);
  const normalizedPlayerTag = existing.playerTag.toUpperCase();
  openByPlayerTag.delete(normalizedPlayerTag);
  void persist();
  return true;
}

void loadFromDisk();
