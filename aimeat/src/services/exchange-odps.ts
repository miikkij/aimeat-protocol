/**
 * @file src/services/exchange-odps.ts
 * @description Projects an EXCHANGE offering into an **Open Data Product Specification v4.1** document
 *   (opendataproducts.org, Linux Foundation, Apache-2.0) — the interoperable, machine-parsable descriptor a
 *   negotiating agent or an outside catalogue can read without knowing AIMEAT. This is a PROJECTION, exactly
 *   like the listing itself is a projection of its source (TARGET-050): nothing is stored in ODPS form, the
 *   document is derived on read from what the node already knows (title, kind, price + plans, usage licence,
 *   provider, observed usage) plus the provider's optional ODPS authoring block (models/odps-schemas.ts).
 *
 *   Two rules keep it honest:
 *   1. **Nothing is invented.** A field the node cannot know is omitted, never filled with a plausible value.
 *      An unstated SLA is an absent SLA block, not a promise of 99.9 %.
 *   v4.1 keeps text multilingual: `product.details` and `product.pricingPlans.declarative` are keyed by
 *   ISO 639-1 language code, and several name/description fields are language maps. AIMEAT listings carry
 *   ONE free-text title/description in whatever language the provider wrote, so everything is emitted under
 *   a single key — `odps.language` when the provider declares it, `en` otherwise. We never duplicate the
 *   same string under a second language: a claimed translation that does not exist is worse than none.
 *
 *   2. **AIMEAT-specific truth lives under `product.x-aimeat`** — the metered coordinate, the pinned interface
 *      + I/O schema, the call recipe, provenance, the projection source and the OBSERVED reputation. The ODPS
 *      root forbids unknown keys (`additionalProperties: false`), `product` does not, so the extension sits
 *      there and the document still validates against the official schema.
 * @structure ODPS_VERSION/ODPS_SCHEMA_URL · OdpsDocument types · offeringToOdps() · odpsToYaml() ·
 *   mergeOdpsExtras/mergeProvenance (app-level defaults → tool) ·
 *   helpers (product type · price plans · licence rights · data access · payment gateway)
 * @usage
 *   const doc = offeringToOdps({ offering, iface, callRecipe, stats, rakePercent, baseUrl, nodeId });
 *   res.type('text/yaml').send(odpsToYaml(doc));
 * @version-history
 *   v1.1.0 — 2026-07-25 — Pinned to ODPS **v4.1** (what the addendum's Q2 actually named; v4.0 was a
 *     miss on my part). v4.1 is structural, not cosmetic: language-keyed `details` + `pricingPlans`,
 *     `Languages` maps on access/gateway/SLA labels, `governanceProfile`/`portfolioPriority`, TOON format.
 *   v1.0.0 — 2026-07-25 — Initial ODPS projection (TARGET-045 §4 + addendum Q2): the listing format
 *     decision from the spec, implemented as a mapping over the native offering record.
 */
import { stringify as yamlStringify } from 'yaml';
import { formatMoneyMajor } from '../commerce/money.js';
import type { Offering, OfferingStats } from './exchange-market.js';
import type { OdpsExtras, OdpsSlaDimension, OdpsQualityDimension, Provenance } from '../models/odps-schemas.js';

/** The ODPS version this node speaks. Pinned per the TARGET-045 addendum (Q2: pin ODPS v4.x, v4.1 current). */
export const ODPS_VERSION = '4.1';
export const ODPS_SCHEMA_URL = 'https://opendataproducts.org/v4.1/schema/odps.json';
/** The same schema in YAML. A YAML document points at the YAML schema, as the spec's own examples do. */
export const ODPS_SCHEMA_URL_YAML = 'https://opendataproducts.org/v4.1/schema/odps.yaml';

/** ISO 639-1 code used when a provider has not declared what language its listing text is in. */
const DEFAULT_LANGUAGE = 'en';

/** v4.1 wraps several free-text fields in a language-keyed object (`$defs.Languages`). */
function localized(lang: string, text: string): Json {
  return { [lang]: text };
}

type Json = Record<string, unknown>;

/** An ODPS v4.1 document. Loosely typed on purpose — the authority is the published JSON Schema, which the
 *  E2E suite validates the generated document against (test/fixtures/odps-v4.1.schema.json). */
export interface OdpsDocument {
  schema: string;
  version: string;
  product: Json;
}

export interface OdpsProjectionInput {
  offering: Offering;
  /** The capability's published I/O schema (pinned snapshot for an app-tool, live action schema otherwise). */
  iface?: { inputSchema?: Json; outputSchema?: Json } | null;
  /** How a contracted consumer actually calls this — mirrored from the offering DETAIL surface. */
  callRecipe?: { method: string; url: string; mcp?: string; note?: string } | null;
  /** Observed usage, offered as evidence — never as an SLA commitment. */
  stats?: OfferingStats | null;
  /** The node's platform fee on each metered call, in percent. */
  rakePercent: number;
  baseUrl: string;
  nodeId: string;
}

/**
 * Inherit an app-level ODPS block into one of its tools. The app carries what is the same for every
 * capability it sells (data holder, logo, brand, governance profile, jurisdiction); the tool overrides
 * what is its own (value proposition, use cases, SLA commitments). Field by field, so a tool can restate
 * one thing without losing the rest. Returns null when neither side says anything.
 */
export function mergeOdpsExtras(base: OdpsExtras | null | undefined, own: OdpsExtras | null | undefined): OdpsExtras | null {
  if (!base && !own) return null;
  const merged = { ...(base ?? {}), ...(own ?? {}) } as OdpsExtras;
  return Object.keys(merged).length ? merged : null;
}

/** Same inheritance for the provenance attestation (the app states its source once, a tool may refine it). */
export function mergeProvenance(base: Provenance | null | undefined, own: Provenance | null | undefined): Provenance | null {
  if (!base && !own) return null;
  const merged = { ...(base ?? {}), ...(own ?? {}) } as Provenance;
  return Object.keys(merged).length ? merged : null;
}

/** ODPS `details.type` for an offering that did not declare one: what the surface actually is. */
function defaultProductType(o: Offering): string {
  if (o.kind === 'agent-work') return 'automated decision-making';
  return 'data-driven service';
}

/** A price as ODPS wants it: a decimal STRING plus a currency, or morsels with the unit spelled out. */
function priceFields(o: Offering, amount: number): { price: string; priceCurrency?: string; note?: string } {
  if (o.unit === 'money') return { price: formatMoneyMajor(amount), priceCurrency: o.currency ?? 'EUR' };
  return {
    price: String(amount),
    note: 'Priced in morsels — the AIMEAT node’s internal throttle unit (plain integers), not a fiat currency.',
  };
}

/** ODPS billing durations are calendar words; a subscription plan carries exact seconds. Pick the closest. */
function billingDuration(periodSeconds: number): 'day' | 'week' | 'month' | 'year' {
  const days = periodSeconds / 86_400;
  if (days < 2) return 'day';
  if (days < 14) return 'week';
  if (days < 120) return 'month';
  return 'year';
}

/** The pricing plans block: the per-call base price plus every volume/subscription plan on the listing. */
function pricingPlans(o: Offering, extras: OdpsExtras | null, lang: string): Json {
  const base = priceFields(o, o.basePrice);
  // The listed price is the one in force since the listing last changed — ODPS states that as a validity window.
  const validity: Json = {
    validFrom: o.updatedAt,   // `format: date-time` here, unlike details.created/updated (`format: date`)
    ...(extras?.valueAddedTaxIncluded !== undefined ? { valueAddedTaxIncluded: extras.valueAddedTaxIncluded } : {}),
    ...(extras?.valueAddedTaxPercentage !== undefined ? { valueAddedTaxPercentage: extras.valueAddedTaxPercentage } : {}),
  };
  const declarative: Json[] = [{
    ...validity,
    name: o.kind === 'agent-work' ? 'Per delivered task' : 'Per call',
    unit: 'Pay-per-use',
    billingDuration: 'instant',
    price: base.price,
    ...(base.priceCurrency ? { priceCurrency: base.priceCurrency } : {}),
    ...(base.note ? { notes: base.note } : {}),
  }];
  for (const plan of o.plans) {
    if (plan.model === 'bundle') {
      const p = priceFields(o, plan.blockPrice);
      declarative.push({
        ...validity,
        name: plan.id,
        unit: 'One-time-payment',
        billingDuration: 'instant',
        price: p.price,
        ...(p.priceCurrency ? { priceCurrency: p.priceCurrency } : {}),
        maxTransactionQuantity: plan.blockSize,
        notes: `Prepaid block of ${plan.blockSize} calls.${p.note ? ` ${p.note}` : ''}`,
      });
    } else if (plan.model === 'subscription') {
      const p = priceFields(o, plan.periodPrice);
      declarative.push({
        ...validity,
        name: plan.id,
        unit: 'Recurring',
        billingDuration: billingDuration(plan.periodSeconds),
        price: p.price,
        ...(p.priceCurrency ? { priceCurrency: p.priceCurrency } : {}),
        maxTransactionQuantity: plan.callsPerWindow,
        notes: `Subscription: period ${plan.periodSeconds}s, ${plan.callsPerWindow} calls per ${plan.windowSeconds}s window.${p.note ? ` ${p.note}` : ''}`,
      });
    }
  }
  return { declarative: { [lang]: declarative } };   // v4.1: declarative is keyed by language
}

/** AIMEAT's three usage flags expressed as ODPS licence rights (what the buyer MAY do with the output). */
function licenceRights(o: Offering): string[] {
  const rights = ['Reproduction', 'Display'];
  if (o.usageTerms?.derivatives) rights.push('Adaptation');
  if (o.usageTerms?.resale) rights.push('Distribution', 'Reselling');
  return rights;
}

/** The licence block: AIMEAT usage terms as rights + restrictions, provider extras as jurisdiction/exit terms. */
function licence(o: Offering, extras: OdpsExtras | null): Json {
  const t = o.usageTerms;
  const restrictions: string[] = [];
  if (t && !t.derivatives) restrictions.push('No derivative works.');
  if (t && !t.resale) restrictions.push('No resale or redistribution of the raw or derived output.');
  if (t?.attribution) restrictions.push('Attribution to the provider is required.');
  if (t?.note) restrictions.push(t.note);
  if (extras?.license?.restrictions) restrictions.push(extras.license.restrictions);

  const scope: Json = {
    definition: t
      ? `Usage licence granted with the metered contract: derivative works ${t.derivatives ? 'allowed' : 'not allowed'}, resale ${t.resale ? 'allowed' : 'not allowed'}, attribution ${t.attribution ? 'required' : 'not required'}.`
      : 'No usage terms stated by the provider.',
    rights: licenceRights(o),
    ...(restrictions.length ? { restrictions: restrictions.join(' ') } : {}),
    ...(extras?.license?.geographicalArea ? { geographicalArea: extras.license.geographicalArea } : {}),
    ...(extras?.license?.permanent !== undefined ? { permanent: extras.license.permanent } : {}),
    ...(extras?.license?.exclusive !== undefined ? { exclusive: extras.license.exclusive } : {}),
  };

  const governance: Json = {
    ownership: `${o.providerGhii} (AIMEAT principal; the provider retains ownership of the source data)`,
    audit: 'Every call is metered by the AIMEAT node against the consumer’s contract; the provider sees per-consumer usage at GET /v1/exchange/offerings/{id}/consumers.',
    ...(extras?.license?.applicableLaws ? { applicableLaws: extras.license.applicableLaws } : {}),
    ...(extras?.license?.warranties ? { warranties: extras.license.warranties } : {}),
    ...(extras?.license?.damages ? { damages: extras.license.damages } : {}),
    ...(extras?.license?.confidentiality ? { confidentiality: extras.license.confidentiality } : {}),
    ...(extras?.license?.forceMajeure ? { forceMajeure: extras.license.forceMajeure } : {}),
  };

  const termination: Json = {
    ...(extras?.license?.terminationNoticePeriodDays !== undefined ? { noticePeriod: extras.license.terminationNoticePeriodDays } : {}),
    ...(extras?.license?.terminationConditions ? { terminationConditions: extras.license.terminationConditions } : {}),
    ...(extras?.license?.continuityConditions ? { continuityConditions: extras.license.continuityConditions } : {}),
  };

  return { scope, governance, ...(Object.keys(termination).length ? { termination } : {}) };
}

/**
 * How the product is actually delivered: the metered REST call, and the MCP surface when the node exposes
 * one. ODPS models `dataAccess` as a MAPPING of named access blocks (`default`, then whatever else the
 * product offers) — see the v4.1 examples. The published JSON Schema is self-contradictory here (the
 * `product.dataAccess` property is `type: object` while it `$ref`s an array-typed definition), so the
 * documented shape is the one to follow; the E2E suite validates around that known schema bug.
 */
function dataAccess(input: OdpsProjectionInput, lang: string): Json {
  const { offering: o, callRecipe, baseUrl } = input;
  const ports: Json = {};
  ports.default = {
    name: localized(lang, 'Metered AIMEAT call'),
    description: localized(lang, 'The accepted contract IS the access — the consumer calls with their own AIMEAT token and no separate API key is issued; each call is metered, charged and rake-split by the node.'),
    outputPortType: 'API',
    format: 'JSON',
    authenticationMethod: 'Token',
    specification: 'OAS',
    specsURL: `${baseUrl}/v1/spec`,
    ...(callRecipe ? { accessURL: `${baseUrl}${callRecipe.url}` } : {}),
    documentationURL: `${baseUrl}/v1/exchange/offerings/${o.offeringId}`,
    // The provider's snapshot digest is exactly what ODPS means by hashType/checksum.
    ...(o.provenance?.snapshotHash ? { hashType: 'SHA-256', checksum: o.provenance.snapshotHash.replace(/^sha256:/, '') } : {}),
  };
  if (callRecipe?.mcp) {
    ports.mcp = {
      name: localized(lang, 'MCP'),
      description: localized(lang, `Same capability over MCP: ${callRecipe.mcp}`),
      outputPortType: 'AI',
      format: 'MCP',
      authenticationMethod: 'Token',
      specification: 'MCP',
      accessURL: `${baseUrl}/v1/mcp`,
      documentationURL: `${baseUrl}/v1/exchange/offerings/${o.offeringId}`,
    };
  }
  return ports;
}

/** Which rail settles this offering. Money goes out over the platform's connected-account rail; morsels never
 *  leave. Same named-mapping shape (and the same published-schema caveat) as `dataAccess`. */
function paymentGateways(o: Offering, rakePercent: number, baseUrl: string, lang: string): Json {
  if (o.unit === 'money') {
    return {
      default: {
        type: 'Stripe',
        description: localized(lang, `Settled to the provider’s connected account through the AIMEAT platform rail (${o.currency ?? 'EUR'}); the platform retains ${rakePercent}% of each metered call.`),
        reference: `${baseUrl}/v1/exchange/info`,
      },
    };
  }
  return {
    default: {
      type: 'Custom',
      description: localized(lang, `Morsel meter — the AIMEAT node’s internal throttle unit. Each metered call debits the consumer’s morsel balance and credits the provider; the platform retains ${rakePercent}%. No external payment rail is involved.`),
      reference: `${baseUrl}/v1/exchange/info`,
    },
  };
}

/** Provider SLA commitments (declarative). Absent unless the provider actually committed to something. */
function slaBlock(extras: OdpsExtras | null, lang: string): Json | null {
  const dims = extras?.sla ?? [];
  if (!dims.length) return null;
  const support: Json = {
    ...(extras?.supportEmail ? { email: extras.supportEmail } : {}),
    ...(extras?.supportHours ? { emailServiceHours: extras.supportHours } : {}),
    ...(extras?.documentationURL ? { documentationURL: extras.documentationURL } : {}),
  };
  return {
    declarative: [{
      name: localized(lang, 'Provider commitment'),
      description: localized(lang, 'Service levels the provider commits to for this offering.'),
      ...(Object.keys(support).length ? { support } : {}),
      dimensions: dims.map((d: OdpsSlaDimension) => ({
        dimension: d.dimension, objective: String(d.objective), unit: d.unit,
        ...(d.description ? { description: d.description } : {}),
      })),
    }],
  };
}

/** Provider data-quality commitments (declarative). */
function qualityBlock(extras: OdpsExtras | null, lang: string): Json | null {
  const dims = extras?.dataQuality ?? [];
  if (!dims.length) return null;
  return {
    declarative: [{
      displayTitle: [localized(lang, 'Provider commitment')],   // v4.1: an ARRAY of language maps here
      description: 'Data-quality levels the provider commits to for this offering.',
      dimensions: dims.map((d: OdpsQualityDimension) => ({
        dimension: d.dimension, objective: Math.round(d.objective), unit: d.unit,
        ...(d.description ? { description: d.description } : {}),
      })),
    }],
  };
}

/** The legal entity behind the offering: the provider's declaration when given, the AIMEAT account otherwise. */
function dataHolder(o: Offering, extras: OdpsExtras | null, baseUrl: string): Json {
  if (extras?.dataHolder) return { ...extras.dataHolder } as Json;
  return {
    legalName: o.providerOwner,
    description: 'AIMEAT account identity of the provider. No verified legal entity has been declared for this offering — treat the account, not a company, as the counterparty.',
    URL: baseUrl,
  };
}

/** The AIMEAT extension block: everything true about this offering that ODPS v4.1 has no slot for. */
function aimeatExtension(input: OdpsProjectionInput): Json {
  const { offering: o, iface, callRecipe, stats, rakePercent, nodeId } = input;
  return {
    node_id: nodeId,
    language: (o.odps as OdpsExtras | null)?.language ?? DEFAULT_LANGUAGE,
    offering_id: o.offeringId,
    kind: o.kind,
    provider: { ghii: o.providerGhii, owner: o.providerOwner },
    capability: { ext: o.ext, action: o.action },
    ...(o.surface ? { surface: o.surface as unknown as Json } : {}),
    ...(iface ? { interface: { input_schema: iface.inputSchema ?? {}, output_schema: iface.outputSchema ?? {} } } : {}),
    ...(callRecipe ? { call_recipe: callRecipe as unknown as Json } : {}),
    ...(o.usageTerms ? { usage_terms: o.usageTerms as unknown as Json } : {}),
    ...(o.provenance ? { provenance: o.provenance as unknown as Json } : {}),
    economics: {
      unit: o.unit, base_price: o.basePrice, currency: o.currency, rake_percent: rakePercent,
      note: 'base_price is in the offering unit: 6-decimal micro-units for money, whole morsels otherwise.',
    },
    ...(stats ? {
      observed: {
        active_contracts: stats.activeContracts, total_contracts: stats.totalContracts,
        total_calls: stats.totalCalls, consumers: stats.consumers,
        listed_at: stats.listedAt, last_used_at: stats.lastUsedAt,
        note: 'Measured by the node from real metered calls. Evidence, not a service-level commitment.',
      },
    } : {}),
    projection: {
      auto: o.auto === true,
      source_hash: o.sourceHash ?? null,
      note: 'This listing is a projection of its source (app-tool manifest, extension action or agent offer); an accepted contract stays pinned to the interface and price it was signed at.',
    },
  };
}

/**
 * Project one offering into an ODPS v4.1 document. Pure: no storage, no clock — everything comes from the
 * inputs, so the same offering always yields the same document.
 */
export function offeringToOdps(input: OdpsProjectionInput): OdpsDocument {
  const o = input.offering;
  const extras = (o.odps ?? null) as OdpsExtras | null;
  const lang = extras?.language ?? DEFAULT_LANGUAGE;
  const ifaceVersion = o.surface && o.surface.kind === 'app-tool' ? o.surface.ifaceVersion : null;

  const details: Json = {
    name: o.title || `${o.ext}/${o.action}`,
    productID: o.offeringId,
    visibility: o.state === 'listed' ? 'public' : 'private',
    status: o.state === 'listed' ? 'production' : 'retired',
    type: extras?.productType ?? defaultProductType(o),
    // ODPS dates are calendar dates (`format: date`), not timestamps — the full instant lives in x-aimeat.
    created: o.createdAt.slice(0, 10),
    updated: o.updatedAt.slice(0, 10),
    ...(o.description ? { description: o.description } : {}),
    ...(extras?.valueProposition ? { valueProposition: extras.valueProposition } : {}),
    ...(extras?.productSeries ? { productSeries: extras.productSeries } : {}),
    ...(o.tags.length ? { tags: o.tags } : {}),
    ...(extras?.categories ? { categories: extras.categories } : {}),
    standards: [...new Set([`ODPS v${ODPS_VERSION}`, ...(extras?.standards ?? [])])],
    ...(extras?.useCases?.length ? {
      useCases: extras.useCases.map(u => ({
        useCase: {
          useCaseTitle: u.title,
          ...(u.description ? { useCaseDescription: u.description } : {}),
          ...(u.url ? { useCaseURL: u.url } : {}),
        },
      })),
    } : {}),
    outputFileFormats: extras?.outputFileFormats ?? ['JSON'],
    ...(extras?.contentSample ? { contentSample: extras.contentSample } : {}),
    ...(extras?.logoURL ? { logoURL: extras.logoURL } : {}),
    ...(extras?.brandSlogan ? { brandSlogan: extras.brandSlogan } : {}),
    ...(extras?.productVersion ?? ifaceVersion ? { productVersion: extras?.productVersion ?? String(ifaceVersion) } : {}),
    ...(extras?.versionNotes ? { versionNotes: extras.versionNotes } : {}),
    ...(extras?.issues ? { issues: extras.issues } : {}),
    ...(extras?.recommendedDataProducts ? { recommendedDataProducts: extras.recommendedDataProducts } : {}),
    ...(extras?.governanceProfile ? { governanceProfile: extras.governanceProfile } : {}),
    ...(extras?.portfolioPriority ? { portfolioPriority: extras.portfolioPriority } : {}),
  };

  const sla = slaBlock(extras, lang);
  const quality = qualityBlock(extras, lang);

  return {
    schema: ODPS_SCHEMA_URL,
    version: ODPS_VERSION,
    product: {
      details: { [lang]: details },   // v4.1: details is keyed by ISO 639-1 language
      dataAccess: dataAccess(input, lang),
      pricingPlans: pricingPlans(o, extras, lang),
      license: licence(o, extras),
      dataHolder: dataHolder(o, extras, input.baseUrl),
      paymentGateways: paymentGateways(o, input.rakePercent, input.baseUrl, lang),
      ...(sla ? { SLA: sla } : {}),
      ...(quality ? { dataQuality: quality } : {}),
      'x-aimeat': aimeatExtension(input),
    },
  };
}

/**
 * Serialise an ODPS document as YAML — the format the specification leads with. The `schema` pointer is
 * swapped to the YAML flavour of the same schema, matching the spec's own examples: a YAML document that
 * points a validator at a JSON schema file is needlessly awkward for the consumer.
 */
export function odpsToYaml(doc: OdpsDocument): string {
  return yamlStringify({ ...doc, schema: ODPS_SCHEMA_URL_YAML }, { lineWidth: 0 });
}
