/**
 * @file src/services/crews/def-envelope.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of a crew definition record and the two rules the generic memory write
 *   applies to crew keys: the envelope at `crews.registry.<agent>` and how it is read, the rule that
 *   a crew key lands only in the namespace of the agent it names, and the rule that only the owner in
 *   person changes the browser site list of the live definition.
 *
 *   WHY A MODULE OF ITS OWN. services/memory-write.ts applies the two rules to every memory write,
 *   and services/crew-def-store.ts publishes through memory-write.ts. While the rules lived in
 *   crew-def-store.ts the two files imported each other, a run-time import cycle. They moved here
 *   unchanged; crew-def-store.ts imports the envelope from here and re-exports the rules, so no
 *   other importer changed.
 * @structure
 *   - ENVELOPE_VERSION / CrewDefEnvelope — the record at `crews.registry.<agent>`
 *   - asObject() / unwrapEnvelope() — read a stored value as that record
 *   - misdirectedCrewKey() — a crew key lands only in the namespace of the agent it names
 *   - crewSitesWriteRefusal() — the browser site list on the generic memory write
 * @usage
 *   const refusal = misdirectedCrewKey(key, targetGaii, visibility);
 *   const live = unwrapEnvelope(record.value, agent.name);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved unchanged from services/crew-def-store.ts (its v1.1.0 of 2026-08-28 and
 *     its 2026-10-16 entry hold the history), which ends the crew-def-store ↔ memory-write import
 *     cycle (structure programme 2026-11, unit 4).
 */
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { isOwnerInPerson } from '../../utils/gaii.js';

/** The envelope schema version crew_registry.py writes and unwraps. */
export const ENVELOPE_VERSION = 1;

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

/**
 * The browser site list on the generic memory write (QA audit F07b-02). `crews.registry.<agent>` is
 * the live definition the runtime runs, and it stays off the reserved-key list on purpose, so a plain
 * memory write by the agent itself could replace it, skipping the crew routes' check that only the
 * owner in person changes the sites the agent's browser may open (crew-ops.ts browserListRefusal).
 * The same rule here: a write of the live definition whose browser_domains differ from the stored
 * definition's is refused unless the caller is the owner in person. Returns the refusal message, or
 * null when the write is fine. Drafts and version rows are not live, and a restore checks the list.
 */
export async function crewSitesWriteRefusal(
  storage: Pick<Storage, 'getMemory'>, key: string, targetGaii: string, value: unknown, caller: { roles?: readonly string[] | null; federated?: boolean },
): Promise<string | null> {
  const m = /^crews\.registry\.([^.]+)$/.exec(key);
  if (!m || isOwnerInPerson(caller)) return null;
  const sites = (doc: Record<string, unknown> | null | undefined): string =>
    JSON.stringify([...((doc?.browser_domains as unknown[] | undefined) ?? [])].map(String).sort());
  const stored = await storage.getMemory(targetGaii, key);
  const before = stored ? unwrapEnvelope(stored.value, m[1]!)?.doc : null;
  const after = unwrapEnvelope(value, m[1]!)?.doc ?? null;
  if (sites(after) === sites(before)) return null;
  return `This changes the sites ${m[1]}'s browser may open, and the owner approves that list. Ask your owner to publish it from the Crew tab in Profile → Agents.`;
}

/** What sits at `crews.registry.<agent>`. `doc` is the crew definition itself. */
export interface CrewDefEnvelope {
  version: number;
  revision: number;
  publishedAt: string;
  publishedBy: string;
  agent_name: string;
  doc: Record<string, unknown>;
  /**
   * WHOSE runtime said this definition is valid, when that was not the agent's own.
   *
   * Absent on every ordinary publish, and absent means the usual thing happened: the agent
   * validated its own definition. It is written only by the seed path, where a brand-new agent has
   * no runtime to ask and a sibling answered instead — and then it has to be recorded, because
   * "this was checked" and "this was checked by something else" are different claims and the second
   * one should not quietly read as the first.
   */
  validatedBy?: string;
}

export function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/** Accept the crew_registry.py envelope OR a bare doc (forward-compat, same as its `_unwrap`). */
export function unwrapEnvelope(value: unknown, fallbackName: string): CrewDefEnvelope | null {
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
    // Only a seed writes this. Projected back out so the Crew tab and a reading agent can see that
    // a sibling checked the definition rather than the agent itself; a field that is written and
    // never read back is the same as not recording it.
    ...(typeof obj.validatedBy === 'string' ? { validatedBy: obj.validatedBy } : {}),
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
