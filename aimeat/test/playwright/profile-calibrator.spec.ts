/**
 * @file profile-calibrator.spec.ts
 * @description Playwright browser tests for the Prompt Calibrator V2 UI.
 *   Verifies project list, detail view, batch rendering with 4-step data,
 *   dimension tables, dual reflection columns, synthesis options, project
 *   creation via UI, and translation key resolution.
 * @version-history
 *   v1.0.0 — 2026-03-29 — Initial Playwright tests for Calibrator V2
 */
import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// E2E: Profile — Calibrator Tab (V2)
// Project list, detail view, batch 4-step flow,
// dimension tables, reflection columns, synthesis options.
// ═══════════════════════════════════════════════════════

const TS = Date.now();
const PASSWORD = 'TestPass42!';

// ── Test data (same structure as e2e-calibrator.ts) ──

const candidateModels = [
  { id: 'llm-1', label: 'Test Model Alpha', provider: 'openrouter', modelId: 'test/model-alpha', apiKeyRef: 'shared' },
];
const reasoningLlm = {
  id: 'llm-r', label: 'Reasoning Beta', provider: 'openrouter', modelId: 'test/reasoning-beta', apiKeyRef: 'shared',
};

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

// ── Helpers ──

/** Load the AIMEAT test harness page (loads all client libs). */
async function loadHarness(page: Page) {
  await page.goto('/v1/libs/test-harness');
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 10_000 });
}

/** Register a new user and return the session object. */
async function registerUser(page: Page, username: string) {
  return page.evaluate(
    ([u, p]) => (window as any).AIMEAT.auth.register(u, u, { password: p }),
    [username, PASSWORD] as const,
  );
}

/** Create an agent via API (needed to reach 'active' tier so calibrator tab is visible). */
async function createAgent(page: Page, agentName: string, owner: string) {
  return page.evaluate(
    ([name, own]) => {
      const session = (window as any).AIMEAT.auth.getSession();
      return fetch('/v1/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.jwt },
        body: JSON.stringify({ name, owner: own, display_name: name }),
      }).then(r => r.json());
    },
    [agentName, owner] as const,
  );
}

/** Make an authenticated API call from the page context. */
async function apiCall(page: Page, method: string, path: string, body?: any) {
  return page.evaluate(
    ([m, p, b]) => {
      const session = (window as any).AIMEAT.auth.getSession();
      const opts: RequestInit = {
        method: m,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.jwt },
      };
      if (b) opts.body = JSON.stringify(b);
      return fetch(p, opts).then(r => r.json());
    },
    [method, path, body] as const,
  );
}

/** Navigate to the profile page and open the Calibrator tab. */
async function gotoCalibratorTab(page: Page) {
  await page.goto('/v1/profile');
  await expect(page.locator('.pf')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);

  // Click Calibrator in the menu (may need to expand the section)
  const menuItem = page.locator('.pf-menu-item', { hasText: /Calibrator/i });
  const visible = await menuItem.first().isVisible({ timeout: 3_000 }).catch(() => false);

  if (!visible) {
    // Try expanding the management/build section
    const expandTrigger = page.locator('.pf-expand-trigger').first();
    if (await expandTrigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expandTrigger.click();
      await page.waitForTimeout(300);
    }
  }

  await expect(menuItem.first()).toBeVisible({ timeout: 10_000 });
  await menuItem.first().click();

  // Wait for calibrator content to render
  await page.waitForTimeout(1000);
}

/**
 * Full setup: register user, create agent (for active tier), seed a calibration project
 * with all 4 steps of batch data via API, then navigate to the calibrator tab.
 * Returns { user, projectId, batchId }.
 */
async function setupCalibrator(page: Page, suffix: string) {
  const user = `pw-cal-${suffix}-${TS}`;
  await loadHarness(page);
  const session = await registerUser(page, user);
  expect(session).toBeTruthy();

  // Create agent to reach 'active' tier
  const agentResult = await createAgent(page, `cal-agent-${suffix}`, user);
  expect(agentResult.ok).toBe(true);

  // 1. Create calibration project
  const createResp = await apiCall(page, 'POST', '/v1/calibrator', { name: 'Playwright Cal Project' });
  expect(createResp.ok).toBe(true);
  const projectId = createResp.data.project.projectId;

  // 2. Update project with candidateModels and reasoningLlm
  const updateResp = await apiCall(page, 'PUT', `/v1/calibrator/${projectId}`, {
    candidateModels,
    reasoningLlm,
  });
  expect(updateResp.ok).toBe(true);

  // 3. Create prompt version 1
  const versionResp = await apiCall(page, 'POST', `/v1/calibrator/${projectId}/versions`, {
    prompt: 'Generate a blueprint for {description}',
    targetOutput: '{"architecture": "cortex-modular"}',
    changelog: 'Initial version',
  });
  expect(versionResp.ok).toBe(true);

  // 4. Create a batch
  const batchResp = await apiCall(page, 'POST', `/v1/calibrator/${projectId}/batches`, {
    promptVersion: 1,
  });
  expect(batchResp.ok).toBe(true);
  const batchId = batchResp.data.batch.batchId;

  // 5. Update batch with Step 1 (generation) data
  const step1Models = [{
    modelId: 'llm-1',
    modelLabel: 'Test Model Alpha',
    step1_generation: step1Done,
    step2_analysis: { status: 'pending', dimensions: [], overallScore: null, analysis: null, error: null, promptSent: null, rawResponse: null },
    step3_reflection: { status: 'pending', judgeProposals: null, selfProposals: null, error: null },
  }];
  await apiCall(page, 'PUT', `/v1/calibrator/${projectId}/batches/${batchId}`, { models: step1Models });

  // 6. Update batch with Step 2 (analysis) data
  const step2Models = [{
    modelId: 'llm-1',
    modelLabel: 'Test Model Alpha',
    step1_generation: step1Done,
    step2_analysis: step2Done,
    step3_reflection: { status: 'pending', judgeProposals: null, selfProposals: null, error: null },
  }];
  await apiCall(page, 'PUT', `/v1/calibrator/${projectId}/batches/${batchId}`, { models: step2Models });

  // 7. Update batch with Step 3 (reflection) data
  const step3Models = [{
    modelId: 'llm-1',
    modelLabel: 'Test Model Alpha',
    step1_generation: step1Done,
    step2_analysis: step2Done,
    step3_reflection: step3Done,
  }];
  await apiCall(page, 'PUT', `/v1/calibrator/${projectId}/batches/${batchId}`, { models: step3Models });

  // 8. Update batch with Step 4 (synthesis) data
  await apiCall(page, 'PUT', `/v1/calibrator/${projectId}/batches/${batchId}`, {
    status: 'synthesized',
    step4_synthesis: step4Done,
  });

  return { user, projectId, batchId };
}


// ── Test 1: Calibrator tab loads and shows project list ──

test.describe('Calibrator — Project List', () => {
  test('shows project card with version, model count, and batch count', async ({ page }) => {
    await setupCalibrator(page, 'list');
    await gotoCalibratorTab(page);

    // Project card should be visible
    const card = page.locator('.fnd-cal-card');
    await expect(card.first()).toBeVisible({ timeout: 10_000 });

    // Card shows the project name
    const cardText = await card.first().textContent();
    expect(cardText).toContain('Playwright Cal Project');

    // Card shows version
    const versionBadge = card.first().locator('.fnd-cal-card-version');
    await expect(versionBadge).toBeVisible();

    // Card shows model count and batch count in meta
    const meta = card.first().locator('.fnd-cal-card-meta');
    const metaText = await meta.textContent();
    expect(metaText).toContain('1'); // at least one of: 1 model, 1 run
  });
});


// ── Test 2: Click project card opens detail view ──

test.describe('Calibrator — Detail View', () => {
  test('clicking project card opens detail with all sections', async ({ page }) => {
    await setupCalibrator(page, 'detail');
    await gotoCalibratorTab(page);

    // Click the project card
    const card = page.locator('.fnd-cal-card').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    // Detail view should appear
    const detail = page.locator('.fnd-cal-detail');
    await expect(detail).toBeVisible({ timeout: 10_000 });

    // Project name is visible in the header input
    const nameInput = detail.locator('.fnd-cal-header input[type="text"]');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue('Playwright Cal Project');

    // Reasoning Model section exists
    const sections = detail.locator('.fnd-cal-section-title');
    const sectionTexts = await sections.allTextContents();
    const hasReasoningSection = sectionTexts.some(t => /Reasoning/i.test(t));
    expect(hasReasoningSection).toBe(true);

    // Prompt section with textarea exists
    const promptTextarea = detail.locator('textarea').first();
    await expect(promptTextarea).toBeVisible();
  });
});


// ── Test 3: Batch card renders with scores ──

test.describe('Calibrator — Batch Card', () => {
  test('batch card shows model name and score percentage', async ({ page }) => {
    await setupCalibrator(page, 'batch');
    await gotoCalibratorTab(page);

    // Navigate into detail
    await page.locator('.fnd-cal-card').first().click();
    await expect(page.locator('.fnd-cal-detail')).toBeVisible({ timeout: 10_000 });

    // Batch card should be visible in the results section
    const batchCard = page.locator('.fnd-cal-batch');
    await expect(batchCard.first()).toBeVisible({ timeout: 10_000 });

    // Batch shows model name and score in the header
    const batchHeader = batchCard.first().locator('.fnd-cal-batch-header');
    const headerText = await batchHeader.textContent();
    expect(headerText).toContain('Test Model Alpha');
    expect(headerText).toContain('50%');

    // Status is shown
    expect(headerText).toMatch(/Status/i);
  });
});


// ── Test 4: Expand batch shows 4 steps ──

test.describe('Calibrator — Batch Steps', () => {
  test('expanded batch shows all 4 step sections', async ({ page }) => {
    await setupCalibrator(page, 'steps');
    await gotoCalibratorTab(page);

    // Navigate into detail
    await page.locator('.fnd-cal-card').first().click();
    await expect(page.locator('.fnd-cal-detail')).toBeVisible({ timeout: 10_000 });

    // Click batch header to expand
    const batchHeader = page.locator('.fnd-cal-batch-header').first();
    await batchHeader.click();
    await page.waitForTimeout(500);

    // Batch detail section should be visible
    const batchDetail = page.locator('.fnd-cal-batch-detail');
    await expect(batchDetail.first()).toBeVisible({ timeout: 5_000 });

    // All 4 steps should be present as <details> summaries
    const steps = batchDetail.first().locator('.fnd-cal-step');
    await expect(steps).toHaveCount(4);

    // Verify step labels (summary text)
    const summaries = batchDetail.first().locator('.fnd-cal-step > summary');
    const summaryTexts = await summaries.allTextContents();
    expect(summaryTexts.some(t => /Step 1.*Generation/i.test(t))).toBe(true);
    expect(summaryTexts.some(t => /Step 2.*Analysis/i.test(t))).toBe(true);
    expect(summaryTexts.some(t => /Step 3.*Reflection/i.test(t))).toBe(true);
    expect(summaryTexts.some(t => /Step 4.*Synthesis/i.test(t))).toBe(true);
  });
});


// ── Test 5: Step 2 shows dimension table ──

test.describe('Calibrator — Step 2 Dimensions', () => {
  test('dimension table shows names and score', async ({ page }) => {
    await setupCalibrator(page, 'dims');
    await gotoCalibratorTab(page);

    // Navigate into detail and expand batch
    await page.locator('.fnd-cal-card').first().click();
    await expect(page.locator('.fnd-cal-detail')).toBeVisible({ timeout: 10_000 });
    await page.locator('.fnd-cal-batch-header').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('.fnd-cal-batch-detail').first()).toBeVisible({ timeout: 5_000 });

    // Step 2 should be open (since analysis is done)
    const step2 = page.locator('.fnd-cal-step').nth(1);

    // Dimension table should be visible
    const dimTable = step2.locator('.fnd-cal-dim-table');
    await expect(dimTable).toBeVisible({ timeout: 5_000 });

    // Dimension names appear
    const tableText = await dimTable.textContent();
    expect(tableText).toContain('feature_count');
    expect(tableText).toContain('valid_json');

    // Score percentage appears in the model meta
    const scoreSpan = step2.locator('.fnd-cal-run-score');
    await expect(scoreSpan.first()).toBeVisible();
    const scoreText = await scoreSpan.first().textContent();
    expect(scoreText).toContain('50%');
  });
});


// ── Test 6: Step 3 shows dual reflection columns ──

test.describe('Calibrator — Step 3 Reflection', () => {
  test('dual reflection columns with judge and self proposals', async ({ page }) => {
    await setupCalibrator(page, 'reflect');
    await gotoCalibratorTab(page);

    // Navigate into detail and expand batch
    await page.locator('.fnd-cal-card').first().click();
    await expect(page.locator('.fnd-cal-detail')).toBeVisible({ timeout: 10_000 });
    await page.locator('.fnd-cal-batch-header').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('.fnd-cal-batch-detail').first()).toBeVisible({ timeout: 5_000 });

    // Open Step 3 details
    const step3 = page.locator('.fnd-cal-step').nth(2);
    const step3Summary = step3.locator('summary');
    await step3Summary.click();
    await page.waitForTimeout(300);

    // Dual reflection columns exist
    const cols = step3.locator('.fnd-cal-reflection-col');
    await expect(cols).toHaveCount(2);

    // Judge column has heading and proposal text
    const judgeCol = cols.first();
    const judgeText = await judgeCol.textContent();
    expect(judgeText).toContain('Judge');
    expect(judgeText).toContain('feature count instruction');

    // Self column has heading and proposal text
    const selfCol = cols.nth(1);
    const selfText = await selfCol.textContent();
    expect(selfText).toContain('Self');
    expect(selfText).toContain('complete example output');
  });
});


// ── Test 7: Step 4 shows synthesis with options ──

test.describe('Calibrator — Step 4 Synthesis', () => {
  test('grouped proposals, option radio buttons, recommendation, and apply button', async ({ page }) => {
    await setupCalibrator(page, 'synth');
    await gotoCalibratorTab(page);

    // Navigate into detail and expand batch
    await page.locator('.fnd-cal-card').first().click();
    await expect(page.locator('.fnd-cal-detail')).toBeVisible({ timeout: 10_000 });
    await page.locator('.fnd-cal-batch-header').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('.fnd-cal-batch-detail').first()).toBeVisible({ timeout: 5_000 });

    // Open Step 4 details
    const step4 = page.locator('.fnd-cal-step').nth(3);
    const step4Summary = step4.locator('summary');
    await step4Summary.click();
    await page.waitForTimeout(300);

    // Grouped proposals are visible
    const proposalCards = step4.locator('.fnd-cal-proposal-card');
    const count = await proposalCards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Option A/B radio buttons exist
    const options = step4.locator('.fnd-cal-option');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThanOrEqual(2); // A and B

    // Radio buttons present
    const radios = step4.locator('input[type="radio"]');
    const radioCount = await radios.count();
    expect(radioCount).toBeGreaterThanOrEqual(2);

    // Recommendation text is visible
    const recommendation = step4.locator('.fnd-cal-recommendation');
    await expect(recommendation).toBeVisible();
    const recText = await recommendation.textContent();
    expect(recText).toContain('Recommendation');
    expect(recText).toContain('Option A');

    // "Apply selected" button exists
    const applyBtn = step4.locator('button', { hasText: /Apply selected/i });
    await expect(applyBtn).toBeVisible();
  });
});


// ── Test 8: Create new project via UI ──

test.describe('Calibrator — Create Project', () => {
  test('typing a name and clicking create opens the new project detail', async ({ page }) => {
    const user = `pw-cal-create-${TS}`;
    await loadHarness(page);
    const session = await registerUser(page, user);
    expect(session).toBeTruthy();

    // Create agent for active tier
    await createAgent(page, 'cal-create-agent', user);

    await gotoCalibratorTab(page);

    // Type a new project name
    const nameInput = page.locator('.fnd-cal-create-input');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    const newName = `PW New Project ${TS}`;
    await nameInput.fill(newName);

    // Click the create button
    const createBtn = page.locator('.fnd-cal-create-bar .btn-primary');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Detail view should open with the new project name
    const detail = page.locator('.fnd-cal-detail');
    await expect(detail).toBeVisible({ timeout: 10_000 });
    const nameField = detail.locator('.fnd-cal-header input[type="text"]');
    await expect(nameField).toHaveValue(newName);
  });
});


// ── Test 9: No raw i18n keys visible ──

test.describe('Calibrator — Translations', () => {
  test('no raw profile.calibrator.* i18n keys visible on the page', async ({ page }) => {
    await setupCalibrator(page, 'i18n');
    await gotoCalibratorTab(page);

    // Check the list view
    const listText = await page.locator('body').textContent();
    expect(listText).not.toMatch(/profile\.calibrator\.\w+/);

    // Navigate to detail view
    const card = page.locator('.fnd-cal-card').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.locator('.fnd-cal-detail')).toBeVisible({ timeout: 10_000 });

    // Check the detail view
    const detailText = await page.locator('body').textContent();
    expect(detailText).not.toMatch(/profile\.calibrator\.\w+/);
  });
});
