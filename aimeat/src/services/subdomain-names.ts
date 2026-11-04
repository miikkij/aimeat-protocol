/**
 * @file subdomain-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a subdomain label may be, and the per-app label an app gets the first time it is
 *   opened. Moved unchanged out of routes/subdomains.ts (codebase analysis 2026-11-03, item D-d): four
 *   services imported these names from that route, and app-publish.ts imported ensureAppSubdomain from
 *   it, which closed a 14-file run-time import cycle through the route and the app publishing
 *   services. The route serves the labels; this file decides them.
 * @structure RESERVED_SUBDOMAINS, SUBDOMAIN_RE — validation primitives;
 *            DRAFT_LABEL_SUFFIX, draftBaseLabel — an app's draft origin label;
 *            ensureAppSubdomain — the app's own label, created on first use.
 * @usage import { ensureAppSubdomain, SUBDOMAIN_RE } from '../services/subdomain-names.js';
 * @version-history
 *   v1.0.0 — 2026-11-04 — Moved unchanged from routes/subdomains.ts, where the history of these
 *     names stays (codebase analysis 2026-11-03, item D-d).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { isNodeApexLabel } from './subdomain-node-labels.js';
import { autoLabelCandidates } from './subdomain-site-origin.js';

/** Subdomains that can never be mapped (infrastructure / future use). */
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'mail', 'api', 'admin', 'static', 'cdn',
  'portal', 'app', 'apps', 'docs', 'status', 'mcp',
  'portfolio',
  // The company family's own parent label: an apex subdomain named "co" would shadow
  // the whole {slug}.co.<apex> family.
  'co',
]);

/** Valid subdomain label: lowercase alphanumeric + hyphens, 2–63 chars, no edge hyphens. */
export const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * An app's UNPUBLISHED draft has an origin of its own, `<sub>--draft.<appHost>`, next to the app's
 * `<sub>.<appHost>`. The draft's code may be somebody else's (a builder, a fork's author, an AI) and
 * the owner has not published it, so it must not run where the published app's sign-in answers
 * silently: on the app's own origin it reached the silent grant with no page between (secaudit
 * 2026-10 follow-up, A2). A label with this suffix is never an app's own address.
 */
export const DRAFT_LABEL_SUFFIX = '--draft';

/** The app label a draft label belongs to, or null when the label is not a draft's. */
export function draftBaseLabel(label: string): string | null {
  if (!label.endsWith(DRAFT_LABEL_SUFFIX)) return null;
  const base = label.slice(0, -DRAFT_LABEL_SUFFIX.length);
  return SUBDOMAIN_RE.test(base) ? base : null;
}

/**
 * Ensure an app has a per-app subdomain (creating one if needed) and return its label. This makes
 * the per-app origin — and therefore seamless SSO — work WITHOUT the operator assigning subdomains
 * by hand: the first time an app is opened it auto-gets a `<sub>.apps.<domain>` from its filename
 * (collision-handled), so existing apps migrate transparently. Returns null when the app origin is
 * not configured or no valid name is free. Idempotent + race-safe.
 */
export async function ensureAppSubdomain(storage: Storage, config: AimeatConfig, ownerBare: string, filename: string): Promise<string | null> {
  if (!config.appHost) return null;
  const target = `${ownerBare}/${filename}`;
  const sites = await storage.listSubdomainSites();
  // A mapping the operator turned OFF is an answer, not an absence. Matching only enabled rows
  // meant the next open of that app minted a SECOND label for the same target (`notes-2`), so
  // "off" was worked around by the node itself within minutes and the operator never saw why.
  // A disabled mapping now means this app has no address of its own, and the callers fall back
  // to the shared path form, which serves the same app.
  const forTarget = sites.filter(s => s.kind === 'app' && s.target === target);
  // A label held since its app went away (services/held-app-labels.ts) is this target's own: the
  // owner published the same app again, so it is no longer held.
  for (const s of forTarget) if (s.heldSince) await storage.updateSubdomainSite(s.subdomain, { heldSince: null });
  const live = forTarget.find(s => s.enabled);
  if (live) return live.subdomain;
  if (forTarget.length > 0) return null;

  const taken = new Set(sites.map(s => s.subdomain));
  // A node name (login, account, pay...) is never an app's label (services/subdomain-node-labels.ts).
  const free = (n: string) => SUBDOMAIN_RE.test(n) && !RESERVED_SUBDOMAINS.has(n) && !isNodeApexLabel(n, config) && !taken.has(n) && draftBaseLabel(n) === null;
  const name = autoLabelCandidates(ownerBare, filename).find(free);
  if (!name) return null;

  const now = new Date().toISOString();
  try {
    // origin 'publisher': this label is served only on the app origin (services/subdomain-site-origin.ts).
    await storage.createSubdomainSite({ subdomain: name, kind: 'app', target, enabled: true, createdBy: `${ownerBare}@${config.nodeId}`, createdAt: now, updatedAt: now, origin: 'publisher' });
    return name;
  } catch {
    // Race: a concurrent request created the mapping — re-resolve, on the same terms as above.
    const after = (await storage.listSubdomainSites()).find(s => s.enabled && s.kind === 'app' && s.target === target);
    return after?.subdomain ?? null;
  }
}
