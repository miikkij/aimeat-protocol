/**
 * @file src/services/content/classes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's ontology of content classes (wish wish-sis-ll-n-purku-luokittelu-ja-owl,
 *   2026-10-20): the built-in classes (data/content-classes.ts), the classes the owner added or
 *   edited, and the classes and properties a model proposed that wait for the owner's decision.
 *
 *   ONE RECORD. The owner's classes and the proposals live in `contentclass.ontology`, private, in
 *   the owner's GHII namespace: `{ classes, proposals, updatedAt }`. An owner class with a built-in
 *   class's id replaces the built-in one for this owner, which is how an owner edits a built-in
 *   class. Proposals are kept newest first and capped at PROPOSALS_KEPT; when the list is full, the
 *   oldest decided proposal is dropped before any pending one.
 *
 *   EVERY WRITE IS CONDITIONAL. The record is read, changed and written on the version that was read
 *   (writeMemoryRecord with expectedVersion), and read again on a conflict, up to CAS_ATTEMPTS times.
 *   updateOwnRecord() does this for this file, settings.ts and facts-store.ts.
 *
 *   OWL. owlOntology() answers the owner's classes as an OWL ontology in JSON-LD: one owl:Class per
 *   content class, a subclass of its schema.org type, and one owl:DatatypeProperty per property.
 *   entityFor() answers one extracted item as a JSON-LD node typed by its class, with each value
 *   coerced to the property's datatype.
 * @structure ContentClassError · ContentDeps · ContentWriter · updateOwnRecord() · validateClass() ·
 *   validateProperties() · listClasses() · getClass() · setOwnerClass() · removeOwnerClass() ·
 *   addProposal() · decideProposal() · listProposals() · contentContext() · owlOntology() · entityFor()
 * @usage
 *   const classes = await listClasses(storage, ownerGhii);
 *   const doc = owlOntology(classes, { ownerGhii, baseUrl: config.baseUrl });
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { writeMemoryRecord } from '../memory-write.js';
import { CAS_ATTEMPTS, UNCHANGED } from '../record-cas.js';
import { DEFAULT_CONTEXT } from '../../utils/onto-context.js';
import { BUILTIN_CLASSES, builtinClass } from '../../data/content-classes.js';
import type { ClassProperty, ClassProposal, ContentClass, ContentKind } from './types.js';

/** A refusal of a content class operation, with the HTTP status a route answers with. */
export class ContentClassError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = 'ContentClassError';
  }
}

/** What a write needs from the node. */
export interface ContentDeps { storage: Storage; config: AimeatConfig }

/** Who writes, and whose namespace the record lands in. */
export interface ContentWriter { principal: string; ownerGhii: string; scopes: string[]; roles: string[] }

export const ONTOLOGY_KEY = 'contentclass.ontology';
/** How many proposals the ontology record keeps. */
export const PROPOSALS_KEPT = 200;

const CLASS_ID = /^[a-z][a-z0-9-]{1,40}$/;
const PROPERTY_NAME = /^[a-z][a-z0-9_]{0,40}$/;
const PROPERTY_TYPES: readonly ClassProperty['type'][] = ['string', 'number', 'date', 'boolean'];
const KINDS: readonly ContentKind[] = ['pdf', 'image', 'video', 'text', 'other'];
const CURIE = /^[A-Za-z][A-Za-z0-9_.-]*:\S+$/;

/**
 * Read `key` in the writer's owner namespace, change it with `mutate`, and write it on the version
 * that was read; read again on a conflict. `mutate` gets the stored value (undefined when absent) and
 * answers the value to write or UNCHANGED; it may run more than once and may throw to refuse. Answers
 * the value as stored, or the stored value when nothing was written.
 */
export async function updateOwnRecord(
  deps: ContentDeps, writer: ContentWriter, key: string,
  mutate: (cur: unknown) => unknown,
): Promise<unknown> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const rec = await deps.storage.getMemory(writer.ownerGhii, key);
    const next = mutate(rec?.value);
    if (next === UNCHANGED) return rec?.value;
    const r = await writeMemoryRecord({ storage: deps.storage, config: deps.config },
      { principal: writer.principal, targetGaii: writer.ownerGhii, scopes: writer.scopes, roles: writer.roles },
      { key, value: next, visibility: 'private', pipeline: 'content.classes', expectedVersion: rec?.version ?? 0 });
    if (r.ok) return next;
    if (r.code !== 'VERSION_CONFLICT') throw new ContentClassError(r.code, r.status, r.message);
  }
  throw new ContentClassError('VERSION_CONFLICT', 409, `${key} changed under every one of ${CAS_ATTEMPTS} attempts to write it. Try again.`);
}

interface Ontology { classes: ContentClass[]; proposals: ClassProposal[]; updatedAt: string }

function parseOntology(v: unknown): Ontology {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Ontology>;
  return {
    classes: Array.isArray(o.classes) ? o.classes.filter((c) => c && typeof c === 'object' && typeof c.id === 'string') : [],
    proposals: Array.isArray(o.proposals) ? o.proposals.filter((p) => p && typeof p === 'object' && typeof p.id === 'string') : [],
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
  };
}

async function readOntology(storage: Storage, ownerGhii: string): Promise<Ontology> {
  return parseOntology((await storage.getMemory(ownerGhii, ONTOLOGY_KEY))?.value);
}

const invalid = (message: string): ContentClassError => new ContentClassError('INVALID_INPUT', 400, message);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Validated properties, or a refusal naming the first bad one. */
export function validateProperties(input: unknown, where = 'properties'): ClassProperty[] {
  if (!Array.isArray(input)) throw invalid(`${where} must be an array.`);
  if (input.length > 40) throw invalid(`${where} has ${input.length} entries; a class has at most 40 properties.`);
  const seen = new Set<string>();
  return input.map((raw, i) => {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = str(p.name);
    if (!PROPERTY_NAME.test(name)) throw invalid(`${where}[${i}].name "${name}" must be lower case letters, digits and underscores, starting with a letter, at most 41 characters.`);
    if (seen.has(name)) throw invalid(`${where} names "${name}" twice.`);
    seen.add(name);
    if (!PROPERTY_TYPES.includes(p.type as ClassProperty['type'])) throw invalid(`${where}[${i}].type must be one of ${PROPERTY_TYPES.join(', ')}.`);
    const describe = str(p.describe);
    if (describe.length > 300) throw invalid(`${where}[${i}].describe is ${describe.length} characters; the limit is 300.`);
    const sameAs = str(p.sameAs);
    if (sameAs && !CURIE.test(sameAs)) throw invalid(`${where}[${i}].sameAs "${sameAs}" must be a prefixed name such as schema:totalPaymentDue.`);
    return { name, type: p.type as ClassProperty['type'], required: p.required === true, describe, ...(sameAs ? { sameAs } : {}) };
  });
}

/** A validated class with the given origin, or a refusal naming the first bad field. */
export function validateClass(input: unknown, origin: ContentClass['origin']): ContentClass {
  const c = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const id = str(c.id);
  if (!CLASS_ID.test(id)) throw invalid(`id "${id}" must be 2 to 41 lower case letters, digits and hyphens, starting with a letter.`);
  const label = (c.label && typeof c.label === 'object' ? c.label : {}) as Record<string, unknown>;
  const fi = str(label.fi); const en = str(label.en); const es = str(label.es);
  if (!fi || !en) throw invalid('label.fi and label.en are both required.');
  const describe = str(c.describe);
  if (describe.length > 400) throw invalid(`describe is ${describe.length} characters; the limit is 400.`);
  const type = str(c.type) || 'schema:Thing';
  if (!CURIE.test(type)) throw invalid(`type "${type}" must be a prefixed name such as schema:Invoice.`);
  let kinds: ContentKind[] | undefined;
  if (c.kinds !== undefined && c.kinds !== null) {
    if (!Array.isArray(c.kinds) || c.kinds.some((k) => !KINDS.includes(k as ContentKind))) throw invalid(`kinds must be a list of ${KINDS.join(', ')}.`);
    kinds = [...new Set(c.kinds as ContentKind[])];
  }
  return {
    id, label: { fi, en, ...(es ? { es } : {}) }, describe, process: c.process !== false, type,
    ...(kinds?.length ? { kinds } : {}),
    properties: validateProperties(c.properties ?? []), origin,
    ...(typeof c.at === 'string' ? { at: c.at } : {}), ...(typeof c.by === 'string' ? { by: c.by } : {}),
  };
}

/** Every class this owner has: the built-in ones (an owner class of the same id in its place), then the owner's own. */
export async function listClasses(storage: Storage, ownerGhii: string): Promise<ContentClass[]> {
  const own = (await readOntology(storage, ownerGhii)).classes;
  const byId = new Map(own.map((c) => [c.id, c]));
  const out = BUILTIN_CLASSES.map((b) => byId.get(b.id) ?? b);
  for (const c of own) if (!builtinClass(c.id)) out.push(c);
  return out;
}

export async function getClass(storage: Storage, ownerGhii: string, id: string): Promise<ContentClass | null> {
  return (await listClasses(storage, ownerGhii)).find((c) => c.id === id) ?? null;
}

/** Keep at most PROPOSALS_KEPT, newest first; the oldest decided ones go before any pending one. */
function capProposals(list: ClassProposal[]): ClassProposal[] {
  const out = [...list];
  while (out.length > PROPOSALS_KEPT) {
    let drop = -1;
    for (let i = out.length - 1; i >= 0; i--) if (out[i].status !== 'pending') { drop = i; break; }
    out.splice(drop === -1 ? out.length - 1 : drop, 1);
  }
  return out;
}

async function updateOntology(deps: ContentDeps, writer: ContentWriter, change: (o: Ontology) => Ontology | typeof UNCHANGED): Promise<Ontology> {
  const stored = await updateOwnRecord(deps, writer, ONTOLOGY_KEY, (cur) => {
    const next = change(parseOntology(cur));
    return next === UNCHANGED ? UNCHANGED : { ...next, proposals: capProposals(next.proposals), updatedAt: new Date().toISOString() };
  });
  return parseOntology(stored);
}

/** Add or replace one of the owner's classes. A built-in id makes it the owner's edit of that class. */
export async function setOwnerClass(deps: ContentDeps, writer: ContentWriter, cls: unknown): Promise<ContentClass> {
  const valid = { ...validateClass(cls, 'owner'), at: new Date().toISOString(), by: writer.principal };
  await updateOntology(deps, writer, (o) => ({ ...o, classes: [...o.classes.filter((c) => c.id !== valid.id), valid] }));
  return valid;
}

/** Remove one of the owner's classes. Removing an edited built-in class brings the built-in one back. */
export async function removeOwnerClass(deps: ContentDeps, writer: ContentWriter, id: string): Promise<void> {
  await updateOntology(deps, writer, (o) => {
    if (!o.classes.some((c) => c.id === id)) {
      throw new ContentClassError('NOT_FOUND', 404, builtinClass(id)
        ? `"${id}" is a built-in class the owner has not edited, so there is nothing of the owner's to remove.`
        : `The owner has no content class "${id}".`);
    }
    return { ...o, classes: o.classes.filter((c) => c.id !== id) };
  });
}

const sameNames = (a: ClassProperty[] = [], b: ClassProperty[] = []): boolean => {
  const x = a.map((p) => p.name).sort().join(','); const y = b.map((p) => p.name).sort().join(',');
  return x === y;
};

/**
 * File a proposal. A pending proposal of the same class id (kind 'class'), or of the same class and
 * the same property names (kind 'properties'), is answered instead of a second one.
 */
export async function addProposal(
  deps: ContentDeps, writer: ContentWriter,
  input: Omit<ClassProposal, 'id' | 'status' | 'at' | 'decidedAt' | 'decidedBy'>,
): Promise<ClassProposal> {
  const sourceId = str(input?.sourceId);
  const why = str(input?.why).slice(0, 1000);
  if (!sourceId) throw invalid('sourceId is required.');
  let proposal: ClassProposal;
  if (input.kind === 'class') {
    const cls = validateClass(input.class, 'proposed');
    proposal = { id: '', kind: 'class', classId: cls.id, class: cls, sourceId, why, status: 'pending', at: '' };
  } else if (input.kind === 'properties') {
    const classId = str(input.classId);
    if (!CLASS_ID.test(classId)) throw invalid('classId names the class the properties would join.');
    const properties = validateProperties(input.properties);
    if (!properties.length) throw invalid('properties must name at least one property.');
    proposal = { id: '', kind: 'properties', classId, properties, sourceId, why, status: 'pending', at: '' };
  } else {
    throw invalid('kind must be "class" or "properties".');
  }
  // Set inside the change, which may run more than once; declared wide so the read after it is not narrowed to null.
  let answer = null as ClassProposal | null;
  await updateOntology(deps, writer, (o) => {
    const dup = o.proposals.find((p) => p.status === 'pending' && p.kind === proposal.kind && p.classId === proposal.classId
      && (proposal.kind === 'class' || sameNames(p.properties, proposal.properties)));
    if (dup) { answer = dup; return UNCHANGED; }
    answer = { ...proposal, id: `prop-${randomBytes(8).readBigUInt64BE().toString(36).padStart(10, '0').slice(-10)}`, at: new Date().toISOString() };
    return { ...o, proposals: [answer, ...o.proposals] };
  });
  return answer!;
}

/** Approve or reject a pending proposal. An approval adds the class, or adds the properties to their class. */
export async function decideProposal(
  deps: ContentDeps, writer: ContentWriter, id: string, decision: 'approve' | 'reject', decidedBy: string,
): Promise<ClassProposal> {
  if (decision !== 'approve' && decision !== 'reject') throw invalid('decision must be "approve" or "reject".');
  let answer = null as ClassProposal | null;
  await updateOntology(deps, writer, (o) => {
    const p =o.proposals.find((x) => x.id === id);
    if (!p) throw new ContentClassError('NOT_FOUND', 404, `No proposal "${id}".`);
    if (p.status !== 'pending') throw invalid(`Proposal "${id}" was already ${p.status}.`);
    const now = new Date().toISOString();
    const decided: ClassProposal = { ...p, status: decision === 'approve' ? 'approved' : 'rejected', decidedAt: now, decidedBy };
    let classes = o.classes;
    if (decision === 'approve' && p.kind === 'class') {
      const cls = validateClass(p.class, 'owner');
      if (builtinClass(cls.id) || classes.some((c) => c.id === cls.id)) {
        throw invalid(`A class "${cls.id}" exists already. Reject this proposal, or propose properties for that class instead.`);
      }
      classes = [...classes, { ...cls, at: now, by: decidedBy }];
    } else if (decision === 'approve') {
      const classId = p.classId ?? '';
      const base = classes.find((c) => c.id === classId) ?? builtinClass(classId);
      if (!base) throw new ContentClassError('NOT_FOUND', 404, `The class "${classId}" these properties would join does not exist any more.`);
      const have = new Set(base.properties.map((x) => x.name));
      const merged = validateClass({ ...base, properties: [...base.properties, ...(p.properties ?? []).filter((x) => !have.has(x.name))] }, 'owner');
      classes = [...classes.filter((c) => c.id !== classId), { ...merged, at: now, by: decidedBy }];
    }
    answer = decided;
    return { ...o, classes, proposals: o.proposals.map((x) => (x.id === id ? decided : x)) };
  });
  return answer!;
}

/** The owner's proposals, newest first, optionally of one status. */
export async function listProposals(storage: Storage, ownerGhii: string, status?: ClassProposal['status']): Promise<ClassProposal[]> {
  const all = (await readOntology(storage, ownerGhii)).proposals;
  return status ? all.filter((p) => p.status === status) : all;
}

/** The JSON-LD context of the ontology and of an entity: the node's defaults plus owl, xsd and cc. */
export function contentContext(baseUrl: string): Record<string, string> {
  return {
    ...DEFAULT_CONTEXT,
    owl: 'http://www.w3.org/2002/07/owl#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    cc: `${baseUrl.replace(/\/+$/, '')}/ns/content-class/`,
  };
}

const XSD_RANGE: Record<ClassProperty['type'], string> = { string: 'xsd:string', number: 'xsd:decimal', date: 'xsd:date', boolean: 'xsd:boolean' };

function labels(label: ContentClass['label']): Array<{ '@value': string; '@language': string }> {
  return Object.entries(label).filter(([, v]) => typeof v === 'string' && v).map(([lang, v]) => ({ '@value': v as string, '@language': lang }));
}

/** The owner's classes as an OWL ontology in JSON-LD. */
export function owlOntology(classes: readonly ContentClass[], opts: { ownerGhii: string; baseUrl: string }): object {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const graph: object[] = [];
  for (const c of classes) {
    graph.push({ '@id': `cc:${c.id}`, '@type': 'owl:Class', 'rdfs:label': labels(c.label), 'rdfs:comment': c.describe, 'rdfs:subClassOf': { '@id': c.type } });
    for (const p of c.properties) {
      graph.push({
        '@id': `cc:${c.id}.${p.name}`, '@type': 'owl:DatatypeProperty', 'rdfs:label': p.name,
        'rdfs:domain': { '@id': `cc:${c.id}` }, 'rdfs:range': { '@id': XSD_RANGE[p.type] }, 'rdfs:comment': p.describe,
        ...(p.sameAs ? { 'owl:equivalentProperty': { '@id': p.sameAs } } : {}),
        'cc:required': p.required,
      });
    }
  }
  return {
    '@context': contentContext(base),
    '@id': `${base}/v1/content/ontology#${encodeURIComponent(opts.ownerGhii)}`,
    '@type': 'owl:Ontology',
    'rdfs:label': 'Content classes',
    '@graph': graph,
  };
}

/** sha256 hex, first 24 characters: the stable short form of a source id. */
function shortHash(s: string): string { return createHash('sha256').update(s).digest('hex').slice(0, 24); }

/** A value coerced to a property's datatype, or undefined when it cannot be one. */
function coerce(type: ClassProperty['type'], v: unknown): string | number | boolean | undefined {
  if (v === null || v === undefined) return undefined;
  if (type === 'number') {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
    return undefined;
  }
  if (type === 'boolean') {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string' && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === 'true';
    return undefined;
  }
  if (type === 'date') {
    if (typeof v !== 'string' && !(v instanceof Date)) return undefined;
    const s = typeof v === 'string' ? v.trim() : '';
    const head = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (head) {
      const d = new Date(`${head[0]}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === head[0] ? head[0] : undefined;
    }
    const t = v instanceof Date ? v.getTime() : Date.parse(s);
    return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
  }
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join('; ') || undefined;
  return undefined;
}

/**
 * One extracted item as a JSON-LD node typed by its class: each known property coerced to its
 * datatype, a value that cannot be one dropped, unknown keys and keys starting with `_` dropped.
 */
export function entityFor(cls: ContentClass, fields: Record<string, unknown>, opts: { sourceId: string; baseUrl: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {
    '@context': contentContext(opts.baseUrl),
    '@type': [`cc:${cls.id}`, cls.type],
    '@id': `urn:aimeat:content:${shortHash(opts.sourceId)}#${cls.id}`,
  };
  const props = new Map(cls.properties.map((p) => [p.name, p]));
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (k.startsWith('_')) continue;
    const p = props.get(k);
    if (!p) continue;
    const value = coerce(p.type, v);
    if (value !== undefined) out[`cc:${cls.id}.${k}`] = value;
  }
  out['cc:source'] = opts.sourceId;
  return out;
}
