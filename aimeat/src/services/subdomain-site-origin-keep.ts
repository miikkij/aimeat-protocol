/**
 * @file src/services/subdomain-site-origin-keep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: every subdomain row written before rows carried `origin` gets the
 *   origin its evidence shows, and the rows it cannot classify are named to the operator on the
 *   Security page, unchanged.
 *
 *   WHY. A publisher's auto-assigned label was served on the apex namespace `<label>.<apex>` as well
 *   as on its app origin, and on the apex namespace the node's own pages and sign-in answer
 *   (secaudit2026oct22). From now on a row with origin 'publisher' is served only on the app origin
 *   (services/subdomain-site-origin.ts apexServesSite). Rows from before have origin null (Postgres
 *   0116, SQLite safeAddColumn) and are served as before until this step or the operator classifies
 *   them.
 *
 *   THE EVIDENCE. classifySiteOrigin: 'operator' for a row the operator routes wrote, 'publisher' for a
 *   row only the auto-assign can have written. Marking 'publisher' moves that app's apex address to a
 *   redirect to its app origin, where the app keeps serving; nothing is deleted or hidden.
 *
 *   WHAT IT DOES NOT DECIDE. An auto-assign row of an app whose owner is an operator (the operator
 *   could have mapped it by hand with the same values), an auto-assign createdBy with a label the
 *   auto-assign never makes, and a createdBy an account erasure replaced. These stay null, served on
 *   the apex as before, and become ONE incident on the Security page with the decision named:
 *   PATCH /v1/admin/subdomains/{label} with origin 'publisher' (app origin only) or 'operator' (apex
 *   too), or aimeat_app_manage subdomain_set with origin.
 *
 *   WHERE. The step's record is SUBDOMAIN_SITE_ORIGIN_STEP_KEY under `system@<nodeId>`:
 *   { at, operator, publisher, unclassified }. It runs before the node serves
 *   (server-bootstrap/once-only-keep-steps.ts).
 * @structure SUBDOMAIN_SITE_ORIGIN_STEP_KEY · classifySubdomainSiteOriginsOnce(storage, config)
 * @usage await classifySubdomainSiteOriginsOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.2.0 — 2026-10-27 — The incident carries `params` (count, labels), so the Security page says it in
 *     plain words in the reader's language; the detail text is unchanged (Jouni, 2026-10-27).
 *   v1.1.0 — 2026-10-25 — The rows are read in pages of PAGE (listSubdomainSitesPage), and an owner's
 *     operator role per owner the rows name (getOwner), instead of two whole-table reads (check:unbounded-lists).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { isOperatorAccount } from '../utils/operator-account.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { recordSecurityIncident } from './security-incident.js';
import { classifySiteOrigin } from './subdomain-site-origin.js';

/** The record under `system@<nodeId>` that says the step has run. */
export const SUBDOMAIN_SITE_ORIGIN_STEP_KEY = 'migrations.secaudit2026oct22.subdomain-site-origin';

/** How many unclassified labels the incident names one by one. */
const INCIDENT_ROWS = 100;

/** How many rows one read takes. */
const PAGE = 200;

/** The owner an app row's target names (`<owner>/<filename>`), or null for a redirect or a malformed target. */
function targetOwner(site: { kind: string; target: string }): string | null {
  const slash = site.target.indexOf('/');
  return site.kind === 'app' && slash > 0 ? site.target.slice(0, slash) : null;
}

interface Outcome { operator: number; publisher: number; unclassified: string[] }

/**
 * Classify the rows without an origin, and name the rest in one Security page incident.
 * Throws when a write fails, and then leaves no record, so the next start tries again.
 * @returns what the step did, or null on a node that ran it before
 */
export async function classifySubdomainSiteOriginsOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<Outcome | null> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, SUBDOMAIN_SITE_ORIGIN_STEP_KEY);
  if (!claim) return null;
  try {
    const out: Outcome = { operator: 0, publisher: 0, unclassified: [] };
    // Whether an account is an operator, read once per distinct account the rows name.
    const operatorOf = new Map<string, boolean>();
    const isOperator = async (name: string): Promise<boolean> => {
      if (!operatorOf.has(name)) operatorOf.set(name, isOperatorAccount(await storage.getOwner(name)));
      return operatorOf.get(name)!;
    };
    // The table a bounded page at a time, in label order; a write sets only `origin`, so the keyset holds.
    let after: string | undefined;
    for (;;) {
      const page = await storage.listSubdomainSitesPage({ after, limit: PAGE });
      if (!page.length) break;
      after = page[page.length - 1]!.subdomain;
      for (const site of page.filter(s => !s.origin)) {
        const owner = targetOwner(site);
        const ownerIsOperator = owner ? await isOperator(owner) : false;
        const origin = classifySiteOrigin(site, config.nodeId, () => ownerIsOperator);
        if (!origin) { out.unclassified.push(site.subdomain); continue; }
        // updatedAt is kept: the row's content did not change.
        await storage.updateSubdomainSite(site.subdomain, { origin, updatedAt: site.updatedAt });
        out[origin] += 1;
      }
      if (page.length < PAGE) break;
    }
    if (out.unclassified.length) {
      const shown = out.unclassified.slice(0, INCIDENT_ROWS).join(', ');
      const more = out.unclassified.length > INCIDENT_ROWS ? ` and ${out.unclassified.length - INCIDENT_ROWS} more (GET /v1/admin/subdomains lists them, origin null)` : '';
      await recordSecurityIncident(storage, config, {
        type: 'subdomain_site_origin',
        code: 'SUBDOMAIN_ORIGIN_UNKNOWN',
        actorGhii: `system@${config.nodeId}`,
        actorName: 'node',
        source: 'boot',
        detail: `${out.unclassified.length} subdomain address(es) could not be told apart as your own site or a label a publish gave an app: ${shown}${more}. `
          + 'They are served as before, at <label>.<apex> and at <label>.<app host>. A label a publish gave an app is from now on served only at '
          + '<label>.<app host>, because the node\'s own pages and sign-in answer on <label>.<apex>. Decide each one: '
          + 'PATCH /v1/admin/subdomains/{label} with {"origin":"publisher"} to serve it only at its app address, or {"origin":"operator"} '
          + 'to keep it at <label>.<apex> too (aimeat_app_manage subdomain_set with origin does the same). Then resolve this incident.',
        params: { count: String(out.unclassified.length), labels: shown + (more ? ` (+${out.unclassified.length - INCIDENT_ROWS})` : '') },
      });
    }
    await claim.finish({ at: new Date().toISOString(), operator: out.operator, publisher: out.publisher, unclassified: out.unclassified });
    if (out.unclassified.length) logger.warn(`${out.unclassified.length} subdomain address(es) need the operator's decision; see the Security page`);
    return out;
  } catch (err) {
    await claim.release();
    throw err;
  }
}
