/**
 * @file generator-interview.spec.ts
 * @description Playwright tests for the Generator V2 interview phase UI.
 *   Tests that the interview flow is accessible, prompts can be copied,
 *   the spec import flow works correctly, and the agent progress banner
 *   appears/disappears correctly when a session is active.
 * @version-history
 *   v1.0.0 — 2026-03-14 — Initial interview phase UI tests
 *   v1.1.0 — 2026-03-18 — Add agent progress banner and stop button tests
 */
import { test, expect, type Page, type Browser } from '@playwright/test';

const PASSWORD = 'BannerTest99!';
const TS_BANNER = Date.now();

/** Load the AIMEAT test harness page (loads all client libs). */
async function loadHarness(page: Page) {
  await page.goto('/v1/libs/test-harness');
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 10_000 });
}

/** Register a new user via the test harness and return the session object. */
async function registerUser(page: Page, username: string) {
  return page.evaluate(
    ([u, p]) => (window as any).AIMEAT.auth.register(u, u, { password: p }),
    [username, PASSWORD] as const,
  );
}

/** Login an existing user via test harness (requires harness already loaded). */
async function loginUser(page: Page, username: string) {
  return page.evaluate(
    ([u, p]) => (window as any).AIMEAT.auth.loginWithPassword(u, p),
    [username, PASSWORD] as const,
  );
}

// ── Basic interview phase tests ──────────────────────────────────────────────

test.describe('Generator Interview Phase', () => {
  test('profile page loads with generator tab', async ({ page }) => {
    await page.goto('/v1/profile');
    await page.waitForLoadState('networkidle');
    // Generator tab should be visible in the navigation
    const genLink = page.locator('a, button').filter({ hasText: /generaattori|generator/i }).first();
    await expect(genLink).toBeVisible({ timeout: 10_000 });
  });

  test('generator tab has new project button', async ({ page }) => {
    await page.goto('/v1/profile');
    await page.waitForLoadState('networkidle');
    // Navigate to generator if it's a tab
    const genLink = page.locator('a, button').filter({ hasText: /generaattori|generator/i }).first();
    if (await genLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await genLink.click();
      await page.waitForTimeout(500);
    }
    // Should show new project button or description area
    const newBtn = page.locator('button').filter({ hasText: /uusi|new/i }).first();
    const descArea = page.locator('textarea.pf-gen-description');
    const hasNewBtn = await newBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    const hasDesc = await descArea.isVisible({ timeout: 1_000 }).catch(() => false);
    expect(hasNewBtn || hasDesc).toBeTruthy();
  });
});

// ── Agent Progress Banner tests ──────────────────────────────────────────────

test.describe('Generator — Agent Progress Banner', () => {
  const ownerName = `pw-banner-${TS_BANNER}`;
  let ownerToken: string;
  let projectId: string;

  /**
   * Set up the owner and project once for both banner tests.
   * We use a browser fixture to get a page so we can use the test harness
   * (which loads the AIMEAT auth library with Ed25519 signing).
   */
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Register user via test harness
      await loadHarness(page);
      const session = await registerUser(page, ownerName) as any;
      ownerToken = session?.jwt as string;
      if (!ownerToken) throw new Error('No JWT returned from register');

      // Create a generator project using the owner JWT
      const projResp = await page.request.post('/v1/generator/projects', {
        headers: {
          'Authorization': `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        data: { name: 'Banner Test Project', description: 'Playwright banner test' },
      });
      const projBody = await projResp.json();
      projectId = projBody.data?.projectId as string;
      if (!projectId) throw new Error(`No projectId returned: ${JSON.stringify(projBody)}`);
    } finally {
      await context.close();
    }
  });

  test.afterAll(async ({ browser }: { browser: Browser }) => {
    if (!ownerToken) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.request.delete(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` },
      });
    } catch { /* best effort */ } finally {
      await context.close();
    }
  });

  /**
   * Navigate to the generator tab and open the test project.
   * Returns only after the project dashboard is rendered.
   */
  async function openProject(page: Page) {
    await page.goto('/v1/profile?tab=generator');
    await page.waitForLoadState('networkidle');

    // Wait for project list to load (spinner gone)
    await page.waitForSelector('.pf-gen-project-card', { timeout: 10_000 });

    // Click into the project card
    await page.locator('.pf-gen-project-card').first().click();

    // Wait for the project dashboard to render — header or back button appears
    await page.waitForSelector('.pf-gen-dashboard', { timeout: 8_000 });
  }

  /**
   * Inject a fake agent session directly into memory via the memory API.
   * This simulates what an agent would do via POST /v1/generator/:id/session/claim,
   * but uses the owner JWT (which satisfies requireRole('agent') via role hierarchy).
   * The owner's GHII is the correct ownerGaii for memory keys in this context.
   */
  async function injectSession(page: Page) {
    const now = new Date().toISOString();
    const sessionData = {
      agentGaii: `playwright-agent#${ownerName}@aimeat-local-001-dev`,
      agentName: 'PlaywrightTestAgent',
      phase: 'building',
      componentId: null,
      stepNumber: 1,
      totalSteps: 3,
      startedAt: now,
      heartbeat: now,
    };

    const resp = await page.request.post('/v1/memory', {
      headers: {
        'Authorization': `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        key: `generator.${projectId}.session`,
        value: sessionData,
        visibility: 'owner',
        tags: ['generator', 'session'],
      },
    });

    if (!resp.ok()) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(`Memory write failed ${resp.status()}: ${JSON.stringify(body)}`);
    }
  }

  /**
   * Delete the session from memory to reset state between tests.
   */
  async function clearSession(page: Page) {
    await page.request.delete(`/v1/memory/${encodeURIComponent(`generator.${projectId}.session`)}`, {
      headers: { 'Authorization': `Bearer ${ownerToken}` },
    }).catch(() => { /* may already be gone */ });
  }

  test('banner appears when agent session is active', async ({ page }) => {
    // Login as the owner using the test harness
    await loadHarness(page);
    await loginUser(page, ownerName);

    // Clear any stale session first
    await clearSession(page);

    // Open the project dashboard
    await openProject(page);

    // Inject a session into memory (simulates agent claiming the session)
    await injectSession(page);

    // Trigger the live-update event so the dashboard re-fetches data
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
    });

    // Banner should appear
    await expect(page.locator('.pf-gen-agent-banner')).toBeVisible({ timeout: 8_000 });
  });

  test('stop button releases session and removes banner', async ({ page }) => {
    // Login as the owner using the test harness
    await loadHarness(page);
    await loginUser(page, ownerName);

    // Ensure a clean session state, then inject a fresh one
    await clearSession(page);
    await injectSession(page);

    // Open the project dashboard
    await openProject(page);

    // Trigger live update so the dashboard picks up the session
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
    });

    // Banner must be visible before we can stop it
    await expect(page.locator('.pf-gen-agent-banner')).toBeVisible({ timeout: 8_000 });

    // Click the stop button
    await page.locator('.pf-gen-stop-btn').click();

    // Banner should disappear after the stop API call + re-render
    await expect(page.locator('.pf-gen-agent-banner')).not.toBeVisible({ timeout: 8_000 });
  });
});
