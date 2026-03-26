/**
 * @file foundry-interview.spec.ts
 * @description Playwright tests for the Foundry interview phase UI.
 *   Tests that the interview flow is accessible, prompts can be copied,
 *   the spec import flow works correctly, and the agent progress banner
 *   appears/disappears correctly when a session is active.
 * @version-history
 *   v1.0.0 — 2026-03-26 — Initial foundry interview phase UI tests (copied from generator-interview.spec.ts)
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

/**
 * Navigate to the profile page and open the Foundry tab.
 * Does NOT use waitForLoadState('networkidle') — the SSE connection keeps the network
 * active indefinitely, preventing networkidle from resolving.
 *
 * For new-tier users: clicks the onboarding tile "Generate a full service".
 * Falls back to the expanded management menu if the tile is not visible.
 */
async function openFoundryTab(page: Page) {
  await page.goto('/v1/profile');
  // Wait for the profile landing page to render (not networkidle — SSE stays open)
  await page.waitForSelector('.pf-landing', { timeout: 10_000 });

  // Try the onboarding tile first (visible for new-tier users)
  const onboardTile = page.locator('.pf-onboard-card').filter({ hasText: /generate|foundry/i }).first();
  const tileVisible = await onboardTile.isVisible({ timeout: 3_000 }).catch(() => false);

  if (tileVisible) {
    await onboardTile.click();
  } else {
    // Fall back to the menu item (visible for active/experienced users or expanded menu)
    // Expand the management section if needed
    const expandTrigger = page.locator('.pf-expand-trigger').first();
    if (await expandTrigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expandTrigger.click();
      await page.waitForTimeout(300);
    }
    const fndMenuItem = page.locator('.pf-menu-item').filter({ hasText: /foundry|generaattori/i }).first();
    await expect(fndMenuItem).toBeVisible({ timeout: 5_000 });
    await fndMenuItem.click();
  }

  // Wait for the foundry tab content to appear
  await page.waitForSelector('.fnd-project-list, .pf-inline-view', { timeout: 10_000 });
}

// ── Basic interview phase tests ──────────────────────────────────────────────

test.describe('Foundry Interview Phase', () => {
  test('profile page loads with foundry tab', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-fnd-basic1-${TS_BANNER}`);

    await page.goto('/v1/profile');
    // Wait for profile to render (SSE keeps network open — don't use networkidle)
    await page.waitForSelector('.pf-landing', { timeout: 10_000 });

    // Foundry tile should be visible in the onboarding section (new users)
    // or in the management menu (active/experienced users)
    const fndTile = page.locator('.pf-onboard-card').filter({ hasText: /generate|foundry/i }).first();
    await expect(fndTile).toBeVisible({ timeout: 8_000 });
  });

  test('foundry tab has new project button', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-fnd-basic2-${TS_BANNER}`);

    await openFoundryTab(page);

    // Should show new project button (inside .fnd-project-list)
    const newBtn = page.locator('.fnd-project-list button').filter({ hasText: /uusi|new/i }).first();
    await expect(newBtn).toBeVisible({ timeout: 5_000 });
  });
});

// ── Agent Progress Banner tests ──────────────────────────────────────────────

test.describe('Foundry — Agent Progress Banner', () => {
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

      // Create a foundry project using the owner JWT
      const projResp = await page.request.post('/v1/foundry/projects', {
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
   * Navigate to the foundry tab and open the test project.
   * Returns only after the project dashboard is rendered.
   *
   * Uses DOM-based waits instead of waitForLoadState('networkidle') because
   * the SSE live-update connection stays open indefinitely, preventing networkidle.
   */
  async function openProject(page: Page) {
    await page.goto('/v1/profile');
    // Wait for the profile landing to render (not networkidle — SSE stays open)
    await page.waitForSelector('.pf-landing', { timeout: 10_000 });

    // Open the foundry tab — try onboarding tile first, fall back to menu item
    const onboardTile = page.locator('.pf-onboard-card').filter({ hasText: /generate|foundry/i }).first();
    const tileVisible = await onboardTile.isVisible({ timeout: 3_000 }).catch(() => false);

    if (tileVisible) {
      await onboardTile.click();
    } else {
      const expandTrigger = page.locator('.pf-expand-trigger').first();
      if (await expandTrigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expandTrigger.click();
        await page.waitForTimeout(300);
      }
      const fndMenuItem = page.locator('.pf-menu-item').filter({ hasText: /foundry|generaattori/i }).first();
      await expect(fndMenuItem).toBeVisible({ timeout: 5_000 });
      await fndMenuItem.click();
    }

    // Wait for the project list to load inside the inline view
    await page.waitForSelector('.fnd-project-card', { timeout: 10_000 });

    // Click into the project card
    await page.locator('.fnd-project-card').first().click();

    // Wait for the project dashboard to render — header or back button appears
    await page.waitForSelector('.fnd-dashboard', { timeout: 8_000 });
  }

  /**
   * Inject a fake agent session directly into memory via the memory API.
   * This simulates what an agent would do via POST /v1/foundry/:id/session/claim,
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
        key: `foundry.${projectId}.session`,
        value: sessionData,
        visibility: 'owner',
        tags: ['foundry', 'session'],
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
    await page.request.delete(`/v1/memory/${encodeURIComponent(`foundry.${projectId}.session`)}`, {
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

    // Banner should appear and show the agent name
    await expect(page.locator('.fnd-agent-banner')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.fnd-agent-banner')).toContainText('PlaywrightTestAgent');
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
    await expect(page.locator('.fnd-agent-banner')).toBeVisible({ timeout: 8_000 });

    // Click the stop button
    await page.locator('.fnd-stop-btn').click();

    // Banner should disappear after the stop API call + re-render
    await expect(page.locator('.fnd-agent-banner')).not.toBeVisible({ timeout: 8_000 });
  });
});
