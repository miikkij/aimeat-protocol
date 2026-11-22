/**
 * @file src/services/kyc/assessment.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two documents an obliged organism writes about its own customer due diligence, drafted
 *   from what it keeps on this node: the business-wide risk assessment (AMLR 2024/1624 art. 10) and the
 *   data protection impact assessment of the due diligence itself (GDPR art. 35).
 *
 *   BUILT FROM THE ORGANISM'S OWN DATA. A supervisor finds many firms with the same copied risk
 *   assessment text, which assesses nothing. So the draft states this organism's own numbers (open
 *   customers by kind, risk and due diligence; the countries that appear; PEP customers; remote
 *   identification below substantial; cash-intensive customers; complex ownership; open sanctions hits;
 *   overdue reviews) and asks, per art. 10 risk area, the questions only the firm can answer. It is a
 *   draft for a person to complete, never the assessment. Suspicions are not counted at all (art. 73:
 *   their existence is not disclosed beyond the officers, and the draft is read by the admins too).
 *
 *   RECORDING. When the firm has updated its assessment, an officer or an admin in person records the
 *   day (and where the document is) on the organism's obliged-entity declaration, the compliance
 *   document `aml`. The write runs the AML gate (services/aml/gate.ts amlDocRefusal) and the
 *   document's schema as the compliance write path does (services/compliance/docs-ops.ts), and changes
 *   the one declaration in place (compliance/docs.ts patchDocItem). The compliance write path's own
 *   access rule (the organism's admins) is not asked: the KYC role decides here, so the named compliance
 *   officer may record it without being an admin.
 *
 *   THE DPIA DRAFT is one item shaped by DpiaSchema and validated with it, stored nowhere: the person
 *   stores it with the compliance write, as the answer's `store` hint says. Each measure it names is one
 *   this server enforces in code (the module named beside it).
 * @structure riskAssessmentDraft · recordRiskAssessment · dpiaDraft · RiskAssessmentFacts · RiskAssessmentSection
 * @version-history
 *   v1.0.1 — 2026-11-19 — The DPIA's risks and measures one per line, in plain words with no file
 *     names; `stored` reads the organism's records; the draft's English counts take their plurals.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import type { CallerContext } from '../caller-context.js';
import { amlDocRefusal, readAmlDeclarations } from '../aml/gate.js';
import { patchDocItem, readDoc, writeDoc, type ComplianceScope } from '../compliance/docs.js';
import { DOC_SCHEMAS, DpiaSchema, type AmlDeclaration, type ComplianceDocs, type ComplianceDpia } from '../compliance/docs-schemas.js';
import { KycError, kycContext, requireInPerson, type KycContext, type KycDeps } from './access.js';
import type { CustomerVersion } from './contract.js';
import { listHeads, readVersion } from './store.js';

/** The numbers the draft states, all from the organism's own open cards. */
export interface RiskAssessmentFacts {
  asOf: string;
  customers: {
    open: number;
    ended: number;
    byKind: Record<'person' | 'entity', number>;
    byStatus: Record<'open' | 'active' | 'blocked', number>;
    byRisk: Record<'low' | 'medium' | 'high' | 'prohibited' | 'unrated', number>;
    byDueDiligence: Record<'simplified' | 'standard' | 'enhanced' | 'unrated', number>;
  };
  /** Each country that appears on an open card (residence or registration, nationality, an owner's), with the customers it appears on. */
  countries: Array<{ country: string; customers: number; highRisk: boolean }>;
  highRiskCountryCustomers: number;
  highRiskCountriesListed: number;
  pep: { customers: number; unknown: number };
  identity: { notIdentified: number; faceToFace: number; remote: number; remoteBelowSubstantial: number };
  cashIntensive: number;
  /** Entities with more than two ownership layers or nominee or bearer shares. */
  complexOwnership: number;
  productRisk: Record<'low' | 'medium' | 'high' | 'unset', number>;
  purposeUnknown: number;
  sourceOfFundsUnknown: number;
  /** Open cards with a possible sanctions hit nobody has decided yet. */
  openSanctionsHits: number;
  reviewsOverdue: number;
}

export interface RiskAssessmentSection { id: 'customers' | 'countries' | 'products' | 'channels' | 'transactions'; title: string; text: string }

const PEP_YES = new Set(['yes', 'family', 'close-associate', 'former']);

/** Officers and admins of the organism, and their agents, read; staff do not. */
async function assessmentContext(deps: KycDeps, caller: CallerContext, org: string): Promise<KycContext> {
  const ctx = await kycContext(deps, caller, org);
  if (ctx.role !== 'officer' && ctx.role !== 'manager') {
    throw new KycError(403, 'KYC_NOT_MANAGER', 'Only the compliance officers and the admins of the organism read and record its risk assessment and its impact assessment.');
  }
  return ctx;
}

async function declarationOf(deps: KycDeps, org: string): Promise<AmlDeclaration> {
  const found = (await readAmlDeclarations(deps.storage, deps.config.nodeId))
    .find(d => d.scope.kind === 'organism' && d.scope.organismId === org);
  // kycContext refused already when there is none; a declaration removed in between answers the same.
  if (!found) throw new KycError(403, 'KYC_NOT_ENABLED', 'This organism has not declared itself an obliged entity.');
  return found.declaration;
}

function plusMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** The newest version of every open card, and the count of ended ones. */
async function openCards(deps: KycDeps, org: string): Promise<{ cards: CustomerVersion[]; ended: number }> {
  const heads = await listHeads(deps.storage, deps.config.nodeId, org);
  const cards: CustomerVersion[] = [];
  let ended = 0;
  for (const h of heads) {
    if (h.status === 'ended') { ended++; continue; }
    const v = await readVersion(deps.storage, deps.config.nodeId, org, h.id, h.n);
    if (v) cards.push(v);
  }
  return { cards, ended };
}

function factsOf(cards: CustomerVersion[], ended: number, highRiskCountries: string[], today: string): RiskAssessmentFacts {
  const high = new Set(highRiskCountries.map(c => c.toUpperCase()));
  const f: RiskAssessmentFacts = {
    asOf: today,
    customers: {
      open: cards.length, ended,
      byKind: { person: 0, entity: 0 },
      byStatus: { open: 0, active: 0, blocked: 0 },
      byRisk: { low: 0, medium: 0, high: 0, prohibited: 0, unrated: 0 },
      byDueDiligence: { simplified: 0, standard: 0, enhanced: 0, unrated: 0 },
    },
    countries: [], highRiskCountryCustomers: 0, highRiskCountriesListed: high.size,
    pep: { customers: 0, unknown: 0 },
    identity: { notIdentified: 0, faceToFace: 0, remote: 0, remoteBelowSubstantial: 0 },
    cashIntensive: 0, complexOwnership: 0,
    productRisk: { low: 0, medium: 0, high: 0, unset: 0 },
    purposeUnknown: 0, sourceOfFundsUnknown: 0, openSanctionsHits: 0, reviewsOverdue: 0,
  };
  const countries = new Map<string, number>();
  for (const v of cards) {
    f.customers.byKind[v.kind]++;
    if (v.status !== 'ended') f.customers.byStatus[v.status]++;
    f.customers.byRisk[v.risk?.level ?? 'unrated']++;
    f.customers.byDueDiligence[v.risk?.dueDiligence ?? 'unrated']++;
    const mine = new Set([v.country, v.nationality, ...v.beneficialOwners.map(o => o.country)]
      .filter((c): c is string => !!c?.trim()).map(c => c.trim().toUpperCase()));
    for (const c of mine) countries.set(c, (countries.get(c) ?? 0) + 1);
    if ([...mine].some(c => high.has(c))) f.highRiskCountryCustomers++;
    if (PEP_YES.has(v.pep)) f.pep.customers++;
    else if (v.pep === 'unknown') f.pep.unknown++;
    if (!v.identity || v.identity.level === 'none') f.identity.notIdentified++;
    else if (v.identity.faceToFace) f.identity.faceToFace++;
    else {
      f.identity.remote++;
      if (v.identity.level === 'low') f.identity.remoteBelowSubstantial++;
    }
    if (v.cashIntensive) f.cashIntensive++;
    if (v.kind === 'entity' && ((v.ownershipLayers ?? 0) > 2 || v.nomineeOrBearerShares)) f.complexOwnership++;
    f.productRisk[v.productRisk ?? 'unset']++;
    if (!v.purpose?.trim()) f.purposeUnknown++;
    if (!v.sourceOfFunds?.trim()) f.sourceOfFundsUnknown++;
    if (v.screening.status === 'possible') f.openSanctionsHits++;
    if (v.nextReviewAt && v.nextReviewAt.slice(0, 10) <= today) f.reviewsOverdue++;
  }
  f.countries = [...countries.entries()]
    .map(([country, customers]) => ({ country, customers, highRisk: high.has(country) }))
    .sort((a, b) => b.customers - a.customers || a.country.localeCompare(b.country));
  return f;
}

function sectionsOf(f: RiskAssessmentFacts): RiskAssessmentSection[] {
  const c = f.customers;
  const flagged = f.countries.filter(x => x.highRisk);
  const listed = f.countries.slice(0, 12).map(x => `${x.country} ${x.customers}${x.highRisk ? ' (on your high-risk list)' : ''}`).join(', ');
  return [
    {
      id: 'customers', title: 'Customers',
      text: `On ${f.asOf} you have ${n(c.open, 'open customer', 'open customers')} (${n(c.byKind.person, 'person', 'persons')}, ${n(c.byKind.entity, 'legal person or arrangement', 'legal persons or arrangements')}) and ${n(c.ended, 'ended relationship', 'ended relationships')} still kept. `
        + `By risk: ${c.byRisk.low} low, ${c.byRisk.medium} medium, ${c.byRisk.high} high, ${c.byRisk.prohibited} prohibited, ${c.byRisk.unrated} not rated. `
        + `By due diligence: ${c.byDueDiligence.simplified} simplified, ${c.byDueDiligence.standard} standard, ${c.byDueDiligence.enhanced} enhanced. `
        + `${n(f.pep.customers, 'customer is', 'customers are')} a politically exposed person or close to one, and for ${f.pep.unknown} the PEP status is not known. `
        + `${n(f.complexOwnership, 'legal person has', 'legal persons have')} more than two ownership layers or nominee or bearer shares. `
        + `${n(c.byStatus.blocked, 'card is', 'cards are')} blocked, ${n(f.openSanctionsHits, 'carries', 'carry')} a possible sanctions hit nobody has decided, and ${n(f.reviewsOverdue, 'review is', 'reviews are')} overdue. `
        + 'Answer for yourselves: which kinds of customer does your business attract, and which of them carry the most risk for you? '
        + 'Is this mix what you expected, and does your policy for PEP and complex-ownership customers fit these numbers? '
        + 'What do you do about the overdue reviews and the undecided hits, and by when?',
    },
    {
      id: 'countries', title: 'Countries and geographic areas',
      text: (f.countries.length
        ? `These countries appear on your open customers (residence or registration, nationality, beneficial owners): ${listed}${f.countries.length > 12 ? `, and ${f.countries.length - 12} more` : ''}. `
        : 'No open customer has a country recorded yet. ')
        + (f.highRiskCountriesListed
          ? `Your list of high-risk third countries has ${f.highRiskCountriesListed} entries; ${n(f.highRiskCountryCustomers, 'customer has', 'customers have')} a link to one of them${flagged.length ? ` (${flagged.map(x => x.country).join(', ')})` : ''}. `
          : 'Your list of high-risk third countries is empty, so no customer is flagged by country. ')
        + 'Answer for yourselves: is your high-risk list the current EU list, and who keeps it up to date? '
        + 'Which countries does your business deal with beyond what the cards show (suppliers, payment routes, where the money comes from)? '
        + 'What extra measures do you apply to a customer linked to a high-risk country?',
    },
    {
      id: 'products', title: 'Products and services',
      text: `On the cards, the product or service risk is ${f.productRisk.low} low, ${f.productRisk.medium} medium, ${f.productRisk.high} high, and not set for ${f.productRisk.unset}. `
        + `${n(f.cashIntensive, 'customer runs', 'customers run')} a cash-intensive business. `
        + 'Answer for yourselves: which of your products and services could be used to move or hide money, and how? '
        + 'Which ones offer anonymity, fast transfer of value, or third-party payments? '
        + 'Does the product risk on each card follow a rule you have written down?',
    },
    {
      id: 'channels', title: 'Delivery channels',
      text: `Of your open customers, ${n(f.identity.faceToFace, 'was', 'were')} identified face to face and ${f.identity.remote} remotely; `
        + `${n(f.identity.remoteBelowSubstantial, 'was', 'were')} identified remotely below eIDAS level substantial, and ${n(f.identity.notIdentified, 'is', 'are')} not identified yet. `
        + 'Answer for yourselves: through which channels do customers reach you (in person, online, through an intermediary or an agent)? '
        + 'Which channel makes it hardest to know who the customer is, and what do you do then? '
        + 'Do you rely on another firm\'s due diligence, and on what terms?',
    },
    {
      id: 'transactions', title: 'Transactions',
      text: `This server keeps no transaction data for you, so the numbers here are what the cards say: the purpose of the relationship is not recorded for ${n(f.purposeUnknown, 'open customer', 'open customers')} and the source of funds for ${f.sourceOfFundsUnknown}. `
        + 'Answer for yourselves: what volumes, amounts and patterns are normal for your customers, and what is unusual? '
        + 'How do you notice a transaction that does not fit the customer\'s purpose or source of funds, and who looks at it? '
        + 'How does a member of staff bring a suspicion to the compliance officer?',
    },
  ];
}

/**
 * The draft of the business-wide risk assessment (AMLR art. 10), built from the organism's own cards.
 * Officers and admins of the organism, and their agents.
 */
export async function riskAssessmentDraft(deps: KycDeps, caller: CallerContext, org: string) {
  const ctx = await assessmentContext(deps, caller, org);
  const declaration = await declarationOf(deps, org);
  const today = new Date().toISOString().slice(0, 10);
  const { cards, ended } = await openCards(deps, org);
  const facts = factsOf(cards, ended, ctx.settings.highRiskCountries, today);
  const last = declaration.riskAssessmentAt ?? null;
  return {
    organism: org,
    facts,
    sections: sectionsOf(facts),
    lastRecordedAt: last,
    ref: declaration.riskAssessmentRef ?? null,
    due: !last || plusMonths(last, 12) <= today,
    note: 'A draft from your own records, not the assessment. Answer each question in your own words, add what the cards cannot show, '
      + 'and keep the finished document where your firm keeps its documents. Then record the day: POST /v1/kyc/<organism>/risk-assessment/recorded, in person.',
  };
}

/**
 * Record that the business-wide risk assessment was updated today, and where it is: sets riskAssessmentAt
 * and riskAssessmentRef on the organism's obliged-entity declaration. An officer or an admin in person.
 */
export async function recordRiskAssessment(deps: KycDeps, caller: CallerContext, org: string, input: { ref?: string }) {
  const ctx = await assessmentContext(deps, caller, org);
  requireInPerson(ctx, 'Recording the risk assessment');
  const ref = typeof input.ref === 'string' ? input.ref.trim() : '';
  if (ref.length > 500) throw new KycError(400, 'INVALID_INPUT', 'ref: at most 500 characters.');
  const declaration = await declarationOf(deps, org);
  const scope: ComplianceScope = { kind: 'organism', organismId: org };
  const today = new Date().toISOString().slice(0, 10);
  const change = (item: Record<string, unknown>): Record<string, unknown> => ({ ...item, riskAssessmentAt: today, ...(ref ? { riskAssessmentRef: ref } : {}) });
  // The gate the compliance write path asks; the declaration ids do not change, so it admits this.
  const current = await readDoc(deps.storage, deps.config.nodeId, 'aml', scope);
  const refused = await amlDocRefusal(deps, scope, { items: current.items.map(it => (it.id === declaration.id ? change(it) : it)) } as ComplianceDocs['aml']);
  if (refused) throw new KycError(refused.status, refused.code, refused.message);
  const validate = (doc: { items: Array<Record<string, unknown>> }): ComplianceDocs['aml'] => {
    const parsed = DOC_SCHEMAS.aml.safeParse(doc);
    if (!parsed.success) {
      throw new KycError(400, 'VALIDATION_ERROR', `The declaration was not changed: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    return parsed.data as ComplianceDocs['aml'];
  };
  const saved = await patchDocItem(deps.storage, deps.config.nodeId, 'aml', scope, declaration.id, change, validate, ctx.by);
  if (!saved) throw new KycError(404, 'AML_DECLARATION_NOT_FOUND', 'The organism\'s obliged-entity declaration was not found.');
  return { declaration: saved as AmlDeclaration };
}

/** The organism's register entry for customer due diligence, when its title says so; else none. */
async function registerIdOf(deps: KycDeps, org: string): Promise<string> {
  const regs = await readDoc(deps.storage, deps.config.nodeId, 'registers', { kind: 'organism', organismId: org });
  const hit = regs.items.find(r => /due diligence|kyc|money laundering|aml\b|rahanpesu|asiakkaan tunteminen/i.test(r.title));
  return hit?.id ?? '';
}

/**
 * A draft data protection impact assessment of customer due diligence and sanctions screening on this
 * server, one DpiaSchema item. Stored nowhere. Officers and admins of the organism, and their agents.
 */
export async function dpiaDraft(deps: KycDeps, caller: CallerContext, org: string) {
  const ctx = await assessmentContext(deps, caller, org);
  const ai = deps.config.kycAi ?? 'local';
  const aiText = ai === 'off' ? 'the operator has turned the server\'s AI off for this data'
    : ai === 'local' ? 'only a model that runs on this server\'s own machine may read it'
      : 'any model this server allows may read it';
  const registerId = await registerIdOf(deps, org);
  const item: ComplianceDpia = {
    id: 'dpia-kyc-customer-due-diligence',
    registerId,
    description: 'Customer due diligence and sanctions screening under the EU anti-money-laundering regulation 2024/1624. '
      + 'Why an impact assessment is needed (GDPR art. 35): each customer is evaluated systematically and given a risk class that decides whether a relationship may start or continue; '
      + 'every customer and beneficial owner is screened automatically against the EU and UN sanctions lists; and the cards hold data on politically exposed persons and data relating to criminal offences '
      + '(sanctions hits, suspicions of money laundering), which GDPR art. 10 restricts. '
      + 'The processing: staff open a card per customer with identity, beneficial owners, purpose and source of funds; the server screens the card against the lists it fetched and rates the risk with a published rule; '
      + 'a person decides each hit and approves each high-risk or PEP customer; officers keep suspicion reports for the Financial Intelligence Unit. '
      + 'The records belong to the organism and are kept as records of this server, not of the member who wrote them.',
    necessity: 'The processing is a legal obligation of the organism as an obliged entity (AMLR art. 19-20 customer due diligence, art. 20(1)(d) and the sanctions regulations for screening, '
      + 'art. 42-46 politically exposed persons, art. 69 reporting suspicions, art. 77 five-year retention). Legal basis GDPR art. 6(1)(c); criminal-offence data under art. 10 as Union law authorises. '
      + 'Proportionality: only the fields the regulation asks for are on the card; the risk rule is additive and every point has a reason and a reference, so a person can check it; '
      + 'the depth of due diligence follows the risk class (simplified, standard, enhanced); a card is deleted after its retention. Answer for your firm: which fields you actually need, and why.',
    // One risk or one measure per line: the page shows each line as a row of its own.
    risks: [
      'False positive sanctions hits: a person with a similar name is blocked or delayed.',
      'Exclusion: a high risk class or a PEP status leads to a refused or ended relationship without the person knowing why.',
      'Data breach: identity documents, PEP status and suspicions are sensitive, and a leak harms the person and can warn a suspect.',
      'Tipping off: if the customer learns of a suspicion report, an investigation can fail and the law is broken (AMLR art. 73).',
      'Errors in the rating rule or in the lists the server fetched lead to wrong decisions at scale.',
      'Answer for your firm: how likely and how severe each one is for your customers.',
    ].join('\n'),
    measures: [
      'What this server enforces:',
      'A person decides each sanctions hit, in person and with a written ground. An agent cannot decide a hit.',
      'A high-risk or PEP customer stays blocked until the compliance officer or an admin approves the customer in person.',
      'Only the named compliance officers read and write suspicion reports, in person. The person who marks a suspicion learns only that it was received.',
      'Every change of a card is a new version, and no version is overwritten, so the firm can show what it knew on a given day.',
      'An ended card is kept five years and then deleted, leaving a receipt with no personal data. Before that, no member\'s delete and no organism delete removes it.',
      'The server\'s operator sees counts only, never a customer and never a suspicion.',
      'Screening runs on this server against lists it fetched, so no customer data leaves the server for screening.',
      `The server's AI and customer due diligence data: ${aiText} (operator setting AIMEAT_KYC_AI, now "${ai}").`,
      'Only the organism\'s named officers, staff and admins reach the cards. A session from another server reaches nothing.',
      'Add your firm\'s own measures: training, access reviews, how a person asks about a decision about them.',
    ].join('\n'),
    answerSources: { description: 'proposed', necessity: 'proposed', risks: 'proposed', measures: 'proposed' },
  };
  const parsed = DpiaSchema.safeParse(item);
  if (!parsed.success) throw new Error(`the DPIA draft does not fit DpiaSchema: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const at = `/v1/compliance/docs/dpias?scope=organism&organism_id=${encodeURIComponent(org)}`;
  const held = await readDoc(deps.storage, deps.config.nodeId, 'dpias', { kind: 'organism', organismId: org });
  return {
    organism: org,
    role: ctx.role,
    item: parsed.data,
    stored: held.items.some(i => i.id === parsed.data.id),
    store: {
      read: { method: 'GET', path: at },
      write: { method: 'POST', path: `/v1/kyc/${encodeURIComponent(org)}/dpia-draft/stored`, body: '{}' },
      mcp: 'aimeat_compliance_register_write with part "dpias", scope "organism", organism_id, and value { items: [ ...every stored item, item ] } (an admin of the organism)',
      who: 'The compliance officer or an admin of the organism, in person: the server keeps every other item and replaces this one by its id.',
    },
    note: 'A draft, not the assessment. Complete it: your own answers to the questions, residualRisk, the data protection officer\'s opinion (dpoOpinion), '
      + (registerId ? '' : 'the registerId of your record of processing for customer due diligence, ')
      + 'and completedAt when it is done. A high residual risk goes to the supervisory authority before the processing (GDPR art. 36).',
  };
}

/**
 * Store the DPIA draft in the organism's records (the compliance document `dpias`), replacing an item
 * with the same id and keeping every other. The KYC role decides, as for the risk assessment: the
 * compliance officer or an admin, in person; a named officer who is not an admin may store it too.
 */
export async function storeDpiaDraft(deps: KycDeps, caller: CallerContext, org: string) {
  const ctx = await assessmentContext(deps, caller, org);
  requireInPerson(ctx, 'Saving the impact assessment');
  const { item } = await dpiaDraft(deps, caller, org);
  const scope: ComplianceScope = { kind: 'organism', organismId: org };
  const current = await readDoc(deps.storage, deps.config.nodeId, 'dpias', scope);
  const next = DOC_SCHEMAS.dpias.safeParse({ ...current, items: [...current.items.filter(i => i.id !== item.id), item] });
  if (!next.success) {
    throw new KycError(400, 'VALIDATION_ERROR', `The records were not changed: ${next.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const saved = await writeDoc(deps.storage, deps.config.nodeId, 'dpias', scope, next.data as ComplianceDocs['dpias'], ctx.by);
  return { item, items: saved.items.length };
}
