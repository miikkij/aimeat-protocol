/**
 * @file src/services/classification/pseudonymise.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The protect mode of a regulated data domain (data/compliance-domains.ts RegulatedAiMode,
 *   plan doc-mwnnp9xz9814, feature audit item 1.3): before content goes to an AI model outside this
 *   server, identifying details in it are replaced with stable stand-ins.
 *
 *   WHAT IS REPLACED, BY RULE, in every text of the content: e-mail addresses, Finnish personal
 *   identity codes, phone numbers (international with +, and Finnish numbers that start with 0),
 *   IBAN account numbers and street addresses (a Finnish or Swedish street name with a number, or a
 *   number with an English street word). In a record, the whole value of a field whose NAME says it
 *   holds a person's name (name, firstName, lastName, nimi, etunimi, sukunimi and the like).
 *
 *   WHAT IS NOT. A name inside free text: rules do not find names reliably, and a guess that misses
 *   one would read as protection. The structural fields of a record (its key, id, owner, scope, times,
 *   type) are left as they are, so the reader still knows what the record is.
 *
 *   STABLE WITHIN ONE CONTAINER. The same value in the same container gets the same stand-in, so a
 *   model can still tell that two records are about the same person: `[email-3f9a2c1b]`. The stand-in
 *   is an HMAC-SHA256 of the container and the value under a key this server keeps
 *   (`compliance.pseudonym-key` of system@<node>, made on first use) and never sends out, so it cannot
 *   be turned back into the value without that key.
 *
 *   COST. One record read per process for the key, kept; the rules are linear regular expressions.
 * @structure PseudonymKind · Protected · pseudonymKey() · protectValue()
 * @usage
 *   const key = await pseudonymKey(storage, nodeId);
 *   const { value, counts } = protectValue(record.value, key, 'workspace\u0000organism:o1\u0000ws-1');
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (plan doc-mwnnp9xz9814, feature audit item 1.3). In the classification
 *     family, because the content reader (reader.ts through regulated-gate.ts) calls it.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import { readSystem, updateSystem, UNCHANGED } from './system-record.js';

export type PseudonymKind = 'email' | 'person-id' | 'phone' | 'iban' | 'address' | 'name';

/** The content with its details replaced, and how many of each kind were replaced. */
export interface Protected<T> {
  value: T;
  counts: Partial<Record<PseudonymKind, number>>;
}

const KEY = 'compliance.pseudonym-key';

/** The rules, in the order they run: an address before a phone, so a street number is not read as one. */
const RULES: ReadonlyArray<{ kind: PseudonymKind; re: RegExp }> = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g },
  // A Finnish personal identity code: six digits of the birth date, the century sign, three digits, a check character.
  { kind: 'person-id', re: /\b\d{6}[-+A-FU-Y]\d{3}[0-9A-FHJ-NPR-Y]\b/g },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g },
  { kind: 'address', re: /\b[A-ZÅÄÖ][a-zåäö]{1,40}(?:tie|katu|kuja|polku|väylä|kaari|rinne|ranta|tori|gatan|vägen|gränd)\s\d{1,4}(?:\s?[A-Z](?:\s?\d{1,3})?)?\b/g },
  { kind: 'address', re: /\b\d{1,5}\s[A-Z][a-z]{1,30}\s(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b/g },
  { kind: 'phone', re: /\+\d{1,3}(?:[ -]?\d{1,4}){2,5}\b/g },
  { kind: 'phone', re: /\b0\d{1,3}[ -]?\d{3,4}[ -]?\d{2,4}\b/g },
];

/** Field names whose whole value is a person's name. Compared without case, dashes or underscores. */
const NAME_FIELDS = new Set([
  'name', 'fullname', 'firstname', 'lastname', 'surname', 'givenname', 'familyname', 'displayname',
  'patientname', 'personname', 'customername', 'employeename', 'contactname',
  'nimi', 'etunimi', 'sukunimi', 'kokonimi', 'potilas', 'asiakas', 'tyontekija',
]);

/** Field names that say what a record is, not what it holds: left as they are. */
const STRUCTURAL_FIELDS = new Set([
  'key', 'id', 'ownergaii', 'owner', 'scope', 'kind', 'type', 'contenttype', 'mimetype', 'createdat',
  'updatedat', 'version', '_version', 'organismid', 'organism_id', 'ws', 'tags', 'visibility', 'label',
  'classificationwarning', 'labeldetail', 'createdby', 'updatedby', 'by', 'principal', 'gaii', 'ghii',
  'aiprovenanceid', 'workspaceref', 'groupid',
]);

const fold = (k: string) => k.toLowerCase().replace(/[-_\s]/g, '');

/** A value that is a stand-in already: content protected once is not protected again. */
const STAND_IN = /^\[(?:email|person-id|phone|iban|address|name)-[0-9a-f]{8}\]$/;

// process-local: the server's pseudonym key, read once from its record; every process reads the same record.
let cached: { nodeId: string; key: Buffer } | null = null;

/** The server's pseudonym key, made on first use. It never leaves this server. */
export async function pseudonymKey(storage: Storage, nodeId: string): Promise<Buffer> {
  if (cached?.nodeId === nodeId) return cached.key;
  const parse = (v: unknown) => (typeof v === 'object' && v && typeof (v as { key?: unknown }).key === 'string' ? (v as { key: string }) : null);
  const stored = parse((await readSystem(storage, nodeId, KEY))?.value);
  const hex = stored?.key ?? (await updateSystem(storage, nodeId, KEY, parse,
    cur => (cur ? UNCHANGED : { key: randomBytes(32).toString('hex') }), null, 'compliance'))!.key;
  cached = { nodeId, key: Buffer.from(hex, 'hex') };
  return cached.key;
}

/** The stand-in of one value in one container. */
function standIn(kind: PseudonymKind, value: string, key: Buffer, container: string): string {
  const h = createHmac('sha256', key).update(`${container}\u0000${kind}\u0000${value.trim().toLowerCase()}`).digest('hex');
  return `[${kind}-${h.slice(0, 8)}]`;
}

function protectText(text: string, key: Buffer, container: string, counts: Protected<unknown>['counts']): string {
  let out = text;
  for (const { kind, re } of RULES) {
    out = out.replace(re, m => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      return standIn(kind, m, key, container);
    });
  }
  return out;
}

/**
 * The value with its details replaced (see the file header), and the counts. A string, an array and a
 * plain object are walked to any depth; anything else is returned as it is.
 */
export function protectValue<T>(value: T, key: Buffer, container: string): Protected<T> {
  const counts: Protected<T>['counts'] = {};
  const walk = (v: unknown, field: string | null): unknown => {
    if (typeof v === 'string') {
      if (field && NAME_FIELDS.has(fold(field)) && v.trim() && !STAND_IN.test(v.trim())) {
        counts.name = (counts.name ?? 0) + 1;
        return standIn('name', v, key, container);
      }
      return protectText(v, key, container, counts);
    }
    if (Array.isArray(v)) return v.map(x => walk(x, field));
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = STRUCTURAL_FIELDS.has(fold(k)) ? x : walk(x, k);
      return o;
    }
    return v;
  };
  return { value: walk(value, null) as T, counts };
}

/** Test seam: forget the cached key. */
export function resetPseudonymKey(): void {
  cached = null;
}
