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
 *   - liaApproveOp: the account holder approves a test. In person it is approved at once. An agent or
 *     an app that asks files the owner's question (the approval standard, approval-standard.ts): the
 *     owner allows it in person, the one who asked hears the answer, and nothing is approved until
 *     then. A model drafts; a person concludes.
 *   - liaDocumentOp: the test as Markdown, a PDF or an Excel workbook (lia-render.ts).
 * @structure liaDraftOp() · liaApproveOp() · liaDocumentOp() · LIA_APPROVAL_KIND · liaLang()
 * @usage const out = await liaDraftOp(deps, caller, { scope: 'app', app: 'crm.html' }, 'fi');
 * @version-history
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
import type { ComplianceScope } from './docs.js';
import { ComplianceDocError, scopeFrom, type ScopeInput } from './docs-ops.js';
import { liaDraftItem } from './lia-draft.js';
import { appLiaReading } from './lia-need.js';
import { renderLiaPdf, renderLiaXlsx, liaMarkdown, type LiaRenderContext } from './lia-render.js';
import {
  approveLiaAs, liaDigest, liaIncomplete, liasForRead, liaUnfinished, trialForRead, SPECIAL_REFUSAL, type LiaRefusal,
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
    scope, needed, items,
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
        + 'Leave a question out when the person has not answered it. Save with aimeat_compliance_register_write { part: "lias", app, value: { items: [...] } }. The person, not you, decides the outcome and approves: '
        + 'aimeat_compliance_register_write { part: "lias", app, item_id, set: { "status": "approved" } } asks them.',
    note: NOT_LEGAL_ADVICE,
  };
}

/**
 * Approve one test. `set` is { status: "approved", review_months? }. The account holder in person:
 * approved now. An agent or an app: the owner's question is filed and nothing changes until they allow it.
 */
export async function liaApproveOp(
  deps: Deps, caller: CallerContext, input: ScopeInput, itemId: unknown, set: unknown, opts: { dryRun?: boolean; app?: string } = {},
): Promise<Record<string, unknown>> {
  const id = typeof itemId === 'string' && itemId.trim() ? itemId.trim() : '';
  if (!id) throw new ComplianceDocError(400, 'INVALID_INPUT', 'item_id names the balancing test.');
  const s = (set && typeof set === 'object' && !Array.isArray(set) ? set : {}) as Record<string, unknown>;
  const extra = Object.keys(s).filter(k => k !== 'status' && k !== 'review_months');
  if (s.status !== 'approved' || extra.length) {
    throw new ComplianceDocError(400, 'INVALID_INPUT', 'One entry of a balancing test is not changed in place. To change answers, notes or the outcome, send the whole test as value. To approve it, send set { "status": "approved" }, with "review_months" when the review is not in 12 months.');
  }
  const reviewMonths = typeof s.review_months === 'number' && Number.isFinite(s.review_months) ? s.review_months : undefined;
  const scope = appScope(input, caller.auth);
  await allowed(deps, caller.auth, scope, 'write');
  const reading = await appLiaReading(deps, scope);
  const lia = reading.lias.find(l => l.id === id);
  if (!lia) throw new ComplianceDocError(404, 'NOT_FOUND', `No balancing test ${id} for this app. Save it first (part "lias", value).`);
  const open = liaUnfinished(lia);
  if (opts.dryRun) {
    return { kind: 'lias', scope, item: lia, stored: false, complete: !open.unanswered.length && !open.outcome && !open.summary, unfinished: open, note: 'Nothing was written.' };
  }
  if (caller.inPerson) {
    const done = await approveLiaAs(deps, scope, id, { approvedBy: caller.ownerGhii, reviewMonths });
    if (!done.ok) return raise(done);
    return { kind: 'lias', scope, stored: true, item: done.item };
  }
  // An agent or an app asks. The person is asked only about a test they can approve: complete, and
  // of a register the rule still asks a test of.
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
