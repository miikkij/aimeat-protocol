import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// E2E: Profile — Wallet Tab
// Balance overview, request morsels, transaction history,
// expand/collapse transactions, copy actions.
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

/** Register, navigate to profile wallet tab. */
async function setupWalletTab(page: Page, suffix: string) {
  const user = `pw-wallet-${suffix}-${TS}`;
  await loadHarness(page);
  const session = await registerUser(page, user);
  expect(session).toBeTruthy();

  await page.goto('/v1/profile?tab=wallet');
  await page.waitForLoadState('networkidle');
  return { user, session };
}

// ── Balance overview ────────────────────────────────────

test.describe('Wallet — Balance Overview', () => {
  test('shows 4 wallet cards with numeric values', async ({ page }) => {
    await setupWalletTab(page, 'balance');

    // Wait for wallet overview to load (spinner gone, cards visible)
    const overview = page.locator('.wallet-overview');
    await expect(overview).toBeVisible({ timeout: 10_000 });

    // 4 wallet cards
    const cards = overview.locator('.wallet-card');
    await expect(cards).toHaveCount(4);

    // Each card has an .amount and a .wlabel
    for (let i = 0; i < 4; i++) {
      const amount = cards.nth(i).locator('.amount');
      await expect(amount).toBeVisible();
      const text = await amount.textContent();
      // Should be a number (possibly 0)
      expect(Number(text)).toBeGreaterThanOrEqual(0);

      const label = cards.nth(i).locator('.wlabel');
      await expect(label).toBeVisible();
      expect((await label.textContent())!.trim().length).toBeGreaterThan(0);
    }
  });

  test('copy balance button works', async ({ page, context }) => {
    // Grant clipboard permissions for this test
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupWalletTab(page, 'copy');

    await expect(page.locator('.wallet-overview')).toBeVisible({ timeout: 10_000 });

    const copyBtn = page.locator('.wallet-balance-copy');
    await expect(copyBtn).toBeVisible();

    // Get original text
    const originalText = await copyBtn.textContent();

    // Click copy
    await copyBtn.click();

    // Button text changes to "Copied" (or translated equivalent)
    await expect(copyBtn).not.toHaveText(originalText!, { timeout: 3_000 });

    // Reverts back after ~2 seconds
    await expect(copyBtn).toHaveText(originalText!, { timeout: 5_000 });
  });
});

// ── Request morsels ─────────────────────────────────────

test.describe('Wallet — Request Morsels', () => {
  test('request form has amount input, reason input, and submit button', async ({ page }) => {
    await setupWalletTab(page, 'form');

    const form = page.locator('.wallet-request');
    await expect(form).toBeVisible({ timeout: 10_000 });

    // Title and description
    const title = form.locator('.wr-title');
    await expect(title).toBeVisible();

    // Amount input (type=number, required)
    const amountInput = form.locator('input[type=number]');
    await expect(amountInput).toBeVisible();
    expect(await amountInput.getAttribute('min')).toBe('1');
    expect(await amountInput.getAttribute('max')).toBe('500');
    expect(await amountInput.getAttribute('required')).not.toBeNull();

    // Reason input
    const reasonInput = form.locator('input[type=text]');
    await expect(reasonInput).toBeVisible();

    // Submit button
    const submitBtn = form.locator('.wr-submit');
    await expect(submitBtn).toBeVisible();
  });

  test('request 10 morsels — balance updates, toast shown, form clears', async ({ page }) => {
    await setupWalletTab(page, 'request');

    await expect(page.locator('.wallet-overview')).toBeVisible({ timeout: 10_000 });

    // Read initial balance
    const balanceCard = page.locator('.wallet-card').first().locator('.amount');
    const initialBalance = Number(await balanceCard.textContent());

    // Fill in request form
    const amountInput = page.locator('.wallet-request input[type=number]');
    const reasonInput = page.locator('.wallet-request input[type=text]');
    const submitBtn = page.locator('.wr-submit');

    await amountInput.fill('10');
    await reasonInput.fill('testing E2E');
    await submitBtn.click();

    // Toast should appear with grant message
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });
    const toastText = await toast.textContent();
    expect(toastText).toContain('10');

    // Form clears after success
    await expect(amountInput).toHaveValue('');
    await expect(reasonInput).toHaveValue('');

    // Balance should increase
    await expect(balanceCard).not.toHaveText(String(initialBalance), { timeout: 5_000 });
    const newBalance = Number(await balanceCard.textContent());
    expect(newBalance).toBeGreaterThan(initialBalance);
  });

  test('request again — second request also works', async ({ page }) => {
    await setupWalletTab(page, 'twice');

    await expect(page.locator('.wallet-overview')).toBeVisible({ timeout: 10_000 });

    const amountInput = page.locator('.wallet-request input[type=number]');
    const submitBtn = page.locator('.wr-submit');

    // First request
    await amountInput.fill('5');
    await submitBtn.click();
    await expect(page.locator('.toast')).toBeVisible({ timeout: 5_000 });

    // Wait for toast to clear
    await page.waitForTimeout(3500);

    // Second request
    await amountInput.fill('5');
    await submitBtn.click();
    await expect(page.locator('.toast')).toBeVisible({ timeout: 5_000 });
    const toastText = await page.locator('.toast').textContent();
    expect(toastText).toContain('5');
  });
});

// ── Transaction history ─────────────────────────────────

test.describe('Wallet — Transaction History', () => {
  test('new user with no transactions shows empty state', async ({ page }) => {
    await setupWalletTab(page, 'empty');

    await expect(page.locator('.wallet-overview')).toBeVisible({ timeout: 10_000 });

    // The "empty" div or "No transactions" message should appear
    // (A brand new user may get a welcome bonus, which creates a transaction.
    //  If so, the tx-list would exist instead. We check for either.)
    const txList = page.locator('.tx-list');
    const emptyMsg = page.locator('.empty');

    // One of these should be visible
    const hasTxList = await txList.isVisible().catch(() => false);
    const hasEmpty = await emptyMsg.isVisible().catch(() => false);
    expect(hasTxList || hasEmpty).toBe(true);
  });

  test('after requesting morsels, transaction appears in list', async ({ page }) => {
    await setupWalletTab(page, 'txlist');

    await expect(page.locator('.wallet-overview')).toBeVisible({ timeout: 10_000 });

    // Request some morsels to create a transaction
    await page.locator('.wallet-request input[type=number]').fill('7');
    await page.locator('.wr-submit').click();
    await expect(page.locator('.toast')).toBeVisible({ timeout: 5_000 });

    // Transaction list should now show at least one item
    const txItems = page.locator('.tx-item');
    await expect(txItems.first()).toBeVisible({ timeout: 10_000 });

    // Transaction shows amount
    const amount = txItems.first().locator('.tx-amount');
    await expect(amount).toBeVisible();
    const amountText = await amount.textContent();
    expect(amountText).toBeTruthy();

    // Transaction shows type label
    const typeLabel = txItems.first().locator('.tx-type');
    await expect(typeLabel).toBeVisible();

    // Transaction shows time
    const dateText = txItems.first().locator('.tx-date');
    await expect(dateText).toBeVisible();

    // Chevron visible (▼ for collapsed)
    const chevron = txItems.first().locator('span').last();
    expect(await chevron.textContent()).toContain('▼');
  });

  test('click transaction to expand details, click again to collapse', async ({ page }) => {
    await setupWalletTab(page, 'expand');

    await expect(page.locator('.wallet-overview')).toBeVisible({ timeout: 10_000 });

    // Create a transaction first
    await page.locator('.wallet-request input[type=number]').fill('5');
    await page.locator('.wr-submit').click();
    await expect(page.locator('.toast')).toBeVisible({ timeout: 5_000 });

    // Wait for tx list
    const txItem = page.locator('.tx-item').first();
    await expect(txItem).toBeVisible({ timeout: 10_000 });

    // No detail section initially
    await expect(page.locator('.tx-detail')).toHaveCount(0);

    // Click to expand
    await txItem.click();

    // Detail section appears
    const detail = page.locator('.tx-detail');
    await expect(detail).toBeVisible({ timeout: 3_000 });

    // Detail shows ID and Type labels
    const labels = detail.locator('.tx-detail-label');
    const labelCount = await labels.count();
    expect(labelCount).toBeGreaterThanOrEqual(1);

    // "Copy Transaction" button in detail
    const copyTxBtn = detail.locator('.tx-copy-btn');
    await expect(copyTxBtn).toBeVisible();

    // Click again to collapse
    await txItem.click();
    await expect(detail).not.toBeVisible({ timeout: 3_000 });
  });

  test('copy transaction details button changes text temporarily', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupWalletTab(page, 'copytx');

    await expect(page.locator('.wallet-overview')).toBeVisible({ timeout: 10_000 });

    // Create transaction
    await page.locator('.wallet-request input[type=number]').fill('3');
    await page.locator('.wr-submit').click();
    await expect(page.locator('.toast')).toBeVisible({ timeout: 5_000 });

    // Expand first transaction
    const txItem = page.locator('.tx-item').first();
    await expect(txItem).toBeVisible({ timeout: 10_000 });
    await txItem.click();

    const detail = page.locator('.tx-detail');
    await expect(detail).toBeVisible({ timeout: 3_000 });

    // Click copy button
    const copyBtn = detail.locator('.tx-copy-btn');
    const originalText = await copyBtn.textContent();
    await copyBtn.click();

    // Text changes (to "Copied" or translated equivalent)
    await expect(copyBtn).not.toHaveText(originalText!, { timeout: 3_000 });

    // Reverts back
    await expect(copyBtn).toHaveText(originalText!, { timeout: 5_000 });
  });

  test('credit transactions show positive styling', async ({ page }) => {
    await setupWalletTab(page, 'credit');

    await expect(page.locator('.wallet-overview')).toBeVisible({ timeout: 10_000 });

    // Request morsels (creates a credit transaction)
    await page.locator('.wallet-request input[type=number]').fill('5');
    await page.locator('.wr-submit').click();
    await expect(page.locator('.toast')).toBeVisible({ timeout: 5_000 });

    // Find the credit transaction amount
    const creditAmount = page.locator('.tx-amount.credit');
    await expect(creditAmount.first()).toBeVisible({ timeout: 10_000 });

    // Credit amounts should start with "+"
    const text = await creditAmount.first().textContent();
    expect(text).toMatch(/^\+/);
  });
});

// ── Tab switching ───────────────────────────────────────

test.describe('Wallet — Tab Navigation', () => {
  test('switch to wallet tab and back, data persists', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-wallet-nav-${TS}`);

    await page.goto('/v1/profile');
    await page.waitForLoadState('networkidle');

    const allTabs = page.locator('.tabs button.tab');
    await expect(allTabs.first()).toBeVisible({ timeout: 10_000 });

    // Find wallet tab (4th tab, index 3)
    const walletTab = allTabs.nth(3);
    await walletTab.click();
    await expect(walletTab).toHaveClass(/active/);

    // Wallet overview loads
    await expect(page.locator('.wallet-overview')).toBeVisible({ timeout: 10_000 });

    // Switch to portfolio tab (first tab)
    await allTabs.first().click();
    await expect(allTabs.first()).toHaveClass(/active/);

    // Wallet overview should be hidden
    await expect(page.locator('.wallet-overview')).not.toBeVisible();

    // Switch back to wallet — data should still be there (component stays mounted)
    await walletTab.click();
    await expect(page.locator('.wallet-overview')).toBeVisible({ timeout: 3_000 });
  });

  test('?tab=wallet URL param loads wallet directly', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-wallet-url-${TS}`);

    await page.goto('/v1/profile?tab=wallet');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.wallet-overview')).toBeVisible({ timeout: 10_000 });

    // Wallet tab should be active
    const allTabs = page.locator('.tabs button.tab');
    await expect(allTabs.nth(3)).toHaveClass(/active/);
  });
});
