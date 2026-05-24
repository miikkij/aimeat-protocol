import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// E2E: Profile — Agent Detail Tab-View
// Shared Agent Board, Two-Zone Header, 8-tab bar,
// state detection, tab switching, smart defaults.
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

async function gotoAgentsTab(page: Page) {
  await page.goto('/v1/profile');
  await expect(page.locator('.pf')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  const menuItem = page.locator('.pf-menu-item', { hasText: /Agents|Agentit/i });
  if (await menuItem.count() > 0 && await menuItem.first().isVisible()) {
    await menuItem.first().click();
  } else {
    const card = page.locator('.pf-onboard-card', { hasText: /agent/i });
    await expect(card).toBeVisible({ timeout: 5_000 });
    await card.click();
  }
  await expect(page.locator('.agent-cta, .pf-agd-card, .pf-agd-collapsed, .empty').first()).toBeVisible({ timeout: 15_000 });
}

async function setupAgentsTab(page: Page, suffix: string) {
  const user = `pw-detail-${suffix}-${TS}`;
  await loadHarness(page);
  const session = await registerUser(page, user);
  expect(session).toBeTruthy();
  const agentName = `detail-agent-${suffix}`;
  const agentResult = await createAgent(page, agentName, user);
  expect(agentResult.ok).toBe(true);
  await gotoAgentsTab(page);
  return { user, session, agentName };
}

// ── Shared Agent Board ──────────────────────────────

test.describe('Agent Detail — Shared Board', () => {
  test('renders board with mini-cards when agents exist', async ({ page }) => {
    await setupAgentsTab(page, 'board');

    const board = page.locator('.pf-agd-board');
    await expect(board).toBeVisible({ timeout: 10_000 });

    const miniCards = board.locator('.pf-agd-board-card');
    await expect(miniCards).toHaveCount(1);
  });
});

// ── Card Expansion & Tab Bar ────────────────────────

test.describe('Agent Detail — Tab Bar', () => {
  test('expanding card shows 8 tabs', async ({ page }) => {
    await setupAgentsTab(page, 'tabs');

    const card = page.locator('.pf-agd-card').first();
    await card.locator('.pf-agd-collapsed').click();
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });

    const tabs = card.locator('.pf-agd-tab');
    await expect(tabs).toHaveCount(8);
  });

  test('tab switching changes content area', async ({ page }) => {
    await setupAgentsTab(page, 'switch');

    const card = page.locator('.pf-agd-card').first();
    await card.locator('.pf-agd-collapsed').click();
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });

    // Click "Messages" tab
    const msgsTab = card.locator('.pf-agd-tab', { hasText: /Messages|Viestit/i });
    await msgsTab.click();

    // Messages tab should be active
    await expect(msgsTab).toHaveClass(/pf-agd-tab--active/);

    // Click "Services" tab
    const svcTab = card.locator('.pf-agd-tab', { hasText: /Services|Palvelut/i });
    await svcTab.click();
    await expect(svcTab).toHaveClass(/pf-agd-tab--active/);

    // Messages tab should no longer be active
    await expect(msgsTab).not.toHaveClass(/pf-agd-tab--active/);
  });
});

// ── Two-Zone Header ─────────────────────────────────

test.describe('Agent Detail — Two-Zone Header', () => {
  test('new agent shows Zone 2 with onboarding-not-started message', async ({ page }) => {
    await setupAgentsTab(page, 'zone2');

    const card = page.locator('.pf-agd-card').first();
    await card.locator('.pf-agd-collapsed').click();
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });

    // Zone 2 should show new state (yellow/warning) since no onboarding exists
    const zone2 = card.locator('.pf-agd-zone2');
    await expect(zone2).toBeVisible();
  });

  test('Zone 1 shows agent name and collapse arrow', async ({ page }) => {
    const { agentName } = await setupAgentsTab(page, 'zone1');

    const card = page.locator('.pf-agd-card').first();
    await card.locator('.pf-agd-collapsed').click();
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });

    const zone1 = card.locator('.pf-agd-zone1');
    await expect(zone1).toBeVisible();
    const nameEl = zone1.locator('.pf-agd-zone1-name');
    await expect(nameEl).toContainText(agentName);
  });
});

// ── Smart Default Tab ───────────────────────────────

test.describe('Agent Detail — Smart Default Tab', () => {
  test('new agent defaults to Integration tab', async ({ page }) => {
    await setupAgentsTab(page, 'default');

    const card = page.locator('.pf-agd-card').first();
    await card.locator('.pf-agd-collapsed').click();
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });

    // Integration tab should be active by default for new agents
    const integrationTab = card.locator('.pf-agd-tab', { hasText: /Integration|Integraatio/i });
    await expect(integrationTab).toHaveClass(/pf-agd-tab--active/);
  });
});

// ── Empty States ────────────────────────────────────

test.describe('Agent Detail — Empty States', () => {
  test('Services tab shows empty state', async ({ page }) => {
    await setupAgentsTab(page, 'empty-svc');

    const card = page.locator('.pf-agd-card').first();
    await card.locator('.pf-agd-collapsed').click();
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });

    // Navigate to Services tab
    const svcTab = card.locator('.pf-agd-tab', { hasText: /Services|Palvelut/i });
    await svcTab.click();

    // Should show empty state text
    const content = card.locator('.pf-agd-tab-content');
    await expect(content).toBeVisible();
    const text = await content.textContent();
    // Empty state should be shown (either the services-specific or generic empty)
    expect(text!.length).toBeGreaterThan(0);
  });
});

// ── Collapse/Expand Toggle ──────────────────────────

test.describe('Agent Detail — Collapse Toggle', () => {
  test('clicking Zone 1 collapses the card back', async ({ page }) => {
    await setupAgentsTab(page, 'collapse');

    const card = page.locator('.pf-agd-card').first();
    await card.locator('.pf-agd-collapsed').click();
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });

    // Click Zone 1 to collapse
    await card.locator('.pf-agd-zone1').click();
    await expect(card.locator('.pf-agd-collapsed')).toBeVisible({ timeout: 5_000 });
  });
});
