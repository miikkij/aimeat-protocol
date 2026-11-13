/**
 * @file src/services/compliance/trial-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node asks the owner of an app whose trial has ended what happens to it: does it go
 *   into use, or is it closed. One notification per app, repeated after REASK_DAYS while the owner has
 *   not decided.
 *
 *   NOTHING CHANGES BY ITSELF. An expired trial stays a trial until its owner says the app goes into
 *   use (the trial mark's `end`) or removes the app. The node does not move it into use, and it asks
 *   no balancing test of it meanwhile (lia-need.ts, reason trial-expired); the open question shows in
 *   the compliance gaps (app-trial-expired).
 *
 *   WHAT IS READ. Every stored trial mark, one listing (listDocs). An app nobody marked has none.
 * @structure TRIAL_REASK_DAYS · askOwnersAboutExpiredTrials()
 * @usage scheduler core handler 'compliance-ask-makers' (core-jobs.ts), daily
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { appSlug } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../notify.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { docKey, listDocs } from './docs.js';
import { trialState } from './lia-need.js';
import type { ComplianceTrial } from './lia-schemas.js';
import { systemGhiiFor } from './register.js';

/** Days before the owner of the same app is asked again. */
export const TRIAL_REASK_DAYS = 14;
const DAY = 86_400_000;

/** Ask the owners of expired trials. Never throws: a question that cannot be sent is tried on the next run. */
export async function askOwnersAboutExpiredTrials(
  storage: Storage, config: AimeatConfig, opts: { now?: Date } = {},
): Promise<{ asked: number }> {
  const now = opts.now ?? new Date();
  let asked = 0;
  for (const { scope, doc } of await listDocs(storage, config.nodeId, 'trial')) {
    if (scope.kind !== 'app' || trialState(doc, now.getTime()) !== 'expired') continue;
    if (doc.askedAt && now.getTime() - Date.parse(doc.askedAt) < TRIAL_REASK_DAYS * DAY) continue;
    try {
      // The key holds the app's slug; the app's own record gives its filename and name.
      const { apps } = await storage.listApps({ ownerGaii: `${scope.ownerName}@${config.nodeId}`, limit: 1000, adminView: true });
      const app = apps.find(a => appSlug(a.filename) === appSlug(scope.app));
      if (!app) continue;
      const title = app.manifest?.name || app.filename;
      const ended = doc.expiresAt!.slice(0, 10);
      const sent = await notify(storage, `${scope.ownerName}@${config.nodeId}`, {
        type: 'compliance_trial_expired',
        title: `The trial of your app ${title} has ended`,
        body: `It ended on ${ended}. Does the app go into use, or do you close it? Nothing changes until you decide. Tell your AI "the app ${app.filename} goes into use", or remove the app.`,
        link: `/v1/appcat?app=${scope.ownerName}/${app.filename}`,
        i18n: { key: 'compliance_trial_expired', vars: { app: title, ended, file: app.filename } },
      });
      if (!sent.stored && !sent.muted) continue;
      const key = docKey('trial', scope);
      if (!key) continue;
      await updateRecord<ComplianceTrial>(storage, systemGhiiFor(config.nodeId), key,
        v => (v && typeof v === 'object' ? v as ComplianceTrial : {}),
        cur => (cur.expiresAt === doc.expiresAt && !cur.endedAt ? { ...cur, askedAt: now.toISOString() } : UNCHANGED),
        { tag: 'compliance', tags: ['compliance', 'trial'] });
      asked++;
    } catch (err) {
      logger.warn('compliance-trial: the owner of an expired trial could not be asked', { owner: scope.ownerName, app: scope.app, error: String(err) });
    }
  }
  return { asked };
}
