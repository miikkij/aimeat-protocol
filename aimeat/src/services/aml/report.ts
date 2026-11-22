/**
 * @file src/services/aml/report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The anti-money-laundering section of the compliance report (section 13 on the Compliance
 *   page; decision decision-aml-velvoitteet-ovat-operaattorin-aktivoima-tila): the setting and what it
 *   means, the obliged entities' declarations, the findings with their reasons and the regulation they
 *   cite, and the obligations with what this node can show for each. GET /v1/admin/compliance/report,
 *   GET /v1/compliance/report/mine and aimeat_compliance_report carry it through
 *   services/compliance/report.ts, so one builder serves all three.
 *
 *   THE OBLIGATIONS SAY WHAT IS NOT BUILT. A row this node cannot show evidence for reads `missing`
 *   with the reason, so an operator who switches a mode on sees what the server does not yet do for
 *   them (the customer review calendar, the legal retention hold, sanctions screening) instead of
 *   reading silence as coverage.
 *
 *   THE OWNER'S SLICE is the owner's own findings and the declarations of the organisms they manage.
 * @structure AmlSection · MODE_TEXT · amlObligations · buildAmlSection
 * @usage const aml = await buildAmlSection({ storage, config }, { ownerGhii });
 * @version-history
 *   2026-11-19 — Obligation aml-ob-cash (art. 80): evidence, check or not applicable from the cash vouchers, on the node's view.
 *   2026-11-19 — The duties read what customer due diligence now does (services/kyc/): screening, cards, the review calendar and the retention hold.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design, stage A).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { AMLR_REFS, type AmlFinding, type AmlObligationRow, type AmlRef } from './contract.js';
import { buildAmlFindings, gatherAmlFacts, type AmlFacts } from './findings.js';

export interface AmlSection {
  /** The section's place on the Compliance page and in the printout. */
  section: '13';
  mode: AimeatConfig['amlMode'];
  /** A stable code for the mode's meaning, and the English sentence. */
  mode_code: string;
  mode_text: string;
  /** The declarations this reader may see: every one for the operator, the organisms they manage in a slice. */
  declarations: Array<{
    scope: 'node' | 'organism'; organism_id: string | null; organism: string | null;
    legal_name: string; business_id: string; sector: string;
    compliance_officer: string; compliance_manager: string | null; deputy: string | null;
    supervisor_registered_at: string | null; fiu_registered_at: string | null; risk_assessment_at: string | null;
  }>;
  findings: AmlFinding[];
  totals: { findings: number; with_items: number; proposed: number; reviewed: number };
  obligations: AmlObligationRow[];
  regulation: AmlRef[];
  /** Where a declaration and the reviews are written. */
  edit: { method: 'PUT' | 'PATCH'; url: string; note: string };
  note: string;
}

const MODE_TEXT: Record<AimeatConfig['amlMode'], string> = {
  report: 'Nothing is refused. This section lists what could make this server or an owner an obliged entity, for a person to decide.',
  none: 'Neither the operator nor the organisms here are obliged entities under the anti-money-laundering law. An organism cannot declare itself an obliged entity here.',
  owners: 'An organism that declared itself an obliged entity and named its compliance officer does that work here. This server holds no funds.',
  node: 'The operator is an obliged entity itself and keeps its own declaration. Owners\' declarations are accepted too.',
};

/** The obligations, from the facts. Pure. */
export function amlObligations(f: AmlFacts, config: Pick<AimeatConfig, 'ftnEnabled'>): AmlObligationRow[] {
  const decls = f.declarations.map(d => d.declaration);
  const applies = f.mode === 'owners' || f.mode === 'node' || decls.length > 0;
  const yearAgo = Date.parse(f.now) - 365 * 86_400_000;
  const na = (code: string, ref: AmlRef, text: string): AmlObligationRow => ({ code, ref, status: 'not_applicable', evidence: { mode: f.mode, declarations: decls.length }, text });
  const rows: AmlObligationRow[] = [
    { code: 'aml-ob-custody', ref: AMLR_REFS.obliged, status: 'evidence', evidence: { rails: ['card: the seller\'s own Stripe key', 'stablecoin: the seller\'s own address', 'invoice: billed by the seller'] },
      text: 'This server holds no funds and no payout key: every rail settles to the seller directly, and a beneficiary payout is signed by the provider.' },
    {
      code: 'aml-ob-sanctions', ref: AMLR_REFS.sanctions,
      status: f.kyc.lists.length && applies ? (f.kyc.notScreened ? 'check' : 'evidence') : f.sellers.length ? 'missing' : 'not_applicable',
      evidence: { sellers: f.sellers.length, lists: f.kyc.lists, cards_not_screened: f.kyc.notScreened },
      text: f.kyc.lists.length && applies
        ? `An obliged organism's customers and their beneficial owners are screened against the ${f.kyc.lists.map(l => l.source === 'un' ? 'UN' : 'EU').join(' and ')} sanctions lists, fetched daily; a possible hit waits for a person's decision.${f.kyc.notScreened ? ` ${f.kyc.notScreened} open card(s) are not screened yet.` : ''} Sellers who take money here are not customers of an obliged entity and are not screened.`
        : f.sellers.length ? 'Sellers take money here and nobody is screened against the sanctions lists: no list is fetched yet (Admin › Customer due diligence › Fetch the lists now).' : 'No account takes money here, so there is nobody to screen.',
    },
  ];
  // Art. 80 binds every business, obliged or not, so this row does not wait for `applies`. Node view only.
  if (f.cash) {
    const over = f.cash.overLimit.length;
    rows.push({
      code: 'aml-ob-cash', ref: AMLR_REFS.cash,
      status: !f.cash.recorded ? 'not_applicable' : over ? 'check' : 'evidence',
      evidence: { vouchers_with_payment_method: f.cash.recorded, cash_vouchers: f.cash.cash, over_limit: over, other_currency: f.cash.otherCurrency },
      text: !f.cash.recorded
        ? 'No voucher records how it was paid, so cash payments cannot be told apart. A person records it when booking a voucher (payment method).'
        : over
          ? `${over} cash payment(s) of more than EUR 10 000 are booked, alone or linked within 30 days. Each one is checked with the business that booked it.`
          : 'Vouchers record how they were paid, and no cash payment of more than EUR 10 000 is booked, alone or linked within 30 days. Only vouchers in EUR are summed.',
    });
  }
  if (!applies) {
    rows.push(
      na('aml-ob-risk-assessment', AMLR_REFS.riskAssessment, 'No obliged entity works here, so no business-wide risk assessment is asked for.'),
      na('aml-ob-roles', AMLR_REFS.compliance, 'No obliged entity works here, so no compliance officer is asked for.'),
      na('aml-ob-cdd', AMLR_REFS.cdd, 'No obliged entity works here, so no customer due diligence is asked for.'),
      na('aml-ob-monitoring', AMLR_REFS.monitoring, 'No obliged entity works here, so no customer review is asked for.'),
      na('aml-ob-reporting', AMLR_REFS.reporting, 'No obliged entity works here, so no FIU registration is asked for.'),
      na('aml-ob-retention', AMLR_REFS.retention, 'No obliged entity works here, so no five-year retention is asked for.'),
    );
    return rows;
  }
  const all = (pred: (d: typeof decls[number]) => boolean) => decls.length > 0 && decls.every(pred);
  const some = (pred: (d: typeof decls[number]) => boolean) => decls.some(pred);
  rows.push(
    {
      code: 'aml-ob-risk-assessment', ref: AMLR_REFS.riskAssessment,
      status: all(d => !!d.riskAssessmentAt && Date.parse(d.riskAssessmentAt) >= yearAgo) ? 'evidence' : some(d => !!d.riskAssessmentAt) ? 'check' : 'missing',
      evidence: { declarations: decls.length, with_assessment: decls.filter(d => !!d.riskAssessmentAt).length },
      text: 'Each obliged entity records the date and address of its business-wide risk assessment in its declaration.',
    },
    {
      code: 'aml-ob-roles', ref: AMLR_REFS.compliance,
      status: all(d => !!d.complianceManager && !!d.deputy) ? 'evidence' : decls.length ? 'check' : 'missing',
      evidence: { declarations: decls.length, complete: decls.filter(d => !!d.complianceManager && !!d.deputy).length },
      text: 'Each declaration names the compliance officer, the compliance manager from the management and a deputy.',
    },
    {
      code: 'aml-ob-cdd', ref: AMLR_REFS.cdd, status: config.ftnEnabled ? 'evidence' : 'check', evidence: { bank_identification: config.ftnEnabled, cards: f.kyc.cards },
      text: (config.ftnEnabled
        ? 'Customer cards record each customer\'s identity, beneficial owners, purpose and source of funds, and a customer can give their own bank identification through an identify link.'
        : 'Customer cards record each customer\'s identity, beneficial owners, purpose and source of funds; identity is recorded as seen (a document, a register extract), because bank identification (FTN) is off and a customer cannot give their own.')
        + ` ${f.kyc.cards} card(s) on this server.`,
    },
    { code: 'aml-ob-monitoring', ref: AMLR_REFS.monitoring, status: f.kyc.due ? 'check' : 'evidence', evidence: { cards: f.kyc.cards, due: f.kyc.due },
      text: `Each customer card has its next review from its risk (high within 12 months, at most 5 years), and the people doing the work get a notice when reviews fall due.${f.kyc.due ? ` ${f.kyc.due} card(s) are due now.` : ''}` },
    {
      code: 'aml-ob-reporting', ref: AMLR_REFS.reporting,
      status: all(d => !!d.fiuRegisteredAt) ? 'evidence' : decls.length ? 'check' : 'missing',
      evidence: { declarations: decls.length, fiu_registered: decls.filter(d => !!d.fiuRegisteredAt).length },
      text: 'Each obliged entity records its registration with the FIU\'s reporting service. Reports themselves are made there by a person, never by this server.',
    },
    { code: 'aml-ob-retention', ref: AMLR_REFS.retention, status: 'evidence', evidence: { cards: f.kyc.cards },
      text: 'Customer cards and suspicions are kept five years after the relationship ends, longer when the officer extends the hold with its ground; no member, memory or organism delete removes them before, and the daily purge removes them after, leaving a receipt that names nobody.' },
  );
  return rows;
}

/** Build the section for the node (no owner) or for one owner's slice. */
export async function buildAmlSection(
  deps: { storage: Storage; config: AimeatConfig }, opts: { ownerGhii?: string; now?: string } = {},
): Promise<AmlSection> {
  const owner = opts.ownerGhii ? localAccountName(opts.ownerGhii) : null;
  const facts = await gatherAmlFacts(deps, { owner, ...(opts.now ? { now: opts.now } : {}) });
  const findings = buildAmlFindings(facts);
  const mode = deps.config.amlMode;
  return {
    section: '13',
    mode,
    mode_code: `aml-mode-${mode}`,
    mode_text: MODE_TEXT[mode],
    declarations: facts.declarations.map(d => ({
      scope: d.scope.kind === 'organism' ? 'organism' : 'node',
      organism_id: d.scope.kind === 'organism' ? d.scope.organismId : null,
      organism: d.scope.kind === 'organism' ? (d.organismName ?? null) : null,
      legal_name: d.declaration.legalName, business_id: d.declaration.businessId, sector: d.declaration.sector,
      compliance_officer: d.declaration.complianceOfficer, compliance_manager: d.declaration.complianceManager ?? null,
      deputy: d.declaration.deputy ?? null, supervisor_registered_at: d.declaration.supervisorRegisteredAt ?? null,
      fiu_registered_at: d.declaration.fiuRegisteredAt ?? null, risk_assessment_at: d.declaration.riskAssessmentAt ?? null,
    })),
    findings,
    totals: {
      findings: findings.length,
      with_items: findings.filter(f => f.count > 0).length,
      proposed: findings.filter(f => f.source === 'proposed' && f.count > 0).length,
      reviewed: findings.filter(f => f.source === 'human').length,
    },
    obligations: amlObligations(facts, deps.config),
    regulation: [AMLR_REFS.obliged, AMLR_REFS.compliance, AMLR_REFS.cdd, AMLR_REFS.reporting, AMLR_REFS.retention, AMLR_REFS.sanctions, AMLR_REFS.cash],
    edit: owner
      ? { method: 'PUT', url: '/v1/compliance/docs/aml?scope=organism&organism_id=<id>', note: 'An organism you manage keeps its own declaration and reviews. On a server set to none the declaration is refused.' }
      : { method: 'PUT', url: '/v1/compliance/docs/aml', note: 'The node\'s declaration (an item of type declaration, mode node) and a review per finding (type review, the finding\'s id, accepted or dismissed). aimeat_compliance_register_write with part aml does the same.' },
    note: 'This is a reading of Regulation (EU) 2024/1624 and the acts it cites, not a legal opinion. Each finding is a proposal until a person reviews it.',
  };
}
