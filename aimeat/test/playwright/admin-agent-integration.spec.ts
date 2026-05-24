import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// E2E: Admin Dashboard -- Agent Integration Tab
// Platform Registry, Onboarding Overview, Readiness Distribution,
// and Skill Bundle Management sections.
// ═══════════════════════════════════════════════════════

const TS = Date.now();
const PASSWORD = 'TestPass42!';

async function loadHarness(page: Page) {
  await page.goto('/v1/libs/test-harness');
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 10_000 });
}

async function registerUser(page: Page, username: string) {
  return page.evaluate(
    ([u, p]) => (window as any).AIMEAT.auth.register(u, u, { password: p }),
    [username, PASSWORD] as const,
  );
}

async function gotoAgentIntegrationTab(page: Page) {
  await page.goto('/v1/admin?tab=agent-integration');
  await expect(page.locator('.adm')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2000);
}

test.describe('Admin Agent Integration Tab', () => {

  test.beforeEach(async ({ page }) => {
    const user = `pw-admagi-${TS}-${Math.random().toString(36).slice(2, 6)}`;
    await loadHarness(page);
    const session = await registerUser(page, user);
    expect(session).toBeTruthy();
    await gotoAgentIntegrationTab(page);
  });

  test('Agent Integration tab appears in admin sidebar', async ({ page }) => {
    const navItem = page.locator('.adm-nav-item', { hasText: /Agent Integration/i });
    await expect(navItem).toBeVisible({ timeout: 10_000 });
  });

  test('Platform Registry section renders', async ({ page }) => {
    const section = page.locator('.adm-agi-section-title', { hasText: /Platform Registry/i });
    await expect(section).toBeVisible({ timeout: 10_000 });

    const table = page.locator('.adm-agi-table').first();
    await expect(table).toBeVisible({ timeout: 10_000 });
  });

  test('Onboarding Overview section renders with stat cards', async ({ page }) => {
    const section = page.locator('.adm-agi-section-title', { hasText: /Onboarding Overview/i });
    await expect(section).toBeVisible({ timeout: 10_000 });

    const statCards = page.locator('.adm-agi-stat-card');
    const count = await statCards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('Readiness Distribution section renders', async ({ page }) => {
    const section = page.locator('.adm-agi-section-title', { hasText: /Readiness Distribution/i });
    await expect(section).toBeVisible({ timeout: 10_000 });
  });

  test('Skill Bundles section renders with regenerate button', async ({ page }) => {
    const section = page.locator('.adm-agi-section-title', { hasText: /Skill Bundles/i });
    await expect(section).toBeVisible({ timeout: 10_000 });

    const regenBtn = page.locator('.adm-agi-regen-btn');
    await expect(regenBtn).toBeVisible();
  });
});
