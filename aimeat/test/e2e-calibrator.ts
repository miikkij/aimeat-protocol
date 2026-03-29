/**
 * @file e2e-calibrator.ts
 * @description E2E tests for the Prompt Calibrator V2 API — batch-based 4-step flow.
 *   Tests cover project CRUD, version management, batch lifecycle with all 4 steps
 *   (Generate, Analyze, Reflect, Synthesize), dimension auto-discovery, listing
 *   with filters, and cascade deletion. NO OpenRouter calls — tests write step
 *   data directly via PUT to verify backend CRUD operations.
 * @version-history
 *   v1.0.0 — 2026-03-29 — Initial tests (V1 runs-based)
 *   v2.0.0 — 2026-03-29 — Rewrite for V2 batch CRUD with 4-step data
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-calibrator.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  \u2705 ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  \u274C ${name}: ${err.message}`);
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

// ─── State ───
const username = `caltest${Date.now()}`;
const password = 'CalTest123!';
let jwt = '';
let projectId = '';
let batchId = '';

// ─── Test data ───
const candidateModels = [
  { id: 'llm-1', label: 'Test Model', provider: 'openrouter', modelId: 'test/model', apiKeyRef: 'shared' },
];
const reasoningLlm = { id: 'llm-reasoning', label: 'Reasoning Model', provider: 'openrouter', modelId: 'test/reasoning', apiKeyRef: 'shared' };

const version1 = { prompt: 'Generate a blueprint for {description}', targetOutput: '{"architecture": "cortex-modular"}', changelog: 'Initial version' };
const version2 = { prompt: 'Generate a blueprint for {description}. Include 6 features.', targetOutput: '{"architecture": "cortex-modular"}', changelog: 'Added feature count rule' };

const step1Done = {
  status: 'done',
  output: '{"architecture": "cortex-modular", "components": []}',
  durationMs: 5000,
  error: null,
  promptSent: 'Generate a blueprint for {description}',
};

const step2Done = {
  status: 'done',
  dimensions: [
    { name: 'feature_count', description: 'Feature count', category: 'structure', severity: 'critical', expected: '6', actual: '0', pass: false },
    { name: 'valid_json', description: 'Valid JSON output', category: 'format', severity: 'critical', expected: 'true', actual: 'true', pass: true },
  ],
  overallScore: 50,
  analysis: 'Model produced valid JSON but no features.',
  error: null,
  promptSent: 'Analysis prompt text...',
  rawResponse: '{"dimensions":[...],"analysis":"Model produced valid JSON but no features."}',
};

const step3Done = {
  status: 'done',
  judgeProposals: {
    proposals: ['Add explicit feature count instruction after the opening paragraph'],
    reasoning: 'The model lacks a concrete numeric requirement',
    promptSent: 'Judge reflection prompt...',
    rawResponse: '{"proposals":["Add explicit feature count instruction"],"reasoning":"..."}',
  },
  selfProposals: {
    proposals: ['Show a complete example output with 6 features', 'Add a checklist of required fields'],
    reasoning: 'I tend to produce minimal output without examples to follow',
    promptSent: 'Self-reflection prompt...',
    rawResponse: '{"proposals":["Show a complete example output"],"reasoning":"..."}',
  },
  error: null,
};

const step4Done = {
  status: 'done',
  groupedProposals: [
    { proposal: 'Add explicit feature count instruction', sources: ['judge:llm-1', 'self:llm-1'], overlap: true, impact: 'high', risk: 'low', explanation: 'Both agree on this fix' },
    { proposal: 'Show a complete example output', sources: ['self:llm-1'], overlap: false, impact: 'medium', risk: 'low', explanation: 'Examples help guide output' },
  ],
  options: {
    A: { label: 'Conservative', proposalIds: [0], expectedImpact: 'Fix critical feature count gap' },
    B: { label: 'Moderate', proposalIds: [0, 1], expectedImpact: 'Address feature count and add examples' },
  },
  recommendation: 'Start with Option A because the feature count fix addresses the most critical gap',
  analysis: 'The judge and candidate both identified the missing feature count as the root cause.',
  error: null,
  promptSent: 'Synthesis prompt text...',
  rawResponse: '{"groupedProposals":[...],"options":{...},"recommendation":"...","analysis":"..."}',
};

console.log(`\n=== Calibrator V2 API E2E Tests ===\n`);
console.log(`Server: ${BASE}`);
console.log(`Username: ${username}\n`);

// ── 1. Register test user ──

await test('Register test user', async () => {
  const { status, body } = await json('/v1/ghii', {
    method: 'POST',
    body: JSON.stringify({ username, display_name: 'Cal Test', password }),
  });
  assert(body.ok === true, `Registration failed: ${JSON.stringify(body.error)}`);
  assert(status === 201 || status === 200, `expected 2xx, got ${status}`);
});

// ── 2. Login ──

await test('Login and get JWT', async () => {
  const { body } = await json('/v1/ghii/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  assert(body.ok === true, `Login failed: ${JSON.stringify(body.error)}`);
  jwt = body.data.token;
  assert(typeof jwt === 'string' && jwt.length > 0, 'missing JWT');
});

// Auth header helper
const auth = () => ({ Authorization: `Bearer ${jwt}` });

// ── 3. Create project ──

await test('Create calibration project', async () => {
  const { status, body } = await json('/v1/calibrator', {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ name: 'V2 Test Project' }),
  });
  assert(body.ok === true, `Create failed: ${JSON.stringify(body.error)}`);
  assert(status === 201, `expected 201, got ${status}`);
  const p = body.data.project;
  assert(typeof p.projectId === 'string' && p.projectId.length > 0, 'missing projectId');
  assert(p.name === 'V2 Test Project', `name mismatch: ${p.name}`);
  assert(p.currentVersion === 0, `currentVersion should be 0, got ${p.currentVersion}`);
  // Verify all 4 template fields exist and are non-empty strings
  assert(typeof p.analysisPromptTemplate === 'string' && p.analysisPromptTemplate.length > 0, 'missing analysisPromptTemplate');
  assert(typeof p.reflectionPromptTemplate === 'string' && p.reflectionPromptTemplate.length > 0, 'missing reflectionPromptTemplate');
  assert(typeof p.selfReflectionPromptTemplate === 'string' && p.selfReflectionPromptTemplate.length > 0, 'missing selfReflectionPromptTemplate');
  assert(typeof p.synthesisPromptTemplate === 'string' && p.synthesisPromptTemplate.length > 0, 'missing synthesisPromptTemplate');
  projectId = p.projectId;
});

// ── 4. Get template defaults ──

await test('Get template defaults', async () => {
  const { body } = await json('/v1/calibrator/templates', {
    headers: auth(),
  });
  assert(body.ok === true, `Get templates failed: ${JSON.stringify(body.error)}`);
  const d = body.data;
  assert(typeof d.analysisPromptTemplate === 'string' && d.analysisPromptTemplate.length > 0, 'missing analysisPromptTemplate');
  assert(typeof d.reflectionPromptTemplate === 'string' && d.reflectionPromptTemplate.length > 0, 'missing reflectionPromptTemplate');
  assert(typeof d.selfReflectionPromptTemplate === 'string' && d.selfReflectionPromptTemplate.length > 0, 'missing selfReflectionPromptTemplate');
  assert(typeof d.synthesisPromptTemplate === 'string' && d.synthesisPromptTemplate.length > 0, 'missing synthesisPromptTemplate');
});

// ── 5. List projects (empty batches) ──

await test('List projects shows batchCount=0, latestAvgScore=null', async () => {
  const { body } = await json('/v1/calibrator', { headers: auth() });
  assert(body.ok === true, `List failed: ${JSON.stringify(body.error)}`);
  const our = body.data.projects.find((p: any) => p.projectId === projectId);
  assert(our, 'our project should appear in list');
  assert(our.batchCount === 0, `batchCount should be 0, got ${our.batchCount}`);
  assert(our.latestAvgScore === null, `latestAvgScore should be null, got ${our.latestAvgScore}`);
});

// ── 6. Update project ──

await test('Update project with candidateModels and reasoningLlm', async () => {
  const { body } = await json(`/v1/calibrator/${projectId}`, {
    method: 'PUT',
    headers: auth(),
    body: JSON.stringify({ name: 'Updated V2 Project', candidateModels, reasoningLlm }),
  });
  assert(body.ok === true, `Update failed: ${JSON.stringify(body.error)}`);
  const p = body.data.project;
  assert(p.name === 'Updated V2 Project', `name not updated: ${p.name}`);
  assert(Array.isArray(p.candidateModels) && p.candidateModels.length === 1, 'should have 1 candidate model');
  assert(p.candidateModels[0].id === 'llm-1', 'model id mismatch');
  assert(p.reasoningLlm.id === 'llm-reasoning', 'reasoning LLM mismatch');
});

// ── 7. Create version 1 ──

await test('Create version 1', async () => {
  const { status, body } = await json(`/v1/calibrator/${projectId}/versions`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify(version1),
  });
  assert(body.ok === true, `Create failed: ${JSON.stringify(body.error)}`);
  assert(status === 201, `expected 201, got ${status}`);
  assert(body.data.version.version === 1, `version should be 1, got ${body.data.version.version}`);
  assert(body.data.version.changelog === 'Initial version', 'changelog mismatch');
});

// ── 8. Create version 2 ──

await test('Create version 2', async () => {
  const { status, body } = await json(`/v1/calibrator/${projectId}/versions`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify(version2),
  });
  assert(body.ok === true, `Create failed: ${JSON.stringify(body.error)}`);
  assert(status === 201, `expected 201, got ${status}`);
  assert(body.data.version.version === 2, `version should be 2, got ${body.data.version.version}`);
  assert(body.data.version.changelog === 'Added feature count rule', 'changelog mismatch');
});

// ── 9. Create batch ──

await test('Create batch for version 1', async () => {
  const { status, body } = await json(`/v1/calibrator/${projectId}/batches`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ promptVersion: 1 }),
  });
  assert(body.ok === true, `Create batch failed: ${JSON.stringify(body.error)}`);
  assert(status === 201, `expected 201, got ${status}`);
  const b = body.data.batch;
  assert(typeof b.batchId === 'string' && b.batchId.length > 0, 'missing batchId');
  assert(b.status === 'created', `status should be "created", got "${b.status}"`);
  assert(Array.isArray(b.models) && b.models.length === 1, `should have 1 model, got ${b.models?.length}`);
  assert(b.models[0].modelId === 'llm-1', `modelId mismatch: ${b.models[0].modelId}`);
  assert(b.models[0].modelLabel === 'Test Model', `modelLabel mismatch: ${b.models[0].modelLabel}`);
  batchId = b.batchId;
});

// ── 10. Verify batch pending structure ──

await test('Batch has correct pending structure for all 4 steps', async () => {
  const { body } = await json(`/v1/calibrator/${projectId}/batches/${batchId}`, { headers: auth() });
  assert(body.ok === true, `Get batch failed: ${JSON.stringify(body.error)}`);
  const b = body.data.batch;
  const m = b.models[0];
  // Step 1
  assert(m.step1_generation.status === 'pending', `step1 should be pending, got "${m.step1_generation.status}"`);
  assert(m.step1_generation.output === null, 'step1 output should be null');
  // Step 2
  assert(m.step2_analysis.status === 'pending', `step2 should be pending, got "${m.step2_analysis.status}"`);
  assert(m.step2_analysis.overallScore === null, 'step2 overallScore should be null');
  assert(Array.isArray(m.step2_analysis.dimensions) && m.step2_analysis.dimensions.length === 0, 'step2 dimensions should be empty array');
  // Step 3
  assert(m.step3_reflection.status === 'pending', `step3 should be pending, got "${m.step3_reflection.status}"`);
  assert(m.step3_reflection.judgeProposals === null, 'step3 judgeProposals should be null');
  assert(m.step3_reflection.selfProposals === null, 'step3 selfProposals should be null');
  // Step 4 (batch-level)
  assert(b.step4_synthesis.status === 'pending', `step4 should be pending, got "${b.step4_synthesis.status}"`);
  assert(Array.isArray(b.step4_synthesis.groupedProposals) && b.step4_synthesis.groupedProposals.length === 0, 'step4 groupedProposals should be empty array');
  assert(b.step4_synthesis.options === null, 'step4 options should be null');
  assert(b.step4_synthesis.recommendation === null, 'step4 recommendation should be null');
});

// ── 11. Update batch with Step 1 data ──

await test('Update batch with Step 1 (generation) data', async () => {
  const models = [{
    modelId: 'llm-1',
    modelLabel: 'Test Model',
    step1_generation: step1Done,
    step2_analysis: { status: 'pending', dimensions: [], overallScore: null, analysis: null, error: null, promptSent: null, rawResponse: null },
    step3_reflection: { status: 'pending', judgeProposals: null, selfProposals: null, error: null },
  }];
  const { body } = await json(`/v1/calibrator/${projectId}/batches/${batchId}`, {
    method: 'PUT',
    headers: auth(),
    body: JSON.stringify({ models }),
  });
  assert(body.ok === true, `Update failed: ${JSON.stringify(body.error)}`);
  const m = body.data.batch.models[0];
  assert(m.step1_generation.status === 'done', 'step1 should be done');
  assert(m.step1_generation.output === step1Done.output, 'step1 output mismatch');
  assert(m.step1_generation.durationMs === 5000, 'step1 durationMs mismatch');
});

// ── 12. Update batch with Step 2 data ──

await test('Update batch with Step 2 (analysis) data', async () => {
  const models = [{
    modelId: 'llm-1',
    modelLabel: 'Test Model',
    step1_generation: step1Done,
    step2_analysis: step2Done,
    step3_reflection: { status: 'pending', judgeProposals: null, selfProposals: null, error: null },
  }];
  const { body } = await json(`/v1/calibrator/${projectId}/batches/${batchId}`, {
    method: 'PUT',
    headers: auth(),
    body: JSON.stringify({ models }),
  });
  assert(body.ok === true, `Update failed: ${JSON.stringify(body.error)}`);
  const m = body.data.batch.models[0];
  assert(m.step2_analysis.status === 'done', 'step2 should be done');
  assert(m.step2_analysis.overallScore === 50, `overallScore should be 50, got ${m.step2_analysis.overallScore}`);
  assert(m.step2_analysis.dimensions.length === 2, `should have 2 dimensions, got ${m.step2_analysis.dimensions.length}`);
  assert(m.step2_analysis.analysis === 'Model produced valid JSON but no features.', 'analysis text mismatch');
});

// ── 13. Verify dimensions auto-discovered ──

await test('Dimensions auto-discovered in project after Step 2', async () => {
  const { body } = await json(`/v1/calibrator/${projectId}`, { headers: auth() });
  assert(body.ok === true, `Get project failed: ${JSON.stringify(body.error)}`);
  const dims = body.data.dimensions;
  assert(Array.isArray(dims), 'dimensions should be an array');
  assert(dims.length === 2, `should have 2 discovered dimensions, got ${dims.length}`);
  assert(dims.some((d: any) => d.name === 'feature_count'), 'should have feature_count dimension');
  assert(dims.some((d: any) => d.name === 'valid_json'), 'should have valid_json dimension');
  // Check dimension metadata
  const fc = dims.find((d: any) => d.name === 'feature_count');
  assert(fc.category === 'structure', `feature_count category should be "structure", got "${fc.category}"`);
  assert(fc.discoveredInBatch === batchId, 'discoveredInBatch should reference our batch');
});

// ── 14. Update batch with Step 3 data ──

await test('Update batch with Step 3 (reflection) data', async () => {
  const models = [{
    modelId: 'llm-1',
    modelLabel: 'Test Model',
    step1_generation: step1Done,
    step2_analysis: step2Done,
    step3_reflection: step3Done,
  }];
  const { body } = await json(`/v1/calibrator/${projectId}/batches/${batchId}`, {
    method: 'PUT',
    headers: auth(),
    body: JSON.stringify({ models }),
  });
  assert(body.ok === true, `Update failed: ${JSON.stringify(body.error)}`);
  const m = body.data.batch.models[0];
  assert(m.step3_reflection.status === 'done', 'step3 should be done');
  assert(m.step3_reflection.judgeProposals.proposals.length === 1, 'should have 1 judge proposal');
  assert(m.step3_reflection.selfProposals.proposals.length === 2, 'should have 2 self proposals');
  assert(typeof m.step3_reflection.judgeProposals.reasoning === 'string', 'judge reasoning should be string');
  assert(typeof m.step3_reflection.selfProposals.reasoning === 'string', 'self reasoning should be string');
});

// ── 15. Update batch with Step 4 data ──

await test('Update batch with Step 4 (synthesis) data', async () => {
  const { body } = await json(`/v1/calibrator/${projectId}/batches/${batchId}`, {
    method: 'PUT',
    headers: auth(),
    body: JSON.stringify({ step4_synthesis: step4Done }),
  });
  assert(body.ok === true, `Update failed: ${JSON.stringify(body.error)}`);
  const s4 = body.data.batch.step4_synthesis;
  assert(s4.status === 'done', `step4 should be done, got "${s4.status}"`);
  assert(s4.groupedProposals.length === 2, `should have 2 grouped proposals, got ${s4.groupedProposals.length}`);
  assert(s4.groupedProposals[0].overlap === true, 'first proposal should have overlap=true');
  assert(s4.groupedProposals[1].overlap === false, 'second proposal should have overlap=false');
  assert(s4.options.A.label === 'Conservative', 'option A label mismatch');
  assert(s4.options.B.label === 'Moderate', 'option B label mismatch');
  assert(typeof s4.recommendation === 'string' && s4.recommendation.length > 0, 'recommendation should be non-empty string');
  assert(typeof s4.analysis === 'string' && s4.analysis.length > 0, 'analysis should be non-empty string');
});

// ── 16. List batches ──

await test('List batches shows 1 batch with scores', async () => {
  const { body } = await json(`/v1/calibrator/${projectId}/batches`, { headers: auth() });
  assert(body.ok === true, `List batches failed: ${JSON.stringify(body.error)}`);
  assert(body.data.batches.length === 1, `should have 1 batch, got ${body.data.batches.length}`);
  const b = body.data.batches[0];
  assert(b.batchId === batchId, 'batchId mismatch');
  assert(b.promptVersion === 1, `promptVersion should be 1, got ${b.promptVersion}`);
  assert(b.modelCount === 1, `modelCount should be 1, got ${b.modelCount}`);
  assert(Array.isArray(b.scores) && b.scores.length === 1, 'should have 1 score entry');
  assert(b.scores[0].modelId === 'llm-1', 'score modelId mismatch');
  assert(b.scores[0].overallScore === 50, `score should be 50, got ${b.scores[0].overallScore}`);
});

// ── 17. List batches with version filter ──

await test('List batches with version filter', async () => {
  const v2 = await json(`/v1/calibrator/${projectId}/batches?version=2`, { headers: auth() });
  assert(v2.body.ok === true, `List v2 failed: ${JSON.stringify(v2.body.error)}`);
  assert(v2.body.data.batches.length === 0, `version=2 should return 0 batches, got ${v2.body.data.batches.length}`);

  const v1 = await json(`/v1/calibrator/${projectId}/batches?version=1`, { headers: auth() });
  assert(v1.body.ok === true, `List v1 failed: ${JSON.stringify(v1.body.error)}`);
  assert(v1.body.data.batches.length === 1, `version=1 should return 1 batch, got ${v1.body.data.batches.length}`);
  assert(v1.body.data.batches[0].batchId === batchId, 'filtered batch should be ours');
});

// ── 18. Get batch detail ──

await test('Get batch detail shows all 4 steps with full data', async () => {
  const { body } = await json(`/v1/calibrator/${projectId}/batches/${batchId}`, { headers: auth() });
  assert(body.ok === true, `Get batch failed: ${JSON.stringify(body.error)}`);
  const b = body.data.batch;
  assert(b.batchId === batchId, 'batchId mismatch');
  assert(b.projectId === projectId, 'projectId mismatch');
  assert(b.promptVersion === 1, 'promptVersion mismatch');
  // Model-level steps
  const m = b.models[0];
  assert(m.step1_generation.status === 'done', 'step1 should be done');
  assert(m.step1_generation.output === step1Done.output, 'step1 output mismatch');
  assert(m.step2_analysis.status === 'done', 'step2 should be done');
  assert(m.step2_analysis.overallScore === 50, 'step2 score mismatch');
  assert(m.step2_analysis.dimensions.length === 2, 'step2 should have 2 dimensions');
  assert(m.step3_reflection.status === 'done', 'step3 should be done');
  assert(m.step3_reflection.judgeProposals.proposals.length === 1, 'step3 judge proposals count');
  assert(m.step3_reflection.selfProposals.proposals.length === 2, 'step3 self proposals count');
  // Batch-level step 4
  assert(b.step4_synthesis.status === 'done', 'step4 should be done');
  assert(b.step4_synthesis.groupedProposals.length === 2, 'step4 grouped proposals count');
  assert(b.step4_synthesis.options.A.proposalIds.length === 1, 'option A should have 1 proposal');
  assert(b.step4_synthesis.options.B.proposalIds.length === 2, 'option B should have 2 proposals');
});

// ── 19. List projects with enriched data ──

await test('List projects shows batchCount=1 and latestAvgScore=50', async () => {
  const { body } = await json('/v1/calibrator', { headers: auth() });
  assert(body.ok === true, `List failed: ${JSON.stringify(body.error)}`);
  const our = body.data.projects.find((p: any) => p.projectId === projectId);
  assert(our, 'our project should appear');
  assert(our.batchCount === 1, `batchCount should be 1, got ${our.batchCount}`);
  assert(our.latestAvgScore === 50, `latestAvgScore should be 50, got ${our.latestAvgScore}`);
});

// ── 20. Old run endpoints removed ──

await test('Old run endpoints return 404', async () => {
  const { status } = await json(`/v1/calibrator/${projectId}/runs`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ promptVersion: 1, candidateModelId: 'llm-1', candidateModelLabel: 'Test', output: 'test', durationMs: 1000 }),
  });
  assert(status === 404, `POST /runs should return 404, got ${status}`);
});

// ── 21. Delete batch ──

await test('Delete batch', async () => {
  const { body } = await json(`/v1/calibrator/${projectId}/batches/${batchId}`, {
    method: 'DELETE',
    headers: auth(),
  });
  assert(body.ok === true, `Delete batch failed: ${JSON.stringify(body.error)}`);
  assert(body.data.deleted === 1, `should delete 1 record, got ${body.data.deleted}`);

  // Verify it's gone
  const { status } = await json(`/v1/calibrator/${projectId}/batches/${batchId}`, { headers: auth() });
  assert(status === 404, `batch should be 404 after delete, got ${status}`);
});

// ── 22. Cascade delete project ──

await test('Cascade delete project removes all related data', async () => {
  const { body } = await json(`/v1/calibrator/${projectId}`, {
    method: 'DELETE',
    headers: auth(),
  });
  assert(body.ok === true, `Delete project failed: ${JSON.stringify(body.error)}`);
  // Should delete: project + 2 versions + dimensions = 4 keys minimum (batch already deleted)
  assert(body.data.deleted >= 4, `should delete at least 4 records (project + 2 versions + dimensions), got ${body.data.deleted}`);

  // Verify project is gone
  const { status } = await json(`/v1/calibrator/${projectId}`, { headers: auth() });
  assert(status === 404, `project should be 404 after delete, got ${status}`);
});

// ─── Summary ───
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
