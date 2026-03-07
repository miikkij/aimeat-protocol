/**
 * Unit tests for the config system: config-schema, config-loader, and config-provenance.
 * Run with: npx tsx test/config-loader.test.ts
 */

import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Config Schema Tests ──

import {
  CONFIG_FIELDS,
  MUTABLE_CONFIG_MAP,
  ALL_CONFIG_MAP,
  ENV_TO_DOT_PATH,
  DOT_PATH_TO_ENV,
  isImmutable,
  parseConfigValue,
  serializeConfigValue,
} from '../src/services/config-schema.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => {
        passed++;
        console.log(`  ✓ ${name}`);
      }).catch(err => {
        failed++;
        console.error(`  ✗ ${name}: ${err.message}`);
      });
    } else {
      passed++;
      console.log(`  ✓ ${name}`);
    }
  } catch (err: any) {
    failed++;
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

console.log('\n── Config Schema ──');

test('MUTABLE_CONFIG_MAP only contains non-immutable fields', () => {
  for (const [, field] of Object.entries(MUTABLE_CONFIG_MAP)) {
    assert.equal(field.immutable, false, `${field.dotPath} should be mutable`);
  }
});

test('ALL_CONFIG_MAP contains all fields', () => {
  assert.equal(Object.keys(ALL_CONFIG_MAP).length, CONFIG_FIELDS.length);
  for (const field of CONFIG_FIELDS) {
    assert.ok(ALL_CONFIG_MAP[field.dotPath], `Missing: ${field.dotPath}`);
  }
});

test('ENV_TO_DOT_PATH and DOT_PATH_TO_ENV are inverse mappings', () => {
  for (const [envVar, dotPath] of Object.entries(ENV_TO_DOT_PATH)) {
    assert.equal(DOT_PATH_TO_ENV[dotPath], envVar, `Inverse mismatch: ${envVar} <-> ${dotPath}`);
  }
  for (const [dotPath, envVar] of Object.entries(DOT_PATH_TO_ENV)) {
    assert.equal(ENV_TO_DOT_PATH[envVar], dotPath, `Inverse mismatch: ${dotPath} <-> ${envVar}`);
  }
});

test('isImmutable("node.id") → true', () => {
  assert.equal(isImmutable('node.id'), true);
});

test('isImmutable("morsel_policy.welcome_bonus") → false', () => {
  assert.equal(isImmutable('morsel_policy.welcome_bonus'), false);
});

test('isImmutable("unknown.field") → true (safe default)', () => {
  assert.equal(isImmutable('unknown.field.that.doesnt.exist'), true);
});

console.log('\n── Serialization ──');

test('parseConfigValue("number", "100") → 100', () => {
  const field = CONFIG_FIELDS.find(f => f.type === 'number')!;
  assert.equal(parseConfigValue(field, '100'), 100);
});

test('parseConfigValue("boolean", "true") → true', () => {
  const field = CONFIG_FIELDS.find(f => f.type === 'boolean')!;
  assert.equal(parseConfigValue(field, 'true'), true);
});

test('parseConfigValue("boolean", "false") → false', () => {
  const field = CONFIG_FIELDS.find(f => f.type === 'boolean')!;
  assert.equal(parseConfigValue(field, 'false'), false);
});

test('parseConfigValue("float", "0.10") → 0.10', () => {
  const field = CONFIG_FIELDS.find(f => f.type === 'float')!;
  assert.equal(parseConfigValue(field, '0.10'), 0.1);
});

test('parseConfigValue("string", "hello") → "hello"', () => {
  const field = CONFIG_FIELDS.find(f => f.type === 'string')!;
  assert.equal(parseConfigValue(field, 'hello'), 'hello');
});

test('serializeConfigValue(100) → "100"', () => {
  assert.equal(serializeConfigValue(100), '100');
});

test('serializeConfigValue(true) → "true"', () => {
  assert.equal(serializeConfigValue(true), 'true');
});

test('serializeConfigValue(false) → "false"', () => {
  assert.equal(serializeConfigValue(false), 'false');
});

test('serializeConfigValue("hello") → "hello"', () => {
  assert.equal(serializeConfigValue('hello'), 'hello');
});

// ── Config Loader Tests ──

console.log('\n── Config Loader ──');

import { loadFileSource, flattenToStrings } from '../src/services/config-loader.js';

test('flattenToStrings from flat object', () => {
  const result = flattenToStrings({ foo: 'bar', count: 42 });
  assert.equal(result['foo'], 'bar');
  assert.equal(result['count'], '42');
});

test('flattenToStrings from nested object', () => {
  const result = flattenToStrings({ node: { id: 'test-001', port: 8080 } });
  assert.equal(result['node.id'], 'test-001');
  assert.equal(result['node.port'], '8080');
});

test('loadFileSource with JSON file', () => {
  const tmpFile = join(tmpdir(), `test-config-${Date.now()}.json`);
  writeFileSync(tmpFile, JSON.stringify({ node: { id: 'json-test', port: 9999 } }));
  try {
    const result = loadFileSource(tmpFile);
    assert.ok(result, 'Should load file');
    assert.equal(result!.values['node.id'], 'json-test');
    assert.equal(result!.values['node.port'], '9999');
  } finally {
    unlinkSync(tmpFile);
  }
});

test('loadFileSource with INI file', () => {
  const tmpFile = join(tmpdir(), `test-config-${Date.now()}.ini`);
  writeFileSync(tmpFile, '[node]\nid = ini-test\nport = 7777\n');
  try {
    const result = loadFileSource(tmpFile);
    assert.ok(result, 'Should load file');
    assert.equal(result!.values['node.id'], 'ini-test');
    assert.equal(result!.values['node.port'], '7777');
  } finally {
    unlinkSync(tmpFile);
  }
});

test('loadFileSource returns null for missing file', () => {
  const result = loadFileSource('/tmp/nonexistent-config-file-12345.json');
  assert.equal(result, null);
});

// ── Config Provenance Tests ──

console.log('\n── Config Provenance ──');

import { ConfigProvenance } from '../src/services/config-provenance.js';

test('initDefaults sets all to "default"', () => {
  const prov = new ConfigProvenance();
  prov.initDefaults(['a', 'b', 'c']);
  assert.equal(prov.getSource('a'), 'default');
  assert.equal(prov.getSource('b'), 'default');
  assert.equal(prov.getSource('c'), 'default');
});

test('markEnv overwrites to "env"', () => {
  const prov = new ConfigProvenance();
  prov.initDefaults(['a', 'b']);
  prov.markEnv(['a']);
  assert.equal(prov.getSource('a'), 'env');
  assert.equal(prov.getSource('b'), 'default');
});

test('markFile overwrites to "file"', () => {
  const prov = new ConfigProvenance();
  prov.initDefaults(['a', 'b']);
  prov.markFile(['a']);
  assert.equal(prov.getSource('a'), 'file');
  assert.equal(prov.getSource('b'), 'default');
});

test('markConsul overwrites to "consul"', () => {
  const prov = new ConfigProvenance();
  prov.initDefaults(['a', 'b']);
  prov.markConsul(['a']);
  assert.equal(prov.getSource('a'), 'consul');
});

test('markDatabase overwrites to "database"', () => {
  const prov = new ConfigProvenance();
  prov.initDefaults(['a', 'b']);
  prov.markDatabase(['a']);
  assert.equal(prov.getSource('a'), 'database');
});

test('revertSource falls back to env when env exists', () => {
  const prov = new ConfigProvenance();
  prov.initDefaults(['a']);
  prov.markDatabase(['a']);
  assert.equal(prov.getSource('a'), 'database');
  prov.revertSource('a', true, false, false);
  assert.equal(prov.getSource('a'), 'env');
});

test('revertSource falls back to file when file exists', () => {
  const prov = new ConfigProvenance();
  prov.initDefaults(['a']);
  prov.markDatabase(['a']);
  prov.revertSource('a', false, true, false);
  assert.equal(prov.getSource('a'), 'file');
});

test('revertSource falls back to consul when consul exists', () => {
  const prov = new ConfigProvenance();
  prov.initDefaults(['a']);
  prov.markDatabase(['a']);
  prov.revertSource('a', false, false, true);
  assert.equal(prov.getSource('a'), 'consul');
});

test('revertSource falls back to default when nothing exists', () => {
  const prov = new ConfigProvenance();
  prov.initDefaults(['a']);
  prov.markDatabase(['a']);
  prov.revertSource('a', false, false, false);
  assert.equal(prov.getSource('a'), 'default');
});

test('getAll returns full provenance map', () => {
  const prov = new ConfigProvenance();
  prov.initDefaults(['a', 'b', 'c']);
  prov.markEnv(['a']);
  prov.markDatabase(['b']);
  const all = prov.getAll();
  assert.equal(all['a'], 'env');
  assert.equal(all['b'], 'database');
  assert.equal(all['c'], 'default');
});

// ── Summary ──

// Use setTimeout to wait for any async tests
setTimeout(() => {
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  process.exit(failed > 0 ? 1 : 0);
}, 500);
