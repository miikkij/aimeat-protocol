/**
 * @file src/services/kyc/jobs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's daily customer due diligence work, as two core scheduled jobs.
 *
 *   kyc-lists (core:kyc-lists, 05:10), only on a node that does customer due diligence (the mode is owners
 *   or node, and an organism or the node has declared itself; otherwise it calls nobody): fetch the sanctions lists (screening/store.ts); when one changed,
 *   screen every open card of every obliged organism again, and tell each organism's officers and staff
 *   in the bell how many cards got a new possible hit. A list that did not change costs one download.
 *
 *   kyc-daily (core:kyc-daily, 06:20): tell each organism's officers and staff how many cards are due for
 *   review (AMLR art. 26), and purge what has passed its retention (art. 77): an ended card after its
 *   retainUntil leaves a receipt with no personal data; a decided suspicion after its retainUntil goes.
 *   This is how the knowledge goes stale: each card carries its next review and its purge day.
 * @structure runKycLists · runKycDaily
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { logger } from '../../utils/logger.js';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { notify } from '../notify.js';
import { emitChange } from '../event-bus.js';
import { systemGhiiFor } from '../compliance/register.js';
import { amlMode, readAmlDeclarations } from '../aml/gate.js';
import { rescreenAll } from './cards.js';
import { refreshLists } from './screening/store.js';
import { keys, listHeads, listReports, organismsWithKyc, purgeCustomer, readSettings } from './store.js';

/** Tell an organism's officers and staff, in the bell and live. */
async function tell(storage: Storage, nodeId: string, org: string, type: string, key: string, vars: Record<string, string | number>, title: string): Promise<void> {
  const settings = await readSettings(storage, nodeId, org);
  for (const ghii of new Set([...settings.officers, ...settings.staff])) {
    await notify(storage, ghii, {
      type, title, link: `/v1/profile?tab=kyc&org=${encodeURIComponent(org)}`,
      i18n: { key, vars, orgVars: { organism: org } },
    }).catch((err) => logger.warn('[kyc] a bell notice was not stored', { org, type, error: String(err) }));
    emitChange('notifications', ghii);
  }
}

/**
 * Whether this node does customer due diligence at all: the operator lets organisms (or itself) be
 * obliged, and one of them has declared itself. A node that does none never calls the list sources.
 */
async function kycInUse(storage: Storage, config: AimeatConfig): Promise<boolean> {
  const mode = amlMode(config);
  if (mode !== 'owners' && mode !== 'node') return false;
  return (await readAmlDeclarations(storage, config.nodeId)).length > 0;
}

export async function runKycLists(storage: Storage, config: AimeatConfig, opts: { force?: boolean } = {}): Promise<{ lists: unknown; flagged: number; skipped?: string }> {
  // The daily job fetches only on a node that does customer due diligence; the operator's "fetch now" always does.
  if (!opts.force && !await kycInUse(storage, config)) return { lists: [], flagged: 0, skipped: 'customer due diligence is not in use on this node' };
  const outcome = await refreshLists(storage, config);
  if (!outcome.some(o => o.changed)) return { lists: outcome, flagged: 0 };
  const orgs = await organismsWithKyc(storage, config.nodeId);
  const flagged = await rescreenAll({ storage, config }, orgs);
  const perOrg = new Map<string, number>();
  for (const f of flagged) perOrg.set(f.org, (perOrg.get(f.org) ?? 0) + 1);
  for (const [org, count] of perOrg) {
    await tell(storage, config.nodeId, org, 'kyc.hits', 'kyc_new_hits', { count }, `${count} customer(s) have a new possible sanctions hit`);
  }
  return { lists: outcome, flagged: flagged.length };
}

export async function runKycDaily(storage: Storage, config: AimeatConfig): Promise<{ due: number; purged: number; reportsPurged: number }> {
  const today = new Date().toISOString().slice(0, 10);
  let due = 0; let purged = 0; let reportsPurged = 0;
  for (const org of await organismsWithKyc(storage, config.nodeId)) {
    const heads = await listHeads(storage, config.nodeId, org);
    const dueHere = heads.filter(h => h.status !== 'ended' && h.nextReviewAt && h.nextReviewAt <= today).length;
    due += dueHere;
    if (dueHere > 0) await tell(storage, config.nodeId, org, 'kyc.reviews', 'kyc_reviews_due', { count: dueHere }, `${dueHere} customer(s) are due for review`);
    for (const h of heads) {
      if (h.status === 'ended' && h.retainUntil && h.retainUntil < today) {
        if (await purgeCustomer(storage, config.nodeId, org, h.id, 'AMLR art. 77: five years after the relationship ended')) purged++;
      }
    }
    for (const r of await listReports(storage, config.nodeId, org)) {
      if ((r.status === 'submitted' || r.status === 'not-reported') && r.retainUntil && r.retainUntil < today) {
        if (await storage.bulkDeleteMemory([{ ownerGaii: systemGhiiFor(config.nodeId), key: keys.report(org, r.id) }])) reportsPurged++;
      }
    }
  }
  return { due, purged, reportsPurged };
}
