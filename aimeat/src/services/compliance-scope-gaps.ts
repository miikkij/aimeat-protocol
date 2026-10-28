/**
 * @file src/services/compliance-scope-gaps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gaps in the compliance documents of plan doc-mvlftkh9zmc9: what a register, an
 *   impact assessment, a request, a breach, a framework answer, a processor or a label pack leaves
 *   open. The operator's report adds them to the AI Act gaps (compliance-report.ts); an organism's
 *   creator or admin and an app's owner read the gaps of their own scope.
 *
 *   A GAP IS WHAT THE DATA SAYS, NEVER A GUESS. Each one names its scope and the entry it is about,
 *   and says in one sentence what a person can do. An unanswered question is a gap and never a "no".
 *
 *   WHAT IS READ, AND HOW MUCH. One scope reads its own documents, the label of each container a
 *   register with a data domain names, and for an app its data map and record. The node-wide list
 *   reads every stored document (one listing per kind) and the data map of every app, parked and
 *   hidden ones included (at most APP_SCAN apps; aimeat.io lists 188 on 2026-10-23).
 * @structure ScopeGapKind · ScopeGap · DEFAULT_REVIEW_MONTHS · scopeGaps() · nodeOnlyGaps() · nodeWideScopeGaps()
 * @usage
 *   const gaps = await scopeGaps({ storage, config }, { kind: 'organism', organismId });
 *   const all = await nodeWideScopeGaps({ storage, config });
 * @version-history
 *   v1.2.0 — 2026-10-28 — app-personal-data-domain-unstated: an app's personal key families whose
 *     data map names no regulated domain, with the domains the map's words point to.
 *   2026-10-27 — A register container outside the register's reach is a gap that says so (not-in-scope,
 *     secaudit2026oct26).
 *   v1.1.0 — 2026-10-25 — The node-wide list reads every app, not only the listed ones, and an app
 *     with no data map is a gap (app-personal-data-unstated): on innokas.aimeat.io the page named 3
 *     apps with personal data where the maps named 15, and said nothing of 18 apps with no map.
 *   v1.0.1 — 2026-10-24 — "An access request", and one question or N questions, in the sentences; an
 *     overdue request's evidence names its subject, which the pages show instead of its id.
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C1.5, C1.6, C2, C3.6, C4, C5, C6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { appSlug, localAccountName } from '../utils/gaii.js';
import { complianceDomainById } from '../data/compliance-domains.js';
import { readNodePolicy } from './classification/policy.js';
import { packStatus } from './classification/packs.js';
import { listDocs, readDoc, type ComplianceScope } from './compliance-docs.js';
import { applyDomainFloors } from './compliance-domain-floor.js';
import {
  appRegisterDraft, derivedProcessors, frameworkVerdicts, inEea, processorsView,
} from './compliance-derived.js';
import { UNCLASSIFIED } from './compliance-register.js';
import { appAiSignals } from './compliance-app-signals.js';
import { readAppDataMap } from './data-map/data-map-store.js';
import type { ComplianceBreach, ComplianceDpia, ComplianceRegister, ComplianceRequest } from './compliance-docs-schemas.js';

export type ScopeGapKind =
  | 'register-without-legal-basis' | 'register-without-special-basis' | 'register-without-retention'
  | 'register-review-overdue' | 'register-unknown-domain' | 'register-domain-without-container'
  | 'domain-label-below-floor' | 'dpia-missing' | 'dpia-incomplete' | 'dpia-overdue' | 'dpia-needs-prior-consultation'
  | 'request-overdue' | 'breach-risk-unassessed' | 'breach-notification-overdue' | 'breach-subjects-not-notified'
  | 'breach-hipaa-overdue' | 'framework-unanswered'
  | 'app-personal-data-without-register' | 'app-personal-data-unstated' | 'app-register-without-privacy-notice'
  | 'app-personal-data-domain-unstated' | 'retention-conflict'
  | 'processor-without-dpa' | 'processor-country-unknown' | 'transfer-without-basis' | 'processor-without-baa'
  | 'processor-not-itar-eligible' | 'classification-pack-not-accredited';

export interface ScopeGap {
  kind: ScopeGapKind;
  detail: string;
  evidence?: Record<string, unknown>;
}

export const DEFAULT_REVIEW_MONTHS = 12;
const APP_SCAN = 1000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SPECIAL = new Set(['health', 'special-category', 'biometric-genetic']);

type Deps = { storage: Storage; config: AimeatConfig };

/** How a scope names itself in a gap's evidence. */
function scopeName(scope: ComplianceScope): Record<string, string> {
  if (scope.kind === 'node') return { scope: 'node' };
  if (scope.kind === 'organism') return { scope: 'organism', organism_id: scope.organismId };
  return { scope: 'app', owner: scope.ownerName, app: scope.app };
}

const monthsAgo = (iso: string | undefined, now: number): number | null =>
  iso ? (now - Date.parse(iso)) / (30 * DAY) : null;

function registerGaps(scope: ComplianceScope, regs: ComplianceRegister[], dpias: ComplianceDpia[], now: number): ScopeGap[] {
  const out: ScopeGap[] = [];
  const at = scopeName(scope);
  for (const r of regs) {
    const ev = { ...at, register: r.id, title: r.title };
    const personal = r.type === 'personal' || r.type === 'pseudonymised';
    if (personal && !r.legalBasis?.length && !r.legalBasisText) {
      out.push({ kind: 'register-without-legal-basis', detail: `The register "${r.title}" holds personal data and names no legal basis (GDPR art. 6).`, evidence: ev });
    }
    if (personal && r.domains?.some(d => SPECIAL.has(d)) && !r.specialBasis) {
      out.push({ kind: 'register-without-special-basis', detail: `The register "${r.title}" holds special category data and names no ground under GDPR art. 9(2).`, evidence: ev });
    }
    if (personal && (r.retentionMonths === null || r.retentionMonths === undefined) && !r.retentionText) {
      out.push({ kind: 'register-without-retention', detail: `The register "${r.title}" does not say how long its data is kept, so nothing tells when it should go.`, evidence: ev });
    }
    const every = r.reviewEveryMonths ?? DEFAULT_REVIEW_MONTHS;
    const age = monthsAgo(r.reviewedAt, now);
    if (age === null || age > every) {
      out.push({ kind: 'register-review-overdue', detail: age === null ? `Nobody has marked the register "${r.title}" reviewed.` : `The register "${r.title}" was last reviewed ${Math.floor(age)} months ago; it is reviewed every ${every}.`, evidence: { ...ev, reviewedAt: r.reviewedAt ?? null } });
    }
    for (const d of r.domains ?? []) {
      if (!complianceDomainById(d)) out.push({ kind: 'register-unknown-domain', detail: `The register "${r.title}" names a data domain "${d}" this node does not know.`, evidence: { ...ev, domain: d } });
    }
    if (r.domains?.length && !r.containers?.length && scope.kind !== 'app') {
      out.push({ kind: 'register-domain-without-container', detail: `The register "${r.title}" has a regulated data domain and names no workspace, organism or app, so no classification follows it.`, evidence: ev });
    }
    const needsDpia = (r.domains ?? []).some(d => complianceDomainById(d)?.dpiaRequired);
    if (needsDpia && !dpias.some(x => x.registerId === r.id)) {
      out.push({ kind: 'dpia-missing', detail: `The register "${r.title}" holds data that needs an impact assessment (GDPR art. 35), and none is written.`, evidence: { ...ev, domains: r.domains } });
    }
  }
  for (const d of dpias) {
    const ev = { ...at, dpia: d.id, register: d.registerId };
    if (!d.completedAt) out.push({ kind: 'dpia-incomplete', detail: `The impact assessment "${d.id}" is not marked complete.`, evidence: ev });
    const age = monthsAgo(d.reviewedAt ?? d.completedAt, now);
    if (age !== null && age > DEFAULT_REVIEW_MONTHS) out.push({ kind: 'dpia-overdue', detail: `The impact assessment "${d.id}" was last reviewed ${Math.floor(age)} months ago.`, evidence: ev });
    if (d.residualRisk === 'high' && !d.priorConsultation) {
      out.push({ kind: 'dpia-needs-prior-consultation', detail: `The impact assessment "${d.id}" leaves a high risk, which goes to the supervisory authority before the processing starts (GDPR art. 36).`, evidence: ev });
    }
  }
  return out;
}

function requestGaps(scope: ComplianceScope, items: ComplianceRequest[], now: number): ScopeGap[] {
  return items
    .filter(r => r.status === 'open' && Date.parse(r.extendedTo ?? r.dueAt ?? r.receivedAt) < now)
    .map(r => ({
      kind: 'request-overdue' as const,
      detail: `${/^[aeiou]/.test(r.kind) ? 'An' : 'A'} ${r.kind} request from ${r.subject}, received ${r.receivedAt.slice(0, 10)}, is past its deadline (GDPR art. 12(3)).`,
      evidence: { ...scopeName(scope), request: r.id, subject: r.subject, dueAt: r.extendedTo ?? r.dueAt },
    }));
}

function breachGaps(scope: ComplianceScope, items: ComplianceBreach[], now: number): ScopeGap[] {
  const out: ScopeGap[] = [];
  for (const b of items) {
    const ev = { ...scopeName(scope), breach: b.id, title: b.title, discoveredAt: b.discoveredAt };
    const since = now - Date.parse(b.discoveredAt);
    const regimes = b.regimes?.length ? b.regimes : ['gdpr'];
    if (!b.riskToPeople) {
      out.push({ kind: 'breach-risk-unassessed', detail: `Nobody has said whether the breach "${b.title}" puts people at risk, which decides whether it is reported.`, evidence: ev });
      continue;
    }
    if (regimes.includes('gdpr') && b.riskToPeople !== 'none' && !b.authorityNotifiedAt && !b.notNotifiedReason && since > 72 * HOUR) {
      out.push({ kind: 'breach-notification-overdue', detail: `The breach "${b.title}" was found ${Math.floor(since / HOUR)} hours ago and is not reported to the supervisory authority, which is due within 72 hours (GDPR art. 33).`, evidence: ev });
    }
    if (regimes.includes('gdpr') && b.riskToPeople === 'high-risk' && !b.subjectsNotifiedAt && !b.notNotifiedReason) {
      out.push({ kind: 'breach-subjects-not-notified', detail: `The breach "${b.title}" puts people at high risk and they are not told (GDPR art. 34).`, evidence: ev });
    }
    if (regimes.includes('hipaa') && b.riskToPeople !== 'none' && !b.subjectsNotifiedAt && since > 60 * DAY) {
      out.push({ kind: 'breach-hipaa-overdue', detail: `The breach "${b.title}" is older than 60 days and the people it affects are not told (HIPAA 45 CFR 164.404).`, evidence: ev });
    }
  }
  return out;
}

/** The gaps of one scope's own documents, its domains' labels, and for an app its data map. */
export async function scopeGaps(deps: Deps, scope: ComplianceScope, opts: { now?: number } = {}): Promise<ScopeGap[]> {
  const { storage, config } = deps;
  const now = opts.now ?? Date.now();
  const [regs, dpias, reqs, breaches] = await Promise.all([
    readDoc(storage, config.nodeId, 'registers', scope), readDoc(storage, config.nodeId, 'dpias', scope),
    readDoc(storage, config.nodeId, 'requests', scope), readDoc(storage, config.nodeId, 'breaches', scope),
  ]);
  const out: ScopeGap[] = [
    ...registerGaps(scope, regs.items, dpias.items, now),
    ...requestGaps(scope, reqs.items, now),
    ...breachGaps(scope, breaches.items, now),
  ];
  for (const f of await applyDomainFloors(deps, scope, regs.items, { dryRun: true })) {
    if (f.outcome === 'held') continue;
    const why = f.outcome === 'off' ? 'classification is off for it, so nothing follows the domain'
      : f.outcome === 'no-label' ? 'the policy has none of the labels its domains ask for'
        : f.outcome === 'suggested' ? `a person set it lower and a raise to ${f.floor} waits for them`
          : f.outcome === 'failed' ? 'its label could not be read'
            : f.outcome === 'not-in-scope' ? 'it is an organism or workspace this register\'s keeper does not manage, so the domain does not raise its label'
              : `it is below ${f.floor}`;
    out.push({ kind: 'domain-label-below-floor', detail: `A container of the register "${f.register}": ${why}.`, evidence: { ...scopeName(scope), ...f } });
  }
  if (scope.kind !== 'app') {
    const fw = await readDoc(storage, config.nodeId, 'frameworks', scope);
    for (const v of frameworkVerdicts(fw, scope.kind)) {
      if (v.verdict.class !== UNCLASSIFIED) continue;
      const n = v.verdict.unanswered.length;
      out.push({ kind: 'framework-unanswered', detail: `${v.name.en}: ${n === 1 ? 'one question is' : `${n} questions are`} unanswered, so nothing says whether it applies.`, evidence: { ...scopeName(scope), framework: v.id, unanswered: v.verdict.unanswered } });
    }
  }
  if (scope.kind === 'app') out.push(...await appGaps(deps, scope, regs.items));
  return out;
}

/** C1.6, C1.7, C4.4: an app's data map against its registers, and its privacy notice. */
async function appGaps(deps: Deps, scope: Extract<ComplianceScope, { kind: 'app' }>, regs: ComplianceRegister[]): Promise<ScopeGap[]> {
  const out: ScopeGap[] = [];
  const at = scopeName(scope);
  const ownerGhii = `${scope.ownerName}@${deps.config.nodeId}`;
  const draft = await appRegisterDraft(deps.storage, ownerGhii, scope.app);
  const personalRegs = regs.filter(r => r.type === 'personal' || r.type === 'pseudonymised');
  if (draft.register && !personalRegs.length) {
    out.push({ kind: 'app-personal-data-without-register', detail: `The app ${scope.app} says in its data map that it keeps personal data (${draft.register.dataCategories?.length ?? 0} key families), and it has no register.`, evidence: { ...at, holds: draft.register.dataCategories ?? [] } });
  }
  if (!draft.hasMap) {
    out.push({ kind: 'app-personal-data-unstated', detail: `The app ${scope.app} has no data map, so nothing says whether it keeps personal data or where it goes.`, evidence: { ...at, families: [] } });
  } else if (draft.unstated.length) {
    out.push({ kind: 'app-personal-data-unstated', detail: `The app ${scope.app} does not say whether ${draft.unstated.length} of its key families hold personal data.`, evidence: { ...at, families: draft.unstated.slice(0, 20) } });
  }
  // A personal row with no stated domain: the label floor, the DPIA duty and the AI Act area cannot
  // follow data nobody placed. What the map's words point to rides along, so the fix is one look.
  if (draft.hasMap && draft.register) {
    const map = await readAppDataMap(deps.storage, ownerGhii, scope.app.replace(/\.html$/i, ''));
    const unstated = (map?.held ?? []).filter(r => r.personalData === 'yes' && r.domains === undefined);
    if (unstated.length) {
      const proposed = appAiSignals(map).domains.filter(d => d.source === 'proposed').map(d => d.domain);
      out.push({
        kind: 'app-personal-data-domain-unstated',
        detail: `The app ${scope.app} keeps personal data in ${unstated.length === 1 ? 'one key family' : `${unstated.length} key families`} whose data map does not say which regulated domain it falls in`
          + (proposed.length ? `; its words point to ${proposed.join(', ')}.` : '.'),
        evidence: { ...at, families: unstated.map(r => r.what).slice(0, 20), proposed },
      });
    }
  }
  if (personalRegs.length || draft.register) {
    const app = await deps.storage.getAppByOwnerName(scope.ownerName, scope.app);
    if (app && !app.manifest?.legal?.privacy) {
      out.push({ kind: 'app-register-without-privacy-notice', detail: `The app ${scope.app} keeps personal data and has no privacy notice of its own for the people who use it.`, evidence: at });
    }
  }
  if (draft.register?.retentionText && personalRegs.some(r => typeof r.retentionMonths === 'number')) {
    out.push({ kind: 'retention-conflict', detail: `The register of ${scope.app} keeps data for a limited time, and the app's data map keeps it until it is deleted. One of the two is wrong.`, evidence: at });
  }
  return out;
}

/** C4.1, C4.2, C3.6: the processors, the transfers and the label packs. Node only. */
export async function nodeOnlyGaps(deps: Deps, opts: { domainsInUse?: Set<string>; hipaaApplies?: boolean } = {}): Promise<ScopeGap[]> {
  const { storage, config } = deps;
  const out: ScopeGap[] = [];
  const stored = await readDoc(storage, config.nodeId, 'processors', { kind: 'node' });
  for (const p of processorsView(derivedProcessors(config), stored.items)) {
    const ev = { scope: 'node', processor: p.id, name: p.name };
    if (!p.dpaSignedAt) out.push({ kind: 'processor-without-dpa', detail: `No data processing agreement is recorded with ${p.name} (GDPR art. 28).`, evidence: ev });
    const eea = inEea(p.country);
    if (eea === null) out.push({ kind: 'processor-country-unknown', detail: `Nobody has written where ${p.name} processes the data, so nothing says whether it leaves the EU.`, evidence: ev });
    else if (!eea && (!p.transferBasis || p.transferBasis === 'none')) {
      out.push({ kind: 'transfer-without-basis', detail: `${p.name} processes data in ${p.country}, outside the EU and the EEA, with no transfer basis recorded (GDPR chapter V).`, evidence: ev });
    }
    if (opts.hipaaApplies && opts.domainsInUse?.has('health') && p.hipaaBaa !== true) {
      out.push({ kind: 'processor-without-baa', detail: `HIPAA applies and health data is kept here; no business associate agreement is recorded with ${p.name}.`, evidence: ev });
    }
    if (opts.domainsInUse?.has('export-controlled') && p.itarEligible !== true) {
      out.push({ kind: 'processor-not-itar-eligible', detail: `Export-controlled data is kept here, and ${p.name} is not recorded as allowed to handle it.`, evidence: ev });
    }
  }
  for (const pack of packStatus(await readNodePolicy(storage, config.nodeId))) {
    if (!pack.top) continue;
    out.push({ kind: 'classification-pack-not-accredited', detail: `${pack.name.en} is on up to ${pack.upTo}. This node is not an accredited system (Katakri, Traficom, NATO accreditation) for its two highest classes.`, evidence: { scope: 'node', pack: pack.id, upTo: pack.upTo } });
  }
  return out;
}

/** Every scope's gaps for the operator's node-wide report: stored documents, every app, the node. */
export async function nodeWideScopeGaps(deps: Deps, opts: { now?: number } = {}): Promise<ScopeGap[]> {
  const { storage, config } = deps;
  const scopes = new Map<string, ComplianceScope>([['node', { kind: 'node' }]]);
  const domainsInUse = new Set<string>();
  for (const kind of ['registers', 'requests', 'breaches', 'dpias', 'frameworks'] as const) {
    for (const { scope, doc } of await listDocs(storage, config.nodeId, kind)) {
      const id = scope.kind === 'node' ? 'node' : scope.kind === 'organism' ? `org:${scope.organismId}` : `app:${scope.ownerName}/${appSlug(scope.app)}`;
      // An app's documents are keyed by its slug; a listed app below replaces this entry with its
      // filename, which its data map and record are read by. An unlisted one keeps the slug.
      scopes.set(id, scope);
      if (kind === 'registers') for (const r of (doc as { items: ComplianceRegister[] }).items) for (const d of r.domains ?? []) domainsInUse.add(d);
    }
  }
  // Every app, parked, community and operator-hidden ones included: an app keeps personal data
  // whether or not the catalogue lists it, and the report is the operator's view of the whole node.
  const { apps } = await storage.listApps({ limit: APP_SCAN, adminView: true });
  for (const a of apps) {
    const owner = localAccountName(a.ownerName ?? a.ownerGaii);
    if (owner) scopes.set(`app:${owner}/${appSlug(a.filename)}`, { kind: 'app', ownerName: owner, app: a.filename });
  }
  const out: ScopeGap[] = [];
  for (const scope of scopes.values()) out.push(...await scopeGaps(deps, scope, opts));
  const nodeFw = frameworkVerdicts(await readDoc(storage, config.nodeId, 'frameworks', { kind: 'node' }), 'node');
  const hipaa = nodeFw.find(f => f.id === 'hipaa')?.verdict.class;
  out.push(...await nodeOnlyGaps(deps, { domainsInUse, hipaaApplies: !!hipaa && hipaa !== 'not-in-scope' && hipaa !== UNCLASSIFIED }));
  return out;
}
