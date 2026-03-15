/**
 * @file profile-packages.spec.ts
 * @description Playwright E2E tests for the Profile — Packages Tab. Verifies
 *   sub-view navigation (My Instances, Browse Packages, Template Gallery),
 *   empty states, filter controls, and view switching.
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation
 */
import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// E2E: Profile — Packages Tab
// My Instances, Browse Packages, Template Gallery sub-views.
// ═══════════════════════════════════════════════════════

const TS = Date.now();
const PASSWORD = 'TestPass42!';

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

/** Register, navigate to profile packages tab. */
async function setupPackagesTab(page: Page, suffix: string) {
  const user = `pw-pkg-${suffix}-${TS}`;
  await loadHarness(page);
  const session = await registerUser(page, user);
  expect(session).toBeTruthy();
  await page.goto('/v1/profile?tab=packages');
  await page.waitForLoadState('networkidle');
  return { user, session };
}

// ── Navigation ──────────────────────────────────────────

test.describe('Packages — Navigation', () => {
  test('packages tab loads with three sub-view navigation buttons', async ({ page }) => {
    await setupPackagesTab(page, 'nav');

    const pkgTab = page.locator('.pkg-tab');
    await expect(pkgTab).toBeVisible({ timeout: 10_000 });

    const navButtons = page.locator('.pkg-nav button');
    await expect(navButtons).toHaveCount(3);

    // First button (My Instances) should be active by default
    await expect(navButtons.nth(0)).toHaveClass(/active/);
    await expect(navButtons.nth(1)).not.toHaveClass(/active/);
    await expect(navButtons.nth(2)).not.toHaveClass(/active/);
  });

  test('clicking each nav button switches visible content', async ({ page }) => {
    await setupPackagesTab(page, 'switch');

    const navButtons = page.locator('.pkg-nav button');
    await expect(navButtons.first()).toBeVisible({ timeout: 10_000 });

    // Default: instances view — section with heading visible
    const section = page.locator('.pkg-section');
    await expect(section).toBeVisible({ timeout: 5_000 });

    // Click Browse Packages (2nd button)
    await navButtons.nth(1).click();
    await expect(navButtons.nth(1)).toHaveClass(/active/);
    await expect(navButtons.nth(0)).not.toHaveClass(/active/);

    // Browse view should show filters
    const filters = page.locator('.pkg-filters');
    await expect(filters).toBeVisible({ timeout: 5_000 });

    // Click Template Gallery (3rd button)
    await navButtons.nth(2).click();
    await expect(navButtons.nth(2)).toHaveClass(/active/);
    await expect(navButtons.nth(1)).not.toHaveClass(/active/);

    // Gallery section visible
    await expect(section).toBeVisible({ timeout: 5_000 });

    // Click back to My Instances (1st button)
    await navButtons.nth(0).click();
    await expect(navButtons.nth(0)).toHaveClass(/active/);
    await expect(navButtons.nth(2)).not.toHaveClass(/active/);
  });
});

// ── My Instances ────────────────────────────────────────

test.describe('Packages — My Instances', () => {
  test('shows empty message when no packages installed', async ({ page }) => {
    await setupPackagesTab(page, 'empty');

    const pkgTab = page.locator('.pkg-tab');
    await expect(pkgTab).toBeVisible({ timeout: 10_000 });

    // Empty state message should be visible for a new user
    const emptyMsg = page.locator('.pkg-empty');
    await expect(emptyMsg).toBeVisible({ timeout: 5_000 });

    // The empty text should be non-empty
    const text = await emptyMsg.textContent();
    expect(text!.trim().length).toBeGreaterThan(0);
  });
});

// ── Browse Packages ─────────────────────────────────────

test.describe('Packages — Browse', () => {
  test('browse view shows search input and category select filter', async ({ page }) => {
    await setupPackagesTab(page, 'browse');

    const navButtons = page.locator('.pkg-nav button');
    await expect(navButtons.first()).toBeVisible({ timeout: 10_000 });

    // Switch to Browse view
    await navButtons.nth(1).click();
    await expect(navButtons.nth(1)).toHaveClass(/active/);

    // Filters container visible
    const filters = page.locator('.pkg-filters');
    await expect(filters).toBeVisible({ timeout: 5_000 });

    // Search input
    const searchInput = filters.locator('input[type="text"]');
    await expect(searchInput).toBeVisible();

    // Category select dropdown
    const categorySelect = filters.locator('select');
    await expect(categorySelect).toBeVisible();

    // Select should have multiple options (All Categories + specific categories)
    const options = categorySelect.locator('option');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThanOrEqual(2);
  });
});

// ── Template Gallery ────────────────────────────────────

test.describe('Packages — Template Gallery', () => {
  test('gallery view shows heading', async ({ page }) => {
    await setupPackagesTab(page, 'gallery');

    const navButtons = page.locator('.pkg-nav button');
    await expect(navButtons.first()).toBeVisible({ timeout: 10_000 });

    // Switch to Gallery view
    await navButtons.nth(2).click();
    await expect(navButtons.nth(2)).toHaveClass(/active/);

    // Gallery section with heading visible
    const section = page.locator('.pkg-section');
    await expect(section).toBeVisible({ timeout: 5_000 });

    const heading = section.locator('h3');
    await expect(heading).toBeVisible();
    const headingText = await heading.textContent();
    expect(headingText!.trim().length).toBeGreaterThan(0);
  });
});
