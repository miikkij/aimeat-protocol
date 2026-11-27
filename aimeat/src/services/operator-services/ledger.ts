/**
 * @file src/services/operator-services/ledger.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ledger of one operator service: which person's agent this service made, and which
 *   person turned the service off. One line per person, keyed by the account name:
 *     { gaii, at, state, removed_at?, told_at?, given?, proof?, nonce?, reserved_at?, by? }
 *   pending — an approval is in progress: the line was reserved (`nonce`, `reserved_at`, `by` = the
 *             credential agent) before the agent was made or connected again.
 *   active  — the service made this person's agent; `proof` is what only that agent has (its record's
 *             createdAt and its public key's fingerprint, written by the approval that made or connected
 *             it), so "made by this service" is a comparison with the live agent (./proof.ts).
 *   removed — the person turned the service off, or removed its agent: the service gets no agent for
 *             this person again until the person turns it back on.
 *   ended   — the operator switched the service off and the sweep removed the agent, a reservation was
 *             cleared, a line was found pointing at an agent that is not the service's, or the person
 *             turned the service back on after `removed`; the next provisioning is allowed.
 *   told_at — when the person got the one notice, written only after it was stored.
 *   operator_off — the operator turned the service off for this account ({ at, by, reason? }): no agent
 *             for it until the operator turns it on. A flag beside `state`, so it and the person's own
 *             `removed` never clear each other. The ledger holds states, never policy: `required` and
 *             `audience` are read from the present setting at each request.
 *   given   — the words the service's approval gave the agent; the sweep's narrowing and a re-approval
 *             take back only these, so a word the person added stays.
 *
 *   THE LEDGER IS THE MARK, not `registeredBy` on the agent. Every write goes through updateRecord()
 *   (services/record-cas.ts), and every change answers the line it replaced from inside the
 *   compare-and-set, so a caller decides from what it actually replaced, never from an earlier read.
 *
 *   SHARDS AND SIZE. A service's lines are spread over 64 records, `operator-service.<id>.<00..3f>`
 *   under `system@<node>`, by a stable hash of the account name, so two enrolments at once rarely touch
 *   the same record. A line measured 405 bytes as JSON (a 24-character account name, a 60-character
 *   GAII, four given words, the proof, three times), so 5,000 accounts are about 78 lines and 32 kB per
 *   record, far inside the 1,024 kB memory value limit; one record reaches the limit at about 2,500
 *   lines, some 160,000 accounts. `operator-services.index` (also under system@<node>) names every
 *   service that has a ledger, so the sweep and an erasure find the ones whose entry left the setting.
 *   A record stays when its entry leaves the setting, so a person's `removed` still holds if the
 *   operator adds the entry back.
 * @structure LedgerLine · LedgerState · AgentProof · Ledger · LineChange · SHARDS · shardOf · ledgerKey ·
 *   ledgerIds · readLine · readLedger · RESERVATION_TTL_MS · reserve · complete · clearReservation ·
 *   markRemoved · markRemovedIfServices · clearRemoved · markEnded · setGiven · setOperatorOff ·
 *   clearOperatorOff · markTold · forgetPerson
 * @usage const { before } = await markRemoved(storage, nodeId, 'desk-helper', 'alice', gaii);
 * @version-history
 *   v2.2.1 — 2026-11-27 — shardOf says why its sha256 is a partition function (code scanning 1844).
 *   v2.2.0 — 2026-11-26 — `person_off`: the person's off kept beside the state while a required entry goes
 *     on (S9); markRemoved and markRemovedIfServices keep the proof, so the fences know a live agent (S4).
 *   v2.1.0 — 2026-11-26 — `operator_off` beside the state (setOperatorOff, clearOperatorOff), carried over
 *     by every other change; reserve refuses it and passes over a person's `removed` when the entry is
 *     required (phase 2).
 *   v2.0.0 — 2026-11-26 — 64 records per service, the pending reservation, the proof, and every change
 *     answering the line it replaced (security review of the operator services).
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';

export type LedgerState = 'pending' | 'active' | 'removed' | 'ended';

/** What only the agent the service made has: its record's createdAt and its public key's fingerprint. */
export interface AgentProof { created_at: string; key_fp: string }

export interface LedgerLine {
  gaii: string;
  at: string;
  state: LedgerState;
  removed_at?: string;
  told_at?: string;
  given?: string[];
  proof?: AgentProof;
  nonce?: string;
  reserved_at?: string;
  /** The credential agent that reserved the line. */
  by?: string;
  /**
   * The operator turned the service off for this account: when, who and why. Independent of `state`,
   * so the person's own `removed` and the operator's switch never clear each other.
   */
  operator_off?: { at: string; by: string; reason?: string };
  /**
   * The person turned the service off, when. Written with `removed` and KEPT while the entry is
   * required and the line goes on to `pending` and `active`, so the person's choice is not forgotten:
   * when `required` goes back to false the service is off for them again (the sweep ends the agent and
   * the line is `removed`) until they turn it on (clearRemoved drops it).
   */
  person_off?: { at: string };
}

/** Account name → its line. */
export type Ledger = Record<string, LedgerLine>;

/** One change: the line before (from inside the compare-and-set) and the line written. */
export interface LineChange { before: LedgerLine | null; after: LedgerLine | null; changed: boolean }

export const SHARDS = 64;
/** A reservation older than this with no agent is cleared by the next request or sweep. */
export const RESERVATION_TTL_MS = 60_000;

const TAG = 'operator-service';
const KEY_PREFIX = 'operator-service.';
const INDEX_KEY = 'operator-services.index';
const owner = (nodeId: string) => `system@${nodeId}`;

/**
 * The record an account's line is in: a stable hash of the account name, 00..3f. The input is an
 * account name and the output picks one of 64 records, so this is a partition function, not a stored
 * secret: CodeQL js/insufficient-password-hash (code scanning 1844) reads the agent id of an OAuth
 * refresh token record as a password source, and that alert is dismissed as a false positive with
 * this reason. The hash stays sha256, because every stored line was placed by it.
 */
export function shardOf(account: string): string {
  return (createHash('sha256').update(account).digest()[0] & (SHARDS - 1)).toString(16).padStart(2, '0');
}

/** The memory key of the record holding `account`'s line of service `id`, or of shard `shard`. */
export function ledgerKey(id: string, accountOrShard: { account: string } | { shard: string }): string {
  const shard = 'shard' in accountOrShard ? accountOrShard.shard : shardOf(accountOrShard.account);
  return `${KEY_PREFIX}${id}.${shard}`;
}

const parseIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const STATES: readonly LedgerState[] = ['pending', 'active', 'removed', 'ended'];

function parse(v: unknown): Ledger {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Ledger = {};
  for (const [name, line] of Object.entries(v as Record<string, unknown>)) {
    const l = line as Partial<LedgerLine> | null;
    if (l && typeof l.gaii === 'string' && STATES.includes(l.state as LedgerState)) out[name] = l as LedgerLine;
  }
  return out;
}

/** The ids of every ledger this node keeps, the ones whose entry left the setting included. */
export async function ledgerIds(storage: Storage, nodeId: string): Promise<string[]> {
  return parseIds((await storage.getMemory(`system@${nodeId}`, INDEX_KEY))?.value);
}

/** Name ledger `id` in the index. A read only, once the id is there. */
async function indexLedger(storage: Storage, nodeId: string, id: string): Promise<void> {
  await updateRecord(storage, owner(nodeId), INDEX_KEY, parseIds,
    (ids) => (ids.includes(id) ? UNCHANGED : [...ids, id]), { tag: TAG, visibility: 'private' });
}

/** The person's line, or null. One record read. */
export async function readLine(storage: Storage, nodeId: string, id: string, account: string): Promise<LedgerLine | null> {
  const shard = parse((await storage.getMemory(`system@${nodeId}`, ledgerKey(id, { account })))?.value);
  return Object.prototype.hasOwnProperty.call(shard, account) ? shard[account] : null;
}

/** Every line of one service: its 64 records. */
export async function readLedger(storage: Storage, nodeId: string, id: string): Promise<Ledger> {
  const shards = Array.from({ length: SHARDS }, (_, i) => i.toString(16).padStart(2, '0'));
  const recs = await Promise.all(shards.map((shard) => storage.getMemory(`system@${nodeId}`, ledgerKey(id, { shard }))));
  return Object.assign({}, ...recs.map((r) => parse(r?.value))) as Ledger;
}

/**
 * Change one person's line. `mutate` gets the stored line (null when none) and answers the next line,
 * null to delete it, or UNCHANGED. It may run more than once on a conflict; the answer is its last run.
 */
async function change(
  storage: Storage, nodeId: string, id: string, account: string,
  mutate: (line: LedgerLine | null) => LedgerLine | null | typeof UNCHANGED,
): Promise<LineChange> {
  await indexLedger(storage, nodeId, id);
  let out: LineChange = { before: null, after: null, changed: false };
  await updateRecord(storage, owner(nodeId), ledgerKey(id, { account }), parse, (cur) => {
    const before = Object.prototype.hasOwnProperty.call(cur, account) ? cur[account] : null;
    const next = mutate(before);
    if (next === UNCHANGED) { out = { before, after: before, changed: false }; return UNCHANGED; }
    out = { before, after: next, changed: true };
    if (next === null) return Object.fromEntries(Object.entries(cur).filter(([name]) => name !== account));
    return { ...cur, [account]: next };
  }, { tag: TAG, visibility: 'private' });
  return out;
}

/**
 * What every change carries over: the notice's mark, the operator's switch and the person's own off,
 * which only their own functions change.
 */
const keepTold = (line: LedgerLine | null) => ({
  ...(line?.told_at ? { told_at: line.told_at } : {}), ...(line?.operator_off ? { operator_off: line.operator_off } : {}),
  ...(line?.person_off ? { person_off: line.person_off } : {}),
});
const now = () => new Date().toISOString();
const fresh = (line: LedgerLine | null, at = Date.now()) =>
  line?.state === 'pending' && !!line.reserved_at && at - Date.parse(line.reserved_at) < RESERVATION_TTL_MS;

export type ReserveOutcome = 'reserved' | 'removed' | 'busy' | 'operator_off';

/**
 * Reserve the person's line before an approval: `pending`, with `nonce`. Refused when the person
 * turned the service off (`removed`) or another approval holds a fresh reservation (`busy`). The line
 * it replaced is answered, so the caller restores it if the approval fails.
 */
export async function reserve(
  storage: Storage, nodeId: string, id: string, account: string, gaii: string, nonce: string, by: string,
  /** The entry is required now: a person's earlier `removed` does not stop it (the operator's switch still does). */
  required = false,
): Promise<{ outcome: ReserveOutcome } & LineChange> {
  let outcome: ReserveOutcome = 'reserved';
  const c = await change(storage, nodeId, id, account, (line) => {
    if (line?.operator_off) { outcome = 'operator_off'; return UNCHANGED; }
    // The person's off, as the state or as the flag a required entry kept (S9).
    if ((line?.state === 'removed' || line?.person_off) && !required) { outcome = 'removed'; return UNCHANGED; }
    if (fresh(line) && line!.nonce !== nonce) { outcome = 'busy'; return UNCHANGED; }
    outcome = 'reserved';
    return {
      gaii, at: line?.at ?? now(), state: 'pending', nonce, reserved_at: now(), by, ...keepTold(line),
      // A `removed` line's proof names an agent the person's off ended; the approval makes a new one.
      ...(line?.given ? { given: line.given } : {}), ...(line?.proof && line.state !== 'removed' ? { proof: line.proof } : {}),
    };
  });
  return { outcome, ...c };
}

/** Complete the reservation `nonce` to `active` with the proof and what was given. False when it is no longer ours. */
export async function complete(
  storage: Storage, nodeId: string, id: string, account: string, nonce: string, proof: AgentProof, given: readonly string[],
): Promise<{ ok: boolean } & LineChange> {
  const c = await change(storage, nodeId, id, account, (line) => {
    if (line?.state !== 'pending' || line.nonce !== nonce) return UNCHANGED;
    return { gaii: line.gaii, at: now(), state: 'active', ...keepTold(line), given: [...given], proof };
  });
  return { ok: c.changed, ...c };
}

/**
 * Clear the reservation `nonce`: write `restore` in its place (null deletes the line). Nothing when the
 * line is no longer that reservation (the person turned the service off meanwhile).
 */
export async function clearReservation(
  storage: Storage, nodeId: string, id: string, account: string, nonce: string, restore: LedgerLine | null,
): Promise<LineChange> {
  return change(storage, nodeId, id, account, (line) => {
    if (line?.state !== 'pending' || line.nonce !== nonce) return UNCHANGED;
    return restore ? { ...restore, ...keepTold(line) } : (line.told_at || line.operator_off ? { gaii: line.gaii, at: line.at, state: 'ended', ...keepTold(line) } : null);
  });
}

/**
 * The person turned the service off: remembered until they turn it on, as the state and as the
 * `person_off` flag (kept while a required entry goes on). The proof stays, so the fences and the sweep
 * still know the agent while it lives (./agent-check.ts). Answers the replaced line.
 */
export async function markRemoved(storage: Storage, nodeId: string, id: string, account: string, gaii: string): Promise<LineChange> {
  return change(storage, nodeId, id, account, (line) => {
    if (line?.state === 'removed') return UNCHANGED;
    const at = now();
    return {
      gaii, at: line?.at ?? at, state: 'removed', removed_at: at, ...keepTold(line), person_off: line?.person_off ?? { at },
      ...(line?.proof ? { proof: line.proof } : {}),
    };
  });
}

/**
 * The ordinary removal of an agent (services/agents/remove-agent.ts): when `isServices(line)` says the
 * removed agent is the one the line names, the line becomes `removed`. Answers the replaced line.
 */
export async function markRemovedIfServices(
  storage: Storage, nodeId: string, id: string, account: string, isServices: (line: LedgerLine) => boolean,
): Promise<LineChange> {
  return change(storage, nodeId, id, account, (line) => {
    if (!line || (line.state !== 'active' && line.state !== 'pending') || !isServices(line)) return UNCHANGED;
    const at = now();
    return {
      gaii: line.gaii, at: line.at, state: 'removed', removed_at: at, ...keepTold(line), person_off: line.person_off ?? { at },
      ...(line.proof ? { proof: line.proof } : {}),
    };
  });
}

/**
 * The person turned the service back on: `removed` becomes `ended`, and the `person_off` flag a
 * required entry kept goes. Answers the replaced line.
 */
export async function clearRemoved(storage: Storage, nodeId: string, id: string, account: string): Promise<LineChange> {
  return change(storage, nodeId, id, account, (line) => {
    if (!line || (line.state !== 'removed' && !line.person_off)) return UNCHANGED;
    const kept = omit(line, ['person_off']);
    return line.state === 'removed' ? { gaii: line.gaii, at: line.at, state: 'ended', ...keepTold(kept) } : kept;
  });
}

/**
 * The line becomes `ended`, when `expect(line)` holds for the stored line (the sweep after it ended the
 * agent, a repair of a line that points at an agent that is not the service's, a stale reservation).
 */
export async function markEnded(
  storage: Storage, nodeId: string, id: string, account: string, expect: (line: LedgerLine) => boolean,
): Promise<LineChange> {
  return change(storage, nodeId, id, account, (line) => {
    if (!line || line.state === 'removed' || line.state === 'ended' || !expect(line)) return UNCHANGED;
    // The proof stays, so a sweep that finds the agent still alive after an `ended` can tell it is the service's.
    return { gaii: line.gaii, at: now(), state: 'ended', ...keepTold(line), ...(line.proof ? { proof: line.proof } : {}) };
  });
}

/** The sweep narrowed the agent: the words the service still gives it. Only on its active line for `gaii`. */
export async function setGiven(storage: Storage, nodeId: string, id: string, account: string, gaii: string, given: readonly string[]): Promise<LineChange> {
  return change(storage, nodeId, id, account, (line) => {
    if (line?.state !== 'active' || line.gaii !== gaii) return UNCHANGED;
    const same = !!line.given && line.given.length === given.length && line.given.every((w) => given.includes(w));
    return same ? UNCHANGED : { ...line, given: [...given] };
  });
}

/**
 * The operator turned the service off for this account. The flag is set in the same write that ends an
 * active or pending line (the caller ends the agent after, from the replaced line); a person's `removed`
 * stays `removed`. Answers the replaced line.
 */
export async function setOperatorOff(
  storage: Storage, nodeId: string, id: string, account: string, gaii: string, by: string, reason?: string,
): Promise<LineChange> {
  return change(storage, nodeId, id, account, (line) => {
    const off = { at: now(), by, ...(reason ? { reason } : {}) };
    if (!line) return { gaii, at: off.at, state: 'ended', operator_off: off };
    const state: LedgerState = line.state === 'removed' ? 'removed' : 'ended';
    return { ...omit(line, ['nonce', 'reserved_at']), state, operator_off: off };
  });
}

/** The line without the named fields. */
function omit(line: LedgerLine, keys: readonly (keyof LedgerLine)[]): LedgerLine {
  return Object.fromEntries(Object.entries(line).filter(([k]) => !keys.includes(k as keyof LedgerLine))) as unknown as LedgerLine;
}

/** The operator turned the service back on for this account: only the flag goes. Answers the replaced line. */
export async function clearOperatorOff(storage: Storage, nodeId: string, id: string, account: string): Promise<LineChange> {
  return change(storage, nodeId, id, account, (line) => {
    if (!line?.operator_off) return UNCHANGED;
    return omit(line, ['operator_off']);
  });
}

/** The person's notice was stored. Answers true only for the first call. */
export async function markTold(storage: Storage, nodeId: string, id: string, account: string): Promise<boolean> {
  const c = await change(storage, nodeId, id, account, (line) => (!line || line.told_at ? UNCHANGED : { ...line, told_at: now() }));
  return c.changed;
}

/** The account was erased: its line goes from every ledger this node keeps. Answers how many it left. */
export async function forgetPerson(storage: Storage, nodeId: string, account: string): Promise<number> {
  let n = 0;
  for (const id of await ledgerIds(storage, nodeId)) {
    if ((await change(storage, nodeId, id, account, (line) => (line ? null : UNCHANGED))).changed) n++;
  }
  return n;
}
