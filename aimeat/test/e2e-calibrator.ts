/**
 * @file e2e-calibrator.ts
 * @description E2E tests for the Prompt Calibrator API.
 * @version-history
 *   v1.0.0 — 2026-03-29 — Initial tests
 */

const BASE = process.env.TEST_BASE_URL || 'http://localhost:40251';

const username = `caltest${Date.now()}`;
const password = 'CalTest123!';
let jwt = '';
let projectId = '';
let runId = '';

async function api(path: string, opts: RequestInit = {}) {
  const resp = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await resp.json() as any;
  data._status = resp.status;
  return data;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    console.error(`  ✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log(`\n=== Calibrator API E2E Tests ===\n`);
console.log(`Server: ${BASE}`);
console.log(`Username: ${username}\n`);

// ── Setup: Register + Login ──

await test('Register test user with password', async () => {
  const data = await api('/v1/ghii', {
    method: 'POST',
    body: JSON.stringify({ username, display_name: 'Cal Test', password }),
  });
  assert(data.ok === true, `Registration failed: ${data.error?.message}`);
});

await test('Login with password', async () => {
  const data = await api('/v1/ghii/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  assert(data.ok === true, `Login failed: ${data.error?.message}`);
  jwt = data.data.token;
  assert(typeof jwt === 'string' && jwt.length > 0, 'missing JWT');
});

// ── Project CRUD ──

await test('Create a calibration project', async () => {
  const data = await api('/v1/calibrator', {
    method: 'POST',
    body: JSON.stringify({ name: 'Test Calibration' }),
  });
  assert(data.ok === true, `Create failed: ${data.error?.message}`);
  assert(data._status === 201, `expected 201, got ${data._status}`);
  assert(typeof data.data.project.projectId === 'string', 'missing projectId');
  assert(data.data.project.name === 'Test Calibration', 'name mismatch');
  assert(data.data.project.currentVersion === 0, 'version should be 0');
  assert(typeof data.data.project.analysisPromptTemplate === 'string', 'missing template');
  projectId = data.data.project.projectId;
});

await test('List calibration projects', async () => {
  const data = await api('/v1/calibrator');
  assert(data.ok === true, `List failed: ${data.error?.message}`);
  assert(data.data.projects.length >= 1, 'should have at least 1 project');
  assert(data.data.projects.some((p: any) => p.projectId === projectId), 'should find our project');
});

await test('Get calibration project', async () => {
  const data = await api(`/v1/calibrator/${projectId}`);
  assert(data.ok === true, `Get failed: ${data.error?.message}`);
  assert(data.data.project.name === 'Test Calibration', 'name mismatch');
  assert(Array.isArray(data.data.dimensions), 'should have dimensions array');
  assert(data.data.dimensions.length === 0, 'should start with no dimensions');
});

await test('Update calibration project', async () => {
  const data = await api(`/v1/calibrator/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Updated Calibration',
      candidateModels: [{ id: 'llm-1', label: 'Test Model', provider: 'openrouter', modelId: 'test/model', apiKeyRef: 'shared' }],
    }),
  });
  assert(data.ok === true, `Update failed: ${data.error?.message}`);
  assert(data.data.project.name === 'Updated Calibration', 'name should be updated');
  assert(data.data.project.candidateModels.length === 1, 'should have 1 model');
});

// ── Versions ──

await test('Create version 1', async () => {
  const data = await api(`/v1/calibrator/${projectId}/versions`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Generate a blueprint for {description}',
      targetOutput: '{"architecture": "cortex-modular"}',
      changelog: 'Initial version',
    }),
  });
  assert(data.ok === true, `Create failed: ${data.error?.message}`);
  assert(data._status === 201, `expected 201, got ${data._status}`);
  assert(data.data.version.version === 1, 'version should be 1');
  assert(data.data.version.changelog === 'Initial version', 'changelog mismatch');
});

await test('Create version 2', async () => {
  const data = await api(`/v1/calibrator/${projectId}/versions`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Generate a blueprint for {description}. Include 6 features.',
      targetOutput: '{"architecture": "cortex-modular"}',
      changelog: 'Added feature count rule',
    }),
  });
  assert(data.ok === true, `Create failed: ${data.error?.message}`);
  assert(data.data.version.version === 2, 'version should be 2');
});

await test('List versions', async () => {
  const data = await api(`/v1/calibrator/${projectId}/versions`);
  assert(data.ok === true, `List failed: ${data.error?.message}`);
  assert(data.data.versions.length === 2, 'should have 2 versions');
  assert(data.data.versions[0].version === 1, 'first version should be 1');
  assert(data.data.versions[1].version === 2, 'second version should be 2');
});

await test('Get specific version', async () => {
  const data = await api(`/v1/calibrator/${projectId}/versions/1`);
  assert(data.ok === true, `Get failed: ${data.error?.message}`);
  assert(data.data.version.prompt === 'Generate a blueprint for {description}', 'prompt mismatch');
  assert(data.data.version.targetOutput === '{"architecture": "cortex-modular"}', 'target mismatch');
});

// ── Runs ──

await test('Create a run', async () => {
  const data = await api(`/v1/calibrator/${projectId}/runs`, {
    method: 'POST',
    body: JSON.stringify({
      promptVersion: 1,
      candidateModelId: 'llm-1',
      candidateModelLabel: 'Test Model',
      output: '{"architecture": "cortex-modular", "components": []}',
      durationMs: 5000,
    }),
  });
  assert(data.ok === true, `Create failed: ${data.error?.message}`);
  assert(data._status === 201, `expected 201, got ${data._status}`);
  assert(typeof data.data.run.runId === 'string', 'missing runId');
  assert(data.data.run.promptVersion === 1, 'version mismatch');
  assert(data.data.run.overallScore === null, 'score should be null before analysis');
  runId = data.data.run.runId;
});

await test('Update run with analysis', async () => {
  const data = await api(`/v1/calibrator/${projectId}/runs/${runId}`, {
    method: 'PUT',
    body: JSON.stringify({
      dimensions: [
        { name: 'feature_count', description: 'Feature count', category: 'structure', severity: 'critical', expected: '6', actual: '0', pass: false },
        { name: 'valid_json', description: 'Valid JSON output', category: 'format', severity: 'critical', expected: 'true', actual: 'true', pass: true },
      ],
      overallScore: 50,
      analysis: 'Model produced valid JSON but no features.',
      proposals: ['Add explicit feature count instruction.'],
    }),
  });
  assert(data.ok === true, `Update failed: ${data.error?.message}`);
  assert(data.data.run.overallScore === 50, 'score should be 50');
  assert(data.data.run.dimensions.length === 2, 'should have 2 dimensions');
  assert(data.data.run.proposals.length === 1, 'should have 1 proposal');
});

await test('Dimensions auto-discovered in project', async () => {
  const data = await api(`/v1/calibrator/${projectId}`);
  assert(data.ok === true, `Get failed: ${data.error?.message}`);
  assert(data.data.dimensions.length === 2, `should have 2 discovered dimensions, got ${data.data.dimensions.length}`);
  assert(data.data.dimensions.some((d: any) => d.name === 'feature_count'), 'should have feature_count dim');
  assert(data.data.dimensions.some((d: any) => d.name === 'valid_json'), 'should have valid_json dim');
});

await test('List runs with version filter', async () => {
  const all = await api(`/v1/calibrator/${projectId}/runs`);
  assert(all.ok === true, `List failed: ${all.error?.message}`);
  assert(all.data.runs.length === 1, 'should have 1 run');

  const filtered = await api(`/v1/calibrator/${projectId}/runs?version=2`);
  assert(filtered.ok === true, `Filtered list failed: ${filtered.error?.message}`);
  assert(filtered.data.runs.length === 0, 'should have 0 runs for v2');
});

await test('Get run detail', async () => {
  const data = await api(`/v1/calibrator/${projectId}/runs/${runId}`);
  assert(data.ok === true, `Get failed: ${data.error?.message}`);
  assert(typeof data.data.run.output === 'string', 'should have output');
  assert(typeof data.data.run.analysis === 'string', 'should have analysis');
  assert(data.data.run.proposals.length === 1, 'should have proposals');
});

// ── Runs list summary excludes full output ──

await test('List runs returns summary without full output', async () => {
  const data = await api(`/v1/calibrator/${projectId}/runs`);
  assert(data.ok === true, `List failed: ${data.error?.message}`);
  const run = data.data.runs[0];
  assert(run.overallScore === 50, 'should have score in summary');
  assert(run.dimensions.length === 2, 'should have dimensions in summary');
  // The list endpoint returns summaries — output field is omitted
  assert(!('output' in run), 'list should not include full output');
});

// ── Cleanup ──

await test('Delete calibration project (cascade)', async () => {
  const data = await api(`/v1/calibrator/${projectId}`, { method: 'DELETE' });
  assert(data.ok === true, `Delete failed: ${data.error?.message}`);
  assert(data.data.deleted >= 4, `should delete at least 4 records (project + 2 versions + 1 run + dims), got ${data.data.deleted}`);

  const get = await api(`/v1/calibrator/${projectId}`);
  assert(get._status === 404, 'should be 404 after delete');
});

// Test user cleanup happens automatically when the in-memory server shuts down.

console.log('\n=== Calibrator API E2E Tests Complete ===\n');
