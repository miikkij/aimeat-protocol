/**
 * Consul config service tests (no live Consul required — tests pure logic).
 * Run with: npx tsx test/consul-config.test.ts
 */

import assert from 'node:assert/strict';
import { createConsulConfigService, applyConsulValues } from '../src/services/consul-config.js';
import type { AimeatConfig } from '../src/config.js';

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

// Mock config factory
function mockConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
  return {
    nodeId: 'test-node',
    port: 40050,
    nodeType: 'full',
    storageProvider: 'memory',
    sqlitePath: ':memory:',
    dbUrl: null,
    adminPassword: 'test123',
    baseUrl: '',
    devMode: true,
    anonymousMode: false,
    jwtTtlSeconds: 3600,
    welcomeBonus: 100,
    dailyAllowance: 50,
    dailyAllowanceCap: 500,
    burnRate: 0.1,
    keyedBrowseEnabled: true,
    extendedFeaturesEnabled: true,
    consulEnabled: false,
    consulUrl: 'http://localhost:8500',
    consulPrefix: 'aimeat/config',
    consulToken: '',
    consulWatchIntervalSeconds: 30,
    consulDatacenter: '',
    ...overrides,
  } as AimeatConfig;
}

console.log('\n── Consul Config Service ──');

test('createConsulConfigService returns null when disabled', () => {
  const config = mockConfig({ consulEnabled: false });
  const service = createConsulConfigService(config);
  assert.equal(service, null);
});

test('createConsulConfigService returns service when enabled', () => {
  const config = mockConfig({ consulEnabled: true, consulUrl: 'http://localhost:8500' });
  const service = createConsulConfigService(config);
  assert.ok(service !== null, 'Service should be created');
  assert.ok(typeof service!.loadAll === 'function', 'has loadAll');
  assert.ok(typeof service!.startWatching === 'function', 'has startWatching');
  assert.ok(typeof service!.stopWatching === 'function', 'has stopWatching');
  assert.ok(typeof service!.set === 'function', 'has set');
  assert.ok(typeof service!.health === 'function', 'has health');
});

console.log('\n── applyConsulValues ──');

test('applyConsulValues applies mutable fields', () => {
  const config = mockConfig({ welcomeBonus: 100 });
  const { applied, skipped } = applyConsulValues(config, {
    'morsel_policy.welcome_bonus': '200',
  });
  assert.deepEqual(applied, ['morsel_policy.welcome_bonus']);
  assert.deepEqual(skipped, []);
  assert.equal(config.welcomeBonus, 200);
});

test('applyConsulValues skips immutable fields', () => {
  const config = mockConfig();
  const { applied, skipped } = applyConsulValues(config, {
    'node.id': 'hacked',
  });
  // node.id is immutable — it should NOT be in MUTABLE_CONFIG_MAP,
  // so it will be skipped (no matching field)
  assert.deepEqual(applied, []);
  assert.deepEqual(skipped, ['node.id']);
  assert.equal(config.nodeId, 'test-node'); // unchanged
});

test('applyConsulValues skips unknown fields', () => {
  const config = mockConfig();
  const { applied, skipped } = applyConsulValues(config, {
    'unknown.field': 'value',
  });
  assert.deepEqual(applied, []);
  assert.deepEqual(skipped, ['unknown.field']);
});

test('applyConsulValues applies multiple fields', () => {
  const config = mockConfig({ welcomeBonus: 100, dailyAllowance: 50, burnRate: 0.1 });
  const { applied } = applyConsulValues(config, {
    'morsel_policy.welcome_bonus': '300',
    'morsel_policy.daily_allowance': '75',
    'morsel_policy.burn_rate': '0.25',
  });
  assert.equal(applied.length, 3);
  assert.equal(config.welcomeBonus, 300);
  assert.equal(config.dailyAllowance, 75);
  assert.equal(config.burnRate, 0.25);
});

test('applyConsulValues skips invalid values', () => {
  const config = mockConfig({ welcomeBonus: 100 });
  const { applied, skipped } = applyConsulValues(config, {
    'morsel_policy.welcome_bonus': 'not-a-number',
  });
  // parseConfigValue should throw for 'not-a-number' on a number field
  assert.deepEqual(applied, []);
  assert.deepEqual(skipped, ['morsel_policy.welcome_bonus']);
  assert.equal(config.welcomeBonus, 100); // unchanged
});

test('applyConsulValues handles boolean fields', () => {
  const config = mockConfig({ keyedBrowseEnabled: true });
  const { applied } = applyConsulValues(config, {
    'features.keyed_browse_enabled': 'false',
  });
  assert.deepEqual(applied, ['features.keyed_browse_enabled']);
  assert.equal(config.keyedBrowseEnabled, false);
});

test('applyConsulValues type-parses float correctly', () => {
  const config = mockConfig({ burnRate: 0.1 });
  const { applied } = applyConsulValues(config, {
    'morsel_policy.burn_rate': '0.50',
  });
  assert.deepEqual(applied, ['morsel_policy.burn_rate']);
  assert.equal(config.burnRate, 0.5);
});

// ── Summary ──
setTimeout(() => {
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  process.exit(failed > 0 ? 1 : 0);
}, 500);
