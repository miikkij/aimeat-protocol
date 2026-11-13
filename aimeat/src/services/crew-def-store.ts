/**
 * @file crew-def-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a JSON crew definition lives on the node, and the one publish sequence every
 *   door shares. A crew definition (crewaimeat `crew_def.py` shape — agents, tasks, a fixed tool
 *   menu, an LLM profile) is DATA the fleet interprets; the node never runs it and never validates
 *   its rules (that is the fleet's validator, asked over the tunnel — see routes/agent-crew.ts).
 *   What the node does own is the storage contract the fleet reads:
 *     - `crews.registry.<agent>`            the LIVE definition, the one key the fleet and
 *                                            crewaimeat's crew_registry.py read (unchanged shape:
 *                                            { version: 1, publishedAt, agent_name, doc } plus
 *                                            `revision` and `publishedBy`)
 *     - `crews.registry.<agent>.version.N`  one full copy per published revision, last 10 kept
 *     - `crews.registry.<agent>.draft`      the owner's unpublished edits, so they survive a reload
 *     - `crews.runtime.<agent>`             written by the RUNTIME when it loads a revision — the
 *                                            only way to see whether a publish is actually in force
 *   All in the AGENT's namespace with owner visibility, which is where the Python side already
 *   writes and reads. Versioning follows workspace records (`.version.N` copies, value-free
 *   enumeration from services/workspace/versions.ts) rather than a second scheme.
 * @structure
 *   - crewKeysFor() / CREW_VERSION_WINDOW — the key contract
 *   - crewSitesWriteRefusal() / misdirectedCrewKey() — re-exported from crews/def-envelope.ts
 *   - readCrewState() — everything the Crew tab shows, in one read
 *   - saveCrewDraft() / discardCrewDraft()
 *   - publishCrewDef() — snapshot, write live, drop the draft, prune, wake the runtime
 *   - readCrewRevision() — one historic copy, for restore
 * @usage
 *   const state = await readCrewState(storage, agent);
 *   const out = await publishCrewDef({ storage, config }, caller, agent, doc);
 * @version-history
 *   2026-11-13 — The envelope (CrewDefEnvelope, unwrapEnvelope), misdirectedCrewKey and
 *     crewSitesWriteRefusal moved unchanged to crews/def-envelope.ts and are re-exported here, which
 *     ends the import cycle with memory-write.ts (structure programme 2026-11, unit 4).
 *   2026-11-04 — No per-key getMemory for a storage without getMemoryByKeys: it is required on Storage
 *     (codebase analysis 2026-11-03, item D-e).
 *   2026-10-19 — publishCrewDef claims its revision by creating the history copy (expectedVersion 0)
 *     and writes the live key on the version it read, so two publishes at once take two revisions
 *     (wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j).
 *   2026-10-16 — crewSitesWriteRefusal(): a memory write of the live definition that changes its
 *     browser site list is the owner's in person, as on the crew routes (QA audit F07b-02).
 *   v1.1.0 — 2026-08-28 — misdirectedCrewKey(): the one rule every memory door applies so a crews.*
 *     key cannot land in the wrong principal's namespace (a chat session writing json-demo's
 *     definition under its own name — found in production, hidden for a day).
 *   v1.0.0 — 2026-08-28 — Initial (JSON-agent Crew tab, node side).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { writeMemoryRecord, type MemoryWriteResult } from './memory-write.js';
import { listVersionRefs, versionNumberOf } from './workspace/versions.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { logger } from '../utils/logger.js';
import { ENVELOPE_VERSION, asObject, unwrapEnvelope, type CrewDefEnvelope } from './crews/def-envelope.js';

// The envelope and the two write rules live in crews/def-envelope.ts, which memory-write.ts imports
// without importing this file; re-exported here for every importer of this file.
export { misdirectedCrewKey, crewSitesWriteRefusal, type CrewDefEnvelope } from './crews/def-envelope.js';

export const CREW_REGISTRY_PREFIX = 'crews.registry.';
export const CREW_RUNTIME_PREFIX = 'crews.runtime.';
/** How many published revisions stay readable behind the live one. */
export const CREW_VERSION_WINDOW = 10;
/** How many times a publish reads again after another publish took its revision or wrote the live key. */
const PUBLISH_ATTEMPTS = 10;

export interface CrewKeys { base: string; draft: string; runtime: string }

export function crewKeysFor(agentName: string): CrewKeys {
  const base = `${CREW_REGISTRY_PREFIX}${agentName}`;
  return { base, draft: `${base}.draft`, runtime: `${CREW_RUNTIME_PREFIX}${agentName}` };
}

export interface CrewDraft { doc: Record<string, unknown>; savedAt: string }
export interface CrewRevisionRef { revision: number; publishedAt: string | null }

export interface CrewState {
  published: CrewDefEnvelope | null;
  draft: CrewDraft | null;
  versions: CrewRevisionRef[];
  /** Whatever the runtime last wrote at `crews.runtime.<agent>`; the node does not shape it. */
  runtime: Record<string, unknown> | null;
}

export interface CrewWriteDeps { storage: Storage; config: AimeatConfig }

/** Who is writing, in the terms the shared memory writer needs. */
export interface CrewWriteCaller {
  principal: string;
  scopes: string[];
  roles: string[];
  pipeline: string;
}

/** One read of everything the Crew tab renders. Version rows are enumerated value-free. */
export async function readCrewState(storage: Storage, agent: AgentRecord): Promise<CrewState> {
  const keys = crewKeysFor(agent.name);
  const [live, draftRec, runtimeRec, refs] = await Promise.all([
    storage.getMemory(agent.gaii, keys.base),
    storage.getMemory(agent.gaii, keys.draft),
    storage.getMemory(agent.gaii, keys.runtime),
    listVersionRefs(storage, keys.base),
  ]);
  const own = refs.filter(r => r.ownerGaii === agent.gaii).sort((a, b) => b.n - a.n);
  // publishedAt per revision needs the values; the window is at most 10 rows, so one batched read.
  const versionKeys = own.map(r => r.key);
  const rows = versionKeys.length ? await storage.getMemoryByKeys(agent.gaii, versionKeys) : [];
  const publishedAtByKey = new Map(rows.map(r => [r.key, unwrapEnvelope(r.value, agent.name)?.publishedAt || null]));
  const draftObj = asObject(draftRec?.value);
  const draftDoc = draftObj ? asObject(draftObj.doc) : null;
  return {
    published: live ? unwrapEnvelope(live.value, agent.name) : null,
    draft: draftDoc ? { doc: draftDoc, savedAt: typeof draftObj?.savedAt === 'string' ? draftObj.savedAt : draftRec!.updatedAt } : null,
    versions: own.map(r => ({ revision: r.n, publishedAt: publishedAtByKey.get(r.key) ?? null })),
    runtime: asObject(runtimeRec?.value),
  };
}

/** `expectedVersion`: write only on that version of the key (0: only when the key is absent). */
function writeInto(deps: CrewWriteDeps, caller: CrewWriteCaller, agent: AgentRecord, key: string, value: unknown, tags: string[], expectedVersion?: number): Promise<MemoryWriteResult> {
  return writeMemoryRecord(deps, {
    principal: caller.principal,
    targetGaii: agent.gaii,
    scopes: caller.scopes,
    roles: caller.roles,
  }, {
    key,
    value,
    // Owner visibility: every principal of this owner reads it (the fleet under the agent's own
    // token, the profile under the owner's). Public sharing is a separate, deliberate act.
    visibility: 'owner',
    tags,
    pipeline: caller.pipeline,
    // The record lands in the agent's namespace by contract; there is no owner copy to shadow.
    ownerScoped: true,
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
}

/** Save unpublished edits. No validation: a draft may be half-written by design. */
export async function saveCrewDraft(deps: CrewWriteDeps, caller: CrewWriteCaller, agent: AgentRecord, doc: Record<string, unknown>): Promise<MemoryWriteResult> {
  const savedAt = new Date().toISOString();
  return writeInto(deps, caller, agent, crewKeysFor(agent.name).draft, { savedAt, doc }, ['crew-def', 'draft']);
}

export async function discardCrewDraft(storage: Storage, agent: AgentRecord): Promise<boolean> {
  return storage.deleteMemory(agent.gaii, crewKeysFor(agent.name).draft);
}

/** One historic copy, for restore. Null when that revision was pruned or never existed. */
export async function readCrewRevision(storage: Storage, agent: AgentRecord, revision: number): Promise<CrewDefEnvelope | null> {
  const rec = await storage.getMemory(agent.gaii, `${crewKeysFor(agent.name).base}.version.${revision}`);
  return rec ? unwrapEnvelope(rec.value, agent.name) : null;
}

export type CrewPublishResult =
  | { ok: true; revision: number; publishedAt: string; key: string }
  | Extract<MemoryWriteResult, { ok: false }>;

/**
 * Publish a definition the fleet's validator has ALREADY accepted (the route asks it first; this
 * function trusts its caller on that and writes). Order: the history copy first, then the live
 * key, then the draft goes, then the window is pruned, then the runtime is woken. A failure in the
 * first write leaves nothing changed; a failure later leaves the live key correct and history one
 * row short, which the next publish repairs.
 */
export async function publishCrewDef(
  deps: CrewWriteDeps, caller: CrewWriteCaller, agent: AgentRecord, doc: Record<string, unknown>,
  /** Only the seed path passes this: the sibling whose runtime validated, when the agent had none. */
  validatedBy?: string,
): Promise<CrewPublishResult> {
  const { storage } = deps;
  const keys = crewKeysFor(agent.name);
  const publishedAt = new Date().toISOString();
  // The revision is claimed by creating its history copy (expectedVersion 0), so two publishes at
  // the same moment cannot both take one number: the loser reads again and takes the next one. The
  // live key is then written on the version that was read, and a newer revision already live wins.
  const readLive = () => storage.getMemory(agent.gaii, keys.base);
  let refs: Awaited<ReturnType<typeof listVersionRefs>> = [];
  let revision = 0;
  let envelope: CrewDefEnvelope | null = null;
  for (let attempt = 0; attempt < PUBLISH_ATTEMPTS && !envelope; attempt++) {
    refs = (await listVersionRefs(storage, keys.base)).filter(r => r.ownerGaii === agent.gaii);
    const live = await readLive();
    const liveRev = live ? (unwrapEnvelope(live.value, agent.name)?.revision ?? 0) : 0;
    revision = Math.max(liveRev, ...refs.map(r => r.n), 0) + 1;
    const candidate: CrewDefEnvelope = {
      version: ENVELOPE_VERSION,
      revision,
      publishedAt,
      publishedBy: caller.principal,
      agent_name: agent.name,
      doc: { ...doc, agent_name: agent.name },
      // Written only when a sibling validated. Omitted otherwise, so an ordinary publish produces
      // exactly the envelope it always did.
      ...(validatedBy ? { validatedBy } : {}),
    };
    const snapshot = await writeInto(deps, caller, agent, `${keys.base}.version.${revision}`, candidate, ['crew-def', 'version'], 0);
    if (!snapshot.ok && snapshot.code === 'VERSION_CONFLICT') continue;
    if (!snapshot.ok) return snapshot;
    envelope = candidate;
  }
  if (!envelope) return { ok: false, status: 409, code: 'VERSION_CONFLICT', message: `${agent.name}'s crew definition was published by someone else at every attempt. Publish again.` };
  let liveWritten = false;
  for (let attempt = 0; attempt < PUBLISH_ATTEMPTS && !liveWritten; attempt++) {
    const live = await readLive();
    if ((live ? (unwrapEnvelope(live.value, agent.name)?.revision ?? 0) : 0) > revision) { liveWritten = true; break; }
    const written = await writeInto(deps, caller, agent, keys.base, envelope, ['crew-def'], live?.version ?? 0);
    if (!written.ok && written.code !== 'VERSION_CONFLICT') return written;
    liveWritten = written.ok;
  }
  if (!liveWritten) return { ok: false, status: 409, code: 'VERSION_CONFLICT', message: `${agent.name}'s live crew definition changed at every attempt. Publish again.` };

  await storage.deleteMemory(agent.gaii, keys.draft);

  // Keep the last CREW_VERSION_WINDOW revisions; the window is small enough to delete one by one.
  const doomed = refs.filter(r => r.n <= revision - CREW_VERSION_WINDOW);
  for (const r of doomed) {
    if (versionNumberOf(r.key, keys.base) === null) continue;
    try { await storage.deleteMemory(r.ownerGaii, r.key); }
    catch (err) { logger.warn('crew-def: version prune failed', { key: r.key, error: String(err) }); }
  }

  // The runtime's reload signal. Rides the tunnel as a deliver; the daemon offers it on the record
  // queue and the unified wake, so a JSON runtime parked there reads the live key and reloads.
  emitDelivery({
    target: agent.gaii,
    kind: 'crew.def_updated',
    id: `crew-def/${agent.name}/${revision}`,
    payload: { type: 'crew.def_updated', event: 'crew.def_updated', key: keys.base, revision, agent_name: agent.name, published_at: publishedAt },
  });
  emitChange('agents', agent.gaii);

  return { ok: true, revision, publishedAt, key: keys.base };
}
