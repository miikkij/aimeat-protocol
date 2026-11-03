/**
 * @file src/services/content/shared-profile.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workspace document's fingerprint is one, shared, and kept with the document on the
 *   organism side (decision decision-sormenj-lki-yksi-yhteinen-per-ty-tilan-asiakirja-sama-lukulu,
 *   Jouni 2026-11-03; wish wish-sormenj-lki-jaetuksi-yksi-per-ty-tilan-asiakirja-ja-ty-tilan).
 *
 *   WHERE IT LIVES. One record per document, keyed by shared-profile-key.ts and held private by the
 *   node's own identity. It carries the compact profile and its sections together (a document has
 *   at most 24 sections, a few kilobytes), who made it, and which words it was made from (the
 *   sha256 of the document's text, and the version that was published then).
 *
 *   WHO SEES IT. Whoever may read the document: the workspace read gate GET /v1/organisms/:id/
 *   workspace asks (decideWorkspaceRead: membership, the manifest, the ecosystem allowlist), then the
 *   classification reader on the document's own record. A reader who may not read the document
 *   gets NOT_FOUND, the answer a document that does not exist gets. The fingerprint tells less than
 *   the document, so the same permission lets out nothing new.
 *
 *   WHO MAKES IT AND PAYS. Whoever asks (POST /v1/content/inspect, aimeat_content_inspect), on their
 *   own AI key and their own fingerprint model. A reader makes a missing or stale one; making a
 *   CURRENT one again replaces it for everyone, so that takes the right to edit the document, and so
 *   does a correction. A person's correction wins: a later run on the same words keeps it.
 *
 *   STALE. A new publication changes the document's words, so the fingerprint's `readFrom` no
 *   longer matches: it is answered with `stale: true` and stays visible until someone makes it
 *   again. It goes when the document goes (services/workspace-write.ts deleteWorkspaceInstance) and
 *   with the workspace, being under its prefix; a listing drops one whose document is gone.
 *
 *   THE READERS' OWN EARLIER ONES. Before 2026-11-03 a workspace document's fingerprint was kept in
 *   the facts of whoever made it. When that person next reads the document or lists its workspace
 *   and no shared one exists, theirs becomes the shared one and leaves their own facts (a move, on
 *   positive evidence: they made it, and they may read the document now).
 * @structure SharedProfile · SharedMeta · isWorkspaceDocKey · openWorkspaceDoc · sharedViewFor ·
 *   makeSharedProfile · correctSharedProfile · listSharedProfiles
 * @usage const view = await sharedViewFor(deps, caller, 'organism.o.w.ws.shared.notes.doc-1.latest', true);
 * @version-history
 *   v1.0.0 — 2026-11-03 — Initial.
 */
import { createHash } from 'node:crypto';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { decideWorkspaceRead } from '../workspace-access.js';
import { findWorkspaceRecord } from '../workspace-write.js';
import { instanceFromKey } from '../workspace-record-key.js';
import { loadWorkspaceContent } from '../workspace-content.js';
import { checkOrganismNamespaceAccess } from '../organism-namespace-access.js';
import { readerFor, systemReader, type ContentReader } from '../classification/reader.js';
import { memoryTarget, ClassificationError } from '../classification/labels.js';
import { aiCallerFromCredential, OWNER_CALLER } from '../ai/caller-context.js';
import { emitWorkspaceChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { ContentError, memoryValueText } from './pipeline.js';
import { measureText } from './extract-text.js';
import { aiMarksOf } from './provenance-read.js';
import { getFacts, putFacts, getProfileDetail, deleteProfileDetail, listFacts, sourceIdOf } from './facts-store.js';
import { profileItem, keepCorrections, correctSections, fingerprintTag, MIN_PROFILE_CHARS } from './profile.js';
import { readSettings } from './settings.js';
import type { StageCtx, StageItem } from './ai-stages.js';
import { workspaceDocOfKey, sharedProfileKeyOf, sharedProfilePrefixOf, systemOwnerOf } from './shared-profile-key.js';
import type { ContentFacts, ContentProfile, ProfileSection, StageName, TechnicalFacts } from './types.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** The stored shared fingerprint of one workspace document. */
export interface SharedProfile {
  v: 1;
  doc: { organismId: string; ws: string; namespace: string; id: string; key: string };
  /** sha256 of the document's text it was made from, "sha256:<hex>". */
  readFrom: string;
  /** The document's version when it was made; 0 when that is not known (a moved earlier one). */
  docVersion: number;
  /** The compact profile, without detailKey; `corrected` names a person's correction. */
  profile: ContentProfile;
  sections: ProfileSection[];
  /** Who asked for it (and paid): a GHII or an agent's GAII. */
  madeBy: string;
  madeAt: string;
}

/** What a reader is told about the shared fingerprint beside the profile itself. */
export interface SharedMeta {
  stale: boolean;
  made_by: string;
  made_at: string;
  doc_version: number;
  read_from: string;
  corrected_by?: string;
  corrected_at?: string;
}

interface OpenedDoc {
  organismId: string;
  ws: string;
  namespace: string;
  id: string;
  key: string;
  record: MemoryRecord;
  text: string;
  hash: string;
  title: string;
  sharedKey: string;
  reader: ContentReader;
}

const notFound = (key: string) => new ContentError('NOT_FOUND', 404, `No workspace document you may read is stored as "${key}".`);
const hashText = (t: string): string => `sha256:${createHash('sha256').update(t, 'utf8').digest('hex')}`;
const namespacesOf = (manRec: MemoryRecord | null): string[] =>
  (((manRec?.value as { objectTypes?: Array<{ namespace?: unknown }> } | null)?.objectTypes) ?? [])
    .map((o) => o?.namespace).filter((n): n is string => typeof n === 'string' && !!n);
const isWords = (v: unknown): boolean => typeof v === 'string'
  || (!!v && typeof v === 'object' && typeof (v as { markdown?: unknown }).markdown === 'string');

function parseShared(v: unknown): SharedProfile | null {
  const s = v as SharedProfile | null;
  return s && typeof s === 'object' && s.v === 1 && !!s.profile && Array.isArray(s.sections) && typeof s.readFrom === 'string' && !!s.doc ? s : null;
}

/** True for the key of a published workspace document (`organism.<org>.w.<ws>.<namespace>.<id>.latest`). */
export function isWorkspaceDocKey(key: string): boolean { return !!workspaceDocOfKey(key); }

function opened(at: { organismId: string; ws: string }, inst: { namespace: string; instance: string }, key: string, rec: MemoryRecord, reader: ContentReader): OpenedDoc {
  const text = memoryValueText(rec.value);
  const t = (rec.value as { title?: unknown } | null)?.title;
  return {
    organismId: at.organismId, ws: at.ws, namespace: inst.namespace, id: inst.instance, key, record: rec, text,
    hash: hashText(text), title: typeof t === 'string' && t.trim() ? t.trim() : inst.instance,
    sharedKey: sharedProfileKeyOf(at.organismId, at.ws, inst.namespace, inst.instance), reader,
  };
}

/**
 * The published document at `key`, when this caller may read it: the workspace read gate, then the
 * classification reader on the document's record. Anything else is NOT_FOUND.
 */
export async function openWorkspaceDoc(deps: Deps, caller: CallerContext, key: string, reader?: ContentReader): Promise<OpenedDoc> {
  const at = workspaceDocOfKey(key);
  if (!at) throw notFound(key);
  const organism = await deps.storage.getOrganism(at.organismId);
  if (!organism) throw notFound(key);
  const decision = await decideWorkspaceRead(deps.storage, deps.config, organism, caller.auth.sub, caller.owner, caller.principal, at.ws);
  if (!decision.canRead) throw notFound(key);
  const inst = instanceFromKey(`organism.${at.organismId}.w.${at.ws}`, namespacesOf(decision.manRec), key);
  if (!inst) throw notFound(key);
  const rec = await findWorkspaceRecord(deps.storage, key);
  if (!rec || rec.archived) throw notFound(key);
  const r = reader ?? readerFor(deps, caller.auth);
  const [shown] = await r.show([rec], (x) => memoryTarget(x.ownerGaii, x.key));
  if (!shown) throw notFound(key);
  return opened(at, inst, key, shown, r);
}

async function getShared(deps: Deps, key: string): Promise<SharedProfile | null> {
  return parseShared((await deps.storage.getMemory(systemOwnerOf(deps.config.nodeId), key))?.value);
}

/** Store `next` as the document's shared fingerprint; `onlyIfAbsent` keeps one that is there. */
async function putShared(deps: Deps, key: string, next: SharedProfile, onlyIfAbsent = false): Promise<SharedProfile> {
  return (await updateRecord(deps.storage, systemOwnerOf(deps.config.nodeId), key, parseShared,
    (cur) => (onlyIfAbsent && cur ? UNCHANGED : next), { tag: 'contentclass', visibility: 'private' })) ?? next;
}

function metaOf(s: SharedProfile, hash: string): SharedMeta {
  return {
    stale: s.readFrom !== hash, made_by: s.madeBy, made_at: s.madeAt, doc_version: s.docVersion, read_from: s.readFrom,
    ...(s.profile.corrected ? { corrected_by: s.profile.corrected.by, corrected_at: s.profile.corrected.at } : {}),
  };
}

function technicalOf(d: OpenedDoc): TechnicalFacts {
  return {
    kind: 'text', mimeType: typeof d.record.value === 'string' ? 'text/plain' : 'application/json',
    size: Buffer.byteLength(d.text, 'utf8'), contentHash: d.hash, text: measureText(d.text, 'memory'), ai: aiMarksOf({ nodeRecord: null }),
  };
}

/** The caller's own facts of the document, when they have any (stored under them or their account). */
async function ownFactsOf(deps: Deps, caller: CallerContext, key: string): Promise<ContentFacts | null> {
  for (const owner of [...new Set([caller.principal, caller.ownerGhii])]) {
    const f = await getFacts(deps.storage, caller.ownerGhii, sourceIdOf({ kind: 'memory', owner, key }));
    if (f) return f;
  }
  return null;
}

/** The facts a reader is answered with: their own with the shared profile in it, or what the document says. */
function factsOf(d: OpenedDoc, shared: SharedProfile | null, own: ContentFacts | null): ContentFacts {
  if (own) {
    const rest: ContentFacts = { ...own };
    delete rest.profile;
    return shared ? { ...rest, profile: shared.profile } : rest;
  }
  const source = { kind: 'memory' as const, owner: d.record.ownerGaii, key: d.key };
  return {
    source, sourceId: sourceIdOf(source), technical: technicalOf(d),
    stages: shared ? { profile: { at: shared.madeAt, ok: true } } : {},
    readFrom: shared?.readFrom ?? d.hash, updatedAt: shared?.madeAt ?? d.record.updatedAt,
    ...(shared ? { profile: shared.profile } : {}),
  };
}

/**
 * The caller's own earlier fingerprint of the document becomes the shared one when there is none
 * yet, and leaves their facts. Never throws: a move that fails leaves both as they were.
 */
async function moveOwn(deps: Deps, caller: CallerContext, d: OpenedDoc, own: ContentFacts | null): Promise<SharedProfile | null> {
  if (!own?.profile?.detailKey) return null;
  try {
    const sections = await getProfileDetail(deps.storage, caller.ownerGhii, own.profile.detailKey);
    if (!sections) return null;
    const { detailKey, ...profile } = own.profile;
    const stored = await putShared(deps, d.sharedKey, {
      v: 1, doc: { organismId: d.organismId, ws: d.ws, namespace: d.namespace, id: d.id, key: d.key },
      readFrom: own.readFrom, docVersion: own.readFrom === d.hash ? d.record.version : 0,
      profile, sections, madeBy: caller.principal, madeAt: own.profile.at,
    }, true);
    const writer = { principal: caller.ownerGhii, ownerGhii: caller.ownerGhii, scopes: [] as string[], roles: ['owner'] };
    const rest: ContentFacts = { ...own, stages: { ...own.stages }, updatedAt: new Date().toISOString() };
    delete rest.profile;
    delete rest.stages.profile;
    await putFacts(deps, writer, rest);
    await deleteProfileDetail(deps, caller.ownerGhii, detailKey);
    logger.info('contentclass: a reader\'s own fingerprint of a workspace document became the shared one', { key: d.key });
    return stored;
  } catch (err) {
    logger.warn('contentclass: a reader\'s own fingerprint was not moved to the shared one; both stay as they were', { key: d.key, error: String((err as Error)?.message ?? err) });
    return null;
  }
}

/** May the caller edit the document: the write rule of its draft, the key an edit writes. */
async function mayEdit(deps: Deps, caller: CallerContext, key: string): Promise<boolean> {
  const refusal = await checkOrganismNamespaceAccess(deps,
    { principal: caller.principal, owner: caller.owner, roles: [...caller.roles], scopes: [...caller.scopes] },
    key.replace(/\.latest$/, '.draft'), 'write');
  return !refusal;
}

export interface SharedView {
  facts: ContentFacts;
  fingerprint?: ReturnType<typeof fingerprintTag>;
  profile_sections?: ProfileSection[] | null;
  shared?: SharedMeta;
}

/** One workspace document's facts as a reader sees them, with the shared fingerprint. NOT_FOUND when there is nothing. */
export async function sharedViewFor(deps: Deps, caller: CallerContext, key: string, withProfile: boolean): Promise<SharedView> {
  const d = await openWorkspaceDoc(deps, caller, key);
  const own = await ownFactsOf(deps, caller, key);
  const shared = (await getShared(deps, d.sharedKey)) ?? (await moveOwn(deps, caller, d, own));
  const ownNow = shared && own?.profile ? await ownFactsOf(deps, caller, key) : own;
  if (!shared) {
    if (!ownNow) throw new ContentError('NOT_FOUND', 404, `"${key}" has no fingerprint yet, and nothing has been read from it. Make one with aimeat_content_inspect { stages: ["profile"] }.`);
    return { facts: factsOf(d, null, ownNow) };
  }
  return {
    facts: factsOf(d, shared, ownNow), fingerprint: fingerprintTag(shared.profile),
    ...(withProfile ? { profile_sections: shared.sections } : {}), shared: metaOf(shared, d.hash),
  };
}

export interface SharedInspect {
  facts: ContentFacts;
  ran: StageName[];
  skipped: Partial<Record<StageName, string>>;
  proposals: [];
  shared?: SharedMeta;
}

/**
 * Make the document's shared fingerprint, on the caller's AI key. A current one is answered as it
 * is unless `force`, and `force` on a current one takes the right to edit the document.
 * `automatic`: the arrival hook, with the publisher as the caller and their settings.
 */
export async function makeSharedProfile(
  deps: Deps, caller: CallerContext, key: string, opts: { force?: boolean; automatic?: boolean; appRef?: string } = {},
): Promise<SharedInspect> {
  const automatic = opts.automatic === true;
  const d = await openWorkspaceDoc(deps, caller, key, automatic ? systemReader(deps, caller.ownerGhii) : undefined);
  const own = await ownFactsOf(deps, caller, key);
  const existing = (await getShared(deps, d.sharedKey)) ?? (await moveOwn(deps, caller, d, own));
  const skipped: Partial<Record<StageName, string>> = {};
  const answer = async (s: SharedProfile | null, ran: StageName[] = []): Promise<SharedInspect> => ({
    facts: factsOf(d, s, s && own?.profile ? await ownFactsOf(deps, caller, key) : own),
    ran, skipped, proposals: [], ...(s ? { shared: metaOf(s, d.hash) } : {}),
  });

  const current = !!existing && existing.readFrom === d.hash;
  if (current && !opts.force) {
    skipped.profile = 'This version of the document already has its fingerprint.';
    return answer(existing);
  }
  if (current && !(await mayEdit(deps, caller, key))) {
    throw new ContentError('ACCESS_DENIED', 403, 'This version of the document already has a fingerprint, and making it again replaces it for everyone who reads the document. Only someone who may edit the document does that.');
  }
  if (d.text.trim().length < MIN_PROFILE_CHARS) {
    skipped.profile = 'too few words to profile';
    return answer(existing);
  }
  try {
    await d.reader.useForAi([memoryTarget(d.record.ownerGaii, d.key)], { capability: 'contentclass' });
  } catch (err) {
    if (!(err instanceof ClassificationError)) throw err;
    skipped.profile = `${err.code}: ${err.message}`;
    return answer(existing);
  }

  const settings = await readSettings(deps.storage, caller.ownerGhii);
  const ctx: StageCtx = {
    deps, ownerGhii: caller.ownerGhii, principal: automatic ? caller.ownerGhii : caller.principal, isOwner: automatic || caller.inPerson,
    ai: automatic ? OWNER_CALLER : aiCallerFromCredential({ roles: caller.roles, app: opts.appRef ?? null }, caller.principal),
    ...(opts.appRef ? { appRef: opts.appRef } : {}), settings,
  };
  const item: StageItem = {
    sourceId: `memory:${key}`, kind: 'text', mimeType: technicalOf(d).mimeType, text: d.text, filename: d.title, technical: technicalOf(d),
  };
  let made: { profile: ContentProfile; sections: ProfileSection[] };
  try {
    made = await profileItem(ctx, item, d.title, item.sourceId);
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    skipped.profile = `${e.code ? `${String(e.code)}: ` : ''}${String(e.message ?? err)}`.slice(0, 500);
    logger.info('contentclass: the shared fingerprint was not made', { key, error: skipped.profile });
    return answer(existing);
  }
  if (current && existing) made = keepCorrections(existing, made);
  const stored = await putShared(deps, d.sharedKey, {
    v: 1, doc: { organismId: d.organismId, ws: d.ws, namespace: d.namespace, id: d.id, key },
    readFrom: d.hash, docVersion: d.record.version, profile: made.profile, sections: made.sections,
    madeBy: automatic ? caller.ownerGhii : caller.principal, madeAt: made.profile.at,
  });
  emitWorkspaceChange(d.organismId, d.ws);
  return answer(stored, ['profile']);
}

/** A person corrects sections of the shared fingerprint; it takes the right to edit the document. */
export async function correctSharedProfile(deps: Deps, caller: CallerContext, key: string, asked: unknown): Promise<SharedView> {
  const d = await openWorkspaceDoc(deps, caller, key);
  const own = await ownFactsOf(deps, caller, key);
  const shared = (await getShared(deps, d.sharedKey)) ?? (await moveOwn(deps, caller, d, own));
  if (!shared) throw new ContentError('NOT_FOUND', 404, `"${key}" has no fingerprint to correct yet.`);
  if (!(await mayEdit(deps, caller, key))) {
    throw new ContentError('ACCESS_DENIED', 403, 'Correcting the fingerprint changes it for everyone who reads the document, so it takes the right to edit the document.');
  }
  let c: { profile: ContentProfile; sections: ProfileSection[] };
  try {
    c = correctSections(shared.profile, shared.sections, asked, caller.principal);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'INVALID_INPUT') throw new ContentError('INVALID_INPUT', 400, String(e.message));
    throw err;
  }
  const stored = await putShared(deps, d.sharedKey, { ...shared, profile: c.profile, sections: c.sections });
  emitWorkspaceChange(d.organismId, d.ws);
  return { facts: factsOf(d, stored, await ownFactsOf(deps, caller, key)), fingerprint: fingerprintTag(stored.profile), profile_sections: stored.sections, shared: metaOf(stored, d.hash) };
}

/** One document of a workspace listing: the compact profile, without its sections. */
export interface SharedListItem {
  key: string;
  namespace: string;
  id: string;
  title: string;
  version: number;
  updated_at: string;
  profile: ContentProfile | null;
  stale: boolean | null;
  made_by: string | null;
  corrected_by: string | null;
}

const fresher = (a: MemoryRecord, b: MemoryRecord): boolean => (a.version !== b.version ? a.version > b.version : a.updatedAt > b.updatedAt);

/**
 * The documents of one workspace under `prefix` (`organism.<org>.w.<ws>.` or a longer one), each
 * with its shared fingerprint or null, in key order. `hasProfile` keeps only those with (true) or
 * without (false) one. The read gate is the workspace read's; `after` is the previous page's `next`.
 */
export async function listSharedProfiles(
  deps: Deps, caller: CallerContext, prefix: string, opts: { hasProfile?: boolean; limit?: number; after?: string } = {},
): Promise<{ items: SharedListItem[]; total: number; next?: string }> {
  const m = /^organism\.([^.]+)\.w\.([^.]+)\./.exec(prefix);
  if (!m) throw new ContentError('INVALID_INPUT', 400, 'A workspace prefix is organism.<organism id>.w.<workspace id>. (one workspace a call), optionally followed by a namespace.');
  const [organismId, ws] = [m[1], m[2]];
  const reader = readerFor(deps, caller.auth);
  const got = await loadWorkspaceContent(deps, reader, { sub: caller.auth.sub, ownerName: caller.owner, accessorGaii: caller.principal }, { organismId, ws });
  if (!got.ok) throw new ContentError(got.code, got.status, got.message);
  if (!got.canRead) throw new ContentError('ACCESS_DENIED', 403, 'You may not read this workspace.');
  const root = `organism.${organismId}.w.${ws}`;
  const namespaces = namespacesOf(got.manRec);
  const docs = new Map<string, { rec: MemoryRecord; inst: { namespace: string; instance: string } }>();
  for (const r of got.items) {
    if (!r.key.startsWith(prefix) || r.archived || !workspaceDocOfKey(r.key) || !isWords(r.value)) continue;
    const inst = instanceFromKey(root, namespaces, r.key);
    if (!inst) continue;
    const prev = docs.get(r.key);
    if (!prev || fresher(r, prev.rec)) docs.set(r.key, { rec: r, inst });
  }
  const sharedRows = (await deps.storage.listAllMemory({ prefix: sharedProfilePrefixOf(organismId, ws), limit: 5000 })).items
    .filter((r) => r.ownerGaii === systemOwnerOf(deps.config.nodeId));
  const byDoc = new Map<string, SharedProfile>();
  for (const r of sharedRows) {
    const s = parseShared(r.value);
    if (!s) continue;
    if (docs.has(s.doc.key)) { byDoc.set(s.doc.key, s); continue; }
    // A fingerprint whose document is gone goes too (services/workspace-write.ts removes it on a
    // delete; this catches any other way a document leaves); an archived document keeps its own.
    if (!s.doc.key.startsWith(prefix)) continue;
    void findWorkspaceRecord(deps.storage, s.doc.key).then((doc) => (doc ? undefined : deps.storage.deleteMemory(r.ownerGaii, r.key)))
      .catch((err: unknown) => logger.warn('contentclass: a fingerprint whose document is gone was not removed', { key: r.key, error: String(err) }));
  }
  // The caller's own earlier fingerprints of documents that have no shared one yet move over.
  const own = await listFacts(deps.storage, caller.ownerGhii, { keyPrefix: prefix, hasProfile: true, limit: 1000 });
  for (const f of own.items) {
    const doc = docs.get(f.source.key);
    if (!doc || byDoc.has(f.source.key) || (f.source.owner !== caller.principal && f.source.owner !== caller.ownerGhii)) continue;
    const moved = await moveOwn(deps, caller, opened({ organismId, ws }, doc.inst, f.source.key, doc.rec, reader), f);
    if (moved) byDoc.set(f.source.key, moved);
  }

  const all: SharedListItem[] = [...docs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, { rec, inst }]) => {
    const s = byDoc.get(key) ?? null;
    const t = (rec.value as { title?: unknown } | null)?.title;
    return {
      key, namespace: inst.namespace, id: inst.instance, title: typeof t === 'string' && t.trim() ? t.trim() : inst.instance,
      version: rec.version, updated_at: rec.updatedAt, profile: s?.profile ?? null,
      stale: s ? s.readFrom !== hashText(memoryValueText(rec.value)) : null,
      made_by: s?.madeBy ?? null, corrected_by: s?.profile.corrected?.by ?? null,
    };
  }).filter((i) => opts.hasProfile === undefined || (i.profile !== null) === opts.hasProfile);
  const limit = Math.min(1000, Math.max(1, Math.floor(opts.limit ?? 100)));
  const start = opts.after && /^\d+$/.test(opts.after) ? Number(opts.after) : 0;
  const items = all.slice(start, start + limit);
  return { items, total: all.length, ...(start + limit < all.length ? { next: String(start + limit) } : {}) };
}
