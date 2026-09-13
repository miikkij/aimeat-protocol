/**
 * @file src/services/exchange-odps-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ODPS length rule at the WRITE. Decided by the developer on 2026-09-13: a write that would
 *   make an EXCHANGE listing's generated ODPS v4.1 document break a schema maxLength is refused before
 *   anything is stored, with 422 ODPS_FIELD_TOO_LONG naming the field the owner wrote, the ODPS field it
 *   fills, that field's length, the cap and the room left. The text is never truncated: a shortened
 *   licence term states something the provider did not write.
 *
 *   Refused ONLY when the text changed. Each entry of the source (a tool by name, an offer by id, an
 *   extension action by id) is compared with the same entry in the stored record, by the ODPS text it
 *   generates: text the stored record already produced keeps publishing with the listing's
 *   ODPS_FIELD_TOO_LONG warning (services/exchange-projection.ts), so republishing an unchanged source
 *   does not start failing. A new record, a new entry, or text that differs by one character is checked.
 *   Comparing the generated text rather than one authoring field is what makes a usage flag count: turning
 *   `derivatives` off adds a node sentence to the same 255-character field, and that can push an unchanged
 *   note past the cap.
 *
 *   ONE decision for every door: the memory write (services/memory-write.ts: POST /v1/memory, the MCP
 *   memory tool, aimeat_app_tools_publish, aimeat_offer_price_set), PUT /v1/memory/:key and PATCH
 *   /v1/memory/:key, PUT /v1/agents/:name/offers, and the extension install and redeploy paths. Each calls
 *   odpsWriteRefusal() with the key, the value it is about to store and the value stored now.
 * @structure ODPS_FIELD_TOO_LONG · OdpsTooLongField · OdpsWriteRefusal · extensionOdpsKey · odpsWriteRefusal
 * @usage
 *   const odps = odpsWriteRefusal(key, value, existing?.value);
 *   if (odps) return res.status(odps.status).json(error(nodeId, odps.code, odps.message, odps.status, odps.details));
 *   const extOdps = odpsWriteRefusal(extensionOdpsKey(record.name), record, existing);
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial: the refusal the developer chose over the listing-only warning.
 */
import type { Offering, UsageTerms } from './exchange-market.js';
import type { OdpsExtras } from '../models/odps-schemas.js';
import { AppToolsDocSchema } from '../models/app-tool-schemas.js';
import { OffersDocSchema } from '../models/offer-schemas.js';
import { ODPS_VERSION, offeringToOdps, odpsCappedTexts, charLength, mergeOdpsExtras, type OdpsTextLimit } from './exchange-odps.js';
import { usageTermsOf } from './exchange-source-terms.js';

export const ODPS_FIELD_TOO_LONG = 'ODPS_FIELD_TOO_LONG' as const;

/** One field the owner wrote that makes an ODPS field too long. */
export interface OdpsTooLongField {
  /** The listing it belongs to: `shop.html/find`, `trader:sold`, `kaiku/search`. */
  entry: string;
  /** Where the owner wrote it, as a path into the value written: `tools[find].usageTerms.note`, `odps.dataHolder.description`. */
  source_field: string;
  /** The field of the generated ODPS document, language key filled in. */
  odps_field: string;
  /** That ODPS field's length in characters (Unicode code points, as JSON Schema counts). */
  length: number;
  max_length: number;
  /** The most characters source_field can hold while everything else in the ODPS field stays as it is. */
  room: number;
}

export interface OdpsWriteRefusal {
  ok: false;
  status: 422;
  code: typeof ODPS_FIELD_TOO_LONG;
  message: string;
  details: { key: string; fields: OdpsTooLongField[] };
}

/** The key an extension record is checked under: its action ids are the entries, `commercial` holds the terms. */
export const extensionOdpsKey = (name: string): string => `ext:${name}`;

/** One listing a source declares, in the terms its ODPS document is generated from. */
interface SourceEntry {
  /** How the same entry is found in the stored record. */
  id: string;
  label: string;
  flagged: boolean;
  usageTerms: UsageTerms;
  odps: OdpsExtras | null;
  /** Where an authoring field (`usageTerms.note`, `odps.license.restrictions`) sits in the written value. */
  where: (field: string) => string;
}

const record = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

type RawTerms = Parameters<typeof usageTermsOf>[0];

/** The entries of a listing source, read the way the projection reads them. Null when the key is not a source. */
function entriesOf(key: string, value: unknown): SourceEntry[] | null {
  const app = /^apps\.(.+)\.tools$/.exec(key);
  if (app) {
    // A manifest the schema rejects lists nothing (INVALID_TOOL_MANIFEST), so it generates no document.
    const parsed = AppToolsDocSchema.safeParse(value);
    if (!parsed.success) return [];
    return parsed.data.tools.map(t => ({
      id: t.name, label: `${app[1]}/${t.name}`, flagged: t.exchange === true,
      usageTerms: usageTermsOf(t.usageTerms), odps: mergeOdpsExtras(parsed.data.odps, t.odps),
      // A tool inherits the manifest root's `odps` key by key, so the root is named when the tool leaves it.
      where: f => (f.startsWith('odps.') && !Object.hasOwn(t.odps ?? {}, f.split('.')[1]!) ? f : `tools[${t.name}].${f}`),
    }));
  }
  const offers = /^agents\.(.+)\.offers$/.exec(key);
  if (offers) {
    const parsed = OffersDocSchema.safeParse(value);
    if (!parsed.success) return [];
    return parsed.data.offers.map(o => ({
      id: o.id, label: `${offers[1]}:${o.id}`, flagged: o.exchange === true,
      usageTerms: usageTermsOf(o.usageTerms), odps: o.odps ?? null, where: f => `offers[${o.id}].${f}`,
    }));
  }
  const ext = /^ext:(.+)$/.exec(key);
  if (ext) {
    // An extension's `commercial` block is carried from the manifest as written, and so is its listing.
    const actions = record(value)?.actions;
    return (Array.isArray(actions) ? actions : []).flatMap(raw => {
      const act = record(raw), comm = record(act?.commercial);
      if (!act || typeof act.id !== 'string') return [];
      const id = act.id;
      return [{
        id, label: `${ext[1]}/${id}`, flagged: comm?.exchange === true,
        usageTerms: usageTermsOf((record(comm?.usageTerms) ?? undefined) as RawTerms),
        odps: record(comm?.odps) as OdpsExtras | null, where: (f: string) => `actions[${id}].commercial.${f}`,
      }];
    });
  }
  return null;
}

/** The capped texts an entry's ODPS document carries that an owner can write, by concrete ODPS path. */
function cappedTexts(e: SourceEntry): Map<string, { limit: OdpsTextLimit; text: string }> {
  // Only usageTerms and odps reach a field an owner can fill; the rest of the listing is the node's.
  const offering = {
    offeringId: '', providerGhii: '', providerOwner: '', kind: 'app-tool', ext: '', action: '', surface: null,
    title: '', description: '', unit: 'morsels', basePrice: 0, currency: null, plans: [], provenance: null,
    odps: e.odps, usageTerms: e.usageTerms, tags: [], state: 'listed', auto: true, createdAt: '', updatedAt: '',
  } as Offering;
  const doc = offeringToOdps({ offering, rakePercent: 0, baseUrl: '', nodeId: '' });
  return new Map(odpsCappedTexts(doc).filter(c => c.limit.fields.length > 0).map(c => [c.path, { limit: c.limit, text: c.text }]));
}

/** The text an owner wrote into one authoring field of an entry, or null when it is empty or absent. */
function fieldText(e: SourceEntry, field: string): string | null {
  const [head, ...rest] = field.split('.');
  let node: unknown = head === 'usageTerms' ? e.usageTerms : head === 'odps' ? e.odps : null;
  for (const k of rest) node = record(node)?.[k];
  return typeof node === 'string' && node ? node : null;
}

/**
 * Would storing `value` under `key` publish an ODPS document past a schema cap, in text that `previous`
 * (the value stored now, or nothing) did not already carry? Returns the refusal to answer with, or null.
 * `key` is a memory key (`apps.{appId}.tools`, `agents.{agent}.offers`) or extensionOdpsKey(name) with the
 * extension record; any other key is not a listing source and returns null. Only entries flagged for
 * EXCHANGE are checked, since nothing else generates a document.
 */
export function odpsWriteRefusal(key: string, value: unknown, previous: unknown): OdpsWriteRefusal | null {
  const next = entriesOf(key, value);
  if (!next?.length) return null;
  const stored = new Map((entriesOf(key, previous) ?? []).map(e => [e.id, e]));
  const fields: OdpsTooLongField[] = [];
  const sentences: string[] = [];
  for (const e of next) {
    if (!e.flagged) continue;
    const before = stored.has(e.id) ? cappedTexts(stored.get(e.id)!) : null;
    for (const [path, { limit, text }] of cappedTexts(e)) {
      const length = charLength(text);
      if (length <= limit.maxLength || before?.get(path)?.text === text) continue;
      const present = limit.fields.flatMap(f => { const t = fieldText(e, f); return t ? [{ f, t }] : []; });
      const nodePart = length - present.reduce((n, p) => n + charLength(p.t), 0) - Math.max(0, present.length - 1);
      for (const { f, t } of present) {
        const room = Math.max(0, limit.maxLength - (length - charLength(t)));
        const src = e.where(f);
        fields.push({ entry: e.label, source_field: src, odps_field: path, length, max_length: limit.maxLength, room });
        const shares = [
          ...(nodePart > 0 ? [`the node's usage-terms sentences take ${nodePart} characters with the space after them`] : []),
          ...present.filter(p => p.f !== f).map(p => `${e.where(p.f)} takes ${charLength(p.t) + 1} with its joining space`),
        ];
        sentences.push(`${src} makes ${path} ${length} characters, and ODPS v${ODPS_VERSION} allows ${limit.maxLength}`
          + (shares.length ? `; in that field ${shares.join(' and ')}, so ${src} can be at most ${room}.` : `, so ${src} can be at most ${room}.`));
      }
    }
  }
  if (!fields.length) return null;
  const labels = [...new Set(fields.map(f => f.entry))];
  return {
    ok: false, status: 422, code: ODPS_FIELD_TOO_LONG,
    message: `Not saved: the EXCHANGE listing${labels.length > 1 ? 's' : ''} ${labels.join(', ')} would publish an ODPS document`
      + ` the ODPS v${ODPS_VERSION} schema refuses. ${sentences.join(' ')} Shorten the text and write again. The node does not`
      + ' cut it for you, because a shortened licence term would say something you did not write.',
    details: { key, fields },
  };
}
