/**
 * @file src/services/compliance/register-drafts.ts
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
 * @structure APP_SCAN · registerDrafts() · appPartiesRegister()
 * @usage const drafts = await registerDrafts({ storage, config }, await listDocs(storage, nodeId, 'registers'));
 * @version-history
 *   v1.1.1 — 2026-11-05 — Moved unchanged from src/services/compliance-register-drafts.ts to src/services/compliance/register-drafts.ts (codebase analysis 2026-11-03, item D-h).
 *   v1.1.0 — 2026-11-01 — An app with people registered to it as outside parties, or with its signup
 *     open, drafts a register of them (appPartiesRegister; plan doc-mvwxcas3dom3, D4.4).
 *   v1.0.0 — 2026-10-26 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { appSlug, localAccountName } from '../../utils/gaii.js';
import type { ComplianceScope } from './docs.js';
import { appRegisterDraft, nodeRegistersDraft } from './derived.js';
import type { ComplianceRegister } from './docs-schemas.js';
import { readAppParties, signupOpen } from '../app-parties/store.js';

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
    const parties = await appPartiesRegister(deps, owner, a.filename);
    const items = [register, parties].filter((r): r is ComplianceRegister => !!r);
    if (items.length) out.push({ scope: { kind: 'app', ownerName: owner, app: a.filename }, items });
  }
  return out;
}

/**
 * The people who registered to an app as its outside parties (services/app-parties/; plan
 * doc-mvwxcas3dom3, D4.4): personal data the app's owner holds as controller, a register of its own.
 * Null when nobody registered and the signup is not open.
 */
export async function appPartiesRegister(deps: { storage: Storage; config: AimeatConfig }, owner: string, filename: string): Promise<ComplianceRegister | null> {
    const rec = await readAppParties(deps.storage, `${owner}@${deps.config.nodeId}`, `${owner}/${filename}`);
    if (!rec.parties.length && !signupOpen(deps.config, rec.registration)) return null;
    const stem = filename.replace(/\.html?$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-');
    return {
        id: `app-${stem}-parties`, title: `People who registered to ${filename}`.slice(0, 300), type: 'personal', purpose: 'member', role: 'controller',
        subjects: ['people registered to the app without an account'],
        dataCategories: ['e-mail address', 'display name', 'role in the app', 'what each person keeps in the app'],
        retentionText: 'Until the person or the app\'s owner removes the registration.',
        containers: [{ kind: 'app', app: filename }], reviewEveryMonths: 12,
        answerSources: { type: 'evidence', purpose: 'evidence', role: 'evidence', subjects: 'evidence', dataCategories: 'evidence', retentionText: 'evidence', containers: 'evidence' },
    } as ComplianceRegister;
}
