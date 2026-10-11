/**
 * @file test/unit/csm-template-limits.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every limit, default and required list a CSM states reaches the JSON Schema the node
 *   compiles from it: the seven runtime templates as seeded at boot, the refresh of a schema an older
 *   build seeded, and every YAML example in the CSM documentation.
 *
 * @version-history
 *   v1.0.0 — 2026-10-11 — The runtime templates wrote minLength, maxLength, minimum, maxItems and
 *     default, the parser read only min/max, and every seeded schema enforced no limit at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { seedCsmTemplates } from '../../src/services/csm-seed.js';
import { CSM_FIELD_KEYS, csmToJsonSchema, parseCsm, validateCsm } from '../../src/services/csm-parser.js';
import { validateValueAgainstSchema } from '../../src/services/schema-validator.js';

const TEMPLATE_DIR = join(import.meta.dirname, '../../docs/csm-examples');
const REPO_ROOT = join(import.meta.dirname, '../../..');
const DOCS = ['docs/csm-spec.md', 'docs/manuals/csm-manual.md', 'docs/manuals/service-owner-manual.md'];

type Field = Record<string, unknown>;
type Expectation = { path: string; keyword: string; value: unknown };

const SHORT: Record<string, Record<'min' | 'max', string>> = {
  string: { min: 'minLength', max: 'maxLength' },
  number: { min: 'minimum', max: 'maximum' },
  integer: { min: 'minimum', max: 'maximum' },
  array: { min: 'minItems', max: 'maxItems' },
};
const NOT_FIELDS = new Set(['csm', 'msm', 'service', 'schema_mode', 'consent_requirements', 'moderation', 'ui_hints',
  'economy', 'scoring', 'limits', 'endpoint', 'auth', 'pricing', 'actions', 'health', 'semantic']);
const LONG = ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'default'];

/** What one field definition states, as JSON Schema keyword → value, at its path. */
function statedLimits(path: string, field: Field, out: Expectation[]): void {
  const type = String(field.type);
  for (const short of ['min', 'max'] as const) {
    const keyword = SHORT[type]?.[short];
    if (keyword && field[short] !== undefined && field[keyword] === undefined) out.push({ path, keyword, value: field[short] });
  }
  for (const keyword of LONG) if (field[keyword] !== undefined) out.push({ path, keyword, value: field[keyword] });
  if (Array.isArray(field.required)) out.push({ path, keyword: 'required', value: field.required });
  for (const [name, prop] of Object.entries((field.properties ?? {}) as Record<string, Field>)) {
    statedLimits(`${path}.properties.${name}`, prop, out);
  }
  if (field.items && typeof field.items === 'object') statedLimits(`${path}.items`, field.items as Field, out);
}

function expectationsOf(dataSchema: Record<string, Record<string, Field>>): Expectation[] {
  const out: Expectation[] = [];
  for (const group of ['required', 'optional']) {
    for (const [name, field] of Object.entries(dataSchema[group] ?? {})) statedLimits(`properties.${name}`, field, out);
  }
  return out;
}

function at(schema: unknown, path: string): Record<string, unknown> | undefined {
  let node = schema as Record<string, unknown> | undefined;
  for (const part of path.split('.')) node = node?.[part] as Record<string, unknown> | undefined;
  return node;
}

/** Every field definition anywhere in a parsed YAML value: a map under data_schema.required/optional
 *  or `properties`, or a bare field map in a documentation fragment. */
function fieldDefs(value: unknown, path: string, out: Array<{ path: string; field: Field }>): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Field;
  if (typeof v.type === 'string') {
    out.push({ path, field: v });
    for (const [name, prop] of Object.entries((v.properties ?? {}) as Record<string, unknown>)) fieldDefs(prop, `${path}.${name}`, out);
    if (v.items && typeof v.items === 'object') fieldDefs(v.items, `${path}[]`, out);
    return;
  }
  for (const [k, child] of Object.entries(v)) fieldDefs(child, path ? `${path}.${k}` : k, out);
}

const templates = readdirSync(TEMPLATE_DIR).filter(f => f.endsWith('.csm.yaml')).map(file => {
  const yaml = readFileSync(join(TEMPLATE_DIR, file), 'utf-8');
  return { file, yaml, raw: parseYaml(yaml) as Record<string, unknown> };
});

let storage: Storage & { close(): void | Promise<void> };
beforeAll(async () => {
  storage = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }) as typeof storage;
}, 60_000);
afterAll(async () => { await storage.close(); });

describe('CSM runtime templates: the seeded schema carries what the template states', () => {
  it('ships seven templates, each stating at least one limit', () => {
    expect(templates).toHaveLength(7);
    for (const t of templates) {
      expect(expectationsOf(t.raw.data_schema as never).length, t.file).toBeGreaterThan(0);
    }
  });

  it('seeds all seven and every stated limit, default and required list is in the locked schema', async () => {
    expect(await seedCsmTemplates(storage, 'system@test-node')).toBe(7);
    const missing: string[] = [];
    for (const t of templates) {
      const name = String((t.raw.service as Field).name);
      const lock = await storage.getSchema(`csm.${name}`, 'prefix');
      expect(lock, t.file).not.toBeNull();
      for (const e of expectationsOf(t.raw.data_schema as never)) {
        const got = at(lock!.schemaJson, e.path)?.[e.keyword];
        if (JSON.stringify(got) !== JSON.stringify(e.value)) {
          missing.push(`${t.file} ${e.path}.${e.keyword}: stated ${JSON.stringify(e.value)}, compiled ${JSON.stringify(got)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('a nested property with a default, outside the required list, is optional', async () => {
    const lock = await storage.getSchema('csm.marketplace', 'prefix');
    const price = at(lock!.schemaJson, 'properties.price')!;
    expect(price.required).toEqual(['amount']);
    expect(at(price, 'properties.currency')).toMatchObject({ type: 'string', default: 'EUR' });
  });
});

describe('CSM seed on an existing node', () => {
  it('refreshes a schema an older build seeded, and leaves a person\'s own lock alone', async () => {
    const own = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }) as typeof storage;
    try {
      await seedCsmTemplates(own, 'system@old-node');
      const now = new Date().toISOString();
      const limitless = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
      const auction = (await own.getSchema('csm.auction', 'prefix'))!;
      await own.setSchema({ ...auction, schemaJson: limitless, updatedAt: now });
      const news = (await own.getSchema('csm.news-feed', 'prefix'))!;
      await own.setSchema({ ...news, schemaJson: limitless, lockedBy: 'alice@old-node', updatedAt: now });

      expect(await seedCsmTemplates(own, 'system@new-node')).toBe(0);

      const refreshed = (await own.getSchema('csm.auction', 'prefix'))!;
      expect(at(refreshed.schemaJson, 'properties.title')).toMatchObject({ minLength: 5, maxLength: 200 });
      expect(refreshed.lockedBy).toBe('system@old-node');
      expect((await own.getSchema('csm.news-feed', 'prefix'))!.schemaJson).toEqual(limitless);
    } finally {
      await own.close();
    }
  });
});

describe('CSM documentation examples pass the parser', () => {
  const blocks = DOCS.flatMap(doc => {
    const text = readFileSync(join(REPO_ROOT, doc), 'utf-8');
    return [...text.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m, i) => ({ where: `${doc} yaml block ${i + 1}`, yaml: m[1] }));
  });

  it('finds the YAML examples', () => {
    expect(blocks.length).toBeGreaterThan(20);
  });

  it('every field definition in every example uses only keys the parser reads', () => {
    const unknown: string[] = [];
    for (const b of blocks) {
      const raw = parseYaml(b.yaml) as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object') continue;
      // A whole manifest is read from its data_schema; a fragment that is a block other than the
      // data schema (service, consent, an MSM endpoint) holds no field definitions.
      const scope = raw.data_schema ?? (Object.keys(raw).some(k => NOT_FIELDS.has(k)) ? null : raw);
      const found: Array<{ path: string; field: Field }> = [];
      fieldDefs(scope, '', found);
      for (const { path, field } of found) {
        for (const key of Object.keys(field)) {
          if (!CSM_FIELD_KEYS.includes(key)) unknown.push(`${b.where} ${path}: "${key}"`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('every complete CSM example validates, and its compiled schema carries every stated limit', () => {
    const problems: string[] = [];
    let complete = 0;
    for (const b of blocks) {
      const raw = parseYaml(b.yaml) as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object' || raw.csm === undefined || !raw.data_schema) continue;
      complete++;
      const def = parseCsm(b.yaml);
      for (const e of validateCsm(def)) problems.push(`${b.where}: ${e}`);
      const schema = csmToJsonSchema(def);
      for (const e of expectationsOf(raw.data_schema as never)) {
        const got = at(schema, e.path)?.[e.keyword];
        if (JSON.stringify(got) !== JSON.stringify(e.value)) problems.push(`${b.where} ${e.path}.${e.keyword}: compiled ${JSON.stringify(got)}`);
      }
    }
    expect(complete).toBeGreaterThan(5);
    expect(problems).toEqual([]);
  });

  it('the service owner manual\'s worked write is accepted, and refused as the manual says', () => {
    const text = readFileSync(join(REPO_ROOT, 'docs/manuals/service-owner-manual.md'), 'utf-8');
    const yaml = [...text.matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => m[1]).find(y => y.includes('name: "kirpputori"'))!;
    const write = /-d '(\{"key":"csm\.kirpputori[^']*)'/.exec(text)!;
    const schema = csmToJsonSchema(parseCsm(yaml));
    const value = (JSON.parse(write[1]) as { value: Record<string, unknown> }).value;
    expect(validateValueAgainstSchema(value, schema)).toEqual({ ok: true });
    const { category: _category, ...withoutCategory } = value;
    expect(validateValueAgainstSchema(withoutCategory, schema).ok).toBe(false);
    expect(validateValueAgainstSchema({ ...value, title: 'No' }, schema).ok).toBe(false);
  });
});
