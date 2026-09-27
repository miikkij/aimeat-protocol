/**
 * @file src/services/held-account-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the move to the full identity left for the operator, and the operator's decision
 *   on each name. No deploy step is done by hand: the move runs when the store opens (Postgres 0086,
 *   sqlite/schema-identity-backfill.ts), acts only on positive evidence, and records what it could
 *   not place. This turns the record into ONE incident on the Security page at start, and settles a
 *   name the way the operator decides it.
 *
 *   WHAT IS HELD. Rows stored under a bare account name that are older than the account that holds
 *   the name now. They may be that person's, or a previous holder's of the name, and nothing in the
 *   data says which. They stay exactly as they were until the operator decides:
 *   - 'holder': they are the holder's. The rows, the holder's own ledger lines and the hook bindings
 *     that name the actions move to the holder's full identity (GHII).
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
 *   - openHeldNamesIncident(config, storage) — at start: the record, once, to one incident
 *   - resolveHeldName(config, storage, { incidentId, name, resolution }) — one decision
 * @usage
 *   await openHeldNamesIncident(config, storage);   // server-bootstrap/config-init.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { HeldNameOutcome, HeldNameResolution, HeldNamesRecord } from '../storage/types/held-names.js';
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

/** The sentence an incident carries for a reader of the REST or MCP answer. The page words its own. */
function detailOf(names: number, bindings: number, untied: number): string {
  const parts: string[] = [];
  if (names > 0) {
    parts.push(`The move to the full identity at start left the rows of ${names} account name${names === 1 ? '' : 's'} as they were: `
      + 'they are older than the account that holds the name now, so they may be that account\'s or a previous holder\'s. '
      + 'Decide each name: "holder" moves its rows to the account that holds it, "previous" settles them as a deleted account\'s.');
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
 * At start: turn what the move recorded into ONE incident, once. Returns the incident's id when this
 * start opened it. A record already turned into an incident, or no record, opens nothing. So does a
 * record with nothing to show, which is then marked as seen.
 */
export async function openHeldNamesIncident(config: AimeatConfig, storage: Storage): Promise<{ id?: string }> {
  let record: HeldNamesRecord | null;
  let byRef: Map<string, unknown>;
  let existing: SecurityIncidentValue | undefined;
  try {
    record = await storage.getHeldNamesRecord();
    if (!record || record.delivered_at) return {};
    byRef = indexActionRefs(await storage.listActions()).byRef;
    // An incident this record already opened, at a start that could not mark the record as seen.
    existing = (await listSecurityIncidents(storage, config)).items
      .find(i => i.type === HELD_NAMES_INCIDENT_TYPE && i.move_at === record?.at);
  } catch (err) {
    logger.error('held-account-names: what the move to the full identity left was not read at start. The next start tries again.', { error: String(err) });
    return {};
  }

  const names: IncidentHeldName[] = record.held.map(h => ({ ...h, bindings: [], status: 'open' }));
  const byName = new Map(names.map(n => [n.name, n]));
  const bindingsLeft: IncidentBinding[] = [];
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

  const now = new Date().toISOString();
  let id: string | null = existing?.id ?? null;
  if (!id && (names.length || bindingsLeft.length || record.untied.length)) {
    const opened = await recordSecurityIncident(storage, config, {
      type: HELD_NAMES_INCIDENT_TYPE, code: HELD_NAMES_INCIDENT_CODE,
      actorGhii: `system@${config.nodeId}`, actorName: '',
      detail: detailOf(names.length, bindingsLeft.length, record.untied.length),
      source: HELD_NAMES_SOURCE, moveAt: record.at,
      names, bindingsLeft, untied: record.untied,
    });
    if (!opened.recorded) {
      logger.error('held-account-names: the incident for what the move to the full identity left could not be saved. The next start tries again.');
      return {};
    }
    id = opened.id;
    emitChange('security');
    for (const n of names) {
      logger.warn(`held-account-names: the rows under the bare name "${n.name}" are older than the account that holds it now, and stay as they are until an operator decides on the Security page (${n.actions} actions, ${n.work} work, ${n.own_lines} own lines, ${n.naming_lines} lines naming it).`);
    }
    for (const b of bindingsLeft) {
      logger.warn(`held-account-names: "${b.ref}" on ${b.hook} names no published action${b.gate ? ', so this gate lets everything pass until it is bound again' : ''}.`);
    }
  }
  try {
    await storage.saveHeldNamesRecord({ ...record, delivered_at: now, incident: id });
  } catch (err) {
    logger.error('held-account-names: the record could not be marked as seen. The next start finds its incident and marks it again.', { error: String(err) });
  }
  return id && !existing ? { id } : {};
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
 * when the last name is decided.
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

  let holderGhii: string | null = null;
  if (resolution === 'holder') {
    const owner = await storage.getOwner(name);
    if (!owner) {
      return { ok: false, code: 'CONFLICT', message: `No account holds "${name}" now, so its rows can only be settled as a previous holder's.` };
    }
    if (Date.parse(owner.createdAt) !== Date.parse(entry.holder_since)) {
      return { ok: false, code: 'CONFLICT', message: `The account that holds "${name}" now is not the one this incident recorded; the rows cannot be moved to it.` };
    }
    holderGhii = (await storage.getGHIIByOwner(name))?.ghii ?? null;
    if (!holderGhii) {
      return { ok: false, code: 'CONFLICT', message: `The account that holds "${name}" has no full identity to move the rows to.` };
    }
  }

  const done = await storage.resolveHeldAccountName({ name, resolution, holderGhii, namingBefore: entry.holder_since });
  let bindingsMoved: Array<{ hook: string; from: string; to: string }> = [];
  if (resolution === 'holder' && holderGhii) {
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
