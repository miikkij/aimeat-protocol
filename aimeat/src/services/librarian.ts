/**
 * @file librarian.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Tier-1 "librarian" retrieval: a single ranked full-text search fanned across ALL of
 *   a viewer's own memory (their GHII + every agent + every ecosystem app), so one query reaches
 *   every organism they have contributed to plus their personal notebook content. Built on the
 *   generic `storage.searchText()` primitive (SQLite FTS5; MongoDB is a per-token substring scan over
 *   a precomputed `searchBlob`, NOT a `$text` index); this service adds the fan-across identity set,
 *   key→organism/workspace annotation, title extraction and snippeting. Auth is implicit: only the
 *   viewer's OWN data is searched, so there is no cross-member read to gate. (Cross-member organism
 *   content readable via consent is a deliberate follow-up — see the design doc §5.)
 * @structure
 *   - librarianSearch() — resolve identity set → searchText → annotate → LibrarianHit[]
 *   - annotate()/titleOf()/snippetOf() — presentation helpers
 * @usage
 *   const { hits } = await librarianSearch(storage, config, { ownerName, fanOutOwner, viewerGaii, query });
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial: fan-across-organisms full-text librarian over searchText().
 *   v1.1.0 — 2026-07-05 — `isOwnerSession` → `fanOutOwner`: the fan-across set is now chosen by the
 *     route from (owner session OR memory:read grant), so app/agent grants with memory:read reach the
 *     owner's full read surface. Corrected the stale "MongoDB $text" note (it is a substring scan).
 *   v1.2.0 — 2026-09-16 — A credential record is titled and snippeted from its redacted value.
 *   v1.3.0 — 2026-09-26 — No hit is a Design Book part: a part is found and read through the Design
 *     Book, the one door that reads it (utils/own-door-keys.ts).
 *   v1.4.0 — 2026-09-29 — The caller passes a classification reader, and every hit is presented
 *     through presentMemories (TARGET-082): what the reader may not see is not a hit.
 *   v1.5.0 — 2026-09-30 — The public scope leaves out an organism's public record whose label keeps it
 *     inside the organism, for a viewer who is not a member (TARGET-082 review, item 1).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { presentMemories } from './classification/present-memory.js';
import type { ContentReader } from './classification/reader.js';
import { ownDoorRefusal } from '../utils/own-door-keys.js';
import { organismKeysCarried } from './group-shares-classification.js';

export interface LibrarianHit {
  key: string;
  ownerGaii: string;
  title: string;
  snippet: string;
  score: number;
  visibility: string;
  tags: string[];
  organismId?: string;
  workspaceId?: string;
  space?: string;
  updatedAt: string;
  /** Original producer (= ownerGaii); meaningful in the public scope where it is someone else. */
  producer: string;
  /** What the hit is, for the badge + the right "open" target. */
  kind: 'knowledge' | 'document' | 'memory';
  /** Knowledge-package id (kind==='knowledge'), parsed from the `packages/{id}/…` key. */
  packageId?: string;
  /** Knowledge content type (kind==='knowledge'), if present on the manifest. */
  contentType?: string;
}

const ORG_KEY = /^organism\.([^.]+)(?:\.w\.([^.]+)\.([^.]+))?/;
const PKG_KEY = /^packages\/([^/]+)\//;

/** Tokens used for snippet windowing (mirrors the FTS tokenizer: unicode words/numbers). */
function queryTokens(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** Best-effort human title for a record value (schema-agnostic). */
function titleOf(value: unknown, fallbackKey: string): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    for (const k of ['title', 'name', 'label', 'summary', 'heading', 'text']) {
      const s = v[k];
      if (typeof s === 'string' && s.trim()) return clip(s.trim(), 80);
    }
    if (typeof v.markdown === 'string') {
      const h = firstHeading(v.markdown);
      if (h) return clip(h, 80);
    }
  } else if (typeof value === 'string' && value.trim()) {
    return clip(firstHeading(value) || value.trim(), 80);
  }
  const seg = fallbackKey.split('.').pop();
  return seg || fallbackKey;
}

function firstHeading(md: string): string | null {
  for (const line of md.split('\n')) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m) return m[1].trim();
    if (line.trim()) return line.trim();
  }
  return null;
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

/** Plain searchable text of a value (string leaves joined) for snippeting. */
function flatten(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flatten).join(' ');
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.markdown === 'string') return v.markdown;
    return Object.values(v).map(flatten).join(' ');
  }
  return '';
}

/** A context window around the first matching token, else the head of the text. */
function snippetOf(text: string, tokens: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return clip(text.slice(0, 180), 180);
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + 120);
  return (start > 0 ? '…' : '') + clip(text.slice(start, end), 200) + (end < text.length ? '…' : '');
}

/**
 * Run a single ranked full-text query.
 *   - scope 'own' (default): fanned across every identity the viewer owns (GHII + agents + ecosystem
 *     apps; an agent session is scoped to itself).
 *   - scope 'public': across the WHOLE node, restricted to public-visibility content — knowledge
 *     packages, public workspace documents and public memory — so you can find what others (and
 *     their agents) have published, with the producer kept on each hit.
 */
export async function librarianSearch(
  storage: Storage,
  config: AimeatConfig,
  opts: { ownerName: string; fanOutOwner: boolean; viewerGaii: string; query: string; limit?: number; keyPrefix?: string; scope?: 'own' | 'public'; reader: ContentReader },
): Promise<{ hits: LibrarianHit[]; ownersSearched: number }> {
  const tokens = queryTokens(opts.query);
  if (tokens.length === 0) return { hits: [], ownersSearched: 0 };
  const limit = opts.limit ?? 50;

  let raw;
  let ownersSearched: number;
  if (opts.scope === 'public') {
    raw = await storage.searchText(opts.query, { visibility: 'public', keyPrefix: opts.keyPrefix, limit, maxFlags: 0 });
    ownersSearched = -1;   // public: the whole node, not a counted owner set
  } else {
    let ownerGaiis: string[];
    if (opts.fanOutOwner) {
      // The caller acts for the owner (owner session, or a grant with memory:read): search the owner's
      // full read surface — their GHII + every agent + every ecosystem app they own.
      const ghii = `${opts.ownerName}@${config.nodeId}`;
      const agents = await storage.getAgentsByOwner(opts.ownerName);
      const ecoApps = await storage.getEcosystemAppsByOwner(opts.ownerName);
      ownerGaiis = [ghii, ...agents.map(a => a.gaii), ...ecoApps.map(a => a.geai)];
    } else {
      ownerGaiis = [opts.viewerGaii];
    }
    raw = await storage.searchText(opts.query, { ownerGaiis, keyPrefix: opts.keyPrefix, limit, maxFlags: 0 });
    ownersSearched = ownerGaiis.length;
  }

  // ONE CAPABILITY, ONE DOOR: a Design Book part is public, and it is found and read through the
  // Design Book (its search, and GET /v1/designbook/:id), so no hit here is one.
  let candidates = raw.filter(({ record }) => !ownDoorRefusal(record.ownerGaii, record.key, config.nodeId));
  // The public scope is other accounts' public records: an organism's record among them reaches a
  // viewer outside that organism only when its label lets it leave (TARGET-082 review, item 1).
  if (opts.scope === 'public') {
    const carried = new Set((await organismKeysCarried({ storage, config }, candidates.map(h => h.record), opts.viewerGaii)).kept);
    candidates = candidates.filter(h => carried.has(h.record));
  }
  // The one presentation of memory values (classification reader + credential mask, TARGET-082).
  const scoreOf = new Map(candidates.map(h => [`${h.record.ownerGaii}\u0000${h.record.key}`, h.score]));
  const presented = await presentMemories(opts.reader, candidates.map(h => h.record));
  const hits: LibrarianHit[] = presented.map(record => ({ record, score: scoreOf.get(`${record.ownerGaii}\u0000${record.key}`) ?? 0 })).map(({ record, score }) => {
    const m = ORG_KEY.exec(record.key);
    const pkg = PKG_KEY.exec(record.key);
    const v = (record.value && typeof record.value === 'object') ? record.value as Record<string, unknown> : null;
    const isManifest = record.key.endsWith('/manifest') && !!pkg;
    const kind: LibrarianHit['kind'] = pkg ? 'knowledge' : m ? 'document' : 'memory';
    // A presented record: a credential's value is already its redacted form.
    const shown = record.value;
    const text = flatten(shown);
    return {
      key: record.key,
      ownerGaii: record.ownerGaii,
      title: isManifest && typeof v?.name === 'string' ? v.name : titleOf(shown, record.key),
      snippet: snippetOf(text, tokens),
      score,
      visibility: record.visibility,
      tags: record.tags,
      organismId: m?.[1],
      workspaceId: m?.[2],
      space: m?.[3],
      updatedAt: record.updatedAt,
      producer: record.ownerGaii,
      kind,
      packageId: pkg?.[1],
      contentType: isManifest && typeof v?.content_type === 'string' ? v.content_type : undefined,
    };
  });

  return { hits, ownersSearched };
}
