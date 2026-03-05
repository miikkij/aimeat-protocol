// Cortex-Core E2E test suite — fixture-driven tests for the extension system
// Run: cd aimeat && pnpm exec tsx test/cortex-e2e.ts
// Requires the AIMEAT server to be running on the configured port (default: 40251)

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

ed.etc.sha512Sync = (...m: Uint8Array[]) =>
  new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body, headers: res.headers };
}

async function rawFetch(path: string, opts: RequestInit = {}) {
  return fetch(`${BASE}${path}`, opts);
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const privKey = Buffer.from(privateKeyB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
  return Buffer.from(sig).toString('base64');
}

// ─── Fixture helpers ───

function loadFixture(filename: string): string {
  return readFileSync(join(__dirname, 'fixtures', 'cortex', filename), 'utf-8');
}

function loadRecipeManifest(): string {
  return loadFixture('recipe-collection.yaml');
}

function loadProjectTrackerManifest(): string {
  return loadFixture('project-tracker.yaml');
}

function loadResearchAssistantManifest(): string {
  return loadFixture('research-assistant.yaml');
}

function loadIotDashboardManifest(): string {
  return loadFixture('iot-dashboard.yaml');
}

function loadLibFile(filename: string): string {
  return loadFixture(filename);
}

// ─── Auth state ───

let ownerToken = '';
let ownerPrivKey = '';
let agentToken = '';
let agentGaii = '';
const ownerName = `cortexowner${Date.now()}`;
const agentName = 'cortexagent';

// Extension names (as they appear in the manifest metadata.name field)
const RECIPE_EXT = 'recipe-collection';
const PROJECT_EXT = 'project-tracker';
const RESEARCH_EXT = 'research-assistant';
const IOT_EXT = 'iot-dashboard';

// URL-encoded extension names
const RECIPE_ENC = encodeURIComponent(RECIPE_EXT);
const PROJECT_ENC = encodeURIComponent(PROJECT_EXT);
const RESEARCH_ENC = encodeURIComponent(RESEARCH_EXT);
const IOT_ENC = encodeURIComponent(IOT_EXT);

console.log('\n=== Cortex-Core E2E Test ===\n');

// ─── Auth Setup ───
console.log('Setup — Auth');

await test('Register owner', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerPrivKey = body.data.private_key;
  assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got owner private key');
});

await test('Owner auth token', async () => {
  const timestamp = new Date().toISOString();
  const message = ownerName + NODE_ID + timestamp;
  const signature = await signMsg(ownerPrivKey, message);
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: ownerName, timestamp, signature }),
  });
  assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
  ownerToken = body.data?.token;
  assert(typeof ownerToken === 'string', 'got owner token');
});

await test('Register agent', async () => {
  const { status, body } = await json('/v1/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      name: agentName,
      owner: ownerName,
      capabilities: ['memory', 'actions'],
      model: 'gpt-4o',
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  agentGaii = body.data.agent.gaii;
  const agentPrivKey = body.data.private_key;
  assert(typeof agentPrivKey === 'string', 'got agent private key');

  // Get agent token
  const ts = new Date().toISOString();
  const msg = agentGaii + ts;
  const sig = await signMsg(agentPrivKey, msg);
  const { body: tokenBody } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: sig }),
  });
  assert(tokenBody.ok === true, `agent token ok: ${JSON.stringify(tokenBody.error)}`);
  agentToken = tokenBody.data?.token;
  assert(typeof agentToken === 'string', 'got agent token');
});

// ─── Phase 1: Manifest Parsing & Validation (6 tests) ───
console.log('\nPhase 1 — Manifest Parsing & Validation');

await test('Valid manifest installs successfully (recipe-collection with libs)', async () => {
  const manifest = loadRecipeManifest();
  const recipeUiContent = loadLibFile('recipe-ui.js');

  const { status, body } = await json('/v1/cortex', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      manifest,
      libs: { 'recipe-ui.js': recipeUiContent },
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
  assert(body.data.name === RECIPE_EXT, `name: ${body.data.name}`);
  assert(body.data.version === '1.0.0', `version: ${body.data.version}`);
  assert(body.data.status === 'inactive', `status: ${body.data.status}`);
  assert(typeof body.data.component_count === 'number' && body.data.component_count > 0,
    `component_count: ${body.data.component_count}`);
});

await test('Invalid YAML returns 400', async () => {
  const { status, body } = await json('/v1/cortex', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ manifest: ':::invalid yaml{{{' }),
  });
  assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === false, 'not ok');
  assert(body.error?.code === 'INVALID_MANIFEST', `code: ${body.error?.code}`);
});

await test('Missing required fields (metadata) returns 400', async () => {
  const manifest = `
apiVersion: cortex.aimeat.org/v1
kind: Extension
spec:
  version: "1.0.0"
  components: []
`;
  const { status, body } = await json('/v1/cortex', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ manifest }),
  });
  assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === false, 'not ok');
  assert(body.error?.code === 'INVALID_MANIFEST', `code: ${body.error?.code}`);
  const errors = body.error?.details?.errors ?? [];
  assert(errors.some((e: string) => e.includes('metadata')), `should mention metadata: ${JSON.stringify(errors)}`);
});

await test('Unknown component type produces warning (not error)', async () => {
  // The parser gives a warning for unknown types, not an error,
  // so the install should succeed if there's at least metadata/spec present
  const manifest = `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: unknown-type-test
  namespace: ${ownerName}
spec:
  version: "1.0.0"
  components:
    - type: alien-widget
      name: foo
`;
  const { status, body } = await json('/v1/cortex', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ manifest }),
  });
  // Should succeed with a warning about the unknown type
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
  const warnings = body.data.warnings ?? [];
  assert(warnings.some((w: string) => w.includes('unknown type')), `should warn: ${JSON.stringify(warnings)}`);

  // Clean up
  await json(`/v1/cortex/${encodeURIComponent('unknown-type-test')}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
});

await test('Duplicate extension name returns 409', async () => {
  const manifest = loadRecipeManifest();
  const { status, body } = await json('/v1/cortex', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ manifest }),
  });
  assert(status === 409, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'CONFLICT', `code: ${body.error?.code}`);
});

await test('Invalid JSON Schema in schema component returns 400', async () => {
  const manifest = `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: bad-schema-test
  namespace: ${ownerName}
spec:
  version: "1.0.0"
  components:
    - type: schema
      name: bad
      key_pattern: "bad:*"
      apply_to: prefix
      schema: "not-an-object"
`;
  const { status, body } = await json('/v1/cortex', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ manifest }),
  });
  assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'INVALID_MANIFEST', `code: ${body.error?.code}`);
  const errors = body.error?.details?.errors ?? [];
  assert(errors.some((e: string) => e.includes('schema')), `should mention schema: ${JSON.stringify(errors)}`);
});

// ─── Phase 2: Full Lifecycle (6 tests) ───
console.log('\nPhase 2 — Full Lifecycle');

await test('List shows installed extension', async () => {
  const { status, body } = await json('/v1/cortex', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}`);
  assert(body.ok === true, 'ok');
  const exts = body.data.extensions;
  assert(Array.isArray(exts), 'extensions is array');
  const recipe = exts.find((e: any) => e.name === RECIPE_EXT);
  assert(recipe, `found ${RECIPE_EXT}`);
  assert(recipe.status === 'inactive', `status: ${recipe.status}`);
  assert(recipe.namespace === 'test', `namespace: ${recipe.namespace}`);
});

await test('Activate extension → status: active', async () => {
  const { status, body } = await json(`/v1/cortex/${RECIPE_ENC}/activate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
  assert(body.data.status === 'active', `status: ${body.data.status}`);
  assert(body.data.name === RECIPE_EXT, `name: ${body.data.name}`);
  assert(typeof body.data.activated_at === 'string', 'has activated_at');
});

await test('Activate already-active is idempotent', async () => {
  const { status, body } = await json(`/v1/cortex/${RECIPE_ENC}/activate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');
  assert(body.data.status === 'active', `status: ${body.data.status}`);
  assert(body.data.message === 'Extension is already active', `message: ${body.data.message}`);
});

await test('Deactivate → status: inactive', async () => {
  const { status, body } = await json(`/v1/cortex/${RECIPE_ENC}/deactivate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');
  assert(body.data.status === 'inactive', `status: ${body.data.status}`);
});

await test('Deactivate already-inactive is idempotent', async () => {
  const { status, body } = await json(`/v1/cortex/${RECIPE_ENC}/deactivate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');
  assert(body.data.status === 'inactive', `status: ${body.data.status}`);
  assert(body.data.message === 'Extension is already inactive', `message: ${body.data.message}`);
});

await test('Re-activate for subsequent tests', async () => {
  const { status, body } = await json(`/v1/cortex/${RECIPE_ENC}/activate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.status === 'active', `status: ${body.data.status}`);
});

// ─── Phase 3: Schema Component (5 tests) ───
console.log('\nPhase 3 — Schema Component');

await test('Conforming memory write succeeds (recipe matches schema)', async () => {
  const recipe = {
    title: 'Test Pasta',
    ingredients: [{ name: 'pasta', amount: '200g' }],
    instructions: [{ step: 1, text: 'Cook the pasta' }],
  };
  const { status, body } = await json('/v1/memory', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      key: 'recipe:test-pasta',
      value: recipe,
      visibility: 'public',
    }),
  });
  assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
});

await test('Violating memory write returns 422 (missing required fields)', async () => {
  const badRecipe = {
    title: 'Incomplete Recipe',
    // missing required: ingredients, instructions
  };
  const { status, body } = await json('/v1/memory', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      key: 'recipe:bad-recipe',
      value: badRecipe,
      visibility: 'public',
    }),
  });
  assert(status === 422, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'SCHEMA_VALIDATION_FAILED', `code: ${body.error?.code}`);
  assert(Array.isArray(body.error?.details?.violations), 'has violations array');
});

await test('Seed data was written on activation', async () => {
  // The recipe-collection manifest has 3 seed data entries
  const { status, body } = await json(`/v1/memory/${encodeURIComponent('recipe:spaghetti-aglio-olio')}`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');
  assert(body.data.value.title === 'Spaghetti Aglio e Olio', `title: ${body.data.value.title}`);
  assert(body.data.value.cuisine === 'italian', `cuisine: ${body.data.value.cuisine}`);
});

await test('After deactivation, violating write succeeds (schema removed)', async () => {
  // Deactivate to remove schema
  await json(`/v1/cortex/${RECIPE_ENC}/deactivate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });

  // Now write a non-conforming recipe — should succeed because no schema is active
  const badRecipe = { title: 'No ingredients recipe' };
  const { status, body } = await json('/v1/memory', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      key: 'recipe:schema-free',
      value: badRecipe,
      visibility: 'public',
    }),
  });
  assert(status === 201 || status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);

  // Clean up
  await json(`/v1/memory/${encodeURIComponent('recipe:schema-free')}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${agentToken}` },
  });
});

await test('Existing data survives deactivation', async () => {
  // Seed data should still be there even after deactivation
  const { status, body } = await json(`/v1/memory/${encodeURIComponent('recipe:spaghetti-aglio-olio')}`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');
  assert(body.data.value.title === 'Spaghetti Aglio e Olio', `title: ${body.data.value.title}`);

  // Re-activate for next phases
  await json(`/v1/cortex/${RECIPE_ENC}/activate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
});

// ─── Phase 4: Prompt Component (3 tests) ───
console.log('\nPhase 4 — Prompt Component');

await test('List prompts endpoint works', async () => {
  const { status, body } = await json(`/v1/cortex/${RECIPE_ENC}/prompts`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');
  assert(body.data.extension === RECIPE_EXT, `extension: ${body.data.extension}`);
  assert(Array.isArray(body.data.prompts), 'prompts is array');
  assert(body.data.total >= 1, `total: ${body.data.total}`);

  const prompt = body.data.prompts.find((p: any) => p.name === 'recipe-assistant');
  assert(prompt, 'found recipe-assistant prompt');
  assert(Array.isArray(prompt.variables), 'has variables');
  assert(typeof prompt.content_length === 'number' && prompt.content_length > 0, `content_length: ${prompt.content_length}`);
});

await test('Get specific prompt with variable substitution', async () => {
  const { status, body } = await json(`/v1/cortex/${RECIPE_ENC}/prompts/recipe-assistant`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');
  assert(body.data.prompt_name === 'recipe-assistant', `prompt_name: ${body.data.prompt_name}`);
  assert(typeof body.data.content === 'string', 'has content');
  // {{node_url}} should be replaced with the actual base URL
  assert(!body.data.content.includes('{{node_url}}'), 'node_url variable was substituted');
  assert(body.data.content.includes('recipe assistant'), 'content has expected text');
});

await test('Get non-existent prompt returns 404', async () => {
  const { status, body } = await json(`/v1/cortex/${RECIPE_ENC}/prompts/nonexistent`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 404, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'NOT_FOUND', `code: ${body.error?.code}`);
});

// ─── Phase 5: Action Component (1 test) ───
console.log('\nPhase 5 — Action Component');

await test('Active action appears in action catalogue', async () => {
  const { status, body } = await json('/v1/actions');
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');

  const actions = body.data.actions;
  assert(Array.isArray(actions), 'actions is array');

  // Cortex actions are prefixed with cortex-{ext.name}-{comp.name}
  const searchAction = actions.find((a: any) => a.id === `cortex-${RECIPE_EXT}-search-recipes`);
  assert(searchAction, `found search-recipes action: ${JSON.stringify(actions.map((a: any) => a.id))}`);
  assert(searchAction.description.includes('Search recipes'), `description: ${searchAction.description}`);

  const addAction = actions.find((a: any) => a.id === `cortex-${RECIPE_EXT}-add-recipe`);
  assert(addAction, `found add-recipe action`);
});

// ─── Phase 6: Board Template Component (1 test) ───
console.log('\nPhase 6 — Board Template Component');

await test('Activation created board', async () => {
  const { status, body } = await json('/v1/boards');
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');

  const boards = body.data.boards;
  assert(Array.isArray(boards), 'boards is array');

  // Board ID is: cortex-{ext.name}-{comp.name}
  const board = boards.find((b: any) => b.id === `cortex-${RECIPE_EXT}-recipe-reviews`);
  assert(board, `found recipe-reviews board: ${JSON.stringify(boards.map((b: any) => b.id))}`);
  assert(board.name === 'Recipe Reviews & Discussions', `name: ${board.name}`);
  assert(board.visibility === 'public', `visibility: ${board.visibility}`);
});

// ─── Phase 7: Ontology Component (2 tests) ───
console.log('\nPhase 7 — Ontology Component');

await test('Get ontology returns concepts with multi-language labels', async () => {
  const { status, body } = await json(`/v1/cortex/${RECIPE_ENC}/ontology`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');
  assert(body.data.extension === RECIPE_EXT, `extension: ${body.data.extension}`);
  assert(Array.isArray(body.data.ontologies), 'ontologies is array');
  assert(body.data.total >= 1, `total: ${body.data.total}`);

  const ontology = body.data.ontologies.find((o: any) => o.name === 'culinary-taxonomy');
  assert(ontology, 'found culinary-taxonomy');
  assert(typeof ontology.concepts === 'object', 'has concepts');
  assert(ontology.concepts.cuisine, 'has cuisine concept');
  assert(ontology.concepts.cuisine.label.en === 'Cuisine', `en label: ${ontology.concepts.cuisine.label.en}`);
  assert(ontology.concepts.cuisine.label.fi === 'Keittiö', `fi label: ${ontology.concepts.cuisine.label.fi}`);
  assert(Array.isArray(ontology.concepts.cuisine.values), 'cuisine has values');
});

await test('Extension without ontology returns empty array', async () => {
  // Install project-tracker (has no ontology component)
  const manifest = loadProjectTrackerManifest();
  await json('/v1/cortex', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ manifest }),
  });
  await json(`/v1/cortex/${PROJECT_ENC}/activate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });

  const { status, body } = await json(`/v1/cortex/${PROJECT_ENC}/ontology`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');
  assert(body.data.total === 0, `total: ${body.data.total}`);
  assert(Array.isArray(body.data.ontologies) && body.data.ontologies.length === 0, 'empty ontologies');
});

// ─── Phase 8: Lib Component (3 tests) ───
console.log('\nPhase 8 — Lib Component');

await test('Lib file is served with correct Content-Type', async () => {
  const res = await rawFetch(`${BASE}/v1/cortex/${RECIPE_ENC}/libs/recipe-ui.js`);
  assert(res.status === 200, `status ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  assert(ct.includes('application/javascript'), `content-type: ${ct}`);
  const text = await res.text();
  assert(text.includes('RecipeCard'), 'contains RecipeCard export');
});

await test('Lib has cache headers', async () => {
  const res = await rawFetch(`${BASE}/v1/cortex/${RECIPE_ENC}/libs/recipe-ui.js`);
  assert(res.status === 200, `status ${res.status}`);
  const cache = res.headers.get('cache-control') ?? '';
  assert(cache.includes('public'), `cache-control: ${cache}`);
  assert(cache.includes('max-age=86400'), `max-age in cache-control: ${cache}`);
});

await test('Non-existent lib returns 404', async () => {
  const res = await rawFetch(`${BASE}/v1/cortex/${RECIPE_ENC}/libs/nonexistent.js`);
  assert(res.status === 404, `status ${res.status}`);
});

// ─── Phase 9: Multi-Extension Coexistence (3 tests) ───
console.log('\nPhase 9 — Multi-Extension Coexistence');

await test('Install research-assistant', async () => {
  const manifest = loadResearchAssistantManifest();
  const { status, body } = await json('/v1/cortex', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ manifest }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.name === RESEARCH_EXT, `name: ${body.data.name}`);
});

await test('Install iot-dashboard with libs', async () => {
  const manifest = loadIotDashboardManifest();
  const iotUiContent = loadLibFile('iot-sensor-ui.js');

  const { status, body } = await json('/v1/cortex', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      manifest,
      libs: { 'iot-sensor-ui.js': iotUiContent },
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.name === IOT_EXT, `name: ${body.data.name}`);
});

await test('List shows all installed extensions', async () => {
  const { status, body } = await json('/v1/cortex', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}`);
  const names = body.data.extensions.map((e: any) => e.name);
  assert(names.includes(RECIPE_EXT), `has ${RECIPE_EXT}`);
  assert(names.includes(PROJECT_EXT), `has ${PROJECT_EXT}`);
  assert(names.includes(RESEARCH_EXT), `has ${RESEARCH_EXT}`);
  assert(names.includes(IOT_EXT), `has ${IOT_EXT}`);
  assert(body.data.total >= 4, `total: ${body.data.total}`);
});

// ─── Phase 10: Uninstall & Cleanup (5 tests) ───
console.log('\nPhase 10 — Uninstall & Cleanup');

await test('Uninstall removes extension', async () => {
  // research-assistant is inactive, uninstall should work
  const { status, body } = await json(`/v1/cortex/${RESEARCH_ENC}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'ok');
  assert(body.data.uninstalled === true, 'uninstalled');
  assert(body.data.name === RESEARCH_EXT, `name: ${body.data.name}`);

  // Verify it's gone from the list
  const { body: listBody } = await json('/v1/cortex', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  const names = listBody.data.extensions.map((e: any) => e.name);
  assert(!names.includes(RESEARCH_EXT), `${RESEARCH_EXT} removed from list`);
});

await test('Uninstall active extension deactivates first', async () => {
  // recipe-collection is active, uninstall should deactivate then remove
  const { status, body } = await json(`/v1/cortex/${RECIPE_ENC}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.uninstalled === true, 'uninstalled');
});

await test('Seed data removed after uninstall', async () => {
  // The seed data keys should be gone after uninstall
  const { status } = await json(`/v1/memory/${encodeURIComponent('recipe:spaghetti-aglio-olio')}`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(status === 404, `seed data should be gone, status ${status}`);
});

await test('Re-install after uninstall works', async () => {
  const manifest = loadRecipeManifest();
  const recipeUiContent = loadLibFile('recipe-ui.js');

  const { status, body } = await json('/v1/cortex', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      manifest,
      libs: { 'recipe-ui.js': recipeUiContent },
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.name === RECIPE_EXT, `name: ${body.data.name}`);
  assert(body.data.status === 'inactive', `status: ${body.data.status}`);
});

await test('Activate non-existent returns 404', async () => {
  const { status, body } = await json(`/v1/cortex/${encodeURIComponent('nonexistent-ext')}/activate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 404, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'NOT_FOUND', `code: ${body.error?.code}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

// Remove all test extensions
for (const name of [RECIPE_EXT, PROJECT_EXT, IOT_EXT]) {
  await json(`/v1/cortex/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
}

// Delete test agent memory entries
for (const key of ['recipe:test-pasta']) {
  await json(`/v1/memory/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${agentToken}` },
  });
}

// Delete owner (cascade deletes agents)
await json(`/v1/owners/${ownerName}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${ownerToken}` },
});

// ─── Summary ───
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
