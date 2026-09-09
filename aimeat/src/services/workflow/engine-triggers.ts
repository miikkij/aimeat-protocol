/**
 * @file src/services/workflow/engine-triggers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The event-trigger fan-out: a memory write, an offer order or an inbound ecosystem
 *   event matched against the owner's registered `trigger.kind:'event'` / `'ecosystem.event'`
 *   workflows, each hit starting a full-live run. Extracted from engine.ts on 2026-09-09 to stay
 *   under max-file-lines; a pure move. The engine keeps three thin methods that delegate here, so
 *   the write and order sites that call them are unchanged.
 * @structure
 *   - fireMemoryWrite(deps, ownerGhii, key)
 *   - fireOfferOrdered(deps, ownerGhii, offerId)
 *   - fireEcosystemEvent(deps, app, on, version, ownerGhii, data)
 * @usage  imported by engine.ts; TriggerDeps is the engine's storage, config and startRun.
 * @version-history
 *   v1.0.0 — 2026-09-09 — Moved out of engine.ts as it stood after the `parallel` change: the
 *     loops no longer pre-check overlap themselves, because they cannot see the definition and a
 *     `parallel` workflow may overlap; startRun holds the guard with the definition in hand.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { globToRegExp } from './signal-eval.js';

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
 * What the fan-out needs from the engine. `startRun` is the engine's own, guard included. The two
 * readers are handed in rather than imported: lifecycle.ts reaches the scheduler, which reaches
 * the engine, and an import here would close that circle a second time (check:deps).
 */
export interface TriggerDeps {
  storage: Storage;
  config: AimeatConfig;
  startRun: (ownerGhii: string, ownerName: string, workflowId: string, opts: { mode: 'full-live' }) => Promise<unknown>;
  readEventTriggers: (storage: Storage, nodeId: string) => Promise<EventTriggerEntry[]>;
  readEcosystemEventTriggers: (storage: Storage, nodeId: string) => Promise<EcosystemTriggerEntry[]>;
}

// The descriptor's `trigger.kind:'event'` is registered in a system-namespace index (lifecycle.ts).
// These are called from the write/order sites; a match starts a run. The overlap guard is
// startRun's, where the definition is known: a `parallel` workflow may overlap, and a check here
// cannot see that flag and would refuse it wrongly.

export async function fireMemoryWrite(deps: TriggerDeps, ownerGhii: string, key: string): Promise<void> {
  await fireEventTriggers(deps, 'memory.write', ownerGhii, t => {
    const pat = t.match.key;
    return !!pat && globToRegExp(pat).test(key);
  });
}

export async function fireOfferOrdered(deps: TriggerDeps, ownerGhii: string, offerId: string): Promise<void> {
  await fireEventTriggers(deps, 'offer.ordered', ownerGhii, t => {
    const pat = t.match.offer;
    return !!pat && globToRegExp(pat).test(offerId);
  });
}

/**
 * Inbound ecosystem event (a GEAI emitted `on` for `app`). Fires every `ecosystem.event` trigger
 * the owner authored that matches {app, on}, whose pinned MAJOR `version` equals the incoming
 * event's major (fail-safe: a major mismatch does NOT fire), and whose optional `match` globs pass
 * against the event payload. Owner-scoped, like the other event triggers.
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
    deps.startRun(ownerGhii, ownerGhii.split('@')[0], t.workflowId, { mode: 'full-live' })
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
  deps: TriggerDeps, on: 'memory.write' | 'offer.ordered', ownerGhii: string,
  matches: (t: { match: Record<string, string> }) => boolean,
): Promise<void> {
  let triggers;
  try { triggers = await deps.readEventTriggers(deps.storage, deps.config.nodeId); }
  catch (err) { logger.error('readEventTriggers failed', { on, error: String(err) }); return; }
  const hits = triggers.filter(t => t.on === on && t.ownerGhii === ownerGhii && matches(t));
  if (hits.length === 0) return;
  for (const t of hits) {
    deps.startRun(ownerGhii, ownerGhii.split('@')[0], t.workflowId, { mode: 'full-live' })
      .catch(err => logger.error('event-triggered workflow run failed', { workflowId: t.workflowId, error: String(err) }));
  }
}
