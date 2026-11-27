/**
 * @file src/services/ai-standing/settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's "Allow always" setting: the permissions every one of their AIs holds
 *   without the owner answering each time, who set each and when, and the step that puts those words
 *   on the agents' own permission lists and takes them off again.
 *
 *   IN THE AGENT'S OWN LIST, NOT AT THE DOOR. A token is the ceiling of what its holder may do and the
 *   agent record narrows it (auth/effective-scopes.ts): a door never widens a permission. So a word
 *   given here is written into each agent's `defaultScopes`, as the store place's default is
 *   (services/place-agent-scopes.ts), and the agent's live connector is told to fetch a fresh token.
 *   Every door then sees an ordinary held word, and nothing else in the node changes.
 *
 *   GIVEN ONCE, TAKEN BACK BY THE SETTING. `given` remembers, per agent, the words this setting put on
 *   its list, and `had` the setting's words the agent already held when the setting reached it. A word
 *   the owner takes off one agent's page afterwards stays off: the sync passes over an agent the
 *   setting has reached with it. A word the owner takes out of the setting is taken off every agent in
 *   whose `given` it is, and only those: an agent that held the word before keeps it.
 *
 *   WHERE. One record per account in the account's service namespace (services/service-records.ts),
 *   `ai-standing.settings`, where no memory route writes: no agent can give itself a word by writing
 *   the record. Only the account holder in person changes it (routes/agents/ai-standing.ts); an AI
 *   reads it.
 * @structure STANDING_PREFIX · STANDING_KEY · StandingRecord · emptyStanding · parseStanding ·
 *   readStanding(storage, ownerGhii) · standingWordsFor(config, rec) · setStandingWords(deps, ownerGhii, wanted, by) ·
 *   syncStandingAgents(deps, ownerGhii) · withStandingWords(storage, config, gaii, held, within?)
 * @usage
 *   const r = await setStandingWords({ storage, config }, 'alice@node', ['publish:public'], 'alice@node');
 *   const scopes = await withStandingWords(storage, config, gaii, held);   // at a door that approves an agent
 * @version-history
 *   v1.1.0 — 2026-11-26 — The sync passes over an agent an operator service made: no word given, none
 *     taken (operator services review, S7; the approval adds none either, device-auth-approve.ts).
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-toimii-itsen-isesti-omistajan-asetuksella-salli-aina-ja-k).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { serviceNamespaceOf, serviceRecords } from '../service-records.js';
import { loadOwnerAgents } from '../db/owner-identity.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { changeScopeList } from '../scope/list-swap.js';
import { emitToolListChanged } from '../resource-events.js';
import { nodeContext } from '../node/context.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { localAccountName, ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { mayStand, standingRefusal } from './words.js';
import { isOperatorServiceAgent } from '../operator-services/agent-check.js';

export const STANDING_PREFIX = 'ai-standing.';
export const STANDING_KEY = `${STANDING_PREFIX}settings`;

export interface StandingWord { at: string; by: string }

export interface StandingRecord {
  /** The owner's "Allow always" words: who set each, and when. */
  words: Record<string, StandingWord>;
  /** Per agent GAII, the words this setting put on that agent's list. */
  given: Record<string, string[]>;
  /** Per agent GAII, the setting's words the agent already held when the setting reached it: never taken off by the setting. */
  had: Record<string, string[]>;
  /** `<agent GAII>|<word>` → the day (YYYY-MM-DD) an act on that word was last written to the feed (./use.ts). */
  noted: Record<string, string>;
}

export const emptyStanding = (): StandingRecord => ({ words: {}, given: {}, had: {}, noted: {} });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseStanding(v: unknown): StandingRecord {
  if (!isObj(v)) return emptyStanding();
  const words: Record<string, StandingWord> = {};
  if (isObj(v.words)) {
    for (const [w, s] of Object.entries(v.words)) {
      if (isObj(s) && typeof s.at === 'string' && typeof s.by === 'string') words[w] = { at: s.at, by: s.by };
    }
  }
  const lists = (raw: unknown): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    if (isObj(raw)) {
      for (const [g, list] of Object.entries(raw)) {
        if (Array.isArray(list)) out[g] = list.filter((x): x is string => typeof x === 'string');
      }
    }
    return out;
  };
  const noted: Record<string, string> = {};
  if (isObj(v.noted)) for (const [k, d] of Object.entries(v.noted)) if (typeof d === 'string') noted[k] = d;
  return { words, given: lists(v.given), had: lists(v.had), noted };
}

/** The owner's setting as stored; empty when there is none. Read through the service records' one code path. */
export async function readStanding(storage: Storage, ownerGhii: string): Promise<StandingRecord> {
  return (await serviceRecords<StandingRecord>(storage, STANDING_PREFIX, { parse: parseStanding }).get(ownerGhii, 'settings')) ?? emptyStanding();
}

/** Write the record on the version read (record-cas.ts). */
async function updateStanding(
  storage: Storage, ownerGhii: string, mutate: (cur: StandingRecord) => StandingRecord | typeof UNCHANGED,
): Promise<StandingRecord> {
  return updateRecord(storage, serviceNamespaceOf(ownerGhii), STANDING_KEY, parseStanding, mutate, { tag: STANDING_KEY });
}

/** The words of the setting that the node lets stand now: a node that turned a class off stops giving it. */
export function standingWordsFor(config: AimeatConfig, rec: StandingRecord): string[] {
  return Object.keys(rec.words).filter(w => mayStand(config, w)).sort();
}

export interface Deps { storage: Storage; config: AimeatConfig }

export class StandingRefused extends Error {
  constructor(public readonly code: string, message: string, public readonly word: string) { super(message); }
}

export interface SetStandingResult { record: StandingRecord; added: string[]; removed: string[]; agents: string[] }

/**
 * Replace the owner's "Allow always" words with `wanted`, then bring every agent of the owner in line.
 * A word the node does not let stand is refused before anything is written (StandingRefused); taking a
 * word out is always allowed. `by` is the principal that set it: the account holder in person.
 */
export async function setStandingWords(deps: Deps, ownerGhii: string, wanted: readonly string[], by: string): Promise<SetStandingResult> {
  const want = [...new Set(wanted.map(w => String(w).trim()).filter(Boolean))];
  const cur = await readStanding(deps.storage, ownerGhii);
  for (const w of want) {
    if (cur.words[w]) continue; // kept as it is, even when the node has since turned its class off
    const refusal = standingRefusal(deps.config, w);
    if (refusal) throw new StandingRefused(refusal.code, refusal.message, w);
  }
  const at = new Date().toISOString();
  let added: string[] = [];
  let removed: string[] = [];
  const record = await updateStanding(deps.storage, ownerGhii, (rec) => {
    added = want.filter(w => !rec.words[w]);
    removed = Object.keys(rec.words).filter(w => !want.includes(w));
    if (added.length === 0 && removed.length === 0) return UNCHANGED;
    const words: Record<string, StandingWord> = {};
    for (const w of want) words[w] = rec.words[w] ?? { at, by };
    return { ...rec, words };
  });
  const agents = await syncStandingAgents(deps, ownerGhii);
  return { record, added, removed, agents };
}

/**
 * The words the setting has not yet reached `agent` with, and the words it should lose: those the
 * setting put there and no longer names. A word the agent already held is reached but never taken.
 */
function planFor(config: AimeatConfig, rec: StandingRecord, agent: AgentRecord): { add: string[]; take: string[]; forget: string[] } {
  const stand = standingWordsFor(config, rec);
  const given = rec.given[agent.gaii] ?? [];
  const had = rec.had[agent.gaii] ?? [];
  return {
    add: stand.filter(w => !given.includes(w) && !had.includes(w)),
    take: given.filter(w => !stand.includes(w)),
    // A word that leaves the setting is forgotten as "had", so naming it again reaches the agent again.
    forget: had.filter(w => !stand.includes(w)),
  };
}

/**
 * Put the setting's words on every agent of the owner that has not had them, and take the words the
 * setting no longer names off the agents that got them from it. Answers the agents whose list changed.
 * Never throws for one agent: an agent whose list could not be written is logged, keeps its list,
 * and is tried again at the next change of the setting.
 */
export async function syncStandingAgents(deps: Deps, ownerGhii: string): Promise<string[]> {
  const { storage, config } = deps;
  const changed: string[] = [];
  const rec = await readStanding(storage, ownerGhii);
  const agents = await loadOwnerAgents(storage, localAccountName(ownerGhii));
  const done: Record<string, { given: string[]; had: string[] }> = {};
  for (const agent of agents) {
    const { add, take, forget } = planFor(config, rec, agent);
    if (add.length === 0 && take.length === 0 && forget.length === 0) continue;
    // An agent an operator service made: the setting never gives it a word and never takes one; its
    // entry is the only source of the entry's words (services/operator-services, S7).
    if (await isOperatorServiceAgent(storage, config, agent.gaii)) continue;
    try {
      // Read from the list the write is made on: a word the agent holds already is "had", not given.
      let added: string[] = [];
      let alreadyHeld: string[] = [];
      const written = await changeScopeList(storage, { kind: 'agent', id: agent.gaii }, agent.defaultScopes ?? [], (held) => {
        const next = held.filter(w => !take.includes(w));
        added = add.filter(w => !scopeIsCovered(held, w));
        alreadyHeld = add.filter(w => scopeIsCovered(held, w));
        for (const w of added) if (!scopeIsCovered(next, w)) next.push(w);
        return next.length === held.length && next.every((w, i) => w === held[i]) ? null : next;
      });
      const given = (rec.given[agent.gaii] ?? []).filter(w => !take.includes(w));
      for (const w of added) if (!given.includes(w)) given.push(w);
      const had = (rec.had[agent.gaii] ?? []).filter(w => !forget.includes(w));
      for (const w of alreadyHeld) if (!had.includes(w)) had.push(w);
      done[agent.gaii] = { given, had };
      if (written) {
        changed.push(agent.gaii);
        emitToolListChanged(agent.gaii);
        nodeContext().tunnel?.notifyScopesChanged(agent.gaii);
      }
    } catch (err) {
      logger.warn(`[ai-standing] ${agent.gaii}: the Allow always scopes could not be written; the next change tries again: ${(err as Error).message}`);
    }
  }
  if (Object.keys(done).length) {
    await updateStanding(storage, ownerGhii, (cur) => {
      const given = { ...cur.given };
      const had = { ...cur.had };
      for (const [g, lists] of Object.entries(done)) {
        if (lists.given.length) given[g] = lists.given; else delete given[g];
        if (lists.had.length) had[g] = lists.had; else delete had[g];
      }
      return { ...cur, given, had };
    });
  }
  return changed;
}

/**
 * `held` with the owner's "Allow always" words added, for a door that approves a new agent
 * (place-agent-scopes.ts applyPlaceDefault calls it for every such door). `within`: the scopes of the
 * agent that approves this one; only the words that list covers are added, as for the store place's
 * default. The words added are remembered as given, so taking them out of the setting takes them off.
 * A record that cannot be read or written leaves `held` as it is.
 */
export async function withStandingWords(
  storage: Storage, config: AimeatConfig, gaii: string, held: readonly string[], within?: readonly string[],
): Promise<string[]> {
  const ownerGhii = ownerGhiiOf(gaii);
  try {
    const rec = await readStanding(storage, ownerGhii);
    const stand = standingWordsFor(config, rec).filter(w => !within || scopeIsCovered(within, w));
    if (stand.length === 0) return [...held];
    const add = stand.filter(w => !scopeIsCovered(held, w));
    const already = stand.filter(w => scopeIsCovered(held, w));
    await updateStanding(storage, ownerGhii, (cur) => {
      const given = new Set(cur.given[gaii] ?? []);
      for (const w of add) given.add(w);
      const had = new Set(cur.had[gaii] ?? []);
      for (const w of already) had.add(w);
      return {
        ...cur,
        given: given.size ? { ...cur.given, [gaii]: [...given] } : cur.given,
        had: had.size ? { ...cur.had, [gaii]: [...had] } : cur.had,
      };
    });
    return [...held, ...add];
  } catch (err) {
    logger.warn(`[ai-standing] ${gaii}: the Allow always scopes were not given at approval: ${(err as Error).message}`);
    return [...held];
  }
}
