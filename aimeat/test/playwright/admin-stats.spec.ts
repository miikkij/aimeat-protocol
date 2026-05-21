import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// E2E: Admin Dashboard -- Stats Tab
// Time range selector, email delivery, push notifications,
// and mailbox notification sections in the admin stats view.
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

/** Navigate to admin dashboard and open the Stats tab. */
async function gotoStatsTab(page: Page) {
  // Use ?tab=stats to go directly to the Stats tab
  await page.goto('/v1/admin?tab=stats');
  // Wait for the admin container to render
  await expect(page.locator('.adm')).toBeVisible({ timeout: 10_000 });
  // Wait for dashboard data to load and Stats tab content to appear
  await page.waitForTimeout(2000);
  // Verify the stats tab content rendered (time range selector is the first element)
  await expect(page.locator('.adm-time-range')).toBeVisible({ timeout: 15_000 });
}

test.describe('Admin Stats Tab', () => {

  test.beforeEach(async ({ page }) => {
    const user = `pw-admstats-${TS}-${Math.random().toString(36).slice(2, 6)}`;
    await loadHarness(page);
    const session = await registerUser(page, user);
    expect(session).toBeTruthy();
    await gotoStatsTab(page);
  });

  // ── TC-01: Time range selector renders with 7 Days active by default ──

  test('time range selector renders with 7 Days active by default', async ({ page }) => {
    // The time range bar should be visible
    const timeRange = page.locator('.adm-time-range');
    await expect(timeRange).toBeVisible();

    // "7 Days" button should have the active class (default period is '7d')
    const activeBtn = timeRange.locator('button.adm-time-btn.active');
    await expect(activeBtn).toBeVisible();
    const activeBtnText = await activeBtn.textContent();
    expect(activeBtnText).toContain('7 Days');

    // Date inputs for custom range should be present
    const dateInputs = timeRange.locator('input[type="date"]');
    expect(await dateInputs.count()).toBe(2);
  });

  // ── TC-02: Time range buttons switch active state ──

  test('time range buttons switch active state', async ({ page }) => {
    const timeRange = page.locator('.adm-time-range');
    await expect(timeRange).toBeVisible();

    // Click "Today" button
    const todayBtn = timeRange.locator('button.adm-time-btn', { hasText: 'Today' });
    await expect(todayBtn).toBeVisible();
    await todayBtn.click();
    await page.waitForTimeout(500);

    // "Today" should now be active
    await expect(todayBtn).toHaveClass(/active/);

    // "7 Days" should no longer be active
    const sevenDaysBtn = timeRange.locator('button.adm-time-btn', { hasText: '7 Days' });
    await expect(sevenDaysBtn).not.toHaveClass(/active/);

    // Click "All" button
    const allBtn = timeRange.locator('button.adm-time-btn', { hasText: 'All' });
    await expect(allBtn).toBeVisible();
    await allBtn.click();
    await page.waitForTimeout(500);

    // "All" should now be active
    await expect(allBtn).toHaveClass(/active/);

    // "Today" should no longer be active
    await expect(todayBtn).not.toHaveClass(/active/);
  });

  // ── TC-03: Email delivery section renders ──

  test('email delivery section renders', async ({ page }) => {
    // Verify "Email Delivery" section header exists
    const emailHeader = page.locator('h3.adm-section-cyan', { hasText: /Email Delivery/i });
    await expect(emailHeader).toBeVisible({ timeout: 10_000 });

    // Verify stat cards: Emails Sent, Emails Failed, Emails Retried, Success Rate
    // The stat cards (adm-card) are in an adm-grid container following the header
    const emailGrid = emailHeader.locator('+ .adm-grid');
    await expect(emailGrid).toBeVisible();

    const emailsSent = emailGrid.locator('.adm-card', { hasText: /Emails Sent/i });
    await expect(emailsSent).toBeVisible();

    const emailsFailed = emailGrid.locator('.adm-card', { hasText: /Emails Failed/i });
    await expect(emailsFailed).toBeVisible();

    const emailsRetried = emailGrid.locator('.adm-card', { hasText: /Emails Retried/i });
    await expect(emailsRetried).toBeVisible();

    const successRate = emailGrid.locator('.adm-card', { hasText: /Success Rate/i });
    await expect(successRate).toBeVisible();
  });

  // ── TC-04: Push notification section renders ──

  test('push notification section renders', async ({ page }) => {
    // Verify "Push Notifications" section header exists
    const pushHeader = page.locator('h3.adm-section-violet', { hasText: /Push Notifications/i });
    await expect(pushHeader).toBeVisible({ timeout: 10_000 });

    // Verify stat cards (adm-card): Push Sent, Push Failed, Expired Subs, Success Rate
    const pushGrid = pushHeader.locator('+ .adm-grid');
    await expect(pushGrid).toBeVisible();

    const pushSent = pushGrid.locator('.adm-card', { hasText: /Push Sent/i });
    await expect(pushSent).toBeVisible();

    const pushFailed = pushGrid.locator('.adm-card', { hasText: /Push Failed/i });
    await expect(pushFailed).toBeVisible();

    const expiredSubs = pushGrid.locator('.adm-card', { hasText: /Expired Subs/i });
    await expect(expiredSubs).toBeVisible();

    const successRate = pushGrid.locator('.adm-card', { hasText: /Success Rate/i });
    await expect(successRate).toBeVisible();
  });

  // ── TC-05: Mailbox notification section renders ──

  test('mailbox notification section renders', async ({ page }) => {
    // Verify "Mailbox Notifications" section header exists
    const mailboxHeader = page.locator('h3.adm-section-amber', { hasText: /Mailbox Notifications/i });
    await expect(mailboxHeader).toBeVisible({ timeout: 10_000 });

    // Verify stat cards (adm-card): Mailbox Sent, Mailbox Failed, Mailbox Blocked
    const mailboxGrid = mailboxHeader.locator('+ .adm-grid');
    await expect(mailboxGrid).toBeVisible();

    const mailboxSent = mailboxGrid.locator('.adm-card', { hasText: /Mailbox Sent/i });
    await expect(mailboxSent).toBeVisible();

    const mailboxFailed = mailboxGrid.locator('.adm-card', { hasText: /Mailbox Failed/i });
    await expect(mailboxFailed).toBeVisible();

    const mailboxBlocked = mailboxGrid.locator('.adm-card', { hasText: /Mailbox Blocked/i });
    await expect(mailboxBlocked).toBeVisible();
  });

});
