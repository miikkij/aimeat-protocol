/**
 * @file src/services/compliance/register-drafts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registers the node can draft and nobody has stored yet, for the operator's
 *   Compliance page: the installation's own (when it keeps none) and every app's whose data map says
 *   it keeps personal data while the app keeps no register, and the customer due diligence register
 *   of every anti-money-laundering obliged organism that lacks one. Nothing here is stored. The page counts
 *   these beside the stored registers and lists them, marked as unreviewed drafts, so a node with
 *   no stored register still shows what it holds instead of a bare 0 (Jouni, 2026-10-26: "mistä
 *   kukaan tietää mitään kun mitään ei näy missään").
 *
 *   Drafted on every read from the data maps, so a draft follows the map and goes when the app or
 *   its personal data goes; once a register is stored, its place shows the stored one instead.
 * @structure APP_SCAN · registerDrafts() · obligedOrganisms() · appPartiesRegister()
 * @usage const drafts = await registerDrafts({ storage, config }, await listDocs(storage, nodeId, 'registers'));
 * @version-history
 *   v1.2.1 — 2026-11-20 — The app name comes from services/app/app-ref.ts (appDisplayName) instead
 *     of a regex of this file's own; no change in behaviour.
 *   v1.2.0 — 2026-11-19 — An organism that declared itself an anti-money-laundering obliged entity is
 *     a draft place: its customer due diligence register `org-kyc`, with its member register when it
 *     keeps none (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 *   v1.1.2 — 2026-11-15 — appPartiesRegister counts the app's people in their table (storage AppParty).
 *   v1.1.1 — 2026-11-05 — Moved unchanged from src/services/compliance-register-drafts.ts to src/services/compliance/register-drafts.ts (codebase analysis 2026-11-03, item D-h).
 *   v1.1.0 — 2026-11-01 — An app with people registered to it as outside parties, or with its signup
 *     open, drafts a register of them (appPartiesRegister; plan doc-mvwxcas3dom3, D4.4).
 *   v1.0.0 — 2026-10-26 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { appSlug, localAccountName } from '../../utils/gaii.js';
import type { ComplianceScope } from './docs.js';
import { appRegisterDraft, nodeRegistersDraft, organismRegisterDraft } from './derived.js';
import type { ComplianceRegister } from './docs-schemas.js';
import { readAppParties, signupOpen } from '../app-parties/store.js';
import { readAmlDeclarations } from '../aml/gate.js';
import { appDisplayName } from '../app/app-ref.js';

/** How many apps are read, as the gap scan reads them (compliance-scope-gaps.ts). */
const APP_SCAN = 1000;

/** One place's drafted registers. */
export interface RegisterDraftPlace {
  scope: ComplianceScope;
  items: ComplianceRegister[];
}

/**
 * The places that keep no stored register and have a draft: the installation first, then each
 * anti-money-laundering obliged organism, then each app, parked and hidden ones included. `stored` is
 * the stored registers documents (listDocs).
 *
 * An organism is listed only when it declared itself an obliged entity (a `declaration` in its `aml`
 * document), because its customer due diligence register is the one the law asks of it. One that keeps
 * no register gets the whole draft (members and customer due diligence); one that keeps registers but
 * not `org-kyc` gets that one entry, so the duty shows even beside a register a person already wrote.
 */
export async function registerDrafts(
  deps: { storage: Storage; config: AimeatConfig },
  stored: Array<{ scope: ComplianceScope; doc: { items: unknown[] } }>,
): Promise<RegisterDraftPlace[]> {
  const { storage, config } = deps;
  const keeps = new Set(stored.filter(s => s.doc.items.length).map(s => (s.scope.kind === 'app'
    ? `app:${s.scope.ownerName}/${appSlug(s.scope.app)}` : s.scope.kind === 'organism' ? `organism:${s.scope.organismId}` : s.scope.kind)));
  const out: RegisterDraftPlace[] = [];
  if (!keeps.has('node')) out.push({ scope: { kind: 'node' }, items: nodeRegistersDraft(config) });
  for (const organismId of await obligedOrganisms(storage, config.nodeId)) {
    const drafted = await organismRegisterDraft(storage, organismId, { obliged: true });
    const storedIds = new Set(stored.filter(s => s.scope.kind === 'organism' && s.scope.organismId === organismId)
      .flatMap(s => (s.doc.items as Array<{ id?: unknown }>).map(i => i.id)));
    const items = keeps.has(`organism:${organismId}`) ? drafted.filter(r => r.id === 'org-kyc' && !storedIds.has(r.id)) : drafted;
    if (items.length) out.push({ scope: { kind: 'organism', organismId }, items });
  }
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

/** The organisms that keep an anti-money-laundering declaration, each once, in the order stored. */
async function obligedOrganisms(storage: Storage, nodeId: string): Promise<string[]> {
  const ids = (await readAmlDeclarations(storage, nodeId))
    .flatMap(d => (d.scope.kind === 'organism' ? [d.scope.organismId] : []));
  return [...new Set(ids)];
}

/**
 * The people who registered to an app as its outside parties (services/app-parties/; plan
 * doc-mvwxcas3dom3, D4.4): personal data the app's owner holds as controller, a register of its own.
 * Null when nobody registered and the signup is not open.
 */
export async function appPartiesRegister(deps: { storage: Storage; config: AimeatConfig }, owner: string, filename: string): Promise<ComplianceRegister | null> {
    const rec = await readAppParties(deps.storage, `${owner}@${deps.config.nodeId}`, `${owner}/${filename}`);
    if (!(await deps.storage.countAppParties(`${owner}/${filename}`)) && !signupOpen(deps.config, rec.registration)) return null;
    const stem = appDisplayName(filename).replace(/[^A-Za-z0-9_-]+/g, '-');
    return {
        id: `app-${stem}-parties`, title: `People who registered to ${filename}`.slice(0, 300), type: 'personal', purpose: 'member', role: 'controller',
        subjects: ['people registered to the app without an account'],
        dataCategories: ['e-mail address', 'display name', 'role in the app', 'what each person keeps in the app'],
        retentionText: 'Until the person or the app\'s owner removes the registration.',
        containers: [{ kind: 'app', app: filename }], reviewEveryMonths: 12,
        answerSources: { type: 'evidence', purpose: 'evidence', role: 'evidence', subjects: 'evidence', dataCategories: 'evidence', retentionText: 'evidence', containers: 'evidence' },
    } as ComplianceRegister;
}
