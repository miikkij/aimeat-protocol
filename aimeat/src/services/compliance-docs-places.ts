/**
 * @file src/services/compliance-docs-places.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One kind of compliance document across every place that keeps it, for the operator
 *   (plan doc-mvlftkh9zmc9, C7.7): the installation's own, each organism's and each app's, each place
 *   with its name, whether the caller may change it, and its entries. The admin Compliance page opens
 *   a row of its records section into this list; aimeat_compliance_register_read with scope "all"
 *   answers the same.
 *
 *   OPERATOR ONLY. Reading every place is reading the installation's compliance documents, which is
 *   the node scope's rule (compliance-docs-access.ts). `may_write` is that place's own write rule:
 *   the operator keeps the node's documents and their own apps', an organism's creator or admin keeps
 *   its, so the page offers a status change only where the same call would be accepted.
 *
 *   AN APP IS NAMED BY ITS FILENAME. Its documents are keyed by the app's slug (compliance-docs.ts);
 *   a listed app gives back the filename and title, an app no longer listed keeps the slug.
 * @structure readAllPlacesOp()
 * @usage const out = await readAllPlacesOp(deps, caller, 'registers');
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvlftkh9zmc9, C7.7).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { appSlug, localAccountName } from '../utils/gaii.js';
import type { OperatorCaller } from './operator-principal.js';
import { complianceDocAccess } from './compliance-docs-access.js';
import { listDocs, readDoc, scopeAllows, type ComplianceScope } from './compliance-docs.js';
import { derivedProcessors, frameworkVerdicts, processorsView, transfersOf } from './compliance-derived.js';
import { COMPLIANCE_DOC_KINDS, isComplianceDocKind, type ComplianceDocKind, type ComplianceDocs } from './compliance-docs-schemas.js';
import { ComplianceDocError } from './compliance-docs-ops.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** How many apps are read to give a slug its filename, as the gaps scan does. */
const APP_SCAN = 1000;

/** A place as the answer names it. */
interface PlaceName { scope: ComplianceScope['kind']; name: string; organism_id?: string; owner?: string; app?: string }

/** Every place that keeps documents of a kind, with its entries, the installation's first. */
export async function readAllPlacesOp(deps: Deps, caller: OperatorCaller, rawKind: unknown): Promise<Record<string, unknown>> {
  if (!isComplianceDocKind(rawKind)) throw new ComplianceDocError(400, 'INVALID_INPUT', `kind is one of ${COMPLIANCE_DOC_KINDS.join(', ')}.`);
  const kind: ComplianceDocKind = rawKind;
  const { storage, config } = deps;
  const a = await complianceDocAccess(storage, caller, { kind: 'node' }, 'read');
  if (!a.ok) throw new ComplianceDocError(a.status, a.code, a.message);

  const stored = await listDocs(storage, config.nodeId, kind);
  const places: Array<{ scope: ComplianceScope; doc: ComplianceDocs[typeof kind] }> = [];
  if (scopeAllows(kind, { kind: 'node' }) && !stored.some(s => s.scope.kind === 'node')) {
    places.push({ scope: { kind: 'node' }, doc: await readDoc(storage, config.nodeId, kind, { kind: 'node' }) });
  }
  places.push(...stored);

  const apps = places.some(p => p.scope.kind === 'app') ? (await storage.listApps({ limit: APP_SCAN })).apps : [];
  const appBySlug = new Map<string, { filename: string; title?: string }>();
  for (const app of apps) {
    const owner = localAccountName(app.ownerName ?? app.ownerGaii);
    if (owner) appBySlug.set(`${owner}/${appSlug(app.filename)}`, { filename: app.filename, title: app.manifest?.name });
  }

  const out = [];
  for (const { scope: raw, doc } of places) {
    let scope = raw;
    let place: PlaceName;
    if (raw.kind === 'node') place = { scope: 'node', name: config.nodeId };
    else if (raw.kind === 'organism') {
      const org = await storage.getOrganism(raw.organismId);
      place = { scope: 'organism', organism_id: raw.organismId, name: org?.name || raw.organismId };
    } else {
      const listed = appBySlug.get(`${raw.ownerName}/${appSlug(raw.app)}`);
      if (listed) scope = { ...raw, app: listed.filename };
      place = { scope: 'app', owner: raw.ownerName, app: listed?.filename ?? raw.app, name: listed?.title || listed?.filename || raw.app };
    }
    const may = await complianceDocAccess(storage, caller, scope, 'write');
    const body = kind === 'processors'
      ? (() => { const items = processorsView(derivedProcessors(config), (doc as ComplianceDocs['processors']).items); return { items, transfers: transfersOf(items) }; })()
      : kind === 'frameworks'
        ? { ...(doc as ComplianceDocs['frameworks']), verdicts: frameworkVerdicts(doc as ComplianceDocs['frameworks'], raw.kind === 'organism' ? 'organism' : 'node') }
        : doc;
    out.push({ place, may_write: may.ok, ...(body as object) });
  }
  return { kind, scope: 'all', places: out };
}
