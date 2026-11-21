/**
 * @file src/services/content/risk-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the content risk marks are kept, beside the content and never in it.
 *
 *   WHAT A SUBJECT IS. Anything the three points mark: a person's memory record or stored file, a
 *   workspace document (a memory key `organism.<org>.w.<ws>.<space>.<id>.latest`), a workspace comment,
 *   a row of a workspace's row space, a direct message in a person's inbox, a board post, and a message
 *   to an agent. Its HOME is the person or the workspace whose rules apply (risk-settings.ts).
 *
 *   THREE RECORDS, MARKED ITEMS ONLY.
 *   - A person's file or memory record: the `risk` field of the item's facts in `contentclass.facts.NN`
 *     (facts-store.ts), with the other stages' facts. When the pipeline has not read the item, a facts
 *     entry with only the measure, the hash and the marks is written; the pipeline reads such an entry
 *     as fresh (it has no technical stage) and keeps the marks of the same hash.
 *   - A person's message, board post or agent message: `contentclass.risk`, one record per person.
 *   - A workspace's document, comment or row: `organism.<org>.w.<ws>.meta.contentrisk`, one record per
 *     workspace, held private by the node's own identity, under the workspace's prefix so it goes
 *     wherever the workspace's keys go; the `meta.` part keeps it out of the workspace read and search.
 *   No entry keeps words of the content: the excerpts are stripped before a write and built again on a
 *   read from the words the reader gets (risk-read.ts). A deleted item's entry is removed by its delete
 *   path (risk-keys.ts).
 *   An item with no marks stores nothing, and its earlier marks are removed. A record past
 *   RECORD_LIMIT_BYTES drops its oldest entries that are not held; a held entry is never dropped.
 *   Every write is on the version that was read (record-cas.ts / classes.ts updateOwnRecord).
 * @structure RiskSubject · RiskHome · homeOf · subjectIdOf · getRiskMarks · getRiskMarksMany · putRiskMarks ·
 *   listHeld · personRiskKey · workspaceRiskKey · RECORD_LIMIT_BYTES
 * @usage await putRiskMarks(deps, subject, marks, { mimeType: 'text/plain', size: 120 });
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { updateOwnRecord } from './classes.js';
import { shardKeyOf, sourceIdOf } from './facts-store.js';
import { workspaceDocOfKey, systemOwnerOf } from './shared-profile-key.js';
import { aiMarksOf } from './provenance-read.js';
import { personRiskKey, workspaceRiskKey } from './risk-keys.js';
import type { ContentFacts, ContentKind } from './types.js';
import type { RiskMarks } from './risk-types.js';

type Deps = { storage: Storage; config: AimeatConfig };

export type RiskSubject =
  | { kind: 'memory'; owner: string; key: string }
  | { kind: 'file'; owner: string; key: string }
  | { kind: 'comment'; org: string; ws: string; key: string }
  | { kind: 'row'; org: string; ws: string; space: string; id: string }
  | { kind: 'dm'; owner: string; id: string }
  | { kind: 'board'; owner: string; boardId: string; id: string }
  | { kind: 'agent-message'; owner: string; agent: string; id: string };

export type RiskHome = { kind: 'person'; owner: string } | { kind: 'workspace'; org: string; ws: string };

/** A record of this many bytes drops its oldest entries that are not held. */
export const RECORD_LIMIT_BYTES = 900 * 1024;

export { personRiskKey, workspaceRiskKey };

/** The marks as kept: without the excerpts, which the read helper builds again from the words in hand. */
function bare(m: RiskMarks): RiskMarks {
  return { ...m, marks: m.marks.map((x) => ({ ...x, excerpt: '' })) };
}

/** Whose rules apply: a workspace for its documents, comments and rows; otherwise the person. */
export function homeOf(subject: RiskSubject): RiskHome {
  if (subject.kind === 'comment' || subject.kind === 'row') return { kind: 'workspace', org: subject.org, ws: subject.ws };
  if (subject.kind === 'memory') {
    const at = workspaceDocOfKey(subject.key);
    if (at) return { kind: 'workspace', org: at.organismId, ws: at.ws };
  }
  return { kind: 'person', owner: ownerGhiiOf(subject.owner) };
}

/** The id an item's marks are kept under in its record. */
export function subjectIdOf(subject: RiskSubject): string {
  switch (subject.kind) {
    case 'memory': return workspaceDocOfKey(subject.key) ? `memory:${subject.key}` : sourceIdOf(subject);
    case 'file': return sourceIdOf(subject);
    case 'comment': return `comment:${subject.key}`;
    // `space` is the space's namespace (row-service.ts appendRows answers it), so a bulk removal of a
    // space's rows can find their entries (risk-keys.ts pruneRowRiskEntries).
    case 'row': return `row:${subject.space}:${subject.id}`;
    case 'dm': return `dm:${subject.id}`;
    case 'board': return `board:${subject.boardId}:${subject.id}`;
    case 'agent-message': return `agent-message:${subject.agent}:${subject.id}`;
  }
}

/** A person's own memory record or file: kept in the facts shards. */
const inFacts = (s: RiskSubject): s is Extract<RiskSubject, { kind: 'memory' | 'file' }> =>
  (s.kind === 'memory' || s.kind === 'file') && homeOf(s).kind === 'person';

interface Items { v: 1; items: Record<string, RiskMarks> }
const parseItems = (v: unknown): Items => {
  const items = v && typeof v === 'object' && (v as Items).items && typeof (v as Items).items === 'object' ? (v as Items).items : {};
  return { v: 1, items: { ...items } };
};

function recordOf(deps: Deps, subject: RiskSubject): { owner: string; key: string } {
  const home = homeOf(subject);
  return home.kind === 'workspace'
    ? { owner: systemOwnerOf(deps.config.nodeId), key: workspaceRiskKey(home.org, home.ws) }
    : { owner: home.owner, key: personRiskKey };
}

const isMarks = (v: unknown): v is RiskMarks => !!v && typeof v === 'object' && (v as RiskMarks).v === 1 && Array.isArray((v as RiskMarks).marks);

/** One item's stored marks, or null. */
export async function getRiskMarks(deps: Deps, subject: RiskSubject): Promise<RiskMarks | null> {
  if (inFacts(subject)) {
    const sourceId = sourceIdOf(subject);
    const rec = await deps.storage.getMemory(ownerGhiiOf(subject.owner), shardKeyOf(sourceId));
    const f = (rec?.value as { items?: Record<string, ContentFacts> } | undefined)?.items?.[sourceId];
    return isMarks(f?.risk) ? f!.risk! : null;
  }
  const { owner, key } = recordOf(deps, subject);
  const m = parseItems((await deps.storage.getMemory(owner, key))?.value).items[subjectIdOf(subject)];
  return isMarks(m) ? m : null;
}

/** Many items' stored marks, one read per record they live in. */
export async function getRiskMarksMany(deps: Deps, subjects: readonly RiskSubject[]): Promise<Array<RiskMarks | null>> {
  const byRecord = new Map<string, { owner: string; key: string }>();
  const where = subjects.map((s) => {
    const r = inFacts(s) ? { owner: ownerGhiiOf(s.owner), key: shardKeyOf(sourceIdOf(s)) } : recordOf(deps, s);
    const id = `${r.owner}\u0000${r.key}`;
    byRecord.set(id, r);
    return id;
  });
  const values = new Map<string, unknown>();
  await Promise.all([...byRecord].map(async ([id, r]) => { values.set(id, (await deps.storage.getMemory(r.owner, r.key))?.value); }));
  return subjects.map((s, i) => {
    const v = values.get(where[i]) as { items?: Record<string, unknown> } | undefined;
    const entry = v?.items?.[inFacts(s) ? sourceIdOf(s) : subjectIdOf(s)];
    const m = inFacts(s) ? (entry as ContentFacts | undefined)?.risk : entry;
    return isMarks(m) ? m : null;
  });
}

const KIND_OF_MIME = (mime: string): ContentKind =>
  mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? 'image' : mime.startsWith('video/') || mime.startsWith('audio/') ? 'video'
    : mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') ? 'text' : 'other';

/** Drop the entries whose content expired, then the oldest entries that are not held until the record fits. */
function fit(items: Record<string, RiskMarks>): void {
  const now = new Date().toISOString();
  for (const [id, m] of Object.entries(items)) if (m.expiresAt && m.expiresAt < now) delete items[id];
  const size = () => Buffer.byteLength(JSON.stringify({ v: 1, items }), 'utf8');
  if (size() <= RECORD_LIMIT_BYTES) return;
  const oldest = Object.entries(items).filter(([, m]) => m.hold?.status !== 'held').sort((a, b) => (a[1].at < b[1].at ? -1 : 1));
  for (const [id] of oldest) {
    delete items[id];
    if (size() <= RECORD_LIMIT_BYTES) return;
  }
}

/**
 * Keep an item's marks, or remove them (`marks` null). `measure` describes the item for a facts entry
 * written for marks alone.
 */
export async function putRiskMarks(
  deps: Deps, subject: RiskSubject, given: RiskMarks | null, measure: { mimeType: string; size: number } = { mimeType: 'text/plain', size: 0 },
): Promise<void> {
  const marks = given ? bare(given) : null;
  if (inFacts(subject)) {
    const ownerGhii = ownerGhiiOf(subject.owner);
    const sourceId = sourceIdOf(subject);
    const writer = { principal: ownerGhii, ownerGhii, scopes: [] as string[], roles: ['owner'] };
    await updateOwnRecord(deps, writer, shardKeyOf(sourceId), (cur) => {
      const shard = { v: 1, items: { ...((cur as { items?: Record<string, ContentFacts> } | undefined)?.items ?? {}) } };
      const f = shard.items[sourceId];
      if (!marks) {
        if (!f?.risk) return UNCHANGED;
        const rest = { ...f };
        delete rest.risk;
        shard.items[sourceId] = rest;
        return shard;
      }
      const now = new Date().toISOString();
      shard.items[sourceId] = f
        ? { ...f, risk: marks, stages: { ...f.stages, risk: { at: now, ok: true } } }
        : {
          source: { kind: subject.kind, owner: subject.owner, key: subject.key }, sourceId,
          technical: {
            kind: subject.kind === 'memory' ? 'text' : KIND_OF_MIME(measure.mimeType), mimeType: measure.mimeType, size: measure.size,
            contentHash: marks.contentHash, ai: aiMarksOf({ nodeRecord: null }),
          },
          stages: { risk: { at: now, ok: true } }, readFrom: marks.contentHash, updatedAt: now, risk: marks,
        };
      return shard;
    });
    return;
  }
  const { owner, key } = recordOf(deps, subject);
  const id = subjectIdOf(subject);
  await updateRecord(deps.storage, owner, key, parseItems, (cur) => {
    if (!marks) {
      if (!(id in cur.items)) return UNCHANGED;
      delete cur.items[id];
      fit(cur.items);
      return cur;
    }
    cur.items[id] = marks;
    fit(cur.items);
    return cur;
  }, { tag: 'contentrisk', visibility: 'private' });
}

/** Every held entry of one record, with its id. For the approver's list. */
export async function listHeld(storage: Storage, owner: string, key: string): Promise<Array<{ id: string; marks: RiskMarks }>> {
  const rec: MemoryRecord | null = await storage.getMemory(owner, key);
  return Object.entries(parseItems(rec?.value).items)
    .filter(([, m]) => isMarks(m) && m.hold?.status === 'held')
    .map(([id, marks]) => ({ id, marks }));
}
