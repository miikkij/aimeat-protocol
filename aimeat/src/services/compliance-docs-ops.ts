/**
 * @file src/services/compliance-docs-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operations on the compliance documents of plan doc-mvlftkh9zmc9, written once for
 *   both doors: the REST routes (routes/compliance-docs.ts) and the MCP tools
 *   aimeat_compliance_register_read and _write (mcp/compliance.ts). A door names the caller and the
 *   scope; the access check, the validation, the domain floors and the answer's shape are here.
 *
 *   - readDocOp: one document of a scope, with what the node knows beside it (processors merged with
 *     the configuration, framework verdicts, the domain floors of each register).
 *   - writeDocOp: replace one, validated; `dryRun` answers what would be stored and stores nothing. A
 *     registers write raises the containers its domains ask for (compliance-domain-floor.ts).
 *   - draftOp: the node's draft of a scope's registers (compliance-derived.ts), stored nowhere.
 *   - gapsOp: the gaps of one scope (compliance-scope-gaps.ts).
 *   - catalogOp: the data domains, the frameworks with their questions, and the label packs.
 * @structure ComplianceDocError · ScopeInput · scopeFrom() · readDocOp() · writeDocOp() · draftOp() · gapsOp() · catalogOp()
 * @usage
 *   const out = await writeDocOp(deps, caller, 'registers', { scope: 'organism', organism_id }, body, { dryRun });
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C1–C7.1).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { COMPLIANCE_DOMAINS } from '../data/compliance-domains.js';
import { COMPLIANCE_FRAMEWORKS } from '../data/compliance-frameworks.js';
import { NOT_LEGAL_ADVICE } from '../data/compliance-questionnaire.js';
import { readNodePolicy } from './classification/policy.js';
import { packStatus } from './classification/packs.js';
import type { OperatorCaller } from './operator-principal.js';
import { complianceDocAccess } from './compliance-docs-access.js';
import { readDoc, scopeAllows, writeDoc, SCOPES_OF, type ComplianceScope } from './compliance-docs.js';
import { applyDomainFloors } from './compliance-domain-floor.js';
import {
  appRegisterDraft, derivedProcessors, frameworkVerdicts, nodeRegistersDraft, organismRegisterDraft, processorsView, transfersOf,
} from './compliance-derived.js';
import { scopeGaps, nodeOnlyGaps } from './compliance-scope-gaps.js';
import { DOC_SCHEMAS, isComplianceDocKind, COMPLIANCE_DOC_KINDS, type ComplianceDocKind, type ComplianceDocs } from './compliance-docs-schemas.js';

export class ComplianceDocError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'ComplianceDocError'; }
}

/** What a caller names as a scope: the node (default), an organism, or an app (its own, or the operator names its owner). */
export interface ScopeInput {
  scope?: unknown;
  organism_id?: unknown;
  app?: unknown;
  app_owner?: unknown;
}

type Deps = { storage: Storage; config: AimeatConfig };

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The scope a caller named. An app without app_owner is the caller's own. */
export function scopeFrom(input: ScopeInput, caller: OperatorCaller): ComplianceScope {
  const kind = str(input.scope) ?? (str(input.organism_id) ? 'organism' : str(input.app) ? 'app' : 'node');
  if (kind === 'node') return { kind: 'node' };
  if (kind === 'organism') {
    const id = str(input.organism_id);
    if (!id) throw new ComplianceDocError(400, 'INVALID_INPUT', 'organism_id names the organism.');
    return { kind: 'organism', organismId: id };
  }
  if (kind === 'app') {
    const app = str(input.app);
    if (!app) throw new ComplianceDocError(400, 'INVALID_INPUT', 'app is the filename of the app, e.g. crm.html.');
    const ownerName = str(input.app_owner) ?? localAccountName(caller.owner ?? caller.sub);
    if (!ownerName) throw new ComplianceDocError(400, 'INVALID_INPUT', 'app_owner names the app\'s owner.');
    return { kind: 'app', ownerName, app };
  }
  throw new ComplianceDocError(400, 'INVALID_INPUT', 'scope is node, organism or app.');
}

async function allowed(deps: Deps, caller: OperatorCaller, kind: ComplianceDocKind | null, scope: ComplianceScope, mode: 'read' | 'write') {
  if (kind && !scopeAllows(kind, scope)) {
    throw new ComplianceDocError(400, 'INVALID_INPUT', `${kind} are kept at scope ${SCOPES_OF[kind].join(' or ')}, not ${scope.kind}.`);
  }
  const a = await complianceDocAccess(deps.storage, caller, scope, mode);
  if (!a.ok) throw new ComplianceDocError(a.status, a.code, a.message);
  return a;
}

function kindOf(v: unknown): ComplianceDocKind {
  if (!isComplianceDocKind(v)) throw new ComplianceDocError(400, 'INVALID_INPUT', `kind is one of ${COMPLIANCE_DOC_KINDS.join(', ')}.`);
  return v;
}

/** One document, with what the node knows beside it. */
export async function readDocOp(deps: Deps, caller: OperatorCaller, rawKind: unknown, input: ScopeInput): Promise<Record<string, unknown>> {
  const kind = kindOf(rawKind);
  const scope = scopeFrom(input, caller);
  await allowed(deps, caller, kind, scope, 'read');
  const doc = await readDoc(deps.storage, deps.config.nodeId, kind, scope);
  const head = { kind, scope };
  if (kind === 'processors') {
    const items = processorsView(derivedProcessors(deps.config), (doc as ComplianceDocs['processors']).items);
    return { ...head, items, transfers: transfersOf(items) };
  }
  if (kind === 'frameworks') {
    const fw = doc as ComplianceDocs['frameworks'];
    return { ...head, ...fw, verdicts: frameworkVerdicts(fw, scope.kind === 'organism' ? 'organism' : 'node'), note: NOT_LEGAL_ADVICE };
  }
  if (kind === 'registers') {
    const regs = (doc as ComplianceDocs['registers']).items;
    return { ...head, items: regs, floors: await applyDomainFloors(deps, scope, regs, { dryRun: true }) };
  }
  return { ...head, ...(doc as object) };
}

/** Replace one document. A registers write raises the containers its domains ask for. */
export async function writeDocOp(
  deps: Deps, caller: OperatorCaller, rawKind: unknown, input: ScopeInput, body: unknown, opts: { dryRun?: boolean } = {},
): Promise<Record<string, unknown>> {
  const kind = kindOf(rawKind);
  const scope = scopeFrom(input, caller);
  const a = await allowed(deps, caller, kind, scope, 'write');
  // The merged processor view carries `derived`; a caller sending it back stores only its own fields.
  const cleaned = kind === 'processors' && body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)
    ? { items: ((body as { items: Array<Record<string, unknown>> }).items).map(({ derived: _d, ...rest }) => rest) }
    : body;
  const parsed = DOC_SCHEMAS[kind].safeParse(cleaned);
  if (!parsed.success) {
    throw new ComplianceDocError(400, 'VALIDATION_ERROR', `That ${kind} document was not stored: `
      + parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const doc = parsed.data as ComplianceDocs[typeof kind];
  if (opts.dryRun) {
    const floors = kind === 'registers' ? await applyDomainFloors(deps, scope, (doc as ComplianceDocs['registers']).items, { dryRun: true }) : undefined;
    return { kind, scope, would_store: doc, stored: false, ...(floors ? { floors } : {}), note: 'Nothing was written. Show this to the person, and send it again without dry_run to store it.' };
  }
  const saved = await writeDoc(deps.storage, deps.config.nodeId, kind, scope, doc, a.by);
  const floors = kind === 'registers' ? await applyDomainFloors(deps, scope, (saved as ComplianceDocs['registers']).items) : undefined;
  return { kind, scope, stored: true, ...(saved as object), ...(floors ? { floors } : {}) };
}

/** The node's draft of a scope's registers. Stored nowhere. */
export async function draftOp(deps: Deps, caller: OperatorCaller, input: ScopeInput): Promise<Record<string, unknown>> {
  const scope = scopeFrom(input, caller);
  await allowed(deps, caller, 'registers', scope, 'read');
  if (scope.kind === 'node') return { scope, items: nodeRegistersDraft(deps.config), stored: false };
  if (scope.kind === 'organism') return { scope, items: await organismRegisterDraft(deps.storage, scope.organismId), stored: false };
  const d = await appRegisterDraft(deps.storage, `${scope.ownerName}@${deps.config.nodeId}`, scope.app);
  return {
    scope, items: d.register ? [d.register] : [], stored: false, has_data_map: d.hasMap,
    ...(d.unstated.length ? { personal_data_unstated: d.unstated } : {}),
    ...(!d.hasMap ? { note: 'This app has no data map, so nothing says what it keeps. Write its data map first (aimeat_datamap_set).' } : {}),
  };
}

/** The gaps of one scope. The node scope adds the processors, transfers and label packs. */
export async function gapsOp(deps: Deps, caller: OperatorCaller, input: ScopeInput): Promise<Record<string, unknown>> {
  const scope = scopeFrom(input, caller);
  await allowed(deps, caller, null, scope, 'read');
  const gaps = [...await scopeGaps(deps, scope), ...(scope.kind === 'node' ? await nodeOnlyGaps(deps) : [])];
  return { scope, gaps, total: gaps.length };
}

/** The reference data a person or their AI fills the documents from. Any signed-in caller reads it. */
export async function catalogOp(deps: Deps): Promise<Record<string, unknown>> {
  return {
    domains: COMPLIANCE_DOMAINS,
    frameworks: COMPLIANCE_FRAMEWORKS.map(f => ({ id: f.id, name: f.name, laws: f.laws, jurisdictions: f.jurisdictions, scopes: f.scopes, questionnaire: f.questionnaire, obligations: f.obligations })),
    packs: packStatus(await readNodePolicy(deps.storage, deps.config.nodeId)),
    kinds: COMPLIANCE_DOC_KINDS.map(k => ({ kind: k, scopes: SCOPES_OF[k] })),
    note: NOT_LEGAL_ADVICE,
  };
}
