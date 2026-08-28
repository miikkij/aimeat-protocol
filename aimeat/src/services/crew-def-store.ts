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
 *   enumeration from services/workspace-versions.ts) rather than a second scheme.
 * @structure
 *   - crewKeysFor() / CREW_VERSION_WINDOW — the key contract
 *   - readCrewState() — everything the Crew tab shows, in one read
 *   - saveCrewDraft() / discardCrewDraft()
 *   - publishCrewDef() — snapshot, write live, drop the draft, prune, wake the runtime
 *   - readCrewRevision() — one historic copy, for restore
 * @usage
 *   const state = await readCrewState(storage, agent);
 *   const out = await publishCrewDef({ storage, config }, caller, agent, doc);
 * @version-history
 *   v1.1.0 — 2026-08-28 — misdirectedCrewKey(): the one rule every memory door applies so a crews.*
 *     key cannot land in the wrong principal's namespace (a chat session writing json-demo's
 *     definition under its own name — found in production, hidden for a day).
 *   v1.0.0 — 2026-08-28 — Initial (JSON-agent Crew tab, node side).
 */
import type { AimeatConfig } from '../config.js';
import type { MemoryRecord, Storage, AgentRecord } from '../storage/interface.js';
import { writeMemoryRecord, type MemoryWriteResult } from './memory-write.js';
import { listVersionRefs, versionNumberOf } from './workspace-versions.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { logger } from '../utils/logger.js';

export const CREW_REGISTRY_PREFIX = 'crews.registry.';
export const CREW_RUNTIME_PREFIX = 'crews.runtime.';
/** How many published revisions stay readable behind the live one. */
export const CREW_VERSION_WINDOW = 10;
/** The envelope schema version crew_registry.py writes and unwraps. */
const ENVELOPE_VERSION = 1;

export interface CrewKeys { base: string; draft: string; runtime: string }

/**
 * A crew definition lives in the namespace of the agent it names, and nowhere else. Why this is a
 * rule and not a convention: a chat session is an agent principal of its own
 * (`claude-desktop-home-mcp#owner`), so a plain memory write of `crews.registry.json-demo` from
 * chat lands under the CHAT's name. The runtime still finds it through the owner-scope fallback and
 * runs it, while the Crew tab reads the agent's namespace and says "No definition yet" about a
 * definition that is in force. That cost a day. Returns the refusal message when `key` is a crew
 * key whose agent segment is not the agent of `targetGaii`; null when the write is fine. A PUBLIC
 * copy is exempt: sharing a definition for another owner to install by the publisher's GAII is
 * exactly a copy under the publisher's own name (crew_registry.py install-by-gaii).
 */
export function misdirectedCrewKey(key: string, targetGaii: string, visibility: string): string | null {
  const m = /^crews\.(registry|runtime)\.([^.]+)(?:\..*)?$/.exec(key);
  if (!m || visibility === 'public') return null;
  const named = m[2];
  const hash = targetGaii.indexOf('#');
  const targetAgent = hash > 0 ? targetGaii.slice(0, hash) : null;
  if (targetAgent === named) return null;
  const where = targetAgent ? `${targetAgent}'s` : 'your own';
  return `A crew definition for ${named} lives in ${named}'s own namespace, and this write would land in ${where}, where neither the Crew tab nor ${named}'s runtime looks. Publish it with aimeat_crew_publish or the Crew tab instead; those write it where it belongs.`;
}

export function crewKeysFor(agentName: string): CrewKeys {
  const base = `${CREW_REGISTRY_PREFIX}${agentName}`;
  return { base, draft: `${base}.draft`, runtime: `${CREW_RUNTIME_PREFIX}${agentName}` };
}

/** What sits at `crews.registry.<agent>`. `doc` is the crew definition itself. */
export interface CrewDefEnvelope {
  version: number;
  revision: number;
  publishedAt: string;
  publishedBy: string;
  agent_name: string;
  doc: Record<string, unknown>;
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

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/** Accept the crew_registry.py envelope OR a bare doc (forward-compat, same as its `_unwrap`). */
function unwrapEnvelope(value: unknown, fallbackName: string): CrewDefEnvelope | null {
  const obj = asObject(typeof value === 'string' ? safeJson(value) : value);
  if (!obj) return null;
  const doc = 'doc' in obj ? asObject(obj.doc) : obj;
  if (!doc) return null;
  return {
    version: typeof obj.version === 'number' ? obj.version : ENVELOPE_VERSION,
    revision: typeof obj.revision === 'number' ? obj.revision : 0,
    publishedAt: typeof obj.publishedAt === 'string' ? obj.publishedAt : '',
    publishedBy: typeof obj.publishedBy === 'string' ? obj.publishedBy : '',
    agent_name: typeof obj.agent_name === 'string' ? obj.agent_name : (typeof doc.agent_name === 'string' ? doc.agent_name : fallbackName),
    doc,
  };
}

/** A registry value written as a JSON string (an older crew_registry.py) — unparseable is logged, not hidden. */
function safeJson(s: string): unknown {
  try { return JSON.parse(s); }
  catch (err) {
    logger.warn('crew-def: registry value is a string that is not JSON', { error: String(err) });
    return null;
  }
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
  const rows = versionKeys.length
    ? (storage.getMemoryByKeys
        ? await storage.getMemoryByKeys(agent.gaii, versionKeys)
        : (await Promise.all(versionKeys.map(k => storage.getMemory(agent.gaii, k)))).filter((r): r is MemoryRecord => !!r))
    : [];
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

function writeInto(deps: CrewWriteDeps, caller: CrewWriteCaller, agent: AgentRecord, key: string, value: unknown, tags: string[]): Promise<MemoryWriteResult> {
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
): Promise<CrewPublishResult> {
  const { storage } = deps;
  const keys = crewKeysFor(agent.name);
  const refs = (await listVersionRefs(storage, keys.base)).filter(r => r.ownerGaii === agent.gaii);
  const live = await storage.getMemory(agent.gaii, keys.base);
  const liveRev = live ? (unwrapEnvelope(live.value, agent.name)?.revision ?? 0) : 0;
  const revision = Math.max(liveRev, ...refs.map(r => r.n), 0) + 1;
  const publishedAt = new Date().toISOString();
  const envelope: CrewDefEnvelope = {
    version: ENVELOPE_VERSION,
    revision,
    publishedAt,
    publishedBy: caller.principal,
    agent_name: agent.name,
    doc: { ...doc, agent_name: agent.name },
  };

  const snapshot = await writeInto(deps, caller, agent, `${keys.base}.version.${revision}`, envelope, ['crew-def', 'version']);
  if (!snapshot.ok) return snapshot;
  const written = await writeInto(deps, caller, agent, keys.base, envelope, ['crew-def']);
  if (!written.ok) return written;

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
