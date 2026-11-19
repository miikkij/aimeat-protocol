/**
 * @file src/services/kyc/screening/store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sanctions lists this node screens against: fetched from the official sources, kept
 *   as records of `system@<node>`, and read back for a screening.
 *
 *   SOURCES. The EU's consolidated list of persons, groups and entities subject to financial sanctions
 *   (Financial Sanctions Files) and the UN Security Council consolidated list, both free and official.
 *   The operator may point them elsewhere, or turn them off, with AIMEAT_KYC_SANCTIONS_SOURCES
 *   (`eu-fsf=<url>,un=<url>`, or `none`); a source the operator names may be a private address, which
 *   is how a test serves its own list. PEP data is not here: it is commercial, and comes later.
 *
 *   STORAGE. A parsed list is larger than one record may hold (1024 kB), so it is kept in parts:
 *   `kyc.lists.<source>.part.<i>` holding entries, then `kyc.lists.<source>.meta` naming the version
 *   and the number of parts. The meta is written last, so a reader sees either the old list or the
 *   whole new one; parts past the new count are removed after.
 * @structure SOURCE_URLS · sanctionsSources() · fetchList() · saveList() · loadLists() · listMetas() · refreshLists()
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import type { AimeatConfig } from '../../../config.js';
import type { MemoryRecord, Storage } from '../../../storage/interface.js';
import { safeFetch } from '../../../utils/url-validator.js';
import { readBodyCapped } from '../../../utils/read-capped.js';
import { systemGhiiFor } from '../../compliance/register.js';
import { listOf, type SanctionsEntry, type SanctionsList, type SanctionsSource } from './lists.js';

/** The official addresses (checked 2026-11-19). */
export const SOURCE_URLS: Readonly<Record<SanctionsSource, string>> = Object.freeze({
  'eu-fsf': 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw',
  un: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
});

const MAX_BYTES = 150 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
/** Bytes of JSON per part, under the 1024 kB a record may hold. */
const PART_BYTES = 800 * 1024;
const TAGS = ['kyc', 'kyc-lists'];

export interface ListMeta { source: SanctionsSource; version: string; fetchedAt: string; url: string; entries: number; parts: number }

const metaKey = (s: SanctionsSource) => `kyc.lists.${s}.meta`;
const partKey = (s: SanctionsSource, i: number) => `kyc.lists.${s}.part.${String(i).padStart(4, '0')}`;

/** The sources this node fetches, and whether the operator named them (then a private address is allowed). */
export function sanctionsSources(config: Pick<AimeatConfig, 'kycSanctionsSources'>): { urls: Partial<Record<SanctionsSource, string>>; operatorNamed: boolean } {
  const raw = (config.kycSanctionsSources ?? '').trim();
  if (!raw) return { urls: { ...SOURCE_URLS }, operatorNamed: false };
  if (raw === 'none') return { urls: {}, operatorNamed: true };
  const urls: Partial<Record<SanctionsSource, string>> = {};
  for (const part of raw.split(',')) {
    const [name, ...rest] = part.split('=');
    const url = rest.join('=').trim();
    if ((name.trim() === 'eu-fsf' || name.trim() === 'un') && URL.canParse(url)) urls[name.trim() as SanctionsSource] = url;
  }
  return { urls, operatorNamed: true };
}

/** Fetch and parse one source. Throws with the reason. */
export async function fetchList(source: SanctionsSource, url: string, operatorNamed: boolean): Promise<SanctionsList> {
  const allowOrigins = operatorNamed ? [new URL(url).origin] : undefined;
  const resp = await safeFetch(url, { headers: { Accept: 'application/xml, text/xml' }, signal: AbortSignal.timeout(TIMEOUT_MS), allowOrigins });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const length = Number(resp.headers.get('content-length') ?? '0');
  if (length > MAX_BYTES) throw new Error(`larger than ${MAX_BYTES} bytes`);
  const body = await readBodyCapped(resp, MAX_BYTES);
  if (body === null) throw new Error(`larger than ${MAX_BYTES} bytes`);
  return listOf(source, new Uint8Array(body), new Date().toISOString());
}

function rec(nodeId: string, key: string, value: unknown, now: string): MemoryRecord {
  return { key, ownerGaii: systemGhiiFor(nodeId), value, visibility: 'private', tags: TAGS, ttlHours: null, version: 1, createdAt: now, updatedAt: now };
}

/** Split entries into parts of at most PART_BYTES of JSON each. */
function partsOf(entries: SanctionsEntry[]): SanctionsEntry[][] {
  const out: SanctionsEntry[][] = [];
  let cur: SanctionsEntry[] = [];
  let size = 2;
  for (const e of entries) {
    const n = JSON.stringify(e).length + 1;
    if (cur.length && size + n > PART_BYTES) { out.push(cur); cur = []; size = 2; }
    cur.push(e); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Store a list: the parts, then the meta, then drop parts past the new count. */
export async function saveList(storage: Storage, nodeId: string, list: SanctionsList, url: string): Promise<ListMeta> {
  const owner = systemGhiiFor(nodeId);
  const now = new Date().toISOString();
  const parts = partsOf(list.entries);
  for (let i = 0; i < parts.length; i++) await storage.setMemory(rec(nodeId, partKey(list.source, i), parts[i], now));
  const meta: ListMeta = { source: list.source, version: list.version, fetchedAt: list.fetchedAt ?? now, url, entries: list.entries.length, parts: parts.length };
  await storage.setMemory(rec(nodeId, metaKey(list.source), meta, now));
  const all = await storage.listMemory(owner, { prefix: `kyc.lists.${list.source}.part.` });
  const stale = all.filter(r => Number(r.key.split('.').pop()) >= parts.length).map(r => ({ ownerGaii: owner, key: r.key }));
  if (stale.length) await storage.bulkDeleteMemory(stale);
  cache.delete(list.source);
  return meta;
}

export async function listMetas(storage: Storage, nodeId: string): Promise<ListMeta[]> {
  const out: ListMeta[] = [];
  for (const s of ['eu-fsf', 'un'] as SanctionsSource[]) {
    const r = await storage.getMemory(systemGhiiFor(nodeId), metaKey(s));
    if (r?.value && typeof r.value === 'object') out.push(r.value as ListMeta);
  }
  return out;
}

// process-local: each process reads a list version from storage once; a second process reads its own copy, keyed by the same version.
const cache = new Map<SanctionsSource, SanctionsList>();

/** Every stored list, read once per version and kept in this process. */
export async function loadLists(storage: Storage, nodeId: string): Promise<SanctionsList[]> {
  const out: SanctionsList[] = [];
  for (const meta of await listMetas(storage, nodeId)) {
    const hit = cache.get(meta.source);
    if (hit && hit.version === meta.version) { out.push(hit); continue; }
    const entries: SanctionsEntry[] = [];
    for (let i = 0; i < meta.parts; i++) {
      const r = await storage.getMemory(systemGhiiFor(nodeId), partKey(meta.source, i));
      if (Array.isArray(r?.value)) entries.push(...(r.value as SanctionsEntry[]));
    }
    const list: SanctionsList = { source: meta.source, version: meta.version, fetchedAt: meta.fetchedAt, entries };
    cache.set(meta.source, list);
    out.push(list);
  }
  return out;
}

export interface RefreshOutcome { source: SanctionsSource; changed: boolean; version?: string; entries?: number; error?: string }

/** Fetch every configured source and store the ones whose bytes changed. */
export async function refreshLists(storage: Storage, config: AimeatConfig): Promise<RefreshOutcome[]> {
  const { urls, operatorNamed } = sanctionsSources(config);
  const metas = await listMetas(storage, config.nodeId);
  const out: RefreshOutcome[] = [];
  for (const [source, url] of Object.entries(urls) as Array<[SanctionsSource, string]>) {
    try {
      const list = await fetchList(source, url, operatorNamed);
      const was = metas.find(m => m.source === source);
      if (was?.version === list.version) {
        // The same bytes: the parts stay, and the meta says when the list was last checked.
        await storage.setMemory(rec(config.nodeId, metaKey(source), { ...was, fetchedAt: list.fetchedAt ?? new Date().toISOString() }, new Date().toISOString()));
        out.push({ source, changed: false, version: list.version, entries: list.entries.length });
        continue;
      }
      await saveList(storage, config.nodeId, list, url);
      out.push({ source, changed: true, version: list.version, entries: list.entries.length });
    } catch (err) {
      out.push({ source, changed: false, error: (err as Error).message.slice(0, 300) });
    }
  }
  return out;
}
