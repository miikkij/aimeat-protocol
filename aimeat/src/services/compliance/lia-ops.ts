/**
 * @file src/services/compliance/lia-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operations on an app's balancing test that are not a plain read or write of its
 *   document, written once for the REST routes (routes/compliance-docs.ts) and the MCP tools
 *   aimeat_compliance_register_read and _write (mcp/compliance.ts):
 *
 *   - liaDraftOp: whether the app needs a test, and the draft of each one it needs, filled from the
 *     app's own records (lia-draft.ts), with the question set in the reader's language. Stored nowhere.
 *   - liaApproveOp: a test is approved by the account holder in person or by an agent or an app with
 *     compliance:write, and the record says which. A test whose owner keeps the approval for
 *     themselves (`ownerApproves`) files the owner's question instead (the approval standard,
 *     approval-standard.ts): the owner allows it in person and the one who asked hears the answer.
 *     The setting compliance.balancing_test off refuses every approval.
 *   - liaDocumentOp: the test as Markdown, a PDF or an Excel workbook (lia-render.ts).
 * @structure liaDraftOp() · liaApproveOp() · liaDocumentOp() · LIA_APPROVAL_KIND · liaLang()
 * @usage const out = await liaDraftOp(deps, caller, { scope: 'app', app: 'crm.html' }, 'fi');
 * @version-history
 *   v1.1.0 — 2026-11-14 — The draft answers the server's `mode` (off answers no draft). An agent or an
 *     app with compliance:write approves a test at once unless its owner keeps the approval
 *     (`ownerApproves`, set by the owner in person); Jouni, 2026-11-14.
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { LIA_SECTIONS, type LiaLang } from '../../data/compliance-lia.js';
import { NOT_LEGAL_ADVICE } from '../../data/compliance-questionnaire.js';
import type { CallerContext } from '../caller-context.js';
import type { OperatorCaller } from '../operator-principal.js';
import { fileAsk, publishRequestedBody, requesterOf } from '../publish-requests/ask.js';
import { complianceDocAccess } from './docs-access.js';
import { patchDocItem, type ComplianceScope } from './docs.js';
import { ComplianceDocError, scopeFrom, type ScopeInput } from './docs-ops.js';
import { DOC_SCHEMAS } from './docs-schemas.js';
import type { ComplianceLia } from './lia-schemas.js';
import { liaDraftItem } from './lia-draft.js';
import { appLiaReading } from './lia-need.js';
import { renderLiaPdf, renderLiaXlsx, liaMarkdown, type LiaRenderContext } from './lia-render.js';
import {
  approveLiaAs, liaDigest, liaIncomplete, liaOff, liasForRead, liaUnfinished, trialForRead, SPECIAL_REFUSAL, type LiaRefusal,
} from './lia-write.js';

type Deps = { storage: Storage; config: AimeatConfig };
type AppScope = Extract<ComplianceScope, { kind: 'app' }>;

export const LIA_APPROVAL_KIND = 'lia-approval' as const;

export const liaLang = (v: unknown): LiaLang => (v === 'fi' || v === 'es' ? v : 'en');

function appScope(input: ScopeInput, caller: OperatorCaller): AppScope {
  const scope = scopeFrom({ ...input, scope: 'app' }, caller);
  if (scope.kind !== 'app') throw new ComplianceDocError(400, 'INVALID_INPUT', 'A balancing test belongs to an app: send app, the filename.');
  return scope;
}

async function allowed(deps: Deps, caller: OperatorCaller, scope: AppScope, mode: 'read' | 'write') {
  const a = await complianceDocAccess(deps.storage, caller, scope, mode);
  if (!a.ok) throw new ComplianceDocError(a.status, a.code, a.message);
  return a;
}

const raise = (r: LiaRefusal): never => { throw new ComplianceDocError(r.status, r.code, r.message); };

/** Why a register that rests on legitimate interests needs no test now, in one sentence. */
const NO_NEED: Record<string, string> = {
  'only-its-user': 'Only the person who uses the app sees this data, so no balancing test is asked.',
  trial: 'The app is marked as a trial, so no balancing test is asked until the trial ends.',
  'trial-expired': 'The trial of this app has ended and its owner has not said whether it goes into use. No balancing test is asked until they do.',
  'reach-unknown': 'The data map does not say who can see this data in words the server reads, so it cannot tell whether a balancing test is needed. Fix the data map first.',
};

/** Whether the app needs a balancing test, and the draft of each one. */
export async function liaDraftOp(deps: Deps, caller: OperatorCaller, input: ScopeInput, lang: LiaLang = 'en'): Promise<Record<string, unknown>> {
  const scope = appScope(input, caller);
  await allowed(deps, caller, scope, 'read');
  const mode = deps.config.balancingTest;
  if (mode === 'off') {
    return {
      scope, mode, needed: false, items: [],
      how: 'The operator of this server has switched the balancing test off (the setting compliance.balancing_test). No test is drafted or written here; tests stored before are read with part "lias".',
    };
  }
  const reading = await appLiaReading(deps, scope);
  const stored = liasForRead(reading);
  const items: Array<Record<string, unknown>> = [];
  const notNeeded: Array<Record<string, unknown>> = [];
  const notAllowed: Array<Record<string, unknown>> = [];
  for (const n of reading.needs) {
    const have = stored.find(l => l.registerId === n.register.id);
    if (n.need === 'not-allowed') {
      notAllowed.push({
        register: n.register, domains: n.domains,
        what_to_do: 'This register holds special category data. Legitimate interests alone do not carry it (GDPR art. 9): choose the ground in the register (specialBasis and the legal basis that goes with it) and write the impact assessment (part "dpias"). No balancing test is drafted.',
      });
      continue;
    }
    if (have) { items.push({ ...have, register_title: n.register.title, stored: true, unfinished: liaUnfinished(have) }); continue; }
    if (n.need === 'none') { notNeeded.push({ register: n.register, reason: n.reason, why: NO_NEED[n.reason] ?? '' }); continue; }
    const reg = reading.registers.find(r => r.id === n.register.id)!;
    const draft = liaDraftItem(deps.config, reading, reg, lang);
    items.push({ ...draft, register_title: n.register.title, stored: false, unfinished: liaUnfinished(draft) });
  }
  const needed = reading.needs.some(n => n.need === 'required');
  return {
    // `mode` required: a missing test is a gap. optional: the test is there to use, and nothing asks for it.
    scope, mode, needed, items,
    ...(notNeeded.length ? { not_needed: notNeeded } : {}),
    ...(notAllowed.length ? { not_allowed: notAllowed } : {}),
    trial: trialForRead(reading.trial),
    reach: reading.reach.reach,
    questions: LIA_SECTIONS.map(s => ({
      id: s.id, title: s.title[lang], reasoning: s.asks[lang],
      questions: s.questions.map(q => ({ id: q.id, text: q.text[lang], ...(q.fact ? { answered_from: q.fact } : {}) })),
    })),
    how: reading.needs.length === 0
      ? 'No register of this app names legitimate interests as its legal basis, so no balancing test is asked. The basis is set in the register (part "registers").'
      : 'Each item is a draft: `facts` is what the server reads from the app, and the answers it carries are the ones it can see. Ask the person the open questions, one section at a time, and write their reasoning into `notes` (by section id or question id). '
        + 'Leave a question out when the person has not answered it. Save with aimeat_compliance_register_write { part: "lias", app, value: { items: [...] } }. The outcome is the person\'s conclusion: ask them for it. '
        + 'aimeat_compliance_register_write { part: "lias", app, item_id, set: { "status": "approved" } } approves the test when the person says so; for a test whose owner approves it themselves (`ownerApproves`) it asks them instead.',
    note: NOT_LEGAL_ADVICE,
  };
}

/**
 * The two changes in place a balancing test has. `set` { status: "approved", review_months? } approves
 * it: the account holder in person, or an agent or an app with compliance:write (which the route and
 * the tool already demand), approves at once and the record says which. When the owner asked to
 * approve this test themselves (`ownerApproves`), an agent or an app files the owner's question
 * instead, and nothing changes until they allow it in person. `set` { ownerApproves: true | false }
 * is that choice, and only the account holder in person makes it (Jouni, 2026-11-14: an agent may do
 * what its person may do; the person may keep one decision for themselves).
 */
export async function liaApproveOp(
  deps: Deps, caller: CallerContext, input: ScopeInput, itemId: unknown, set: unknown, opts: { dryRun?: boolean; app?: string } = {},
): Promise<Record<string, unknown>> {
  const id = typeof itemId === 'string' && itemId.trim() ? itemId.trim() : '';
  if (!id) throw new ComplianceDocError(400, 'INVALID_INPUT', 'item_id names the balancing test.');
  const s = (set && typeof set === 'object' && !Array.isArray(set) ? set : {}) as Record<string, unknown>;
  const keys = Object.keys(s);
  const choice = keys.length === 1 && typeof s.ownerApproves === 'boolean';
  const approve = s.status === 'approved' && keys.every(k => k === 'status' || k === 'review_months');
  if (!choice && !approve) {
    throw new ComplianceDocError(400, 'INVALID_INPUT', 'One entry of a balancing test is not changed in place. To change answers, notes or the outcome, send the whole test as value. To approve it, send set { "status": "approved" }, with "review_months" when the review is not in 12 months. The owner, signed in themselves, sends set { "ownerApproves": true } to approve the test only themselves.');
  }
  const off = liaOff(deps.config);
  if (off) return raise(off);
  const scope = appScope(input, caller.auth);
  await allowed(deps, caller.auth, scope, 'write');
  const reading = await appLiaReading(deps, scope);
  const lia = reading.lias.find(l => l.id === id);
  if (!lia) throw new ComplianceDocError(404, 'NOT_FOUND', `No balancing test ${id} for this app. Save it first (part "lias", value).`);
  if (choice) return ownerChoiceOp(deps, caller, scope, lia, s.ownerApproves === true, !!opts.dryRun);
  const reviewMonths = typeof s.review_months === 'number' && Number.isFinite(s.review_months) ? s.review_months : undefined;
  const open = liaUnfinished(lia);
  if (opts.dryRun) {
    return { kind: 'lias', scope, item: lia, stored: false, complete: !open.unanswered.length && !open.outcome && !open.summary, unfinished: open, note: 'Nothing was written.' };
  }
  if (caller.inPerson || !lia.ownerApproves) {
    // The account holder's own credential is the person, signed in or not; an app grant and an
    // ecosystem app are an app; an agent is an agent.
    const kind = caller.kind === 'agent' ? 'agent' as const
      : caller.kind === 'app' || caller.kind === 'ecosystem' ? 'app' as const : 'person' as const;
    const done = await approveLiaAs(deps, scope, id, { approvedBy: kind === 'person' ? caller.ownerGhii : caller.principal, kind, reviewMonths });
    if (!done.ok) return raise(done);
    return { kind: 'lias', scope, stored: true, item: done.item };
  }
  // The owner approves this test themselves. The person is asked only about a test they can approve:
  // complete, and of a register the rule still asks a test of.
  const need = reading.needs.find(n => n.register.id === lia.registerId);
  if (!need) throw new ComplianceDocError(409, 'LIA_NOT_APPLICABLE', 'The register of this test no longer names legitimate interests as its legal basis.');
  if (need.need === 'not-allowed') return raise(SPECIAL_REFUSAL(need.register.title));
  const incomplete = liaIncomplete(lia);
  if (incomplete) return raise(incomplete);
  const ref = `${scope.ownerName}/${scope.app}`;
  const filed = await fileAsk(deps, caller.owner, requesterOf(deps, caller, opts.app), {
    kind: LIA_APPROVAL_KIND,
    target: { app_owner: scope.ownerName, app: scope.app, lia: id, digest: liaDigest(lia), ...(reviewMonths ? { review_months: reviewMonths } : {}) },
    title: `the balancing test of the app ${scope.app}`,
    name: scope.app,
    change: { field: 'status', from: 'draft', to: 'approved' },
    approval: {
      approver: 'owner',
      asks: `approve the balancing test of your app ${scope.app}`,
      why: `The test says whether legitimate interests fit the processing of personal data in ${scope.app}. Its conclusion is yours as the one who answers for the data: the answers may be drafted by an AI, and a person approves them. `
        + `Read the test first on the app's page (${(deps.config.baseUrl || '').replace(/\/$/, '')}/v1/appcat?app=${ref}).`,
      // A conclusion about the person's own processing: only they allow it, never an agent or an app.
      in_person: true,
      labels: { allow: 'Approve the test', deny: 'Do not approve', key: 'approval_lia' },
      change: { link: `/v1/appcat?app=${ref}`, key: 'approval_change.lia' },
      i18n: { key: 'approval_lia', vars: { app: scope.app, outcome: lia.outcome?.result === 'suitable' ? 'suitable' : 'not-suitable' } },
    },
  });
  if (!filed.ok) throw new ComplianceDocError(filed.status, filed.code, filed.message);
  return { kind: 'lias', scope, stored: false, item: lia, approval_request: publishRequestedBody(deps, filed) };
}

/** The owner's choice to approve one test only themselves. Only the account holder in person makes it. */
async function ownerChoiceOp(
  deps: Deps, caller: CallerContext, scope: AppScope, lia: ComplianceLia, on: boolean, dryRun: boolean,
): Promise<Record<string, unknown>> {
  if (!caller.inPerson) {
    throw new ComplianceDocError(403, 'NOT_ALLOWED', 'Whether only the owner approves this test is the owner\'s own choice: they make it signed in themselves, on the app\'s page.');
  }
  const next: ComplianceLia = { ...lia };
  if (on) next.ownerApproves = true;
  else delete next.ownerApproves;
  if (dryRun) return { kind: 'lias', scope, item: next, stored: false, note: 'Nothing was written.' };
  const saved = await patchDocItem(deps.storage, deps.config.nodeId, 'lias', scope, lia.id, (item) => {
    const changed = { ...item };
    if (on) changed.ownerApproves = true;
    else delete changed.ownerApproves;
    return changed;
  }, d => DOC_SCHEMAS.lias.parse(d), caller.ownerGhii);
  if (!saved) throw new ComplianceDocError(404, 'NOT_FOUND', `No balancing test ${lia.id} for this app.`);
  return { kind: 'lias', scope, stored: true, item: saved };
}

const FORMATS = {
  pdf: { type: 'application/pdf', ext: 'pdf' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  md: { type: 'text/markdown; charset=utf-8', ext: 'md' },
} as const;

/** One test as a file. `format` is pdf (default), xlsx or md; `lang` overrides the test's own language. */
export async function liaDocumentOp(
  deps: Deps, caller: OperatorCaller, input: ScopeInput, itemId: string, format: unknown, lang?: unknown,
): Promise<{ contentType: string; filename: string; body: Buffer }> {
  const scope = appScope(input, caller);
  await allowed(deps, caller, scope, 'read');
  const fmt = format === undefined || format === '' ? 'pdf' : format;
  if (fmt !== 'pdf' && fmt !== 'xlsx' && fmt !== 'md') throw new ComplianceDocError(400, 'INVALID_INPUT', 'format is pdf, xlsx or md.');
  const reading = await appLiaReading(deps, scope);
  const lia = liasForRead(reading).find(l => l.id === itemId);
  if (!lia) throw new ComplianceDocError(404, 'NOT_FOUND', `No balancing test ${itemId} for this app.`);
  const ctx: LiaRenderContext = {
    app: reading.app?.manifest?.name ? `${reading.app.manifest.name} (${scope.app})` : scope.app,
    registerTitle: reading.registers.find(r => r.id === lia.registerId)?.title ?? lia.registerId,
    standing: lia.standing.state,
    ...(lang === 'en' || lang === 'fi' || lang === 'es' ? { lang } : {}),
  };
  const body = fmt === 'pdf' ? await renderLiaPdf(lia, ctx) : fmt === 'xlsx' ? await renderLiaXlsx(lia, ctx) : Buffer.from(liaMarkdown(lia, ctx), 'utf8');
  return { contentType: FORMATS[fmt].type, filename: `${lia.id}.${FORMATS[fmt].ext}`, body };
}
