import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// E2E: Profile — Chat Sessions Tab
// Create section, prompt copy, session cards, expand/collapse, delete.
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

/** Create a session-* agent under the current owner via REST API. */
async function createSessionAgent(page: Page, agentName: string) {
  return page.evaluate(
    ([name]) => {
      const session = (window as any).AIMEAT.auth.getSession();
      return fetch('/v1/agents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, display_name: name }),
      }).then(r => r.json());
    },
    [agentName] as const,
  );
}

async function setupChatSessionsTab(page: Page, suffix: string) {
  const user = `pw-chat-${suffix}-${TS}`;
  await loadHarness(page);
  const session = await registerUser(page, user);
  expect(session).toBeTruthy();

  await page.goto('/v1/profile?tab=chatsessions');
  await page.waitForLoadState('networkidle');
  return { user, session };
}

// ── Empty state & create section ────────────────────────

test.describe('Chat Sessions — Empty State', () => {
  test('shows create section and empty message when no sessions exist', async ({ page }) => {
    await setupChatSessionsTab(page, 'empty');

    // Section title should be visible
    const title = page.locator('.section-title').first();
    await expect(title).toBeVisible({ timeout: 10_000 });

    // "Create a Chat Session" card visible
    const createCard = page.locator('.card').first();
    await expect(createCard).toBeVisible();
    await expect(createCard.locator('.card-title')).toBeVisible();

    // Two copy buttons (quick + detailed)
    const copyBtns = createCard.locator('.btn-sm.btn-copy');
    await expect(copyBtns).toHaveCount(2);

    // Empty message below create card
    const emptyMsg = page.locator('.empty');
    await expect(emptyMsg).toBeVisible();
  });
});

// ── Copy prompt buttons ─────────────────────────────────

test.describe('Chat Sessions — Copy Prompts', () => {
  test('copy quick prompt — button shows loading, toast appears', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupChatSessionsTab(page, 'quick');

    const createCard = page.locator('.card').first();
    await expect(createCard).toBeVisible({ timeout: 10_000 });

    // Click first copy button (Quick Prompt)
    const quickBtn = createCard.locator('.btn-sm.btn-copy').first();
    const originalText = await quickBtn.textContent();
    await quickBtn.click();

    // Toast appears confirming copy
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // Button should be re-enabled (not showing "..." anymore)
    await expect(quickBtn).toHaveText(originalText!, { timeout: 5_000 });
  });

  test('copy detailed prompt — toast appears', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupChatSessionsTab(page, 'detailed');

    const createCard = page.locator('.card').first();
    await expect(createCard).toBeVisible({ timeout: 10_000 });

    // Click second copy button (Detailed Prompt)
    const detailedBtn = createCard.locator('.btn-sm.btn-copy').nth(1);
    await detailedBtn.click();

    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });
  });
});

// ── Session cards ───────────────────────────────────────

test.describe('Chat Sessions — Session Cards', () => {
  test('creating a session-* agent makes it appear in the list', async ({ page }) => {
    const user = `pw-chat-card-${TS}`;
    await loadHarness(page);
    await registerUser(page, user);

    // Create a session agent via API
    const result = await createSessionAgent(page, 'session-test-1');
    expect(result.ok).not.toBe(false);

    // Navigate to chat sessions tab
    await page.goto('/v1/profile?tab=chatsessions');
    await page.waitForLoadState('networkidle');

    // Session card should appear
    const cards = page.locator('.card-clickable');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });

    // Card shows expand icon (▶) and session name
    const expandIcon = cards.first().locator('.expand-icon');
    await expect(expandIcon).toBeVisible();
    expect(await expandIcon.textContent()).toContain('▶');

    // Card title contains session name
    const cardTitle = cards.first().locator('.card-title');
    await expect(cardTitle).toContainText('session-test-1');

    // Badge with agent name
    const badge = cards.first().locator('.badge');
    await expect(badge).toBeVisible();
  });

  test('expand session card shows GAII, trust, balance, and action buttons', async ({ page }) => {
    const user = `pw-chat-expand-${TS}`;
    await loadHarness(page);
    await registerUser(page, user);
    await createSessionAgent(page, 'session-expand-1');

    await page.goto('/v1/profile?tab=chatsessions');
    await page.waitForLoadState('networkidle');

    const cardHeader = page.locator('.card-clickable').first();
    await expect(cardHeader).toBeVisible({ timeout: 10_000 });

    // Click to expand
    await cardHeader.click();

    // Card gets expanded class
    const card = page.locator('.card.card-expanded');
    await expect(card).toBeVisible({ timeout: 3_000 });

    // Expand icon changes to ▼
    const expandIcon = cardHeader.locator('.expand-icon');
    expect(await expandIcon.textContent()).toContain('▼');

    // Detail section appears
    const detail = card.locator('.card-detail');
    await expect(detail).toBeVisible();

    // Detail grid shows GAII label
    const gaiiLabel = detail.locator('.detail-label', { hasText: 'GAII' });
    await expect(gaiiLabel).toBeVisible();

    // GAII value in monospace
    const gaiiValue = detail.locator('.detail-value.mono');
    await expect(gaiiValue).toBeVisible();
    const gaii = await gaiiValue.textContent();
    expect(gaii).toContain('session-expand-1');

    // Trust score
    const trustLabel = detail.locator('.detail-label', { hasText: /trust/i });
    await expect(trustLabel).toBeVisible();

    // Balance
    const balanceLabel = detail.locator('.detail-label', { hasText: /balance/i });
    await expect(balanceLabel).toBeVisible();

    // Action buttons: Copy GAII + Remove
    const copyGaiiBtn = detail.locator('.btn-sm.btn-copy');
    await expect(copyGaiiBtn).toBeVisible();
    const removeBtn = detail.locator('.btn-sm.btn-danger');
    await expect(removeBtn).toBeVisible();
  });

  test('collapse expanded session card', async ({ page }) => {
    const user = `pw-chat-collapse-${TS}`;
    await loadHarness(page);
    await registerUser(page, user);
    await createSessionAgent(page, 'session-collapse-1');

    await page.goto('/v1/profile?tab=chatsessions');
    await page.waitForLoadState('networkidle');

    const cardHeader = page.locator('.card-clickable').first();
    await expect(cardHeader).toBeVisible({ timeout: 10_000 });

    // Expand
    await cardHeader.click();
    await expect(page.locator('.card-detail')).toBeVisible({ timeout: 3_000 });

    // Collapse by clicking again
    await cardHeader.click();
    await expect(page.locator('.card-detail')).not.toBeVisible({ timeout: 3_000 });

    // Icon back to ▶
    const expandIcon = cardHeader.locator('.expand-icon');
    expect(await expandIcon.textContent()).toContain('▶');
  });

  test('copy GAII button copies and does not collapse card', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const user = `pw-chat-copygaii-${TS}`;
    await loadHarness(page);
    await registerUser(page, user);
    await createSessionAgent(page, 'session-copygaii-1');

    await page.goto('/v1/profile?tab=chatsessions');
    await page.waitForLoadState('networkidle');

    // Expand
    const cardHeader = page.locator('.card-clickable').first();
    await expect(cardHeader).toBeVisible({ timeout: 10_000 });
    await cardHeader.click();
    await expect(page.locator('.card-detail')).toBeVisible({ timeout: 3_000 });

    // Click "Copy GAII"
    const copyBtn = page.locator('.card-detail .btn-sm.btn-copy');
    await copyBtn.click();

    // Toast appears
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // Card should still be expanded (stopPropagation)
    await expect(page.locator('.card-detail')).toBeVisible();
  });
});

// ── Delete session ──────────────────────────────────────

test.describe('Chat Sessions — Delete', () => {
  test('remove session — accept confirm dialog, card disappears', async ({ page }) => {
    const user = `pw-chat-delete-${TS}`;
    await loadHarness(page);
    await registerUser(page, user);
    await createSessionAgent(page, 'session-delete-1');

    await page.goto('/v1/profile?tab=chatsessions');
    await page.waitForLoadState('networkidle');

    // Expand the session card
    const cardHeader = page.locator('.card-clickable').first();
    await expect(cardHeader).toBeVisible({ timeout: 10_000 });
    await cardHeader.click();
    await expect(page.locator('.card-detail')).toBeVisible({ timeout: 3_000 });

    // Auto-accept the confirm dialog
    page.on('dialog', dialog => dialog.accept());

    // Click "Remove"
    const removeBtn = page.locator('.card-detail .btn-sm.btn-danger');
    await removeBtn.click();

    // Card should disappear
    await expect(cardHeader).not.toBeVisible({ timeout: 10_000 });

    // Toast confirms deletion
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // Empty message should appear (was the only session)
    const emptyMsg = page.locator('.empty');
    await expect(emptyMsg).toBeVisible({ timeout: 5_000 });
  });

  test('remove session — cancel dialog, card remains', async ({ page }) => {
    const user = `pw-chat-cancel-${TS}`;
    await loadHarness(page);
    await registerUser(page, user);
    await createSessionAgent(page, 'session-cancel-1');

    await page.goto('/v1/profile?tab=chatsessions');
    await page.waitForLoadState('networkidle');

    // Expand
    const cardHeader = page.locator('.card-clickable').first();
    await expect(cardHeader).toBeVisible({ timeout: 10_000 });
    await cardHeader.click();
    await expect(page.locator('.card-detail')).toBeVisible({ timeout: 3_000 });

    // Dismiss the confirm dialog
    page.on('dialog', dialog => dialog.dismiss());

    // Click "Remove"
    const removeBtn = page.locator('.card-detail .btn-sm.btn-danger');
    await removeBtn.click();

    // Card should still be there
    await expect(cardHeader).toBeVisible();
    await expect(page.locator('.card-detail')).toBeVisible();

    // No empty message
    await expect(page.locator('.empty')).not.toBeVisible();
  });
});

// ── Multiple sessions ───────────────────────────────────

test.describe('Chat Sessions — Multiple', () => {
  test('multiple session agents listed, expand one at a time', async ({ page }) => {
    const user = `pw-chat-multi-${TS}`;
    await loadHarness(page);
    await registerUser(page, user);

    // Create 3 session agents
    await createSessionAgent(page, 'session-alpha');
    await createSessionAgent(page, 'session-beta');
    await createSessionAgent(page, 'session-gamma');

    await page.goto('/v1/profile?tab=chatsessions');
    await page.waitForLoadState('networkidle');

    // Should have 3 session cards
    const cards = page.locator('.card-clickable');
    await expect(cards).toHaveCount(3, { timeout: 10_000 });

    // Expand first
    await cards.nth(0).click();
    await expect(page.locator('.card-expanded')).toHaveCount(1);
    const detail1 = page.locator('.card-detail');
    await expect(detail1).toBeVisible();

    // Expand second — first should collapse (only one expanded at a time)
    await cards.nth(1).click();
    await expect(page.locator('.card-expanded')).toHaveCount(1);

    // Expand third
    await cards.nth(2).click();
    await expect(page.locator('.card-expanded')).toHaveCount(1);
    const detail3 = page.locator('.card-detail');
    await expect(detail3).toBeVisible();
    expect(await detail3.locator('.detail-value.mono').textContent()).toContain('session-gamma');
  });
});
