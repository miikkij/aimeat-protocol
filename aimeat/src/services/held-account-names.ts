/**
 * @file src/services/held-account-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the move to the full identity and the start steps for what deleted accounts
 *   installed and were issued left for the operator, and the operator's decision on each name. No
 *   deploy step is done by hand: the move runs when the store opens (Postgres 0086,
 *   sqlite/schema-identity-backfill.ts), the start steps run right after it (settleInstallsAtStart,
 *   settleCredentialsAtStart), all act only on positive evidence, and all record what they could not
 *   place. This turns the records into ONE incident on the Security page at start, and settles a name
 *   the way the operator decides it.
 *
 *   WHAT IS HELD. Rows stored under a bare account name that are older than the account that holds
 *   the name now: actions, work and ledger lines (the move), cortexes installed and ecosystem apps
 *   connected under the name, and app grants and personal access tokens issued in it (the start
 *   steps). They may be that person's, or a previous holder's of the name, and nothing in the data
 *   says which. They stay exactly as they were until the operator decides, and a held ecosystem app
 *   acts for the account that holds the name until then. The tokens of a held grant or access token
 *   are refused whatever the decision, because they are older than the account (auth/credential-age.ts):
 *   - 'holder': they are the holder's. The rows, the holder's own ledger lines and the hook bindings
 *     that name the actions move to the holder's full identity (GHII); the cortexes, apps, grants and
 *     tokens stay.
 *   - 'previous': they were a previous holder's, and are settled as deleting that account would have
 *     settled them (HeldAccountNameRepository.resolveHeldAccountName).
 *   A hook binding whose action the move did not put under a full identity is listed: with its name
 *   when the name is held, else among the bindings that name nothing, where a gate lets everything
 *   pass until it is bound again. A gate is never made to refuse by this: on another operator's node
 *   that would stop every registration until somebody bound it again.
 *
 *   ONE IMPLEMENTATION for every interface an operator uses for incidents: the REST endpoint POST
 *   /v1/admin/security/incidents/:id/resolve with a name, the aimeat_admin_incident_resolve MCP tool
 *   with a name, and the Security page. Nothing here throws on data: at start, a store that cannot be
 *   read or written is logged, and the next start tries again.
 * @structure
 *   - HELD_NAMES_INCIDENT_TYPE, HELD_NAMES_INCIDENT_CODE, HELD_NAMES_SOURCE
 *   - settleInstallsAtStart(config, storage) — at start: the cortexes and ecosystem apps of deleted
 *     accounts, once per node
 *   - settleCredentialsAtStart(storage) — at start: their app grants, access tokens and session rows,
 *     once per node, under its own record
 *   - openHeldNamesIncident(config, storage) — at start: the records, once each, to one incident
 *   - resolveHeldName(config, storage, { incidentId, name, resolution }) — one decision
 * @usage
 *   await settleInstallsAtStart(config, storage);   // server-bootstrap/config-init.ts
 *   await settleCredentialsAtStart(storage);
 *   await openHeldNamesIncident(config, storage);
 * @version-history
 *   v1.2.0 — 2026-09-26 — settleCredentialsAtStart, the start step for the app grants, personal access
 *     tokens and session rows of deleted accounts. Its record joins the same incident; a decision covers
 *     the grants and tokens its entry holds.
 *   v1.1.0 — 2026-09-26 — settleInstallsAtStart, the start step for the cortexes and ecosystem apps of
 *     deleted accounts. The incident is made from both records, a name counted once with every kind
 *     of row it holds; a record whose run an open incident has not taken joins it. A decision covers
 *     the kinds of row its entry holds.
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type {
  DeletedAtStart, HeldAccountName, HeldNameOutcome, HeldNameResolution, HeldNamesRecord, UntiedLedgerValue,
} from '../storage/types/held-names.js';
import {
  HELD_NAMES_RECORD_KEY, HELD_INSTALLS_RECORD_KEY, HELD_CREDENTIALS_RECORD_KEY,
} from '../storage/repositories/held-names.repository.js';
import { HOOK_NAMES, hookKind, indexActionRefs } from './hooks.js';
import { accountNameRef, followActionsToFullIdentity } from './hooks-overview.js';
import {
  recordSecurityIncident, findSecurityIncident, listSecurityIncidents, saveSecurityIncident,
  type IncidentBinding, type IncidentHeldName, type SecurityIncidentValue,
} from './security-incident.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/** The incident's type, code and source, which the Security page words in the reader's language. */
export const HELD_NAMES_INCIDENT_TYPE = 'held_account_names';
export const HELD_NAMES_INCIDENT_CODE = 'NAMES_TO_DECIDE';
export const HELD_NAMES_SOURCE = 'full_identity_move';

/** The records an incident of this kind is made from, the move's first. */
const RECORD_KEYS = [HELD_NAMES_RECORD_KEY, HELD_INSTALLS_RECORD_KEY, HELD_CREDENTIALS_RECORD_KEY];

/** One run of one record, as an incident names what it took: `<key>@<at>`. */
const sourceOf = (key: string, record: HeldNamesRecord): string => `${key}@${record.at}`;

/** The runs an incident took. An incident written before it listed them names the move's run by `move_at`. */
const sourcesOf = (i: SecurityIncidentValue): string[] =>
  i.sources ?? (i.move_at ? [`${HELD_NAMES_RECORD_KEY}@${i.move_at}`] : []);

/** Rows the move recorded for a name: actions, work, lines. */
const holdsRows = (n: HeldAccountName): boolean => n.actions + n.work + n.own_lines + n.naming_lines > 0;
/** Cortexes and ecosystem apps the start step recorded for a name. */
const holdsInstalls = (n: HeldAccountName): boolean => (n.cortexes ?? 0) + (n.ecosystem_apps ?? 0) > 0;
/** App grants and personal access tokens the start step for credentials recorded for a name. */
const holdsCredentials = (n: HeldAccountName): boolean => (n.app_grants ?? 0) + (n.access_tokens ?? 0) > 0;

/** Add what another record holds for the same name. */
function addCounts(into: HeldAccountName, from: HeldAccountName): void {
  into.actions += from.actions;
  into.work += from.work;
  into.own_lines += from.own_lines;
  into.naming_lines += from.naming_lines;
  into.cortexes = (into.cortexes ?? 0) + (from.cortexes ?? 0);
  into.ecosystem_apps = (into.ecosystem_apps ?? 0) + (from.ecosystem_apps ?? 0);
  into.app_grants = (into.app_grants ?? 0) + (from.app_grants ?? 0);
  into.access_tokens = (into.access_tokens ?? 0) + (from.access_tokens ?? 0);
}

/** What a start step deleted, as a list for the log: "2 cortexes, 1 ecosystem apps". */
function deletedList(d: DeletedAtStart): string {
  return Object.entries(d).filter(([kind]) => kind !== 'names').map(([kind, n]) => `${n} ${kind.replace('_', ' ')}`).join(', ');
}

/** The sentence an incident carries for a reader of the REST or MCP answer. The page words its own. */
function detailOf(names: HeldAccountName[], bindings: number, untied: number): string {
  const parts: string[] = [];
  const n = names.length;
  if (n > 0) {
    parts.push(`At start, the move to the full identity and the settling of what deleted accounts installed and were issued left the rows of ${n} account name${n === 1 ? '' : 's'} as they were: `
      + 'they are older than the account that holds the name now, so they may be that account\'s or a previous holder\'s. '
      + 'Decide each name: "holder" moves its actions, work and own ledger lines to the account that holds it and keeps its cortexes, ecosystem apps, app grants and access tokens, "previous" settles them all as a deleted account\'s.');
    if (names.some(h => (h.ecosystem_apps ?? 0) > 0)) {
      parts.push('An ecosystem app among them can still act for the account that holds its name until you decide.');
    }
    if (names.some(holdsCredentials)) {
      parts.push('The app grants and access tokens among them are refused whatever you decide, because they are older than the account.');
    }
  }
  if (bindings > 0) {
    parts.push(`${bindings} hook binding${bindings === 1 ? '' : 's'} name${bindings === 1 ? 's' : ''} no published action now. `
      + 'A gate among them lets everything pass until you bind it again on the Hooks page.');
  }
  if (untied > 0) {
    parts.push(`${untied} value${untied === 1 ? '' : 's'} in other people's ledgers name${untied === 1 ? 's' : ''} no account, and nothing ties ${untied === 1 ? 'it' : 'them'} to a person, so ${untied === 1 ? 'it stays' : 'they stay'} as ${untied === 1 ? 'it is' : 'they are'}.`);
  }
  return parts.join(' ');
}

/**
 * At start, right after the move: the cortexes and ecosystem apps of deleted accounts, once per node
 * (HeldAccountNameRepository.settleInstallsOfDeletedAccounts). What no account holds goes as an account
 * deletion takes it; what is older than the account holding its name now is recorded for the
 * operator. The node starts whatever the store answers; the next start tries again.
 */
export async function settleInstallsAtStart(config: AimeatConfig, storage: Storage): Promise<void> {
  try {
    const record = await storage.settleInstallsOfDeletedAccounts({ nodeId: config.nodeId });
    const d = record?.deleted;
    if (d && d.names > 0) {
      logger.info(`held-account-names: the cortexes and ecosystem apps of ${d.names} deleted account${d.names === 1 ? '' : 's'} went as an account deletion takes them (${deletedList(d)}).`);
    }
  } catch (err) {
    logger.error('held-account-names: the cortexes and ecosystem apps of deleted accounts were not settled at start. The next start tries again.', { error: String(err) });
  }
}

/**
 * At start, after the step above: the app grants, personal access tokens and session rows of deleted
 * accounts, once per node, under its own record (HeldAccountNameRepository.settleCredentialsOfDeletedAccounts).
 * What no account holds goes as an account deletion takes it; a grant or token created before the
 * account holding its name now is recorded for the operator. The node starts whatever the store answers.
 */
export async function settleCredentialsAtStart(storage: Storage): Promise<void> {
  try {
    const record = await storage.settleCredentialsOfDeletedAccounts();
    const d = record?.deleted;
    if (d && d.names > 0) {
      logger.info(`held-account-names: the app grants, access tokens and session rows of ${d.names} deleted account${d.names === 1 ? '' : 's'} went as an account deletion takes them (${deletedList(d)}).`);
    }
  } catch (err) {
    logger.error('held-account-names: the app grants, access tokens and session rows of deleted accounts were not settled at start. The next start tries again.', { error: String(err) });
  }
}

/** Say in the log what the incident holds, one line per name and per binding. */
function logHeld(names: HeldAccountName[], bindingsLeft: IncidentBinding[]): void {
  for (const n of names) {
    const apps = n.ecosystem_apps ?? 0;
    logger.warn(`held-account-names: the rows under the name "${n.name}" are older than the account that holds it now, and stay as they are until an operator decides on the Security page (${n.actions} actions, ${n.work} work, ${n.own_lines} own lines, ${n.naming_lines} lines naming it, ${n.cortexes ?? 0} cortexes, ${apps} ecosystem apps${apps ? ', which act for that account until then' : ''}, ${n.app_grants ?? 0} app grants and ${n.access_tokens ?? 0} access tokens, which are refused).`);
  }
  for (const b of bindingsLeft) {
    logger.warn(`held-account-names: "${b.ref}" on ${b.hook} names no published action${b.gate ? ', so this gate lets everything pass until it is bound again' : ''}.`);
  }
}

/**
 * At start: turn what the move and the start steps recorded into ONE incident, once per record. A
 * name several recorded is one entry with every count. Returns the incident's id when this start opened
 * it. A record already turned into an incident, or no record, opens nothing. So does a record with
 * nothing to show, which is then marked as seen. A record that comes after its incident was opened
 * joins it while it is open and none of its names is decided there; else it opens its own.
 */
export async function openHeldNamesIncident(config: AimeatConfig, storage: Storage): Promise<{ id?: string }> {
  const pending: Array<{ key: string; record: HeldNamesRecord }> = [];
  let byRef: Map<string, unknown>;
  let incidents: SecurityIncidentValue[];
  try {
    for (const key of RECORD_KEYS) {
      const record = await storage.getHeldNamesRecord(key);
      if (record && !record.delivered_at) pending.push({ key, record });
    }
    if (!pending.length) return {};
    byRef = indexActionRefs(await storage.listActions()).byRef;
    incidents = (await listSecurityIncidents(storage, config)).items.filter(i => i.type === HELD_NAMES_INCIDENT_TYPE);
  } catch (err) {
    logger.error('held-account-names: what the move to the full identity and the start step left was not read at start. The next start tries again.', { error: String(err) });
    return {};
  }

  // A record an incident took already, at a start that could not mark it as seen.
  const tookBy = new Map<string, string>();
  for (const i of incidents) for (const s of sourcesOf(i)) tookBy.set(s, i.id);
  const fresh = pending.filter(p => !tookBy.has(sourceOf(p.key, p.record)));

  const byName = new Map<string, IncidentHeldName>();
  for (const p of fresh) {
    for (const h of p.record.held) {
      const entry = byName.get(h.name);
      if (entry) addCounts(entry, h);
      else {
        byName.set(h.name, {
          ...h, cortexes: h.cortexes ?? 0, ecosystem_apps: h.ecosystem_apps ?? 0,
          app_grants: h.app_grants ?? 0, access_tokens: h.access_tokens ?? 0, bindings: [], status: 'open',
        });
      }
    }
  }
  const names = [...byName.values()];
  const untied: UntiedLedgerValue[] = fresh.flatMap(p => p.record.untied ?? []);
  const bindingsLeft: IncidentBinding[] = [];
  // The hook bindings name actions by the bare name, which only the move's record speaks of.
  const moveRecord = fresh.find(p => p.key === HELD_NAMES_RECORD_KEY)?.record;
  if (moveRecord) {
    for (const hook of HOOK_NAMES) {
      for (const ref of config.extensionHooks[hook] ?? []) {
        const parsed = accountNameRef(ref);
        if (!parsed) continue;
        const binding: IncidentBinding = { hook, ref: ref as string, gate: hookKind(hook) === 'gate' };
        const entry = byName.get(parsed.name);
        if (entry) entry.bindings.push(binding);
        else if (!byRef.has(ref as string)) bindingsLeft.push(binding);
      }
    }
  }

  const now = new Date().toISOString();
  let id: string | null = null;
  let opened = false;
  if (names.length || bindingsLeft.length || untied.length) {
    const sources = fresh.map(p => sourceOf(p.key, p.record));
    const open = incidents.find(i => i.status === 'open');
    const decidedThere = !!open && names.some(n => (open.names ?? []).some(e => e.name === n.name && e.status !== 'open'));
    const rec = open && !decidedThere ? await findSecurityIncident(storage, config, open.id) : null;
    if (rec) {
      // The open incident takes them: a name it lists already gets the new counts.
      const value = rec.value as SecurityIncidentValue;
      const all = (value.names ?? []).map(e => ({ ...e }));
      for (const n of names) {
        const entry = all.find(e => e.name === n.name);
        if (entry) { addCounts(entry, n); entry.bindings = [...entry.bindings, ...n.bindings]; } else all.push(n);
      }
      const left = [...(value.bindings_left ?? []), ...bindingsLeft];
      const allUntied = [...(value.untied ?? []), ...untied];
      try {
        await saveSecurityIncident(storage, rec, {
          ...value, names: all, bindings_left: left, untied: allUntied, sources: [...sourcesOf(value), ...sources],
          detail: detailOf(all, left.length, allUntied.length),
        });
      } catch (err) {
        logger.error('held-account-names: the incident could not take what the start step left. The next start tries again.', { error: String(err) });
        return {};
      }
      id = value.id;
    } else {
      const made = await recordSecurityIncident(storage, config, {
        type: HELD_NAMES_INCIDENT_TYPE, code: HELD_NAMES_INCIDENT_CODE,
        actorGhii: `system@${config.nodeId}`, actorName: '',
        detail: detailOf(names, bindingsLeft.length, untied.length),
        source: HELD_NAMES_SOURCE, moveAt: moveRecord?.at, sources,
        names, bindingsLeft, untied,
      });
      if (!made.recorded) {
        logger.error('held-account-names: the incident for what the move to the full identity and the start step left could not be saved. The next start tries again.');
        return {};
      }
      id = made.id;
      opened = true;
      emitChange('security');
    }
    logHeld(names, bindingsLeft);
  }
  for (const p of pending) {
    try {
      await storage.saveHeldNamesRecord({ ...p.record, delivered_at: now, incident: tookBy.get(sourceOf(p.key, p.record)) ?? id }, p.key);
    } catch (err) {
      logger.error('held-account-names: a record could not be marked as seen. The next start finds its incident and marks it again.', { error: String(err) });
    }
  }
  return opened && id ? { id } : {};
}

export type ResolveHeldNameResult =
  | {
    ok: true; name: string; resolution: HeldNameResolution; done: HeldNameOutcome;
    /** The hook bindings the decision moved to the holder's GHII. */
    bindings_moved: Array<{ hook: string; from: string; to: string }>;
    incident_status: 'open' | 'resolved';
  }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_INPUT' | 'CONFLICT'; message: string };

/**
 * The operator's decision on one name of the incident. Deciding a name the way it was decided
 * already answers what that decision did; deciding it the other way is a CONFLICT. The incident closes
 * when the last name is decided. A decision covers the kinds of row the name's entry holds.
 */
export async function resolveHeldName(
  config: AimeatConfig,
  storage: Storage,
  input: { incidentId: string; name: string; resolution: string },
): Promise<ResolveHeldNameResult> {
  const { name } = input;
  if (input.resolution !== 'holder' && input.resolution !== 'previous') {
    return { ok: false, code: 'INVALID_INPUT', message: 'resolution is "holder" (the rows are the account\'s that holds the name now) or "previous" (they were a previous holder\'s).' };
  }
  const resolution: HeldNameResolution = input.resolution;
  const rec = await findSecurityIncident(storage, config, input.incidentId);
  if (!rec) return { ok: false, code: 'NOT_FOUND', message: 'Incident not found' };
  const value = rec.value as SecurityIncidentValue;
  const entry = value.names?.find(n => n.name === name);
  if (!entry) return { ok: false, code: 'NOT_FOUND', message: `This incident names no account "${name}" to decide.` };
  if (entry.status !== 'open') {
    if (entry.status === resolution && entry.done) {
      return { ok: true, name, resolution, done: entry.done, bindings_moved: [], incident_status: value.status === 'open' ? 'open' : 'resolved' };
    }
    return { ok: false, code: 'CONFLICT', message: `"${name}" was decided as "${entry.status}" on ${entry.resolvedAt ?? 'an earlier day'}.` };
  }

  const rows = holdsRows(entry);
  const installs = holdsInstalls(entry);
  const credentials = holdsCredentials(entry);
  let holderGhii: string | null = null;
  if (resolution === 'holder') {
    const owner = await storage.getOwner(name);
    if (!owner) {
      return { ok: false, code: 'CONFLICT', message: `No account holds "${name}" now, so its rows can only be settled as a previous holder's.` };
    }
    if (Date.parse(owner.createdAt) !== Date.parse(entry.holder_since)) {
      return { ok: false, code: 'CONFLICT', message: `The account that holds "${name}" now is not the one this incident recorded; the rows cannot be given to it.` };
    }
    holderGhii = (await storage.getGHIIByOwner(name))?.ghii ?? null;
    if (!holderGhii && rows) {
      return { ok: false, code: 'CONFLICT', message: `The account that holds "${name}" has no full identity to move the rows to.` };
    }
  }

  const done = await storage.resolveHeldAccountName({
    name, resolution, holderGhii, namingBefore: entry.holder_since, nodeId: config.nodeId, rows, installs, credentials,
  });
  let bindingsMoved: Array<{ hook: string; from: string; to: string }> = [];
  if (resolution === 'holder' && holderGhii && rows) {
    const byRef = indexActionRefs(await storage.listActions()).byRef;
    bindingsMoved = (await followActionsToFullIdentity(config, storage, new Map([[name, holderGhii]]), byRef)).moved;
    if (bindingsMoved.length) emitChange('config');
  }

  const now = new Date().toISOString();
  const names = (value.names ?? []).map(n => n.name === name ? { ...n, status: resolution, resolvedAt: now, done } : n);
  const closed = names.every(n => n.status !== 'open');
  await saveSecurityIncident(storage, rec, { ...value, names, ...(closed ? { status: 'resolved', resolvedAt: now } : {}) });
  emitChange('work');
  logger.info(`held-account-names: "${name}" decided as ${resolution}: ${JSON.stringify(done)}`);
  return { ok: true, name, resolution, done, bindings_moved: bindingsMoved, incident_status: closed ? 'resolved' : 'open' };
}
