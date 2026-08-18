/**
 * @file src/models/odps-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ODPS (Open Data Product Specification, Linux Foundation) authoring contract for an
 *   EXCHANGE offering. AIMEAT derives most of an ODPS v4.1 document from what the node already knows
 *   (title, price, plans, licence, provider, observed usage — see services/exchange-odps.ts); these are the
 *   fields ODPS defines that the node CANNOT derive and a provider may therefore declare on the listing:
 *   the product framing (value proposition, categories, standards, use cases, sample), the SLA + data-quality
 *   COMMITMENTS (objectives, which are promises no observation can substitute for), and the legal data holder.
 *   Everything here is optional — an offering without it still projects a valid ODPS v4.1 document.
 *   PROVENANCE lives here too: the provider's attestation about where the data came from, on what legal
 *   basis, how long it is kept, and (for derived data) the upstream lineage it was built from.
 * @structure ODPS enums (product type · SLA/DQ dimensions + units) · ProvenanceSchema · OdpsExtrasSchema ·
 *   inferred types (Provenance · OdpsExtras · OdpsSlaDimension · OdpsQualityDimension · OdpsDataHolder)
 * @usage
 *   const parsed = OdpsExtrasSchema.safeParse(req.body.odps);
 *   if (!parsed.success) return res.status(400).json(error(nodeId, 'INVALID_ODPS', parsed.error.message));
 * @version-history
 *   Text limits raised 10x (shortText 4 000, longText 40 000, valueProposition 4 000) — 2026-07-30 —
 *     none of them came from ODPS; they were ours, and they truncated real descriptors.
 *   v1.1.0 — 2026-07-25 — Pinned to ODPS v4.1 (the version the addendum's Q2 named): `language` (v4.1
 *     keys details + pricing by ISO 639-1 code), `governanceProfile`, `portfolioPriority`, TOON format.
 *   v1.0.0 — 2026-07-25 — Initial ODPS authoring contract + provenance attestation (TARGET-045 §4,
 *     addendum Q2/Q3): closes the drift where `odpsVersion` was declared but never written.
 */
import { z } from 'zod';

/** ODPS v4.1 `product.details.type` — what KIND of data product this is. */
export const ODPS_PRODUCT_TYPES = [
  'raw data', 'derived data', 'dataset', 'reports', 'analytic view', '3D visualisation', 'algorithm',
  'decision support', 'automated decision-making', 'data-enhanced product', 'data-driven service',
  'data-enabled performance', 'bi-directional',
] as const;

/** ODPS v4.1 SLA dimensions (`product.SLA.declarative[].dimensions[].dimension`). */
export const ODPS_SLA_DIMENSIONS = [
  'latency', 'uptime', 'responseTime', 'errorRate', 'endOfSupport', 'endOfLife', 'updateFrequency',
  'timeToDetect', 'timeToNotify', 'timeToRepair', 'emailResponseTime',
] as const;

/** ODPS v4.1 SLA objective units. */
export const ODPS_SLA_UNITS = [
  'percent', 'milliseconds', 'seconds', 'minutes', 'days', 'weeks', 'months', 'years', 'never', 'date', 'null',
] as const;

/** ODPS v4.1 data-quality dimensions. */
export const ODPS_QUALITY_DIMENSIONS = [
  'accuracy', 'completeness', 'conformity', 'consistency', 'coverage', 'timeliness', 'validity', 'uniqueness',
] as const;

/** ODPS v4.1 output file formats a data product can be delivered in (v4.1 adds TOON). */
export const ODPS_OUTPUT_FORMATS = ['TOON', 'JSON', 'XML', 'CSV', 'Excel', 'zip', 'plain text', 'GraphQL', 'MCP'] as const;

/** ODPS v4.1 `details.governanceProfile` — how strictly the product is governed. */
export const ODPS_GOVERNANCE_PROFILES = ['structured', 'enforced', 'automated', 'audit_ready'] as const;

/** ODPS v4.1 `details.portfolioPriority` — how important the product is in its owner's portfolio. */
export const ODPS_PORTFOLIO_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

const shortText = z.string().trim().min(1).max(4_000);
const longText = z.string().trim().min(1).max(40_000);
const shortList = z.array(z.string().trim().min(1).max(400)).max(100);

/** One hop of upstream lineage for DERIVED data — where a component came from and what was done to it. */
export const ProvenanceLineageHopSchema = z.object({
  source: shortText,
  transform: shortText.optional(),
  at: z.string().trim().max(40).optional(),
});

/**
 * The provider's provenance attestation. A PROMISE by the provider, not a platform guarantee — but a
 * structured, attributed one (the provider is a GHII/GAII/GEAI) that a buyer can hold them to. Maps onto
 * ODPS `license.governance` + the AIMEAT extension block; absent provenance is legal, it just reads as
 * "unstated" to every buyer looking at the listing.
 */
export const ProvenanceSchema = z.object({
  /** Where the data comes from (system, register, API, collection method). */
  source: shortText.optional(),
  /** The lawful basis for holding + reselling it (e.g. "GDPR Art. 6(1)(f) legitimate interest", "public register"). */
  legalBasis: shortText.optional(),
  /** Consent state of the underlying subjects, when the data is personal. */
  consentStatus: shortText.optional(),
  /** How long the provider retains it. */
  retention: shortText.optional(),
  /** What was done to the raw material to make this product (cleaning, joining, enrichment, model inference). */
  transformations: longText.optional(),
  /** SHA-256 content identity of the snapshot this promise is about (hex or `sha256:` prefixed). */
  snapshotHash: z.string().trim().regex(/^(sha256:)?[a-fA-F0-9]{64}$/, 'snapshotHash must be a SHA-256 hex digest').optional(),
  /** Upstream chain for derived data (OpenLineage-style, kept deliberately small + human-readable). */
  lineage: z.array(ProvenanceLineageHopSchema).max(20).optional(),
  /** Which ODPS version this listing's descriptor follows. Defaulted by the node on write. */
  odpsVersion: z.string().trim().max(10).optional(),
});

/** An SLA COMMITMENT on the offering (what the provider promises, as opposed to what the node observed). */
export const OdpsSlaDimensionSchema = z.object({
  dimension: z.enum(ODPS_SLA_DIMENSIONS),
  objective: z.number(),
  unit: z.enum(ODPS_SLA_UNITS),
  description: shortText.optional(),
});

/** A data-quality COMMITMENT on the offering. */
export const OdpsQualityDimensionSchema = z.object({
  dimension: z.enum(ODPS_QUALITY_DIMENSIONS),
  objective: z.number(),
  unit: z.enum(['percentage', 'number']),
  description: shortText.optional(),
});

/** The legal entity behind the offering. AIMEAT knows the ACCOUNT (a GHII); only the provider knows the company. */
export const OdpsDataHolderSchema = z.object({
  legalName: shortText,
  businessID: z.string().trim().max(60).optional(),
  taxID: z.string().trim().max(60).optional(),
  vatID: z.string().trim().max(60).optional(),
  email: z.string().trim().email().max(200).optional(),
  URL: z.string().trim().url().max(400).optional(),
  telephone: z.string().trim().max(60).optional(),
  contactName: shortText.optional(),
  addressRegion: z.string().trim().max(120).optional(),
  businessDomain: shortText.optional(),
  description: longText.optional(),
  addressCountry: z.string().trim().max(60).optional(),
  addressLocality: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  streetAddress: shortText.optional(),
  logoURL: z.string().trim().url().max(400).optional(),
  slogan: shortText.optional(),
  parentOrganization: shortText.optional(),
});

/** Licence terms ODPS carries that AIMEAT's three-flag `usageTerms` does not (jurisdiction, exclusivity, exit). */
export const OdpsLicenseExtrasSchema = z.object({
  geographicalArea: shortList.optional(),
  permanent: z.boolean().optional(),
  exclusive: z.boolean().optional(),
  restrictions: longText.optional(),
  applicableLaws: shortText.optional(),
  warranties: longText.optional(),
  damages: longText.optional(),
  confidentiality: longText.optional(),
  forceMajeure: longText.optional(),
  terminationNoticePeriodDays: z.number().int().min(0).max(3650).optional(),
  terminationConditions: longText.optional(),
  continuityConditions: longText.optional(),
});

/**
 * Everything ODPS defines that the node cannot derive from the offering itself. All optional: a listing
 * without any of it still projects a schema-valid ODPS v4.1 document, just a thinner one.
 */
export const OdpsExtrasSchema = z.object({
  /**
   * ISO 639-1 code for the language the listing text is written in. ODPS v4.1 keys `details` and
   * `pricingPlans.declarative` by language; AIMEAT carries one free-text title/description, so this says
   * which key it belongs under. Defaults to `en`. The same string is never duplicated under a second
   * language — a claimed translation that does not exist is worse than none.
   */
  language: z.string().trim().regex(/^[a-z]{2}$/, 'language must be an ISO 639-1 two-letter code').optional(),
  /** Overrides the node's default product type (derived from the offering kind). */
  productType: z.enum(ODPS_PRODUCT_TYPES).optional(),
  /** v4.1: governance maturity applied to this product. */
  governanceProfile: z.enum(ODPS_GOVERNANCE_PROFILES).optional(),
  /** v4.1: importance of this product in the provider's portfolio. */
  portfolioPriority: z.enum(ODPS_PORTFOLIO_PRIORITIES).optional(),
  /** ODPS caps the value proposition at 512 characters. */
  valueProposition: z.string().trim().min(1).max(4_000).optional(),
  productSeries: shortText.optional(),
  categories: shortList.optional(),
  standards: shortList.optional(),
  /** Use cases as ODPS models them: a title, an optional description and an optional link. */
  useCases: z.array(z.object({
    title: shortText,
    description: longText.optional(),
    url: z.string().trim().url().max(400).optional(),
  })).max(20).optional(),
  outputFileFormats: z.array(z.enum(ODPS_OUTPUT_FORMATS)).max(8).optional(),
  /** URL of a real output sample, so a buyer sees the goods before contracting (ODPS requires a URI here). */
  contentSample: z.string().trim().url().max(400).optional(),
  logoURL: z.string().trim().url().max(400).optional(),
  brandSlogan: shortText.optional(),
  productVersion: z.string().trim().max(40).optional(),
  versionNotes: longText.optional(),
  issues: longText.optional(),
  documentationURL: z.string().trim().url().max(400).optional(),
  supportEmail: z.string().trim().email().max(200).optional(),
  supportHours: shortText.optional(),
  /** VAT treatment of the listed price — applied to every pricing plan in the projected document. */
  valueAddedTaxIncluded: z.boolean().optional(),
  valueAddedTaxPercentage: z.number().int().min(0).max(100).optional(),
  /** Related products a buyer may also want (ODPS cross-sell hook): offering ids or URLs. */
  recommendedDataProducts: shortList.optional(),
  sla: z.array(OdpsSlaDimensionSchema).max(11).optional(),
  dataQuality: z.array(OdpsQualityDimensionSchema).max(8).optional(),
  dataHolder: OdpsDataHolderSchema.optional(),
  license: OdpsLicenseExtrasSchema.optional(),
});

export type ProvenanceLineageHop = z.infer<typeof ProvenanceLineageHopSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type OdpsSlaDimension = z.infer<typeof OdpsSlaDimensionSchema>;
export type OdpsQualityDimension = z.infer<typeof OdpsQualityDimensionSchema>;
export type OdpsDataHolder = z.infer<typeof OdpsDataHolderSchema>;
export type OdpsLicenseExtras = z.infer<typeof OdpsLicenseExtrasSchema>;
export type OdpsExtras = z.infer<typeof OdpsExtrasSchema>;
