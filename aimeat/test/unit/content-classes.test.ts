/**
 * @file test/unit/content-classes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content class ontology and settings on a real in-memory SQLite storage: the
 *   built-in classes agree with the refinery's ids, the OWL document and the JSON-LD entity carry the
 *   right types, proposals are not filed twice and an approval changes the owner's classes, and the
 *   settings start cautious and take a partial patch while refusing an unknown key.
 * @structure builtins · owlOntology · entityFor · proposals · owner classes · settings
 * @usage cd aimeat && pnpm exec vitest run test/unit/content-classes.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import { CLASS_PACKS } from '../../src/data/refinery-classes.js';
import { BUILTIN_CLASSES, builtinClass } from '../../src/data/content-classes.js';
import {
  ContentClassError, addProposal, decideProposal, entityFor, getClass, listClasses, listProposals, owlOntology,
  removeOwnerClass, setOwnerClass, type ContentWriter,
} from '../../src/services/content/classes.js';
import { aiStagesOn, readSettings, writeSettings } from '../../src/services/content/settings.js';

type TestStorage = Storage & { close(): void | Promise<void> };
let storage: TestStorage;
const config = loadConfig().config;
const BASE = 'https://node.example';

beforeAll(async () => { storage = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }) as TestStorage; });
afterAll(async () => { await storage.close(); });

function owner(): { deps: { storage: Storage; config: typeof config }; writer: ContentWriter; ghii: string } {
  const ghii = `cc-${randomUUID().slice(0, 8)}@${config.nodeId}`;
  return { deps: { storage, config }, writer: { principal: ghii, ownerGhii: ghii, scopes: ['memory:write'], roles: ['owner'] }, ghii };
}

describe('built-in classes', () => {
  it('carry every refinery id, and invoice with its properties and schema.org mappings', () => {
    for (const p of CLASS_PACKS) expect(builtinClass(p.id)?.id).toBe(p.id);
    const invoice = builtinClass('invoice')!;
    expect(invoice.origin).toBe('builtin');
    expect(invoice.properties.map((p) => p.name)).toContain('due_date');
    expect(invoice.properties.find((p) => p.name === 'amount')?.sameAs).toBe('schema:totalPaymentDue');
    expect(invoice.properties.find((p) => p.name === 'due_date')?.sameAs).toBe('schema:paymentDueDate');
    expect(builtinClass('receipt')!.properties.find((p) => p.name === 'date')?.sameAs).toBe('schema:paymentDate');
    expect(builtinClass('photo')).toMatchObject({ process: false, kinds: ['image'], label: { fi: 'Valokuva' } });
    expect(new Set(BUILTIN_CLASSES.map((c) => c.id)).size).toBe(BUILTIN_CLASSES.length);
  });
});

describe('owlOntology', () => {
  it('has an owl:Class per class with subClassOf, and a DatatypeProperty per property with its xsd range', () => {
    const doc = owlOntology(BUILTIN_CLASSES, { ownerGhii: 'alice@n', baseUrl: BASE }) as Record<string, unknown>;
    expect(doc['@type']).toBe('owl:Ontology');
    expect(doc['@id']).toBe(`${BASE}/v1/content/ontology#alice%40n`);
    const ctx = doc['@context'] as Record<string, string>;
    expect(ctx.cc).toBe(`${BASE}/ns/content-class/`);
    expect(ctx.owl && ctx.xsd && ctx.rdfs && ctx.schema).toBeTruthy();
    const graph = doc['@graph'] as Array<Record<string, unknown>>;
    const classes = graph.filter((n) => n['@type'] === 'owl:Class');
    expect(classes).toHaveLength(BUILTIN_CLASSES.length);
    expect(graph.find((n) => n['@id'] === 'cc:invoice')?.['rdfs:subClassOf']).toEqual({ '@id': 'schema:Invoice' });
    const props = graph.filter((n) => n['@type'] === 'owl:DatatypeProperty');
    expect(props).toHaveLength(BUILTIN_CLASSES.reduce((n, c) => n + c.properties.length, 0));
    const amount = graph.find((n) => n['@id'] === 'cc:invoice.amount')!;
    expect(amount['rdfs:range']).toEqual({ '@id': 'xsd:decimal' });
    expect(amount['rdfs:domain']).toEqual({ '@id': 'cc:invoice' });
    expect(amount['owl:equivalentProperty']).toEqual({ '@id': 'schema:totalPaymentDue' });
    expect(amount['cc:required']).toBe(true);
    expect(graph.find((n) => n['@id'] === 'cc:invoice.due_date')?.['rdfs:range']).toEqual({ '@id': 'xsd:date' });
    expect(graph.find((n) => n['@id'] === 'cc:system.action_required')?.['rdfs:range']).toEqual({ '@id': 'xsd:boolean' });
  });
});

describe('entityFor', () => {
  it('coerces numbers and dates, drops what cannot be coerced, unknown keys and _ keys', () => {
    const e = entityFor(builtinClass('invoice')!, {
      vendor: ' Acme Oy ', amount: '12.50', vat: '12,50', due_date: '2026-11-30', date: 'not a date',
      iban: '', reference: null, extra: 'x', _model: 'm',
    }, { sourceId: 'file:alice@n:a.pdf', baseUrl: BASE });
    expect(e['@type']).toEqual(['cc:invoice', 'schema:Invoice']);
    expect(String(e['@id'])).toMatch(/^urn:aimeat:content:[0-9a-f]{24}#invoice$/);
    expect(e['cc:invoice.vendor']).toBe('Acme Oy');
    expect(e['cc:invoice.amount']).toBe(12.5);
    expect(e).not.toHaveProperty('cc:invoice.vat');
    expect(e['cc:invoice.due_date']).toBe('2026-11-30');
    expect(e).not.toHaveProperty('cc:invoice.date');
    expect(e).not.toHaveProperty('cc:invoice.iban');
    expect(e).not.toHaveProperty('cc:invoice.reference');
    expect(Object.keys(e).some((k) => k.includes('extra') || k.includes('_model'))).toBe(false);
    expect(e['cc:source']).toBe('file:alice@n:a.pdf');
    const d = entityFor(builtinClass('booking')!, { start: '2026-02-30', end: '2026-03-02T10:00:00Z' }, { sourceId: 's', baseUrl: BASE });
    expect(d).not.toHaveProperty('cc:booking.start');
    expect(d['cc:booking.end']).toBe('2026-03-02');
  });
});

describe('proposals', () => {
  const recipe = { id: 'recipe', label: { fi: 'Resepti', en: 'Recipe' }, describe: 'A cooking recipe.', process: true, type: 'schema:Recipe',
    properties: [{ name: 'dish', type: 'string', required: true, describe: 'The dish.' }], origin: 'proposed' as const };

  it('files a class proposal once, and an approval adds it as the owner\'s class', async () => {
    const { deps, writer, ghii } = owner();
    const a = await addProposal(deps, writer, { kind: 'class', class: recipe as never, sourceId: 'file:x:1', why: 'seen twice' });
    const b = await addProposal(deps, writer, { kind: 'class', class: recipe as never, sourceId: 'file:x:2', why: 'again' });
    expect(a.id).toMatch(/^prop-[0-9a-z]{10}$/);
    expect(b.id).toBe(a.id);
    expect(await listProposals(storage, ghii, 'pending')).toHaveLength(1);
    const decided = await decideProposal(deps, writer, a.id, 'approve', ghii);
    expect(decided.status).toBe('approved');
    expect(await getClass(storage, ghii, 'recipe')).toMatchObject({ id: 'recipe', origin: 'owner', type: 'schema:Recipe' });
    await expect(decideProposal(deps, writer, a.id, 'reject', ghii)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('dedupes a properties proposal by class and names; an approval on a built-in class copies it into the owner\'s list', async () => {
    const { deps, writer, ghii } = owner();
    const props = [{ name: 'po_number', type: 'string' as const, required: false, describe: 'The purchase order number.' }];
    const a = await addProposal(deps, writer, { kind: 'properties', classId: 'invoice', properties: props, sourceId: 'file:x:1', why: 'w' });
    const b = await addProposal(deps, writer, { kind: 'properties', classId: 'invoice', properties: props, sourceId: 'file:x:3', why: 'w' });
    expect(b.id).toBe(a.id);
    await decideProposal(deps, writer, a.id, 'approve', ghii);
    const inv = (await listClasses(storage, ghii)).filter((c) => c.id === 'invoice');
    expect(inv).toHaveLength(1);
    expect(inv[0].origin).toBe('owner');
    expect(inv[0].properties.map((p) => p.name)).toEqual([...builtinClass('invoice')!.properties.map((p) => p.name), 'po_number']);
    expect(builtinClass('invoice')!.properties.some((p) => p.name === 'po_number')).toBe(false);
  });
});

describe('owner classes', () => {
  it('validates, stores and removes an owner class', async () => {
    const { deps, writer, ghii } = owner();
    await expect(setOwnerClass(deps, writer, { id: 'X', label: { fi: 'a', en: 'b' } })).rejects.toBeInstanceOf(ContentClassError);
    await expect(setOwnerClass(deps, writer, { id: 'ok-id', label: { fi: 'a', en: '' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(setOwnerClass(deps, writer, { id: 'ok-id', label: { fi: 'a', en: 'b' },
      properties: [{ name: 'a', type: 'string' }, { name: 'a', type: 'string' }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await setOwnerClass(deps, writer, { id: 'ok-id', label: { fi: 'a', en: 'b' }, type: 'schema:Thing', properties: [{ name: 'n', type: 'number' }] });
    expect((await getClass(storage, ghii, 'ok-id'))?.properties[0]).toMatchObject({ name: 'n', type: 'number', required: false });
    await removeOwnerClass(deps, writer, 'ok-id');
    expect(await getClass(storage, ghii, 'ok-id')).toBeNull();
    await expect(removeOwnerClass(deps, writer, 'ok-id')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('settings', () => {
  it('start with the technical stage on and every AI stage off', async () => {
    const { ghii } = owner();
    const s = await readSettings(storage, ghii);
    expect(s.stages.technical).toBe(true);
    expect(aiStagesOn(s)).toBe(false);
    expect(s.language).toBe('');
  });

  it('take a partial patch, refuse an unknown key and a bad language, and keep the other fields', async () => {
    const { deps, writer, ghii } = owner();
    const s = await writeSettings(deps, writer, { stages: { describe: true }, language: 'fi', minTextChars: 500 });
    expect(s.stages).toMatchObject({ technical: true, describe: true, classify: false });
    expect(aiStagesOn(s)).toBe(true);
    await expect(writeSettings(deps, writer, { colour: 'red' })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('colour') });
    await expect(writeSettings(deps, writer, { stages: { magic: true } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(writeSettings(deps, writer, { language: 'Finnish' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(writeSettings(deps, writer, { approval: 'rule' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(writeSettings(deps, writer, { minTextChars: 100 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    // The technical read is always on; the refusal names the setting that does stop reading.
    await expect(writeSettings(deps, writer, { stages: { technical: false } })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('onArrival') });
    const t = await writeSettings(deps, writer, { onArrival: false, approval: 'rule', approvalRule: 'approve-classes' });
    expect(t).toMatchObject({ language: 'fi', minTextChars: 500, onArrival: false, approval: 'rule', approvalRule: 'approve-classes', stages: { technical: true, describe: true } });
    expect(await readSettings(storage, ghii)).toEqual(t);
  });

  it('read a bad stored field as its default', async () => {
    const { ghii } = owner();
    const now = new Date().toISOString();
    await storage.setMemory({ key: 'contentclass.settings', ownerGaii: ghii, value: { stages: { describe: 'yes', classify: true }, minTextChars: 5, language: 'xx_YY' },
      visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
    const s = await readSettings(storage, ghii);
    expect(s.stages).toMatchObject({ describe: false, classify: true });
    expect(s.minTextChars).toBe(2000);
    expect(s.language).toBe('');
  });
});
