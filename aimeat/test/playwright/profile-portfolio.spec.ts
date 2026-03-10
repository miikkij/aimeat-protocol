import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// E2E: Profile — Portfolio Tab
// Tests tab rendering, navigation, and session-dependent elements.
// ═══════════════════════════════════════════════════════

const TS = Date.now();
const USERNAME = `pw-portfolio-${TS}`;
const PASSWORD = 'TestPass42!';

/** Load the AIMEAT test harness page (loads all client libs). */
async function loadHarness(page: Page) {
  await page.goto('/v1/libs/test-harness');
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 10_000 });
}

/** Register a new user and return the session object. */
async function registerUser(page: Page, username: string, password: string) {
  return page.evaluate(
    ([u, p]) => (window as any).AIMEAT.auth.register(u, u, { password: p }),
    [username, password] as const,
  );
}

/** Register user via harness, then navigate to profile page (session persists in localStorage). */
async function setupAuthenticatedProfile(page: Page) {
  await loadHarness(page);
  const session = await registerUser(page, USERNAME, PASSWORD);
  expect(session).toBeTruthy();
  expect(session.owner).toBe(USERNAME);

  await page.goto('/v1/profile?tab=portfolio');
  await page.waitForLoadState('networkidle');
  return session;
}

// ── TC-01: Tab renders correctly ─────────────────────

test.describe('Portfolio Tab — Authenticated', () => {
  test('renders heading, subtitle, and builder button', async ({ page }) => {
    await setupAuthenticatedProfile(page);

    // Tab content container should be visible
    const tabContent = page.locator('.tab-content');
    await expect(tabContent).toBeVisible({ timeout: 10_000 });

    // Heading (h3) should be present
    const heading = tabContent.locator('h3');
    await expect(heading).toBeVisible();
    const headingText = await heading.textContent();
    expect(headingText?.length).toBeGreaterThan(0);

    // Subtitle paragraph
    const subtitle = tabContent.locator('p');
    await expect(subtitle.first()).toBeVisible();

    // "Open Portfolio Builder" button
    const builderBtn = tabContent.locator('button.btn.btn-primary');
    await expect(builderBtn).toBeVisible();

    // No spinner should be present (portfolio tab has no data loading)
    const spinner = page.locator('.spinner');
    await expect(spinner).toHaveCount(0);
  });

  // ── TC-02: Open Portfolio Builder navigation ─────────

  test('builder button navigates to /v1/portfolio', async ({ page }) => {
    await setupAuthenticatedProfile(page);

    const builderBtn = page.locator('.tab-content button.btn.btn-primary');
    await expect(builderBtn).toBeVisible({ timeout: 10_000 });

    await builderBtn.click();
    await page.waitForLoadState('networkidle');

    // Should navigate to portfolio builder page
    await expect(page).toHaveURL(/\/v1\/portfolio/);
  });

  // ── TC-03: View Public Portfolio link ────────────────

  test('public portfolio link points to correct owner URL', async ({ page }) => {
    await setupAuthenticatedProfile(page);

    const publicLink = page.locator('.tab-content a.btn.btn-ghost');
    await expect(publicLink).toBeVisible({ timeout: 10_000 });

    // Verify href contains the owner name
    const href = await publicLink.getAttribute('href');
    expect(href).toContain(`/v1/portfolio/${encodeURIComponent(USERNAME)}`);

    // Verify opens in new tab
    const target = await publicLink.getAttribute('target');
    expect(target).toBe('_blank');
  });

  test('public portfolio link text is the view-public translation', async ({ page }) => {
    await setupAuthenticatedProfile(page);

    const publicLink = page.locator('.tab-content a.btn.btn-ghost');
    await expect(publicLink).toBeVisible({ timeout: 10_000 });

    const text = await publicLink.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});

// ── TC-04: No session — public link hidden ─────────────

test.describe('Portfolio Tab — Unauthenticated', () => {
  test('shows login prompt when not authenticated', async ({ page }) => {
    await page.goto('/v1/profile?tab=portfolio');
    await page.waitForLoadState('networkidle');

    // Without session, profile page shows login prompt
    const loginPrompt = page.locator('.login-prompt, .pf-login, .pf-auth');
    await expect(loginPrompt.first()).toBeVisible({ timeout: 10_000 });

    // The portfolio tab content should NOT be rendered
    const tabContent = page.locator('.tab-content');
    await expect(tabContent).toHaveCount(0);
  });

  test('no public portfolio link visible without session', async ({ page }) => {
    await page.goto('/v1/profile?tab=portfolio');
    await page.waitForLoadState('networkidle');

    // The ghost link should not exist at all
    const publicLink = page.locator('.tab-content a.btn.btn-ghost');
    await expect(publicLink).toHaveCount(0);
  });
});

// ── Tab switching ──────────────────────────────────────

test.describe('Portfolio Tab — Tab Switching', () => {
  test('can switch to portfolio tab via tab button', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-tabswitch-${TS}`, PASSWORD);

    // Start on profile page (default tab is agents)
    await page.goto('/v1/profile');
    await page.waitForLoadState('networkidle');

    // Find and click the portfolio tab button
    const portfolioTab = page.locator('.tabs button.tab').filter({ hasText: /.+/ }).first();
    // The portfolio tab is the first tab in the TABS array
    const allTabs = page.locator('.tabs button.tab');
    await expect(allTabs.first()).toBeVisible({ timeout: 10_000 });
    await allTabs.first().click();

    // Portfolio tab content should now be visible
    const tabContent = page.locator('.tab-content');
    await expect(tabContent).toBeVisible({ timeout: 5_000 });

    // The clicked tab should have the active class
    await expect(allTabs.first()).toHaveClass(/active/);
  });

  test('portfolio tab loads via URL param ?tab=portfolio', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-urlparam-${TS}`, PASSWORD);

    await page.goto('/v1/profile?tab=portfolio');
    await page.waitForLoadState('networkidle');

    const tabContent = page.locator('.tab-content');
    await expect(tabContent).toBeVisible({ timeout: 10_000 });

    // The portfolio tab button should be active
    const activeTab = page.locator('.tabs button.tab.active');
    await expect(activeTab).toBeVisible();
  });
});
