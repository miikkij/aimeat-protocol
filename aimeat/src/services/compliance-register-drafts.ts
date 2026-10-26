/**
 * @file src/services/compliance-register-drafts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registers the node can draft and nobody has stored yet, for the operator's
 *   Compliance page: the installation's own (when it keeps none) and every app's whose data map says
 *   it keeps personal data while the app keeps no register. Nothing here is stored. The page counts
 *   these beside the stored registers and lists them, marked as unreviewed drafts, so a node with
 *   no stored register still shows what it holds instead of a bare 0 (Jouni, 2026-10-26: "mistä
 *   kukaan tietää mitään kun mitään ei näy missään").
 *
 *   Drafted on every read from the data maps, so a draft follows the map and goes when the app or
 *   its personal data goes; once a register is stored, its place shows the stored one instead.
 * @structure APP_SCAN · registerDrafts()
 * @usage const drafts = await registerDrafts({ storage, config }, await listDocs(storage, nodeId, 'registers'));
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { appSlug, localAccountName } from '../utils/gaii.js';
import type { ComplianceScope } from './compliance-docs.js';
import { appRegisterDraft, nodeRegistersDraft } from './compliance-derived.js';
import type { ComplianceRegister } from './compliance-docs-schemas.js';

/** How many apps are read, as the gap scan reads them (compliance-scope-gaps.ts). */
const APP_SCAN = 1000;

/** One place's drafted registers. */
export interface RegisterDraftPlace {
  scope: Extract<ComplianceScope, { kind: 'node' } | { kind: 'app' }>;
  items: ComplianceRegister[];
}

/**
 * The places that keep no stored register and have a draft: the installation first, then each app,
 * parked and hidden ones included. `stored` is the stored registers documents (listDocs).
 */
export async function registerDrafts(
  deps: { storage: Storage; config: AimeatConfig },
  stored: Array<{ scope: ComplianceScope; doc: { items: unknown[] } }>,
): Promise<RegisterDraftPlace[]> {
  const { storage, config } = deps;
  const keeps = new Set(stored.filter(s => s.doc.items.length).map(s => (s.scope.kind === 'app'
    ? `app:${s.scope.ownerName}/${appSlug(s.scope.app)}` : s.scope.kind)));
  const out: RegisterDraftPlace[] = [];
  if (!keeps.has('node')) out.push({ scope: { kind: 'node' }, items: nodeRegistersDraft(config) });
  const { apps } = await storage.listApps({ limit: APP_SCAN, adminView: true });
  for (const a of apps) {
    const owner = localAccountName(a.ownerName ?? a.ownerGaii);
    if (!owner || keeps.has(`app:${owner}/${appSlug(a.filename)}`)) continue;
    const { register } = await appRegisterDraft(storage, `${owner}@${config.nodeId}`, a.filename);
    if (register) out.push({ scope: { kind: 'app', ownerName: owner, app: a.filename }, items: [register] });
  }
  return out;
}
