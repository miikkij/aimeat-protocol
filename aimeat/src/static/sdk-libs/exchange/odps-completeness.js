/**
 * @file exchange/odps-completeness.js
 * @description The ODPS fill-rate meter: given an offering, which Open Data Product Specification
 *   v4.1 fields it fills and which are still blank, so an app can show a completeness bar whose
 *   every gap is something the seller can actually go and fix.
 *
 *   WHAT IT MEASURES, and why that is the honest question. `tools/odps-coverage.ts` walks the whole
 *   published v4.1 schema against a maximally-filled listing and splits every field three ways:
 *   what AIMEAT DERIVES (product id, timestamps, status, pricing plans, access ports, licence
 *   rights, observed usage — always present, never authored), what the PROVIDER authors (the `odps`
 *   block, the provenance attestation, the listing's own framing), and what AIMEAT has no source
 *   for at all. Counting the derived fields would put every listing above 60% on its first day and
 *   move when the projection changed rather than when the seller did; counting the unreachable ones
 *   would cap it below 100% forever. So this counts exactly the AUTHORED set — the same fields
 *   `models/odps-schemas.ts` defines as "what the node cannot derive" — and each entry carries the
 *   ODPS v4.1 path it lands on, so "missing" names a real place in a real document.
 *
 *   Deliberately dependency-free (no `window`, no fetch, no imports): the same function runs in the
 *   browser bundle and in a Node test that checks it against the projection it describes.
 * @structure ODPS_AUTHORED_FIELDS · valueAt · odpsCompleteness(offering)
 * @usage const { percent, missing } = odpsCompleteness(offering);
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 02 — the EXCHANGE browser library, gap G19).
 *     Field set mirrors OdpsExtrasSchema + ProvenanceSchema + the listing's own framing, i.e. the
 *     "provider must author" column of tools/odps-coverage.ts for ODPS v4.1.
 */

/**
 * One measurable field: where it lives on the offering, where it lands in the ODPS document, and
 * which part of the descriptor it belongs to.
 * @typedef {Object} OdpsField
 * @property {string} key     Dotted path on the OFFERING (`odps.valueProposition`, `provenance.source`, `title`).
 * @property {string} path    Dotted path in the projected ODPS v4.1 document.
 * @property {string} group   Grouping for a UI: framing · commitments · provenance · legal · support · governance.
 * @property {string} label   Short human label.
 */

/**
 * The fields a PROVIDER authors on an ODPS v4.1 descriptor. Order is presentation order: the ones a
 * buyer reads first come first, so a completeness list doubles as a to-do list in priority order.
 * @type {OdpsField[]}
 */
export const ODPS_AUTHORED_FIELDS = [
  // ── Framing: what a buyer reads to decide ──
  { key: 'title', path: 'product.details.name', group: 'framing', label: 'Title' },
  { key: 'description', path: 'product.details.description', group: 'framing', label: 'Description' },
  { key: 'odps.valueProposition', path: 'product.details.valueProposition', group: 'framing', label: 'Value proposition' },
  { key: 'odps.productType', path: 'product.details.type', group: 'framing', label: 'Product type' },
  { key: 'odps.categories', path: 'product.details.categories', group: 'framing', label: 'Categories' },
  { key: 'tags', path: 'product.details.tags', group: 'framing', label: 'Tags' },
  { key: 'odps.useCases', path: 'product.details.useCases', group: 'framing', label: 'Use cases' },
  { key: 'odps.contentSample', path: 'product.details.contentSample', group: 'framing', label: 'Output sample' },
  { key: 'odps.outputFileFormats', path: 'product.details.outputFileFormats', group: 'framing', label: 'Output formats' },
  { key: 'odps.standards', path: 'product.details.standards', group: 'framing', label: 'Standards followed' },
  { key: 'odps.productSeries', path: 'product.details.productSeries', group: 'framing', label: 'Product series' },
  { key: 'odps.logoURL', path: 'product.details.logoURL', group: 'framing', label: 'Logo' },
  { key: 'odps.brandSlogan', path: 'product.details.brandSlogan', group: 'framing', label: 'Slogan' },
  { key: 'odps.recommendedDataProducts', path: 'product.details.recommendedDataProducts', group: 'framing', label: 'Related products' },

  // ── Commitments: promises no observation can substitute for ──
  { key: 'odps.sla', path: 'product.SLA.declarative', group: 'commitments', label: 'Service-level commitments' },
  { key: 'odps.dataQuality', path: 'product.dataQuality.declarative', group: 'commitments', label: 'Data-quality commitments' },

  // ── Provenance: where the material came from, and on what basis ──
  { key: 'provenance.source', path: 'product.license.governance.ownership', group: 'provenance', label: 'Source' },
  { key: 'provenance.legalBasis', path: 'product.license.governance.applicableLaws', group: 'provenance', label: 'Legal basis' },
  { key: 'provenance.consentStatus', path: 'product.license.governance.audit', group: 'provenance', label: 'Consent status' },
  { key: 'provenance.retention', path: 'product.license.governance.audit', group: 'provenance', label: 'Retention' },
  { key: 'provenance.transformations', path: 'product.details.versionNotes', group: 'provenance', label: 'Transformations applied' },
  { key: 'provenance.snapshotHash', path: 'product.dataAccess[].checksum', group: 'provenance', label: 'Snapshot hash' },
  { key: 'provenance.lineage', path: 'product.license.governance.ownership', group: 'provenance', label: 'Upstream lineage' },

  // ── Usage terms: the three flags every AIMEAT listing must state to be listed at all ──
  { key: 'usageTerms', path: 'product.license.scope.rights', group: 'legal', label: 'Usage terms' },

  // ── Legal identity + jurisdiction: what a validator reports as missing on an otherwise full listing ──
  { key: 'odps.dataHolder.legalName', path: 'product.dataHolder.legalName', group: 'legal', label: 'Legal name' },
  { key: 'odps.dataHolder.businessID', path: 'product.dataHolder.businessID', group: 'legal', label: 'Business ID' },
  { key: 'odps.dataHolder.URL', path: 'product.dataHolder.URL', group: 'legal', label: 'Company website' },
  { key: 'odps.dataHolder.addressCountry', path: 'product.dataHolder.addressCountry', group: 'legal', label: 'Country' },
  { key: 'odps.dataHolder.addressLocality', path: 'product.dataHolder.addressLocality', group: 'legal', label: 'City' },
  { key: 'odps.license.applicableLaws', path: 'product.license.governance.applicableLaws', group: 'legal', label: 'Applicable law' },
  { key: 'odps.license.geographicalArea', path: 'product.license.scope.geographicalArea', group: 'legal', label: 'Geographical area' },
  { key: 'odps.license.exclusive', path: 'product.license.scope.exclusive', group: 'legal', label: 'Exclusivity stated' },
  { key: 'odps.license.terminationConditions', path: 'product.license.termination.terminationConditions', group: 'legal', label: 'Termination conditions' },

  // ── Support + versioning: what a buyer needs after they have bought ──
  { key: 'odps.documentationURL', path: 'product.SLA.declarative[].support.documentationURL', group: 'support', label: 'Documentation' },
  { key: 'odps.supportEmail', path: 'product.SLA.declarative[].support.email', group: 'support', label: 'Support email' },
  { key: 'odps.supportHours', path: 'product.SLA.declarative[].support.emailServiceHours', group: 'support', label: 'Support hours' },
  { key: 'odps.issues', path: 'product.details.issues', group: 'support', label: 'Known issues' },
  { key: 'odps.productVersion', path: 'product.details.productVersion', group: 'support', label: 'Product version' },

  // ── Governance + tax: how strictly it is run, and what the price includes ──
  { key: 'odps.language', path: 'product.details', group: 'governance', label: 'Content language' },
  { key: 'odps.governanceProfile', path: 'product.details.governanceProfile', group: 'governance', label: 'Governance profile' },
  { key: 'odps.portfolioPriority', path: 'product.details.portfolioPriority', group: 'governance', label: 'Portfolio priority' },
  { key: 'odps.valueAddedTaxIncluded', path: 'product.pricingPlans.declarative[].valueAddedTaxIncluded', group: 'governance', label: 'VAT included' },
  { key: 'odps.valueAddedTaxPercentage', path: 'product.pricingPlans.declarative[].valueAddedTaxPercentage', group: 'governance', label: 'VAT percentage' },
];

/**
 * Read a dotted path off an object without throwing on a missing branch.
 * @param {any} obj
 * @param {string} path
 * @returns {any}
 */
export function valueAt(obj, path) {
  let node = obj;
  for (const part of path.split('.')) {
    if (node === null || node === undefined || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

/**
 * True when a value counts as STATED. `false` and `0` count — a provider who declares "not
 * exclusive" or "0% VAT" has answered the question, and treating their answer as absence would tell
 * them to go and fill in a field they already filled.
 * @param {any} v
 * @returns {boolean}
 */
function isFilled(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;   // numbers (including 0) and booleans (including false)
}

/**
 * The ODPS fill rate for one offering, plus exactly what is missing.
 *
 * Accepts the offering record itself, or the `{ offering, … }` detail envelope `get(id)` returns —
 * an app usually has the latter in hand and should not have to remember which.
 *
 * @param {any} offering
 * @returns {{ percent: number, filled: number, total: number,
 *             missing: Array<{ key: string, path: string, group: string, label: string }>,
 *             present: Array<{ key: string, path: string, group: string, label: string }>,
 *             byGroup: Record<string, { filled: number, total: number, percent: number }>,
 *             odpsVersion: string }}
 */
export function odpsCompleteness(offering) {
  const o = (offering && offering.offering) ? offering.offering : (offering || {});
  const missing = [];
  const present = [];
  const byGroup = /** @type {Record<string, { filled: number, total: number, percent: number }>} */ ({});

  for (const field of ODPS_AUTHORED_FIELDS) {
    const g = byGroup[field.group] || (byGroup[field.group] = { filled: 0, total: 0, percent: 0 });
    g.total += 1;
    if (isFilled(valueAt(o, field.key))) {
      g.filled += 1;
      present.push(field);
    } else {
      missing.push(field);
    }
  }
  for (const k of Object.keys(byGroup)) {
    byGroup[k].percent = Math.round((byGroup[k].filled / byGroup[k].total) * 100);
  }

  const total = ODPS_AUTHORED_FIELDS.length;
  return {
    percent: Math.round((present.length / total) * 100),
    filled: present.length,
    total,
    missing,
    present,
    byGroup,
    // The version the descriptor follows — stamped by the node onto provenance when the listing is
    // written, so a listing authored before a version bump still says which spec it answers to.
    odpsVersion: (o.provenance && o.provenance.odpsVersion) || '4.1',
  };
}
