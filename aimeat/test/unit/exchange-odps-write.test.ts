/**
 * @file test/unit/exchange-odps-write.test.ts
 * @description The developer decided on 2026-09-13: a write that would make a generated ODPS document break
 *   an ODPS schema maxLength is REFUSED at the write with 422 ODPS_FIELD_TOO_LONG, naming the field the
 *   owner wrote, the ODPS field it fills, its length, the cap and the room left (the node's own usage
 *   sentences take part of license.scope.restrictions). Only text that CHANGED is refused: an over-long
 *   field a stored record already carried keeps publishing with the listing warning, so republishing an
 *   unchanged source does not start failing. Nothing is ever truncated. One function decides it for every
 *   door (odpsWriteRefusal), so these tests call it for all three kinds of source.
 * @usage cd aimeat && pnpm exec vitest run test/unit/exchange-odps-write.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial (appdev pitfall usageterms-note-caps-at-156-not-255, turned into a refusal).
 */
import { describe, it, expect } from 'vitest';
import { odpsWriteRefusal, extensionOdpsKey } from '../../src/services/exchange-odps-write.js';
import { ODPS_TEXT_LIMITS } from '../../src/services/exchange-odps.js';

const KEY = 'apps.shop.html.tools';
const IN = { type: 'object', properties: { q: {} } };
const OUT = { type: 'object', properties: { a: {} } };
const TERMS = { derivatives: true, resale: false, attribution: true };

const tool = (over: Record<string, unknown> = {}) => ({
  name: 'find', action_id: 'ext:e:a', exchange: true, price: { morsels: 5 }, inputSchema: IN, outputSchema: OUT,
  usageTerms: { ...TERMS }, ...over,
});
const manifest = (tools: unknown[], root: Record<string, unknown> = {}) => ({ version: 1, tools, ...root });
const noted = (note: string, over: Record<string, unknown> = {}) => tool({ usageTerms: { ...TERMS, note }, ...over });

describe('an app-tool manifest', () => {
  it('refuses a new record whose note pushes the restrictions past 255, and says how much room there is', () => {
    const refusal = odpsWriteRefusal(KEY, manifest([noted('n'.repeat(200))]), undefined);
    expect(refusal).toMatchObject({ ok: false, status: 422, code: 'ODPS_FIELD_TOO_LONG' });
    // The node writes 98 characters of its own sentences and a joining space first: 255 - 99 = 156.
    expect(refusal!.details).toEqual({
      key: KEY,
      fields: [{
        entry: 'shop.html/find', source_field: 'tools[find].usageTerms.note', odps_field: 'product.license.scope.restrictions',
        length: 299, max_length: 255, room: 156,
      }],
    });
    for (const s of ['tools[find].usageTerms.note', 'product.license.scope.restrictions', '299', '255', '156', 'not saved']) {
      expect(refusal!.message.toLowerCase()).toContain(s.toLowerCase());
    }
  });

  it('draws the line exactly at the cap', () => {
    expect(odpsWriteRefusal(KEY, manifest([noted('n'.repeat(156))]), undefined)).toBeNull();
    expect(odpsWriteRefusal(KEY, manifest([noted('n'.repeat(157))]), undefined)?.details.fields[0]).toMatchObject({ length: 256, room: 156 });
  });

  it('lets an unchanged over-long note through when the record is republished for another reason', () => {
    const stored = manifest([noted('n'.repeat(200))]);
    const repriced = manifest([noted('n'.repeat(200), { price: { morsels: 9 }, description: 'now with a description' })]);
    expect(odpsWriteRefusal(KEY, repriced, stored)).toBeNull();
  });

  it('refuses the note once it changes, even by one character, and a short note that grows past the cap', () => {
    expect(odpsWriteRefusal(KEY, manifest([noted('n'.repeat(201))]), manifest([noted('n'.repeat(200))]))?.code).toBe('ODPS_FIELD_TOO_LONG');
    expect(odpsWriteRefusal(KEY, manifest([noted('n'.repeat(200))]), manifest([noted('short')]))?.code).toBe('ODPS_FIELD_TOO_LONG');
  });

  it('refuses when a usage flag adds a node sentence that no longer leaves the unchanged note room', () => {
    const stored = manifest([noted('n'.repeat(140))]);                         // 99 + 140 = 239, fits
    const tightened = manifest([tool({ usageTerms: { ...TERMS, derivatives: false, note: 'n'.repeat(140) } })]);
    const refusal = odpsWriteRefusal(KEY, tightened, stored);
    expect(refusal?.details.fields).toEqual([expect.objectContaining({ source_field: 'tools[find].usageTerms.note', length: 260, room: 135 })]);
  });

  it('says nothing about a tool that is not flagged for EXCHANGE, since no document is generated', () => {
    expect(odpsWriteRefusal(KEY, manifest([noted('n'.repeat(400), { exchange: false })]), undefined)).toBeNull();
  });

  it('names each field the owner wrote into a shared ODPS field, with the room the other one leaves', () => {
    const both = tool({ usageTerms: { ...TERMS, note: 'n'.repeat(100) }, odps: { license: { restrictions: 'r'.repeat(100) } } });
    const fields = odpsWriteRefusal(KEY, manifest([both]), undefined)!.details.fields;
    expect(fields.map(f => [f.source_field, f.length, f.room])).toEqual([
      ['tools[find].usageTerms.note', 300, 55],
      ['tools[find].odps.license.restrictions', 300, 55],
    ]);
  });

  it('names the manifest root when a tool inherits the text, and the tool when it overrides it', () => {
    const root = { odps: { dataHolder: { legalName: 'Oy', description: 'd'.repeat(600) } } };
    const inherited = odpsWriteRefusal(KEY, manifest([tool()], root), undefined)!.details.fields;
    expect(inherited).toEqual([expect.objectContaining({ entry: 'shop.html/find', source_field: 'odps.dataHolder.description', odps_field: 'product.dataHolder.description', length: 600, max_length: 512, room: 512 })]);
    const own = odpsWriteRefusal(KEY, manifest([tool({ odps: { valueProposition: 'v'.repeat(513) } })]), undefined)!.details.fields;
    expect(own).toEqual([expect.objectContaining({ source_field: 'tools[find].odps.valueProposition', odps_field: 'product.details.en.valueProposition', room: 512 })]);
  });

  it('counts characters the way JSON Schema does, by code point', () => {
    expect(odpsWriteRefusal(KEY, manifest([tool({ odps: { valueProposition: '\u{1F600}'.repeat(512) } })]), undefined)).toBeNull();
  });

  it('leaves alone a key that is not a listing source, and a manifest the schema rejects', () => {
    expect(odpsWriteRefusal('apps.shop.html.settings', manifest([noted('n'.repeat(400))]), undefined)).toBeNull();
    expect(odpsWriteRefusal(KEY, { tools: 'not a list' }, undefined)).toBeNull();
  });
});

describe('an agent offers document', () => {
  const offer = (note: string) => ({
    id: 'sold', title: 'Sold', ask: 'Send an id.', deliverable: { format: 'document', sample: 'untested' },
    inputSchema: IN, outputSchema: OUT, price: { morsels: 4 }, exchange: true, visibility: 'public',
    usageTerms: { ...TERMS, note },
  });

  it('refuses a changed over-long note and names the offer', () => {
    const refusal = odpsWriteRefusal('agents.trader.offers', { offers: [offer('n'.repeat(200))] }, { offers: [offer('short')] });
    expect(refusal?.details.fields).toEqual([expect.objectContaining({
      entry: 'trader:sold', source_field: 'offers[sold].usageTerms.note', length: 299, room: 156,
    })]);
  });

  it('keeps an unchanged one', () => {
    const doc = { offers: [offer('n'.repeat(200))] };
    expect(odpsWriteRefusal('agents.trader.offers', { version: 2, ...doc }, { version: 1, ...doc })).toBeNull();
  });
});

describe('an extension manifest', () => {
  const ext = (note: string) => ({
    name: 'kaiku',
    actions: [{ id: 'search', inputSchema: IN, outputSchema: OUT, commercial: { payMorsels: 3, exchange: true, usageTerms: { ...TERMS, note } } }],
  });

  it('refuses an install whose flagged action carries an over-long note', () => {
    const refusal = odpsWriteRefusal(extensionOdpsKey('kaiku'), ext('n'.repeat(200)), null);
    expect(refusal?.details.fields).toEqual([expect.objectContaining({
      entry: 'kaiku/search', source_field: 'actions[search].commercial.usageTerms.note', length: 299, room: 156,
    })]);
  });

  it('keeps a redeploy that leaves the note as it was', () => {
    expect(odpsWriteRefusal(extensionOdpsKey('kaiku'), ext('n'.repeat(200)), ext('n'.repeat(200)))).toBeNull();
  });
});

describe('every capped ODPS field a provider can fill is refused under its own name', () => {
  for (const limit of ODPS_TEXT_LIMITS) {
    if (/^the node(,|$)/.test(limit.source)) {
      it(`${limit.path} is the node's own text and names no authoring field`, () => expect(limit.fields).toEqual([]));
      continue;
    }
    for (const field of limit.fields) {
      it(`${field} → ${limit.path}`, () => {
        const long = 'x'.repeat(limit.maxLength + 1);
        const [head, ...rest] = field.split('.');
        const nested = rest.reduceRight<unknown>((acc, k) => ({ [k]: acc }), long) as Record<string, unknown>;
        const legal = field.startsWith('odps.dataHolder.') && field !== 'odps.dataHolder.legalName'
          ? { odps: { dataHolder: { legalName: 'Oy', ...(nested.dataHolder as object) } } } : null;
        const over = head === 'usageTerms' ? { usageTerms: { ...TERMS, ...nested } } : legal ?? { [head!]: nested };
        const fields = odpsWriteRefusal(KEY, manifest([tool(over)]), undefined)?.details.fields ?? [];
        expect(fields.map(f => [f.source_field, f.odps_field.replace('.en.', '.*.')])).toContainEqual([`tools[find].${field}`, limit.path]);
      });
    }
  }
});
