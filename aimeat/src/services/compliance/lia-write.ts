/**
 * @file src/services/compliance/lia-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a write of an app's balancing tests, its trial mark or an organism's privacy
 *   contact becomes before it is stored, and how a balancing test is approved. docs-ops.ts calls the
 *   three prepare functions from its one write path, so REST and MCP store the same document.
 *
 *   A SAVED TEST IS A DRAFT. A write never approves: `status`, the approval fields and the facts in a
 *   caller's document are ignored. The node writes the facts again from the app as it stands, and
 *   marks each answer, note and outcome with who gave it: `ai` when an agent or an app wrote it,
 *   `human` when the account holder did in person, `evidence` for a fact answer the node can see.
 *   An approved test sent back unchanged stays approved; one sent back changed is a draft again,
 *   because the person approved other content.
 *
 *   APPROVAL IS A PERSON'S (approveLiaAs). It is refused while a question is unanswered or the
 *   outcome is missing: the node checks that the test is complete and never what it concludes. The
 *   approval keeps who could see the data and the regulated data at that moment (lia-need.ts reads a
 *   later change as "open again"), and tells the privacy contact of each organism the app is shared
 *   with, when that organism asked to hear.
 *
 *   No import of docs-ops.ts: that file imports this one. A refusal is returned, and the caller
 *   raises it in its own error type.
 *
 *   balancingTestStep() is the sentence a publish, a data map write or a register write adds to its
 *   answer when the app needs a test and has no approved one. Null for every other app, so a demo
 *   hears nothing.
 * @structure LiaRefusal · liaDigest() · liaUnfinished() · liaIncomplete() · prepareLiasWrite() · prepareTrialWrite() ·
 *   prepareContactWrite() · liasForRead() · trialForRead() · approveLiaAs() · BalancingTestStep · balancingTestStepOf() · balancingTestStep()
 * @usage const p = await prepareLiasWrite(deps, caller, scope, doc); if (!p.ok) throw new ComplianceDocError(p.status, p.code, p.message);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { LIA_QUESTION_IDS } from '../../data/compliance-lia.js';
import { stableStringify } from '../../utils/stable-json.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../notify.js';
import { actsForSomeone, type OperatorCaller } from '../operator-principal.js';
import { patchDocItem, readDoc, type ComplianceScope } from './docs.js';
import { DOC_SCHEMAS, type ComplianceDocs } from './docs-schemas.js';
import { factAnswers, liaFacts } from './lia-draft.js';
import { appLiaReading, liaStanding, trialState, type AppLiaReading, type LiaStanding, type TrialState } from './lia-need.js';
import { TRIAL_DEFAULT_DAYS, TRIAL_MAX_DAYS, type ComplianceLia, type ComplianceTrial } from './lia-schemas.js';

type Deps = { storage: Storage; config: AimeatConfig };
type AppScope = Extract<ComplianceScope, { kind: 'app' }>;

export type LiaRefusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): LiaRefusal => ({ ok: false, status, code, message });

const DAY = 86_400_000;
export const LIA_REVIEW_MONTHS = 12;

/** What a person approves: everything but the node's stamps and the approval itself. */
const contentOf = (l: ComplianceLia) => ({
  registerId: l.registerId, language: l.language ?? null, facts: l.facts ?? null,
  answers: l.answers ?? {}, notes: l.notes ?? {}, outcome: l.outcome ?? null,
});

/** The digest an approval request binds, so the owner approves the content that was there when it was asked. */
export function liaDigest(l: ComplianceLia): string {
  return createHash('sha256').update(stableStringify(contentOf(l))).digest('hex');
}

/** What a caller can change: the answers, the notes, the outcome, the language and which register it is about. */
const editable = (l: ComplianceLia) => stableStringify({
  registerId: l.registerId, language: l.language ?? null, answers: l.answers ?? {},
  notes: Object.fromEntries(Object.entries(l.notes ?? {}).filter(([, v]) => v.trim())), outcome: l.outcome ?? null,
});

/** What keeps a test from being approved: the unanswered questions and a missing outcome. Empty when it is complete. */
export function liaUnfinished(l: ComplianceLia): { unanswered: string[]; outcome: boolean; summary: boolean } {
  return {
    unanswered: LIA_QUESTION_IDS.filter(q => !l.answers?.[q]),
    outcome: !l.outcome?.result,
    summary: !l.outcome?.summary?.trim(),
  };
}

/** The refusal for a test that is not complete, naming what is open. Null when it is complete. */
export function liaIncomplete(l: ComplianceLia): LiaRefusal | null {
  const open = liaUnfinished(l);
  if (!open.unanswered.length && !open.outcome && !open.summary) return null;
  return refuse(409, 'LIA_INCOMPLETE', 'The balancing test is not complete, so it cannot be approved: '
    + [
      open.unanswered.length ? `${open.unanswered.length === 1 ? 'one question is' : `${open.unanswered.length} questions are`} unanswered (${open.unanswered.join(', ')})` : '',
      open.outcome ? 'the outcome says neither "suitable" nor "not-suitable"' : '',
      open.summary ? 'the outcome has no summary' : '',
    ].filter(Boolean).join('; ') + '.');
}

export const SPECIAL_REFUSAL = (title: string) => refuse(409, 'LIA_SPECIAL_CATEGORY',
  `The register "${title}" holds special category data (health, biometric or genetic data, or another special category). Legitimate interests alone do not carry that data: GDPR art. 9(2) names the grounds. `
  + 'No balancing test is written for it. Choose the ground in the register (specialBasis, and the legal basis that goes with it), and write the impact assessment (part "dpias").');

/** The tests a write stores: each a draft with fresh facts and marked sources, an unchanged approved one as it was. */
export async function prepareLiasWrite(
  deps: Deps, caller: OperatorCaller, scope: AppScope, doc: ComplianceDocs['lias'],
): Promise<{ ok: true; doc: ComplianceDocs['lias'] } | LiaRefusal> {
  const reading = await appLiaReading(deps, scope);
  const who = actsForSomeone(caller) ? 'ai' as const : 'human' as const;
  const seen = new Set<string>();
  const items: ComplianceLia[] = [];
  for (const inc of doc.items) {
    const reg = reading.registers.find(r => r.id === inc.registerId);
    if (!reg) return refuse(400, 'INVALID_INPUT', `registerId "${inc.registerId}" names no register of this app. Read part "registers" for its ids.`);
    if (seen.has(reg.id)) return refuse(400, 'INVALID_INPUT', `Two tests name the register "${reg.id}". A register has one balancing test.`);
    seen.add(reg.id);
    const need = reading.needs.find(n => n.register.id === reg.id);
    if (!need) {
      return refuse(409, 'LIA_NOT_APPLICABLE', `The register "${reg.title}" does not name legitimate interests as its legal basis, so it has no balancing test. The basis is set in the register (part "registers", legalBasis).`);
    }
    if (need.need === 'not-allowed') return SPECIAL_REFUSAL(reg.title);
    const prev = reading.lias.find(s => s.id === inc.id);
    if (prev?.status === 'approved' && editable(prev) === editable(inc)) { items.push(prev); continue; }
    const lang = inc.language ?? prev?.language ?? 'en';
    const facts = liaFacts(deps.config, reading, reg, lang);
    const evidence = factAnswers(facts);
    const sources: NonNullable<ComplianceLia['answerSources']> = { facts: 'evidence' };
    const kept = (key: string) => prev?.answerSources?.[key];
    for (const [q, a] of Object.entries(inc.answers ?? {})) {
      const key = `answers.${q}`;
      sources[key] = prev?.answers?.[q] === a && kept(key) ? kept(key)! : !prev?.answers?.[q] && evidence[q] === a ? 'evidence' : who;
    }
    const notes = Object.fromEntries(Object.entries(inc.notes ?? {}).filter(([, v]) => v.trim()));
    for (const [k, v] of Object.entries(notes)) {
      const key = `notes.${k}`;
      sources[key] = prev?.notes?.[k] === v && kept(key) ? kept(key)! : who;
    }
    if (inc.outcome) sources.outcome = prev?.outcome && stableStringify(prev.outcome) === stableStringify(inc.outcome) && kept('outcome') ? kept('outcome')! : who;
    items.push({
      id: inc.id, registerId: reg.id, status: 'draft', language: lang, facts,
      ...(inc.answers && Object.keys(inc.answers).length ? { answers: inc.answers } : {}),
      ...(Object.keys(notes).length ? { notes } : {}),
      ...(inc.outcome ? { outcome: inc.outcome } : {}),
      answerSources: sources,
    });
  }
  return { ok: true, doc: { items } };
}

const TrialInput = z.object({
  days: z.number().int().min(1).max(TRIAL_MAX_DAYS).optional(),
  note: z.string().max(500).optional(),
  end: z.literal(true).optional(),
}).strict();

/**
 * The trial mark a write stores. `{ days, note }` starts a trial from now (60 days when no number is
 * given, at most 180); sent again it starts the count again and is counted as a renewal. `{ end: true }`
 * says the app goes into use. The dates are the node's clock, never the caller's.
 */
export async function prepareTrialWrite(
  deps: Deps, scope: AppScope, body: unknown, now = Date.now(),
): Promise<{ ok: true; doc: ComplianceTrial } | LiaRefusal> {
  const parsed = TrialInput.safeParse(body ?? {});
  if (!parsed.success) {
    return refuse(400, 'VALIDATION_ERROR', `That trial mark was not stored: send { "days": 1 to ${TRIAL_MAX_DAYS}, "note": "..." } to start a trial, or { "end": true } when the app goes into use. `
      + parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const stored = await readDoc(deps.storage, deps.config.nodeId, 'trial', scope);
  const at = new Date(now).toISOString();
  if (parsed.data.end) {
    if (trialState(stored, now) === 'none') return refuse(409, 'NO_TRIAL', 'This app is not marked as a trial, so there is nothing to end.');
    // The open question to the owner is answered, so its date goes.
    const ended: ComplianceTrial = { ...stored, endedAt: stored.endedAt ?? at };
    delete ended.askedAt;
    return { ok: true, doc: ended };
  }
  const days = parsed.data.days ?? TRIAL_DEFAULT_DAYS;
  return {
    ok: true,
    doc: {
      startedAt: at, expiresAt: new Date(now + days * DAY).toISOString(), days,
      ...(parsed.data.note?.trim() ? { note: parsed.data.note.trim() } : {}),
      renewals: stored.startedAt ? (stored.renewals ?? 0) + 1 : 0,
    },
  };
}

/** An organism's privacy contact: the account named is one of its active members. */
export async function prepareContactWrite(
  deps: Deps, scope: Extract<ComplianceScope, { kind: 'organism' }>, body: unknown,
): Promise<{ ok: true; doc: ComplianceDocs['contact'] } | LiaRefusal> {
  const parsed = DOC_SCHEMAS.contact.safeParse(body ?? {});
  if (!parsed.success) {
    return refuse(400, 'VALIDATION_ERROR', 'That privacy contact was not stored: ' + parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  // The two fields a caller sets; the stamp is the node's (docs.ts writeDoc).
  const doc: ComplianceDocs['contact'] = {
    ...(parsed.data.privacyContact ? { privacyContact: parsed.data.privacyContact } : {}),
    ...(parsed.data.notifyApprovedLia !== undefined ? { notifyApprovedLia: parsed.data.notifyApprovedLia } : {}),
  };
  if (doc.privacyContact) {
    const m = await deps.storage.getMembership(scope.organismId, doc.privacyContact);
    if (!m || m.status !== 'active') return refuse(400, 'INVALID_INPUT', `privacyContact "${doc.privacyContact}" is not an active member of this organism. Send a member's account name.`);
  }
  return { ok: true, doc };
}

/** An app's tests as a read answers them: each with where it stands against the app as it is now. */
export function liasForRead(reading: AppLiaReading, now = Date.now()): Array<ComplianceLia & { standing: LiaStanding }> {
  return reading.lias.map((l) => {
    const need = reading.needs.find(n => n.register.id === l.registerId);
    return { ...l, standing: liaStanding(l, now, { reach: reading.reach.reach, domains: need?.domains ?? reading.mapDomains }) };
  });
}

/** A trial mark as a read answers it. */
export function trialForRead(trial: ComplianceTrial, now = Date.now()): ComplianceTrial & { state: TrialState } {
  return { ...trial, state: trialState(trial, now) };
}

/** The organisms an app is shared with: the one its access names, and each a register of it names as a container. */
function organismsOf(reading: AppLiaReading): string[] {
  const out = new Set<string>();
  const access = reading.app?.access;
  if (typeof access === 'string' && access.startsWith('organism:')) out.add(access.slice('organism:'.length));
  for (const r of reading.registers) for (const c of r.containers ?? []) if (c.organism_id) out.add(c.organism_id);
  return [...out];
}

/**
 * Approve one test as `approvedBy`, the account holder. `digest`, when given, is the content the
 * person was shown: a test changed since is not approved. Answers the stored test or why not.
 */
export async function approveLiaAs(
  deps: Deps, scope: AppScope, liaId: string,
  by: { approvedBy: string; requestedBy?: string; digest?: string; reviewMonths?: number; now?: number },
): Promise<{ ok: true; item: ComplianceLia } | LiaRefusal> {
  const { storage, config } = deps;
  const now = by.now ?? Date.now();
  const reading = await appLiaReading(deps, scope, { now });
  const lia = reading.lias.find(l => l.id === liaId);
  if (!lia) return refuse(404, 'NOT_FOUND', `No balancing test ${liaId} for this app.`);
  if (by.digest && liaDigest(lia) !== by.digest) return refuse(409, 'LIA_CHANGED', 'The balancing test changed after the approval was asked for, so it was not approved. Ask again for the test as it is now.');
  const need = reading.needs.find(n => n.register.id === lia.registerId);
  if (!need) return refuse(409, 'LIA_NOT_APPLICABLE', 'The register of this test no longer names legitimate interests as its legal basis.');
  if (need.need === 'not-allowed') return SPECIAL_REFUSAL(need.register.title);
  const incomplete = liaIncomplete(lia);
  if (incomplete) return incomplete;
  const months = Math.min(Math.max(Math.round(by.reviewMonths ?? LIA_REVIEW_MONTHS), 1), 60);
  const review = new Date(now);
  review.setUTCMonth(review.getUTCMonth() + months);
  const saved = await patchDocItem(storage, config.nodeId, 'lias', scope, liaId, (item) => {
    const next: Record<string, unknown> = {
      ...item, status: 'approved', approvedBy: by.approvedBy, approvedAt: new Date(now).toISOString(), reviewAt: review.toISOString(),
      approvedOn: { reach: reading.reach.reach, domains: need.domains },
    };
    // Who asked for this approval; an earlier approval's asker does not carry over.
    if (by.requestedBy) next.requestedBy = by.requestedBy;
    else delete next.requestedBy;
    return next;
  }, d => DOC_SCHEMAS.lias.parse(d), by.approvedBy);
  if (!saved) return refuse(404, 'NOT_FOUND', `No balancing test ${liaId} for this app.`);
  const item = saved as unknown as ComplianceLia;

  // The privacy contact of each organism the app is shared with, when that organism asked to hear.
  for (const organismId of organismsOf(reading)) {
    try {
      const contact = await readDoc(storage, config.nodeId, 'contact', { kind: 'organism', organismId });
      if (!contact.privacyContact || contact.notifyApprovedLia === false) continue;
      const m = await storage.getMembership(organismId, contact.privacyContact);
      if (!m || m.status !== 'active') continue;
      const title = reading.app?.manifest?.name || scope.app;
      await notify(storage, `${contact.privacyContact}@${config.nodeId}`, {
        type: 'compliance_lia_approved',
        title: `The balancing test of the app ${title} was approved`,
        body: `${by.approvedBy} approved it. The outcome: legitimate interests ${item.outcome?.result === 'suitable' ? 'fit' : 'do not fit'} the processing in the register "${need.register.title}".`,
        link: `/v1/appcat?app=${scope.ownerName}/${scope.app}`,
        i18n: { key: item.outcome?.result === 'suitable' ? 'compliance_lia_approved' : 'compliance_lia_approved_unsuitable', vars: { app: title, by: by.approvedBy, register: need.register.title } },
      });
    } catch (err) {
      logger.warn('compliance: the privacy contact could not be told of an approved balancing test', { organismId, error: String(err) });
    }
  }
  return { ok: true, item };
}

export interface BalancingTestStep {
  state: 'missing' | 'draft' | 'open-again' | 'choose-another-basis';
  registers: string[];
  /** What to tell the person, in one or two sentences. */
  text: string;
  draft?: { tool: string; rest: string };
  url: string;
}

/**
 * What an answer about an app adds when the app needs a balancing test and has no approved one.
 * Null when nothing is asked: no register on legitimate interests, data only its user sees, a trial.
 */
export function balancingTestStepOf(config: AimeatConfig, scope: AppScope, reading: AppLiaReading, now = Date.now()): BalancingTestStep | null {
  const url = `${(config.baseUrl || '').replace(/\/$/, '')}/v1/appcat?app=${scope.ownerName}/${scope.app}`;
  const special = reading.needs.filter(n => n.need === 'not-allowed');
  if (special.length) {
    return {
      state: 'choose-another-basis', registers: special.map(n => n.register.title), url,
      text: `The register ${special.map(n => `"${n.register.title}"`).join(', ')} names legitimate interests for special category data. That basis alone does not carry such data (GDPR art. 9). Choose the ground in the register and write the impact assessment; no balancing test is drafted.`,
    };
  }
  const required = reading.needs.filter(n => n.need === 'required');
  if (!required.length) return null;
  const stored = liasForRead(reading, now);
  const open = required.map(n => ({ n, lia: stored.find(l => l.registerId === n.register.id) }))
    .filter(x => !x.lia || x.lia.standing.state === 'draft' || x.lia.standing.state === 'reopened');
  if (!open.length) return null;
  const state = open.some(x => !x.lia) ? 'missing' : open.some(x => x.lia!.standing.state === 'reopened') ? 'open-again' : 'draft';
  const q = `scope=app&app=${encodeURIComponent(scope.app)}`;
  return {
    state, registers: open.map(x => x.n.register.title), url,
    draft: { tool: `aimeat_compliance_register_read { part: "lia_draft", app: "${scope.app}" }`, rest: `GET /v1/compliance/lia/draft?${q}` },
    text: state === 'missing'
      ? `This app needs a balancing test: others can see its personal data or it holds regulated data, and its register names legitimate interests. A draft is ready, filled from the app's data map and register. Nothing is blocked; the open test shows in the compliance gaps until its owner approves it.`
      : state === 'open-again'
        ? 'The approved balancing test of this app is open again: more people can see the data, or the app holds new regulated data. Its owner reads it and approves it again.'
        : 'The balancing test of this app is a draft. Its owner answers the open questions and approves it.',
  };
}

/** balancingTestStepOf for an app named by its owner and filename. Never throws: an answer is not failed by a hint. */
export async function balancingTestStep(deps: Deps, ownerName: string, app: string): Promise<BalancingTestStep | null> {
  try {
    const scope: AppScope = { kind: 'app', ownerName, app };
    return balancingTestStepOf(deps.config, scope, await appLiaReading(deps, scope));
  } catch (err) {
    logger.warn('compliance: the balancing test step could not be read', { ownerName, app, error: String(err) });
    return null;
  }
}
