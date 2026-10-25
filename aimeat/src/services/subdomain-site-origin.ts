/**
 * @file subdomain-site-origin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who chose a subdomain label, and where the label is served. One table holds two kinds
 *   of row: a site the operator mapped (the operator routes, the MCP subdomain_set action), and the
 *   label a publish or an open assigned to an app (routes/subdomains.ts ensureAppSubdomain). The
 *   operator's site is served on the apex namespace `<label>.<apex>` too. A publisher's label is
 *   served only on the app origin `<label>.<appHost>`: on the apex namespace the node's own pages and
 *   sign-in answer, and a publisher's script there runs in a sibling of the node's own origin
 *   (secaudit2026oct22). A row written before `origin` existed and not yet classified keeps the old
 *   rule (served on the apex), until the operator decides it.
 * @structure
 *   - autoLabelCandidates(ownerBare, filename) — the labels ensureAppSubdomain tries, in order
 *   - apexServesSite(site, label, config)     — may the apex namespace serve this row
 *   - classifySiteOrigin(site, nodeId, isOperator) — 'operator' | 'publisher' | null, on evidence only
 * @usage import { apexServesSite } from '../services/subdomain-site-origin.js';
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22): publisher labels leave the apex namespace.
 *     autoLabelCandidates moved unchanged out of routes/subdomains.ts ensureAppSubdomain.
 *   v1.0.1 — 2026-10-25 — autoLabelCandidates trims dashes in linear time (CodeQL alerts 1763, 1764).
 */
import type { AimeatConfig } from '../config.js';
import type { SubdomainSiteRecord, SubdomainSiteOrigin } from '../storage/interface.js';
import { ERASED_PARTY_PREFIX } from '../storage/erased-party.js';
import { isNodeApexLabel } from './subdomain-node-labels.js';

/**
 * The labels ensureAppSubdomain tries for an app, in order: the filename's base, the owner-prefixed
 * base, then base-2 to base-51. Unchanged since the auto-assign was written (2026-06-20), so it also
 * says whether an older row's label could have come from it.
 */
export function autoLabelCandidates(ownerBare: string, filename: string): string[] {
  let base = trimDashes(filename.replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-')).slice(0, 50);
  if (base.length < 2) base = `app-${base}`.replace(/-+$/g, '').slice(0, 50);
  return [base, trimDashes(`${ownerBare}-${base}`).slice(0, 63), ...Array.from({ length: 50 }, (_, i) => `${base}-${i + 2}`)];
}

/**
 * Leading and trailing dashes removed, in one pass. The regex `/^-+|-+$/g` did the same in quadratic
 * time on a long run of dashes inside a publisher-chosen filename (CodeQL js/polynomial-redos).
 */
function trimDashes(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) === 45) start++;
  while (end > start && s.charCodeAt(end - 1) === 45) end--;
  return s.slice(start, end);
}

/**
 * True when the apex namespace may serve this row's app at `<label>.<apex>`. A redirect row is always
 * served (a 301 runs no script). An app row is not served there when its label is a node name
 * (services/subdomain-node-labels.ts) or when a publish assigned it (origin 'publisher'). An operator
 * row and a row not yet classified are served as before.
 */
export function apexServesSite(
  site: Pick<SubdomainSiteRecord, 'kind' | 'origin'>, label: string,
  config: Pick<AimeatConfig, 'baseUrl' | 'appHost' | 'portfolioHost' | 'coHost' | 'pageHost'>,
): boolean {
  if (site.kind !== 'app') return true;
  if (isNodeApexLabel(label, config)) return false;
  return site.origin !== 'publisher';
}

/**
 * Who chose an unclassified row's label, on positive evidence only, or null when the row cannot be
 * told apart. The evidence:
 *   - ensureAppSubdomain has always written kind 'app', target `<owner>/<filename>`, createdBy
 *     `<owner>@<nodeId>` and a label from autoLabelCandidates. The operator routes write the caller's
 *     resolved identity as createdBy.
 *   - So a row whose createdBy is not the target owner's identity came from the operator routes:
 *     'operator'. A redirect row is always the operator's: the auto-assign makes app rows only.
 *   - A row with the auto-assign's createdBy and one of its labels is the publisher's: 'publisher'.
 *     When that owner is an operator, the operator could have mapped their own app by hand with the
 *     same values, so the row stays null.
 *   - An auto-assign createdBy with a label the auto-assign never makes stays null, and so does a
 *     createdBy an account erasure replaced with its pseudonym ('erased:').
 */
export function classifySiteOrigin(
  site: Pick<SubdomainSiteRecord, 'subdomain' | 'kind' | 'target' | 'createdBy'>,
  nodeId: string,
  isOperator: (accountName: string) => boolean,
): SubdomainSiteOrigin | null {
  if (site.createdBy.startsWith(ERASED_PARTY_PREFIX)) return null;
  if (site.kind !== 'app') return 'operator';
  const slash = site.target.indexOf('/');
  const owner = slash > 0 ? site.target.slice(0, slash) : '';
  const filename = slash > 0 ? site.target.slice(slash + 1) : '';
  if (!owner || site.createdBy !== `${owner}@${nodeId}`) return 'operator';
  if (isOperator(owner)) return null;
  return autoLabelCandidates(owner, filename).includes(site.subdomain) ? 'publisher' : null;
}
