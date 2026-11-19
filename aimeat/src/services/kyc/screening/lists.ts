/**
 * @file src/services/kyc/screening/lists.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Parsers for the two official, free targeted-financial-sanctions lists that customer
 *   due diligence under Regulation (EU) 2024/1624 (AMLR) screens against, into one normalised entry
 *   shape:
 *   - the EU Financial Sanctions Files (FSF) consolidated XML (root <export>, one <sanctionEntity>
 *     per subject; the default namespace http://eu.europa.ec/fpi/fsd/export may be present, so
 *     elements are matched by localName);
 *   - the UN Security Council consolidated list XML (<CONSOLIDATED_LIST> with <INDIVIDUALS> and
 *     <ENTITIES>).
 *
 *   NO I/O. The caller fetches the bytes and stores the result; this file only parses. `listOf`
 *   stamps a list with a version: the first 16 hex characters of the SHA-256 of the input bytes, so
 *   the same download gives the same version and the matcher can cache its prepared form by it.
 *
 *   INPUT LIMITS. Input over MAX_LIST_BYTES is refused, and so is any XML with a DOCTYPE or an
 *   ENTITY declaration: neither list uses one, and refusing them removes entity expansion
 *   (billion-laughs) and external entity resolution from the parser's reach.
 * @structure SanctionsSource · SanctionsEntry · SanctionsList · MAX_LIST_BYTES · parseEuFsf ·
 *   parseUnConsolidated · listOf · listVersion
 * @usage const list = listOf('eu-fsf', xmlBytes, new Date().toISOString());
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
import { createHash } from 'node:crypto';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';

/** The list a sanctions entry comes from. */
export type SanctionsSource = 'eu-fsf' | 'un';

/** One listed subject, normalised across both sources. */
export interface SanctionsEntry {
  source: SanctionsSource;
  /** EU: the sanctionEntity logicalId. UN: REFERENCE_NUMBER, or DATAID when the reference is empty. */
  id: string;
  kind: 'person' | 'entity';
  /** Whole name first, then the aliases, each as written in the source. No duplicates. */
  names: string[];
  /** YYYY or YYYY-MM-DD, as given. */
  birthDates: string[];
  /** ISO 3166-1 alpha-2 when the source gives it, else the source's text. */
  countries: string[];
  /** EU: the regulation programme codes (comma-separated when several). UN: UN_LIST_TYPE. */
  programme: string;
  /** EU: the earliest regulation publicationDate. UN: LISTED_ON. */
  listedOn?: string;
}

/** A parsed list, versioned by the bytes it was parsed from. */
export interface SanctionsList {
  source: SanctionsSource;
  /** First 16 hex characters of the SHA-256 of the input bytes. */
  version: string;
  fetchedAt?: string;
  entries: SanctionsEntry[];
}

/** The largest input accepted, in bytes. The EU file is about 25 MB and the UN file about 2 MB. */
export const MAX_LIST_BYTES = 200 * 1024 * 1024;

/** Refuses oversized input and any DTD construct; throws an Error naming the reason. */
function guardInput(xml: string): void {
  if (Buffer.byteLength(xml, 'utf8') > MAX_LIST_BYTES) {
    throw new Error(`sanctions list refused: input is larger than ${MAX_LIST_BYTES} bytes`);
  }
  if (/<!DOCTYPE/i.test(xml)) {
    throw new Error('sanctions list refused: XML with a DOCTYPE is not accepted (entity expansion)');
  }
  if (/<!ENTITY/i.test(xml)) {
    throw new Error('sanctions list refused: XML with an ENTITY declaration is not accepted (entity expansion)');
  }
}

/** Parses XML into its document element; a fatal or recoverable parse error throws. */
function parseRoot(xml: string, rootName: string): XmlElement {
  guardInput(xml);
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level !== 'warning') throw new Error(`sanctions list XML ${level}: ${msg}`);
    },
  }).parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || root.localName !== rootName) {
    throw new Error(`sanctions list refused: root element is ${root?.localName ?? 'missing'}, expected ${rootName}`);
  }
  return root;
}

/** Element children of `el`, optionally only those with the given localName. */
function children(el: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (name === undefined || (n as XmlElement).localName === name)) out.push(n as XmlElement);
  }
  return out;
}

/** The first element child with the given localName. */
function child(el: XmlElement, name: string): XmlElement | undefined {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as XmlElement).localName === name) return n as XmlElement;
  }
  return undefined;
}

/** Trimmed text content of the named child, or '' when absent. */
function childText(el: XmlElement, name: string): string {
  return (child(el, name)?.textContent ?? '').trim();
}

/** Trimmed attribute value, or '' when absent. */
function attr(el: XmlElement, name: string): string {
  return (el.getAttribute(name) ?? '').trim();
}

/** Appends `v` to `arr` when it is non-empty and not already present. */
function pushUnique(arr: string[], v: string): void {
  const s = v.replace(/\s+/g, ' ').trim();
  if (s && !arr.includes(s)) arr.push(s);
}

/** A country as ISO2 when the code is a real one (the EU file writes "00" for unknown), else the text. */
function euCountry(el: XmlElement): string {
  const iso = attr(el, 'countryIso2Code').toUpperCase();
  if (/^[A-Z]{2}$/.test(iso)) return iso;
  const desc = attr(el, 'countryDescription');
  return desc.toUpperCase() === 'UNKNOWN' ? '' : desc;
}

/**
 * Parses the EU Financial Sanctions Files consolidated XML.
 * @param xml The file's text.
 * @returns One entry per <sanctionEntity>.
 * @throws Error on oversized input, a DOCTYPE or ENTITY declaration, malformed XML or a wrong root.
 */
export function parseEuFsf(xml: string): SanctionsEntry[] {
  const root = parseRoot(xml, 'export');
  const out: SanctionsEntry[] = [];
  for (const se of children(root, 'sanctionEntity')) {
    const id = attr(se, 'logicalId') || attr(se, 'euReferenceNumber');
    if (!id) continue;
    const code = attr(child(se, 'subjectType') ?? se, 'code').toLowerCase();
    const kind: SanctionsEntry['kind'] = code === 'person' ? 'person' : 'entity';
    const names: string[] = [];
    for (const na of children(se, 'nameAlias')) {
      const whole = attr(na, 'wholeName')
        || [attr(na, 'firstName'), attr(na, 'middleName'), attr(na, 'lastName')].filter(Boolean).join(' ');
      pushUnique(names, whole);
    }
    if (names.length === 0) continue;
    const birthDates: string[] = [];
    for (const bd of children(se, 'birthdate')) {
      const full = attr(bd, 'birthdate');
      if (/^\d{4}-\d{2}-\d{2}$/.test(full)) pushUnique(birthDates, full);
      else if (/^\d{4}$/.test(attr(bd, 'year'))) pushUnique(birthDates, attr(bd, 'year'));
    }
    const countries: string[] = [];
    for (const c of children(se, 'citizenship')) pushUnique(countries, euCountry(c));
    if (kind === 'entity') for (const a of children(se, 'address')) pushUnique(countries, euCountry(a));
    const programmes: string[] = [];
    let listedOn: string | undefined;
    for (const r of children(se, 'regulation')) {
      pushUnique(programmes, attr(r, 'programme'));
      const pub = attr(r, 'publicationDate');
      if (pub && (listedOn === undefined || pub < listedOn)) listedOn = pub;
    }
    const entry: SanctionsEntry = {
      source: 'eu-fsf', id, kind, names, birthDates, countries, programme: programmes.join(', '),
    };
    if (listedOn) entry.listedOn = listedOn;
    out.push(entry);
  }
  return out;
}

/** UN birth dates: DATE, YEAR, or a FROM_YEAR..TO_YEAR range expanded when it spans at most ten years. */
function unBirthDates(el: XmlElement): string[] {
  const out: string[] = [];
  for (const dob of children(el, 'INDIVIDUAL_DATE_OF_BIRTH')) {
    const date = childText(dob, 'DATE');
    const m = /^(\d{4})(-\d{2}-\d{2})?/.exec(date);
    if (m) { pushUnique(out, m[2] ? m[0] : m[1]); continue; }
    const year = childText(dob, 'YEAR');
    if (/^\d{4}$/.test(year)) { pushUnique(out, year); continue; }
    const from = Number(childText(dob, 'FROM_YEAR'));
    const to = Number(childText(dob, 'TO_YEAR'));
    if (Number.isInteger(from) && Number.isInteger(to) && from > 999 && to >= from && to - from <= 10) {
      for (let y = from; y <= to; y++) pushUnique(out, String(y));
    }
  }
  return out;
}

/** One UN <INDIVIDUAL> or <ENTITY> element as an entry, or null when it carries no name. */
function unEntry(el: XmlElement, kind: SanctionsEntry['kind']): SanctionsEntry | null {
  const id = childText(el, 'REFERENCE_NUMBER') || childText(el, 'DATAID');
  if (!id) return null;
  const names: string[] = [];
  const whole = kind === 'person'
    ? ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME'].map((n) => childText(el, n)).filter(Boolean).join(' ')
    : childText(el, 'FIRST_NAME');
  pushUnique(names, whole);
  const aliasTag = kind === 'person' ? 'INDIVIDUAL_ALIAS' : 'ENTITY_ALIAS';
  for (const a of children(el, aliasTag)) pushUnique(names, childText(a, 'ALIAS_NAME'));
  if (names.length === 0) return null;
  const countries: string[] = [];
  for (const nat of children(el, 'NATIONALITY')) {
    for (const v of children(nat, 'VALUE')) pushUnique(countries, (v.textContent ?? '').trim());
  }
  const entry: SanctionsEntry = {
    source: 'un', id, kind, names,
    birthDates: kind === 'person' ? unBirthDates(el) : [],
    countries, programme: childText(el, 'UN_LIST_TYPE'),
  };
  const listedOn = childText(el, 'LISTED_ON');
  if (listedOn) entry.listedOn = listedOn.slice(0, 10);
  return entry;
}

/**
 * Parses the UN Security Council consolidated list XML.
 * @param xml The file's text.
 * @returns One entry per <INDIVIDUAL> and per <ENTITY>, individuals first.
 * @throws Error on oversized input, a DOCTYPE or ENTITY declaration, malformed XML or a wrong root.
 */
export function parseUnConsolidated(xml: string): SanctionsEntry[] {
  const root = parseRoot(xml, 'CONSOLIDATED_LIST');
  const out: SanctionsEntry[] = [];
  for (const group of children(root, 'INDIVIDUALS')) {
    for (const ind of children(group, 'INDIVIDUAL')) {
      const e = unEntry(ind, 'person');
      if (e) out.push(e);
    }
  }
  for (const group of children(root, 'ENTITIES')) {
    for (const ent of children(group, 'ENTITY')) {
      const e = unEntry(ent, 'entity');
      if (e) out.push(e);
    }
  }
  return out;
}

/**
 * The version of a list's input: the first 16 hex characters of the SHA-256 of its bytes.
 * @param input The file as bytes or as text (text is hashed as UTF-8).
 */
export function listVersion(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Parses a downloaded list with the parser for its source and stamps it with a version.
 * @param source Which list the bytes are.
 * @param xml The file as bytes (decoded as UTF-8) or as text.
 * @param fetchedAt When the caller fetched it (ISO 8601), carried through as given.
 * @throws Error when the input is refused or does not parse.
 */
export function listOf(source: SanctionsSource, xml: string | Uint8Array, fetchedAt?: string): SanctionsList {
  if (typeof xml !== 'string' && xml.byteLength > MAX_LIST_BYTES) {
    throw new Error(`sanctions list refused: input is larger than ${MAX_LIST_BYTES} bytes`);
  }
  const text = typeof xml === 'string' ? xml : new TextDecoder('utf-8').decode(xml);
  const entries = source === 'eu-fsf' ? parseEuFsf(text) : parseUnConsolidated(text);
  const list: SanctionsList = { source, version: listVersion(xml), entries };
  if (fetchedAt) list.fetchedAt = fetchedAt;
  return list;
}
