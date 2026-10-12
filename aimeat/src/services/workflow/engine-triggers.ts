/**
 * @file src/services/workflow/engine-triggers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The event-trigger fan-out: a memory write, an offer order, an append to a workspace
 *   row space or an inbound ecosystem event matched against the registered `trigger.kind:'event'` /
 *   `'ecosystem.event'` workflows, each hit starting a full-live run that carries the event
 *   (workflow-event.ts). Also the two ends of `coalesce`: keeping an event whose start met a live
 *   run, and starting one more run when that run ends (engine-coalesce.ts keeps what waits).
 *   Extracted from engine.ts on 2026-09-09 to stay under max-file-lines; a pure move then. The
 *   engine keeps thin methods that delegate here, so the write and order sites that call them are
 *   unchanged.
 * @structure
 *   - fireMemoryWrite(deps, ownerGhii, key)
 *   - fireOfferOrdered(deps, ownerGhii, offerId)
 *   - fireWorkspaceRows(deps, evt)
 *   - fireEcosystemEvent(deps, app, on, version, ownerGhii, data)
 *   - holdForLater(deps, ownerGhii, workflowId, event) · startWaiting(deps, ownerGhii, workflowId)
 *   - startOrphans(deps)
 * @usage  imported by engine.ts; TriggerDeps is the engine's storage, config and startRun.
 * @version-history
 *   v1.1.0 — 2026-10-13 — A run a trigger starts carries its event; `workspace.rows`, which starts a
 *     workflow of every owner who may read the row space that was appended to; and the two ends of
 *     `coalesce`.
 *   v1.0.0 — 2026-09-09 — Moved out of engine.ts as it stood after the `parallel` change: the
 *     loops no longer pre-check overlap themselves, because they cannot see the definition and a
 *     `parallel` workflow may overlap; startRun holds the guard with the definition in hand.
 *   v1.0.1 — 2026-09-26 — The owner's account name comes from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { RowsAppendedEvent } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { localAccountName } from '../../utils/gaii.js';
import { checkOrganismNamespaceAccess } from '../organism-namespace-access.js';
import { globToRegExp } from './signal-eval.js';
import { workflowEvent, rowIdsField, type WorkflowEvent } from './workflow-event.js';
import { holdEvent, takeWaitingEvent, readWaitingEvents } from './engine-coalesce.js';

/** A registered `trigger.kind:'event'` entry, as lifecycle.ts indexes it. */
export interface EventTriggerEntry {
  workflowId: string;
  ownerGhii: string;
  on: string;
  match: Record<string, string>;
}

/** A registered `trigger.kind:'ecosystem.event'` entry, as lifecycle.ts indexes it. */
export interface EcosystemTriggerEntry {
  workflowId: string;
  ownerGhii: string;
  app: string;
  on: string;
  version: number;
  match?: Record<string, string>;
}

/**
 * What the fan-out needs from the engine. `startRun` is the engine's own, guard included. The
 * readers are handed in rather than imported: lifecycle.ts reaches the scheduler, which reaches
 * the engine, and an import here would close that circle a second time (check:deps).
 */
export interface TriggerDeps {
  storage: Storage;
  config: AimeatConfig;
  startRun: (ownerGhii: string, ownerName: string, workflowId: string, opts: { mode: 'full-live'; event?: WorkflowEvent }) => Promise<unknown>;
  readEventTriggers: (storage: Storage, nodeId: string) => Promise<EventTriggerEntry[]>;
  readEcosystemEventTriggers: (storage: Storage, nodeId: string) => Promise<EcosystemTriggerEntry[]>;
  readActiveRuns: (storage: Storage, nodeId: string) => Promise<Array<{ ownerGhii: string; workflowId: string }>>;
}

// The descriptor's `trigger.kind:'event'` is registered in a system-namespace index (lifecycle.ts).
// These are called from the write/order sites; a match starts a run. The overlap guard is
// startRun's, where the definition is known: a `parallel` workflow may overlap, and a check here
// cannot see that flag and would refuse it wrongly.

export async function fireMemoryWrite(deps: TriggerDeps, ownerGhii: string, key: string): Promise<void> {
  await fireEventTriggers(deps, 'memory.write', ownerGhii, workflowEvent('memory.write', { key }), t => {
    const pat = t.match.key;
    return !!pat && globToRegExp(pat).test(key);
  });
}

export async function fireOfferOrdered(deps: TriggerDeps, ownerGhii: string, offerId: string): Promise<void> {
  await fireEventTriggers(deps, 'offer.ordered', ownerGhii, workflowEvent('offer.ordered', { offer: offerId }), t => {
    const pat = t.match.offer;
    return !!pat && globToRegExp(pat).test(offerId);
  });
}

/**
 * Rows were appended to a workspace row space. Starts every `workspace.rows` workflow whose `match`
 * names the place and whose OWNER may read that space now.
 *
 * NOT OWNER-SCOPED LIKE THE OTHERS, AND THE MEMBERSHIP CHECK IS WHY THAT IS SAFE. A memory write
 * starts the writer's own workflows, because the record is the writer's. A row belongs to the
 * workspace, and the member who needs to hear of it is usually not the one who wrote it: a mail
 * import or an alert ingest writes, and a colleague's workflow handles. So a hit is decided by the
 * rule every read of the space goes through (organism-namespace-access.ts), asked for the
 * workflow's owner at the moment of the event: an active member starts, a person who left or never
 * joined does not, and a workflow saved with somebody else's organism id in its match never runs.
 * The event carries ids and a count, never a row's content; a step reads the rows through its own
 * permission.
 */
export async function fireWorkspaceRows(deps: TriggerDeps, evt: RowsAppendedEvent): Promise<void> {
  let triggers;
  try { triggers = await deps.readEventTriggers(deps.storage, deps.config.nodeId); }
  catch (err) { logger.error('readEventTriggers failed', { on: 'workspace.rows', error: String(err) }); return; }
  const hits = triggers.filter(t => t.on === 'workspace.rows' && rowsMatch(t.match, evt));
  if (hits.length === 0) return;
  const event = workflowEvent('workspace.rows', {
    organism: evt.organismId, workspace: evt.wsId, space: evt.space,
    count: evt.rowIds.length, row_ids: rowIdsField(evt.rowIds),
  });
  const mayRead = new Map<string, boolean>();
  for (const t of hits) {
    if (!mayRead.has(t.ownerGhii)) mayRead.set(t.ownerGhii, await ownerMayRead(deps, t.ownerGhii, evt));
    if (!mayRead.get(t.ownerGhii)) continue;
    deps.startRun(t.ownerGhii, localAccountName(t.ownerGhii), t.workflowId, { mode: 'full-live', event })
      .catch(err => logger.error('rows-triggered workflow run failed', { workflowId: t.workflowId, error: String(err) }));
  }
}

/** `organism` and `workspace` are required globs; `space`, when given, is tested against the space's name and its namespace. */
function rowsMatch(match: Record<string, string>, evt: RowsAppendedEvent): boolean {
  if (!match.organism || !match.workspace) return false;
  if (!globToRegExp(match.organism).test(evt.organismId) || !globToRegExp(match.workspace).test(evt.wsId)) return false;
  if (!match.space) return true;
  const space = globToRegExp(match.space);
  return space.test(evt.space) || space.test(evt.namespace);
}

/** The shared access rule, asked for a workflow's owner: may this person read the row space? */
async function ownerMayRead(deps: TriggerDeps, ownerGhii: string, evt: RowsAppendedEvent): Promise<boolean> {
  try {
    const refusal = await checkOrganismNamespaceAccess(
      deps,
      { principal: ownerGhii, owner: localAccountName(ownerGhii), roles: ['owner'] },
      `organism.${evt.organismId}.w.${evt.wsId}.${evt.namespace}.rows`, 'read',
    );
    return refusal === null;
  } catch (err) {
    logger.error('workspace.rows access check failed', { ownerGhii, organismId: evt.organismId, error: String(err) });
    return false;
  }
}

/**
 * Inbound ecosystem event (a GEAI emitted `on` for `app`). Fires every `ecosystem.event` trigger
 * the owner authored that matches {app, on}, whose pinned MAJOR `version` equals the incoming
 * event's major (fail-safe: a major mismatch does NOT fire), and whose optional `match` globs pass
 * against the event payload. Owner-scoped, like the other event triggers. The run gets the app's
 * name and the payload fields its own `match` names, and no other field of the payload.
 */
export async function fireEcosystemEvent(
  deps: TriggerDeps, app: string, on: string, version: number, ownerGhii: string, data: Record<string, unknown>,
): Promise<void> {
  let triggers;
  try { triggers = await deps.readEcosystemEventTriggers(deps.storage, deps.config.nodeId); }
  catch (err) { logger.error('readEcosystemEventTriggers failed', { app, on, error: String(err) }); return; }
  const hits = triggers.filter(t =>
    t.ownerGhii === ownerGhii && t.app === app && t.on === on &&
    t.version === version &&                                   // fail-safe: skip on major mismatch
    ecoMatchPasses(t.match, data));
  if (hits.length === 0) return;
  for (const t of hits) {
    const named: Record<string, string> = { app };
    for (const field of Object.keys(t.match ?? {})) named[field] = String(data[field]);
    deps.startRun(ownerGhii, localAccountName(ownerGhii), t.workflowId, { mode: 'full-live', event: workflowEvent(on, named) })
      .catch(err => logger.error('ecosystem-event-triggered workflow run failed', { workflowId: t.workflowId, error: String(err) }));
  }
}

/** Each match entry is a glob tested against the same-named field in the event payload (string-coerced). */
function ecoMatchPasses(match: Record<string, string> | undefined, data: Record<string, unknown>): boolean {
  if (!match) return true;
  for (const [field, pat] of Object.entries(match)) {
    const val = data[field];
    if (val === undefined || val === null) return false;
    if (!globToRegExp(pat).test(String(val))) return false;
  }
  return true;
}

async function fireEventTriggers(
  deps: TriggerDeps, on: 'memory.write' | 'offer.ordered', ownerGhii: string, event: WorkflowEvent,
  matches: (t: { match: Record<string, string> }) => boolean,
): Promise<void> {
  let triggers;
  try { triggers = await deps.readEventTriggers(deps.storage, deps.config.nodeId); }
  catch (err) { logger.error('readEventTriggers failed', { on, error: String(err) }); return; }
  const hits = triggers.filter(t => t.on === on && t.ownerGhii === ownerGhii && matches(t));
  if (hits.length === 0) return;
  for (const t of hits) {
    deps.startRun(ownerGhii, localAccountName(ownerGhii), t.workflowId, { mode: 'full-live', event })
      .catch(err => logger.error('event-triggered workflow run failed', { workflowId: t.workflowId, error: String(err) }));
  }
}

// ── coalesce: the two ends ────────────────────────────────────────────────────

const inFlight = async (deps: TriggerDeps, ownerGhii: string, workflowId: string): Promise<boolean> =>
  (await deps.readActiveRuns(deps.storage, deps.config.nodeId)).some(a => a.ownerGhii === ownerGhii && a.workflowId === workflowId);

/**
 * An event's start met a live run, and the definition says `coalesce`: keep the event. The run may
 * have ended between the guard's look and this write, and then nothing would come to collect the
 * event, so the look is taken again after the write.
 */
export async function holdForLater(deps: TriggerDeps, ownerGhii: string, workflowId: string, event: WorkflowEvent): Promise<void> {
  await holdEvent(deps.storage, deps.config.nodeId, ownerGhii, workflowId, event);
  if (!(await inFlight(deps, ownerGhii, workflowId))) startWaiting(deps, ownerGhii, workflowId);
}

/**
 * A run of this workflow ended: start one more for what waited, when something did. Never throws
 * and is not awaited, because the caller holds the ended run's lock. A start that meets a live run
 * again (another event got there first) goes back through startRun's guard, which keeps it.
 */
export function startWaiting(deps: TriggerDeps, ownerGhii: string, workflowId: string): void {
  void (async () => {
    const event = await takeWaitingEvent(deps.storage, deps.config.nodeId, ownerGhii, workflowId);
    if (!event) return;
    await deps.startRun(ownerGhii, localAccountName(ownerGhii), workflowId, { mode: 'full-live', event });
  })().catch(err => logger.error('workflow follow-up run failed', { workflowId, error: String(err) }));
}

/** At boot: an event may wait for a run that ended while the node was down. Start those. */
export async function startOrphans(deps: TriggerDeps): Promise<void> {
  for (const w of await readWaitingEvents(deps.storage, deps.config.nodeId)) {
    if (!(await inFlight(deps, w.ownerGhii, w.workflowId))) startWaiting(deps, w.ownerGhii, w.workflowId);
  }
}
