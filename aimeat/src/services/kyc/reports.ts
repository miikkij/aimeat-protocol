/**
 * @file src/services/kyc/reports.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Suspicions and the report to the Financial Intelligence Unit (Rahanpesun
 *   selvittelykeskus, through goAML), the one write path REST and MCP share.
 *
 *   WHO SEES WHAT (AMLR art. 69, 73). Anyone who does the due diligence, an agent included, may mark a
 *   suspicion; the answer is only that it was received, and the person who marked it does not learn
 *   what follows. The compliance officers alone, in person, read the marks, complete the draft, decide,
 *   and record that the report was sent. The customer's own views never show any of it.
 *
 *   goAML. AIMEAT prepares the draft and the officer sends it in goAML themselves; this node does not
 *   connect to goAML. The officer then records the submission and its reference here.
 *
 *   AI HELP. The officer may ask the server's AI to draft the narrative. AIMEAT_KYC_AI decides which
 *   model may read the case: local (the default, only a model on this machine), node (any model this
 *   server allows) or off.
 * @structure markSuspicion · listSuspicions · readSuspicion · updateSuspicion · submitSuspicion ·
 *   closeSuspicion · assistNarrative
 * @version-history
 *   v1.0.2 — 2026-11-20 — DraftSchema is a patchOf() schema, which carries no defaults; sentFields removed.
 *   v1.0.1 — 2026-11-20 — A draft update keeps the fields it does not send (sentFields): a new
 *     narrative emptied the indicators and transactions through the zod partial defaults.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { logger } from '../../utils/logger.js';
import { randomUUID } from 'node:crypto';
import type { CallerContext } from '../caller-context.js';
import { completeForOwner } from '../ai/completion.js';
import { notify } from '../notify.js';
import { emitChange } from '../event-bus.js';
import { KycError, kycContext, requireCards, requireOfficer, type KycDeps } from './access.js';
import { SuspicionReportSchema, type SuspicionReport } from './contract.js';
import { patchOf } from '../../utils/zod-patch.js';
import { retentionUntil } from './risk.js';
import { UNCHANGED } from '../record-cas.js';
import { listReports, readHead, readReport, readVersions, writeReport } from './store.js';

const now = (): string => new Date().toISOString();

/** Mark a suspicion. The marker learns only that it was received. */
export async function markSuspicion(deps: KycDeps, caller: CallerContext, org: string, input: { customerId?: string; observation: string }): Promise<{ id: string; received: true }> {
  const ctx = await kycContext(deps, caller, org);
  requireCards(ctx);
  const observation = (input.observation ?? '').trim();
  if (observation.length < 10) throw new KycError(400, 'INVALID_INPUT', 'Say what you saw, in at least a sentence.');
  if (input.customerId && !await readHead(deps.storage, deps.config.nodeId, org, input.customerId)) {
    throw new KycError(404, 'CUSTOMER_NOT_FOUND', 'No such customer card in this organism.');
  }
  const id = `r-${randomUUID().slice(0, 13)}`;
  const at = now();
  await writeReport(deps.storage, deps.config.nodeId, org, id, () => ({
    id, organism: org, customerId: input.customerId, status: 'marked', observation: observation.slice(0, 4000),
    markedBy: ctx.by, markedAt: at, indicators: [], transactions: [], updatedAt: at, updatedBy: ctx.by,
  }));
  for (const officer of ctx.settings.officers) {
    await notify(deps.storage, officer, {
      type: 'kyc.suspicion', title: 'A suspicion was marked', body: `${ctx.organism.name}: open it on the customer due diligence page.`,
      link: `/v1/profile?tab=kyc&org=${encodeURIComponent(org)}&report=${encodeURIComponent(id)}`,
      i18n: { key: 'kyc_suspicion', orgVars: { organism: org } },
    }).catch((err) => logger.warn('[kyc] the officer\'s bell notice was not stored', { org, error: String(err) }));
    emitChange('notifications', officer);
  }
  return { id, received: true };
}

export async function listSuspicions(deps: KycDeps, caller: CallerContext, org: string): Promise<SuspicionReport[]> {
  const ctx = await kycContext(deps, caller, org);
  requireOfficer(ctx);
  return listReports(deps.storage, deps.config.nodeId, org);
}

export async function readSuspicion(deps: KycDeps, caller: CallerContext, org: string, id: string): Promise<SuspicionReport> {
  const ctx = await kycContext(deps, caller, org);
  requireOfficer(ctx);
  const r = await readReport(deps.storage, deps.config.nodeId, org, id);
  if (!r) throw new KycError(404, 'REPORT_NOT_FOUND', 'No such suspicion in this organism.');
  return r;
}

/** patchOf: a field left out stays out, so a new narrative keeps the indicators and the transactions. */
const DraftSchema = patchOf(SuspicionReportSchema.pick({ reportType: true, indicators: true, transactions: true, narrative: true }));

export async function updateSuspicion(deps: KycDeps, caller: CallerContext, org: string, id: string, patch: unknown): Promise<SuspicionReport> {
  const ctx = await kycContext(deps, caller, org);
  requireOfficer(ctx);
  const parsed = DraftSchema.safeParse(patch ?? {});
  if (!parsed.success) throw new KycError(400, 'INVALID_INPUT', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const out = await writeReport(deps.storage, deps.config.nodeId, org, id, (cur) => {
    if (!cur) throw new KycError(404, 'REPORT_NOT_FOUND', 'No such suspicion in this organism.');
    if (cur.status === 'submitted' || cur.status === 'not-reported') throw new KycError(409, 'REPORT_CLOSED', 'This case is decided and does not change.');
    return { ...cur, ...parsed.data, status: 'draft', updatedAt: now(), updatedBy: ctx.by };
  });
  return out!;
}

/** The officer sent the report in goAML: record when and its reference. */
export async function submitSuspicion(deps: KycDeps, caller: CallerContext, org: string, id: string, input: { goamlRef: string; submittedAt?: string; decision?: string }): Promise<SuspicionReport> {
  const ctx = await kycContext(deps, caller, org);
  requireOfficer(ctx);
  if (!input.goamlRef?.trim()) throw new KycError(400, 'INVALID_INPUT', 'Give the reference goAML answered.');
  const at = input.submittedAt && Number.isFinite(Date.parse(input.submittedAt)) ? new Date(input.submittedAt).toISOString() : now();
  const out = await writeReport(deps.storage, deps.config.nodeId, org, id, (cur) => {
    if (!cur) throw new KycError(404, 'REPORT_NOT_FOUND', 'No such suspicion in this organism.');
    if (cur.status === 'submitted') return UNCHANGED;
    return { ...cur, status: 'submitted', goamlRef: input.goamlRef.trim().slice(0, 120), submittedAt: at, decision: input.decision?.slice(0, 2000),
      retainUntil: retentionUntil(at), updatedAt: now(), updatedBy: ctx.by };
  });
  return out ?? (await readSuspicion(deps, caller, org, id));
}

/** The officer decided not to report, with the ground (kept, as the decision is part of the record). */
export async function closeSuspicion(deps: KycDeps, caller: CallerContext, org: string, id: string, decision: string): Promise<SuspicionReport> {
  const ctx = await kycContext(deps, caller, org);
  requireOfficer(ctx);
  if (!decision?.trim()) throw new KycError(400, 'INVALID_INPUT', 'Say why the case is not reported.');
  const at = now();
  const out = await writeReport(deps.storage, deps.config.nodeId, org, id, (cur) => {
    if (!cur) throw new KycError(404, 'REPORT_NOT_FOUND', 'No such suspicion in this organism.');
    if (cur.status === 'submitted') throw new KycError(409, 'REPORT_CLOSED', 'This case was reported.');
    return { ...cur, status: 'not-reported', decision: decision.slice(0, 2000), retainUntil: retentionUntil(at), updatedAt: at, updatedBy: ctx.by };
  });
  return out!;
}

/** Ask the server's AI for a narrative draft, on the model AIMEAT_KYC_AI allows. Nothing is saved. */
export async function assistNarrative(deps: KycDeps, caller: CallerContext, org: string, id: string): Promise<{ narrative: string; model: string }> {
  const ctx = await kycContext(deps, caller, org);
  requireOfficer(ctx);
  const ai = deps.config.kycAi ?? 'local';
  if (ai === 'off') throw new KycError(403, 'KYC_AI_OFF', 'The operator has turned the server\'s AI off for customer due diligence data (setting compliance.kyc_ai).');
  const report = await readSuspicion(deps, caller, org, id);
  const card = report.customerId ? (await readVersions(deps.storage, deps.config.nodeId, org, report.customerId)).at(-1) : null;
  const facts = {
    observation: report.observation, reportType: report.reportType, indicators: report.indicators, transactions: report.transactions,
    customer: card ? { kind: card.kind, name: card.name, country: card.country, businessId: card.businessId, pep: card.pep,
      risk: card.risk?.level, purpose: card.purpose, sourceOfFunds: card.sourceOfFunds, sanctions: card.screening.status } : null,
  };
  const out = await completeForOwner(deps.storage, deps.config, caller.ownerGhii, {
    caller: 'owner',
    systemPrompt: 'You draft the narrative of a suspicious transaction or activity report for a Financial Intelligence Unit (goAML). '
      + 'Write in the language of the observation. State facts in order: who, what, when, amounts, why it is unusual for this customer, '
      + 'which indicators apply. Do not speculate beyond the facts given, and do not address the customer.',
    prompt: JSON.stringify(facts),
    ...(ai === 'local' ? { requires: { local: true } } : {}),
  });
  return { narrative: out.content, model: out.model };
}
