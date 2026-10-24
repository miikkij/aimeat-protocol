/**
 * @file src/services/internet-opening/opening-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading and writing the opening records and the trusted-openers record
 *   (opening-types.ts). Every change goes through updateRecord (services/record-cas.ts), so two
 *   requests changing one opening at once both land: an operator's approval and the owner's new
 *   version can arrive in the same second.
 * @structure OpeningCtx · parseOpening · readOpening · updateOpening · listOpenings · readOpeners · updateOpeners ·
 *   withEvent · activeOpeners
 * @usage const o = await updateOpening(ctx, 'alice', 'page.html', cur => ({ ...cur!, state: 'closed' }));
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import {
  openingOwner, openingKey, OPENING_PREFIX, OPENERS_KEY, OPENING_TAG, HISTORY_MAX,
  type InternetOpening, type OpeningEvent, type OpenersRecord, type TrustedOpener,
} from './opening-types.js';

export interface OpeningCtx { storage: Storage; config: AimeatConfig }

export function parseOpening(v: unknown): InternetOpening | null {
  const o = v as InternetOpening | null | undefined;
  return o && o.spec === 'aimeat.internet-opening/v1' && typeof o.id === 'string' ? o : null;
}

export async function readOpening(ctx: OpeningCtx, owner: string, filename: string): Promise<InternetOpening | null> {
  const rec = await ctx.storage.getMemory(openingOwner(ctx.config.nodeId), openingKey(owner, filename));
  return parseOpening(rec?.value);
}

/**
 * Change one app's opening. `mutate` gets the stored opening (null when there is none) and answers
 * the new one, or UNCHANGED to write nothing. It may run more than once, so it reads only its argument.
 */
export async function updateOpening(
  ctx: OpeningCtx, owner: string, filename: string,
  mutate: (cur: InternetOpening | null) => InternetOpening | typeof UNCHANGED,
): Promise<InternetOpening | null> {
  return updateRecord<InternetOpening | null>(ctx.storage, openingOwner(ctx.config.nodeId), openingKey(owner, filename),
    parseOpening, mutate, { tag: OPENING_TAG });
}

/** Every opening on this node, newest change first. One record per app that was ever opened. */
export async function listOpenings(ctx: OpeningCtx): Promise<InternetOpening[]> {
  const owner = openingOwner(ctx.config.nodeId);
  const { items } = await ctx.storage.listAllMemory({ prefix: OPENING_PREFIX, limit: 5000 });
  return items
    .filter(r => r.ownerGaii === owner)
    .map(r => parseOpening(r.value))
    .filter((o): o is InternetOpening => o !== null)
    .sort((a, b) => lastAt(b).localeCompare(lastAt(a)));
}

function lastAt(o: InternetOpening): string {
  return o.history[o.history.length - 1]?.at ?? o.requestedAt;
}

/** The opening with one more event, the oldest dropped past HISTORY_MAX. */
export function withEvent(o: InternetOpening, ev: OpeningEvent): InternetOpening {
  const history = [...o.history, ev];
  return { ...o, history: history.length > HISTORY_MAX ? history.slice(history.length - HISTORY_MAX) : history };
}

function parseOpeners(v: unknown): OpenersRecord {
  const r = v as OpenersRecord | null | undefined;
  return r && r.spec === 'aimeat.internet-openers/v1' && Array.isArray(r.openers)
    ? r : { spec: 'aimeat.internet-openers/v1', openers: [] };
}

export async function readOpeners(ctx: OpeningCtx): Promise<OpenersRecord> {
  const rec = await ctx.storage.getMemory(openingOwner(ctx.config.nodeId), OPENERS_KEY);
  return parseOpeners(rec?.value);
}

export async function updateOpeners(
  ctx: OpeningCtx, mutate: (cur: OpenersRecord) => OpenersRecord | typeof UNCHANGED,
): Promise<OpenersRecord> {
  return updateRecord<OpenersRecord>(ctx.storage, openingOwner(ctx.config.nodeId), OPENERS_KEY,
    parseOpeners, mutate, { tag: OPENING_TAG });
}

/** The openers whose trust has not ended at `now`. */
export function activeOpeners(rec: OpenersRecord, now: Date = new Date()): TrustedOpener[] {
  const t = now.toISOString();
  return rec.openers.filter(o => o.until === null || o.until > t);
}

export { UNCHANGED };
