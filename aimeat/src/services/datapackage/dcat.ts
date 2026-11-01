/**
 * @file src/services/datapackage/dcat.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The DCAT-AP 3.0 catalogue of this node's public data packages, as JSON-LD and as Turtle,
 *   for GET /v1/catalogue/dcat. A harvester (data.europa.eu, a national open-data portal, CKAN's DCAT
 *   harvester) reads it and lists the packages in its own catalogue, which is how a dataset published
 *   here is found by someone who has never heard of this node.
 *
 *   ONE GRAPH, TWO SERIALISATIONS. The catalogue is built once as a small node graph (RdfNode) and then
 *   written as JSON-LD (dcatToJsonLd) or as Turtle (dcatToTurtle), so the two formats cannot say
 *   different things. No RDF library: the graph has fixed shapes and the two writers are short, and the
 *   dependency rules ask for a reason a library would be needed.
 *
 *   WHAT A DATASET STATES, all from its catalogue manifest (./catalogue-facts.ts), no file read:
 *   dct:title, dct:description (the package's own, or a sentence of its size), dct:identifier (the
 *   package id), dct:publisher (the owner's account as a foaf:Agent with the node's address),
 *   dct:issued and dct:modified, dcat:keyword, dct:license when the package names one,
 *   dct:accrualPeriodicity when a schedule produces it and its cron has a word in the EU frequency
 *   vocabulary (accrualPeriodicityOf; a cron it cannot name exactly gets none), dcat:landingPage (the
 *   public dataset page), and a dcat:distribution for each resource CSV (downloadURL, mediaType
 *   text/csv, byteSize when recorded), for the OData v4 service and for the Frictionless descriptor.
 *
 *   PAGING follows the Hydra convention DCAT-AP harvesters read (the one data.europa.eu documents for
 *   paged DCAT feeds): the catalogue carries hydra:totalItems and a hydra:PartialCollectionView with
 *   hydra:first, hydra:last and, where they exist, hydra:next and hydra:previous. `?page=` counts from
 *   1, `?page_size=` takes 1 to 500 (default 100).
 * @structure accrualPeriodicityOf · buildDcatGraph · dcatToJsonLd · dcatToTurtle · DCAT_PAGE_SIZE ·
 *   DCAT_MAX_PAGE_SIZE · DCAT_PREFIXES
 * @usage
 *   const graph = buildDcatGraph({ config, facts: page, total, page: 1, pageSize: 100, format: 'jsonld' });
 *   res.type('application/ld+json').send(JSON.stringify(dcatToJsonLd(graph)));
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D1.3).
 */
import type { AimeatConfig } from '../../config.js';
import { datasetLinks, type DatasetFacts } from './catalogue-facts.js';

export const DCAT_PAGE_SIZE = 100;
export const DCAT_MAX_PAGE_SIZE = 500;

export const DCAT_PREFIXES = {
  dcat: 'http://www.w3.org/ns/dcat#',
  dct: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  hydra: 'http://www.w3.org/ns/hydra/core#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
} as const;

const FREQUENCY = 'http://publications.europa.eu/resource/authority/frequency/';
const FILE_TYPE = 'http://publications.europa.eu/resource/authority/file-type/';
const MEDIA_TYPE = 'http://www.iana.org/assignments/media-types/';
const ODATA_V4 = 'http://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html';
const TABULAR_DATA_PACKAGE = 'https://specs.frictionlessdata.io/tabular-data-package/';

/* ── The graph ─────────────────────────────────────────────────────────────────────────────────── */

/** A value of one property: an IRI, a literal (typed or plain), or a nested node. */
export type RdfValue =
  | { iri: string }
  | { lit: string; dt?: string }
  | RdfNode;

/** One node: an IRI subject (`id`) or a blank node, its types, and its properties in order. */
export interface RdfNode {
  id?: string;
  types: string[];
  props: Array<[string, RdfValue]>;
}

const iri = (v: string): RdfValue => ({ iri: v });
const lit = (v: string, dt?: string): RdfValue => (dt ? { lit: v, dt } : { lit: v });
const isNode = (v: RdfValue): v is RdfNode => 'types' in v;

/**
 * A cron expression as an EU frequency word, or null when the expression has no exact word. Coarse on
 * purpose and never rounded: `0 6 * * *` is DAILY, `0 6 * * 1` WEEKLY, `0 6 1 * *` MONTHLY, but a cron
 * every three days or on four weekdays has no word in the vocabulary and gets none.
 */
export function accrualPeriodicityOf(cron: string | undefined): string | null {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts;
  const single = (f: string) => /^\d+$/.test(f);
  const list = (f: string) => (/^\d+(,\d+)+$/.test(f) ? f.split(',').length : 0);
  if (!single(minute)) return null;
  if (month !== '*') {
    // A month named: once a year on a named day of it; every third or sixth month a quarter or a half.
    if (!single(dom) || dow !== '*') return null;
    if (single(month)) return single(hour) ? 'ANNUAL' : null;
    if (month === '*/3') return single(hour) ? 'QUARTERLY' : null;
    if (month === '*/6') return single(hour) ? 'ANNUAL_2' : null;
    return null;
  }
  if (dom !== '*') return dow === '*' && single(dom) && single(hour) ? 'MONTHLY' : null;
  if (dow !== '*') {
    if (!single(hour)) return null;
    if (single(dow)) return 'WEEKLY';
    const days = list(dow);
    return days === 2 ? 'WEEKLY_2' : days === 3 ? 'WEEKLY_3' : null;
  }
  if (hour === '*') return 'HOURLY';
  if (single(hour)) return 'DAILY';
  return list(hour) === 2 ? 'DAILY_2' : null;
}

/** The description a dataset carries: its own, or a sentence of its size from the descriptor's numbers. */
export function datasetDescriptionOf(f: Pick<DatasetFacts, 'description' | 'resources'>): string {
  if (f.description) return f.description;
  const rows = f.resources.reduce((n, r) => n + r.rowCount, 0);
  return `${rows} rows across ${f.resources.length} resource(s), as a Frictionless Data Package (CSV with a Table Schema).`;
}

/** The node's own address of the account that published a package: a fragment under the node. */
function agentIri(base: string, owner: string): string {
  return `${base}/#account-${encodeURIComponent(owner)}`;
}

/** dct:license: an IRI when the package names one, else a licence document with the text as its label. */
function licenseValue(license: string): RdfValue {
  if (/^https?:\/\/\S+$/.test(license)) return iri(license);
  return { types: ['dct:LicenseDocument'], props: [['rdfs:label', lit(license)]] };
}

function datasetNode(base: string, f: DatasetFacts): RdfNode {
  const links = datasetLinks(base, f);
  const props: Array<[string, RdfValue]> = [
    ['dct:title', lit(f.title)],
    ['dct:description', lit(datasetDescriptionOf(f))],
    ['dct:identifier', lit(f.packageId)],
    ['dct:publisher', {
      id: agentIri(base, f.owner), types: ['foaf:Agent'],
      props: [['foaf:name', lit(f.owner)], ['foaf:homepage', iri(`${base}/`)]],
    }],
    ['dct:issued', lit(f.issued, 'xsd:dateTime')],
    ['dct:modified', lit(f.modified, 'xsd:dateTime')],
  ];
  for (const k of f.keywords) props.push(['dcat:keyword', lit(k)]);
  if (f.license) props.push(['dct:license', licenseValue(f.license)]);
  const freq = accrualPeriodicityOf(f.schedule);
  if (freq) props.push(['dct:accrualPeriodicity', iri(`${FREQUENCY}${freq}`)]);
  if (links.landing) props.push(['dcat:landingPage', iri(links.landing)]);
  for (const r of f.resources) {
    const d: Array<[string, RdfValue]> = [
      ['dct:title', lit(r.title ?? r.name)],
      ['dcat:accessURL', iri(r.csvUrl)],
      ['dcat:downloadURL', iri(r.csvUrl)],
      ['dcat:mediaType', iri(`${MEDIA_TYPE}text/csv`)],
      ['dct:format', iri(`${FILE_TYPE}CSV`)],
    ];
    if (r.bytes !== undefined) d.push(['dcat:byteSize', lit(String(r.bytes), 'xsd:nonNegativeInteger')]);
    if (f.license) d.push(['dct:license', licenseValue(f.license)]);
    props.push(['dcat:distribution', { id: r.csvUrl, types: ['dcat:Distribution'], props: d }]);
  }
  props.push(['dcat:distribution', {
    id: links.odata, types: ['dcat:Distribution'], props: [
      ['dct:title', lit('OData v4 service')],
      ['dct:description', lit('Every resource as an OData v4 entity set, with $filter, $orderby and $top, for Excel, Power BI and other OData clients.')],
      ['dcat:accessURL', iri(links.odata)],
      ['dct:conformsTo', iri(ODATA_V4)],
      ['dcat:mediaType', iri(`${MEDIA_TYPE}application/json`)],
    ],
  }]);
  props.push(['dcat:distribution', {
    id: links.descriptor, types: ['dcat:Distribution'], props: [
      ['dct:title', lit('Frictionless Data Package descriptor')],
      ['dct:description', lit('datapackage.json with a Table Schema per resource; frictionless-py, R and the JS client read the resources from it.')],
      ['dcat:accessURL', iri(links.descriptor)],
      ['dcat:downloadURL', iri(links.descriptor)],
      ['dct:conformsTo', iri(TABULAR_DATA_PACKAGE)],
      ['dcat:mediaType', iri(`${MEDIA_TYPE}application/json`)],
      ['dct:format', iri(`${FILE_TYPE}JSON`)],
    ],
  }]);
  return { id: links.api, types: ['dcat:Dataset'], props };
}

export interface DcatInput {
  config: Pick<AimeatConfig, 'baseUrl' | 'nodeId' | 'seoSiteName' | 'seoSiteDescription' | 'seoOrganizationName' | 'seoOrganizationUrl'>;
  /** The datasets on this page, already the public ones, newest first. */
  facts: DatasetFacts[];
  /** How many public datasets there are across all pages. */
  total: number;
  page: number;
  pageSize: number;
  /** The format the view addresses keep: `ttl` adds `format=ttl` to them. */
  format: 'jsonld' | 'ttl';
}

/** The catalogue of one page: the dcat:Catalog node first, then the page's datasets. */
export function buildDcatGraph(input: DcatInput): RdfNode[] {
  const { config, facts, total, page, pageSize, format } = input;
  const base = config.baseUrl.replace(/\/+$/, '');
  const self = `${base}/v1/catalogue/dcat`;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageUrl = (n: number) => {
    const q = new URLSearchParams({ page: String(n) });
    if (pageSize !== DCAT_PAGE_SIZE) q.set('page_size', String(pageSize));
    if (format === 'ttl') q.set('format', 'ttl');
    return `${self}?${q.toString()}`;
  };
  const datasets = facts.map(f => datasetNode(base, f));
  const title = config.seoSiteName?.trim() || `AIMEAT node ${config.nodeId}`;
  const operator = config.seoOrganizationName?.trim() || title;
  const view: Array<[string, RdfValue]> = [
    ['hydra:first', iri(pageUrl(1))],
    ['hydra:last', iri(pageUrl(pages))],
  ];
  if (page > 1) view.push(['hydra:previous', iri(pageUrl(Math.min(page - 1, pages)))]);
  if (page < pages) view.push(['hydra:next', iri(pageUrl(page + 1))]);
  const newest = facts.reduce<string | null>((m, f) => (!m || f.modified > m ? f.modified : m), null);
  const catalog: RdfNode = {
    id: self,
    types: ['dcat:Catalog', 'hydra:Collection'],
    props: [
      ['dct:title', lit(title)],
      ['dct:description', lit(config.seoSiteDescription?.trim()
        || `The public data packages of the AIMEAT node ${config.nodeId}: tables published by its accounts, each with a Frictionless descriptor, CSV files and an OData feed.`)],
      ['dct:publisher', {
        types: ['foaf:Agent'],
        props: [['foaf:name', lit(operator)], ['foaf:homepage', iri(config.seoOrganizationUrl?.trim() || `${base}/`)]],
      }],
      ['foaf:homepage', iri(`${base}/`)],
      ...(newest ? [['dct:modified', lit(newest, 'xsd:dateTime')] as [string, RdfValue]] : []),
      ['hydra:totalItems', lit(String(total), 'xsd:nonNegativeInteger')],
      ...datasets.map(d => ['dcat:dataset', iri(d.id!)] as [string, RdfValue]),
      ['hydra:view', { id: pageUrl(page), types: ['hydra:PartialCollectionView'], props: view }],
    ],
  };
  return [catalog, ...datasets];
}

/* ── JSON-LD ───────────────────────────────────────────────────────────────────────────────────── */

function jsonValue(v: RdfValue): unknown {
  if (isNode(v)) return jsonNode(v);
  if ('iri' in v) return { '@id': v.iri };
  return v.dt ? { '@value': v.lit, '@type': v.dt } : v.lit;
}

function jsonNode(n: RdfNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (n.id) out['@id'] = n.id;
  out['@type'] = n.types.length === 1 ? n.types[0] : n.types;
  for (const [p, v] of n.props) {
    const value = jsonValue(v);
    if (p in out) {
      const prev = out[p];
      out[p] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else {
      out[p] = value;
    }
  }
  return out;
}

/** The graph as one JSON-LD document: the prefixes as the context, every top-level node in @graph. */
export function dcatToJsonLd(graph: RdfNode[]): Record<string, unknown> {
  return { '@context': { ...DCAT_PREFIXES }, '@graph': graph.map(jsonNode) };
}

/* ── Turtle ────────────────────────────────────────────────────────────────────────────────────── */

/** A string literal in Turtle's double-quoted form. */
export function turtleString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
}

/** An IRI in angle brackets, with the characters Turtle refuses inside them percent-encoded. */
export function turtleIri(s: string): string {
  // eslint-disable-next-line no-control-regex -- Turtle's IRIREF refuses the control characters, so they are encoded
  return '<' + s.replace(/[\u0000- <>"{}|^`\\]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) + '>';
}

function turtleTerm(v: RdfValue, indent: string, named: RdfNode[]): string {
  if (isNode(v)) {
    if (v.id) { named.push(v); return turtleIri(v.id); }
    return '[\n' + turtleBody(v, indent + '    ', named) + `\n${indent}]`;
  }
  if ('iri' in v) return turtleIri(v.iri);
  return v.dt ? `${turtleString(v.lit)}^^${v.dt}` : turtleString(v.lit);
}

function turtleBody(n: RdfNode, indent: string, named: RdfNode[]): string {
  const lines = [`${indent}a ${n.types.join(', ')}`];
  for (const [p, v] of n.props) lines.push(`${indent}${p} ${turtleTerm(v, indent, named)}`);
  return lines.join(' ;\n');
}

/** The graph as Turtle: the prefixes, then one subject block per node with an IRI, nested ones after. */
export function dcatToTurtle(graph: RdfNode[]): string {
  const out = Object.entries(DCAT_PREFIXES).map(([p, ns]) => `@prefix ${p}: <${ns}> .`);
  const queue = [...graph];
  const seen = new Set<string>();
  while (queue.length) {
    const n = queue.shift()!;
    if (n.id && seen.has(n.id)) continue;
    if (n.id) seen.add(n.id);
    const named: RdfNode[] = [];
    out.push('', `${n.id ? turtleIri(n.id) : '[]'}\n${turtleBody(n, '    ', named)} .`);
    queue.push(...named);
  }
  return out.join('\n') + '\n';
}
