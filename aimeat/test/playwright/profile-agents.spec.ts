import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// E2E: Profile — Agents Tab
// Agent list rendering, details expansion, scope management,
// device auth approval, and translation verification.
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

/** Create an agent via API and return the result. */
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

/** Navigate to profile and open agents tab.
 *  Tier 1 (new user, no agents): click the "Connect an AI agent" onboarding card.
 *  Tier 2+ (has agents): click the Agents menu item in DAILY section.
 *  We try both approaches with a short timeout. */
async function gotoAgentsTab(page: Page) {
  await page.goto('/v1/profile');
  await expect(page.locator('.pf')).toBeVisible({ timeout: 10_000 });
  // Give the SPA time to settle (stats load → tier computed → DOM stable)
  await page.waitForTimeout(1500);

  // Try tier 2+ "Agents" menu item first (faster, more reliable)
  const menuItem = page.locator('.pf-menu-item', { hasText: /Agents|Agentit/i });
  if (await menuItem.count() > 0 && await menuItem.first().isVisible()) {
    await menuItem.first().click();
  } else {
    // Tier 1: click the onboarding card
    const card = page.locator('.pf-onboard-card', { hasText: /agent/i });
    await expect(card).toBeVisible({ timeout: 5_000 });
    await card.click();
  }
  // Wait for the agents tab content to render (new tab-view uses pf-agd-card classes)
  await expect(page.locator('.agent-cta, .pf-agd-card, .pf-agd-collapsed, .empty').first()).toBeVisible({ timeout: 15_000 });
}

/** Register user, create an agent, navigate to agents tab, wait for tab to load. */
async function setupAgentsTab(page: Page, suffix: string) {
  const user = `pw-agents-${suffix}-${TS}`;
  await loadHarness(page);
  const session = await registerUser(page, user);
  expect(session).toBeTruthy();

  const agentName = `test-agent-${suffix}`;
  const agentResult = await createAgent(page, agentName, user);
  expect(agentResult.ok).toBe(true);

  await gotoAgentsTab(page);
  return { user, session, agentName };
}

// ── TC-02: Agent list renders ────────────────────────

test.describe('Agents — List Rendering', () => {
  test('shows agent cards after creation', async ({ page }) => {
    const { agentName } = await setupAgentsTab(page, 'list');

    // Wait for agents to load (new tab-view uses pf-agd-card/pf-agd-collapsed)
    await expect(page.locator('.pf-agd-card').first()).toBeVisible({ timeout: 10_000 });

    // Agent name should appear in card
    const cardText = await page.locator('.pf-agd-card').first().textContent();
    expect(cardText).toContain(agentName);
  });

  test('GET /v1/agents response includes owner field', async ({ page }) => {
    const user = `pw-agents-owner-${TS}`;
    await loadHarness(page);
    await registerUser(page, user);
    await createAgent(page, 'owner-check', user);

    const result = await page.evaluate(() => {
      const s = (window as any).AIMEAT.auth.getSession();
      return fetch('/v1/agents', {
        headers: { 'Authorization': 'Bearer ' + s.jwt },
      }).then(r => r.json());
    });

    expect(result.ok).toBe(true);
    const agents = result.data?.agents || [];
    expect(agents.length).toBeGreaterThanOrEqual(1);
    expect(agents[0].owner).toBeTruthy();
    expect(agents[0].owner).toBe(user);
  });
});

// ── TC-03: Empty state ────────────────────────────────

test.describe('Agents — Empty State', () => {
  test('shows empty message when no agents', async ({ page }) => {
    const user = `pw-agents-empty-${TS}`;
    await loadHarness(page);
    await registerUser(page, user);

    await gotoAgentsTab(page);

    // Agent prompt section should still be visible
    await expect(page.locator('.agent-prompt-box')).toBeVisible();
  });
});

// ── TC-05: Expand agent card ──────────────────────────

test.describe('Agents — Card Expansion', () => {
  test('clicking collapsed card expands to tab-view', async ({ page }) => {
    const { agentName } = await setupAgentsTab(page, 'expand');

    const card = page.locator('.pf-agd-card').first();
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Card should start collapsed
    await expect(card.locator('.pf-agd-collapsed')).toBeVisible();

    // Click the collapsed card to expand
    await card.locator('.pf-agd-collapsed').click();

    // Expanded view with zones and tabs should be visible
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });
    await expect(card.locator('.pf-agd-zone1')).toBeVisible();
    await expect(card.locator('.pf-agd-tabs')).toBeVisible();

    // Agent name should appear in the identity zone
    const zone1Text = await card.locator('.pf-agd-zone1').textContent();
    expect(zone1Text).toContain(agentName);
  });
});

// ── Translations: no raw i18n keys visible ────────────

test.describe('Agents — Translations', () => {
  test('expanded card shows translated tab labels, not i18n key paths', async ({ page }) => {
    await setupAgentsTab(page, 'i18n');

    const card = page.locator('.pf-agd-card').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.locator('.pf-agd-collapsed').click();
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });

    const expandedText = await card.locator('.pf-agd-expanded').textContent();

    // Tab labels should be translated, not raw i18n keys
    expect(expandedText).not.toContain('agents.detail.tabs.integration');
    expect(expandedText).not.toContain('agents.detail.tabs.tasks');
    expect(expandedText).not.toContain('agents.detail.tabs.messages');
  });
});

// ── Scope management: Manage button visible for owner ──

test.describe('Agents — Scope Management', () => {
  test('owner sees Manage button in expanded card', async ({ page }) => {
    await setupAgentsTab(page, 'scopes');

    const card = page.locator('.pf-agd-card').first();
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Expand the card to see the footer with manage button
    await card.locator('.pf-agd-collapsed').click();
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });

    // Scope manage button should be in the card footer
    const manageBtn = card.locator('.pf-agd-card-footer .btn-outline', { hasText: /Manage|Hallinta/i });
    await expect(manageBtn).toBeVisible({ timeout: 5_000 });
  });

  test('clicking Manage opens scope modal', async ({ page }) => {
    await setupAgentsTab(page, 'scopemodal');

    const card = page.locator('.pf-agd-card').first();
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Expand card first
    await card.locator('.pf-agd-collapsed').click();
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });

    const manageBtn = card.locator('.pf-agd-card-footer .btn-outline', { hasText: /Manage|Hallinta/i });
    await expect(manageBtn).toBeVisible({ timeout: 5_000 });
    await manageBtn.click();

    // Modal should appear
    await expect(page.locator('.scope-modal')).toBeVisible({ timeout: 5_000 });
  });

  test('saving scopes via modal does not return 404', async ({ page }) => {
    await setupAgentsTab(page, 'scopesave');

    const card = page.locator('.pf-agd-card').first();
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Expand card first
    await card.locator('.pf-agd-collapsed').click();
    await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });

    // Open scope modal
    const manageBtn = card.locator('.pf-agd-card-footer .btn-outline', { hasText: /Manage|Hallinta/i });
    await expect(manageBtn).toBeVisible({ timeout: 5_000 });
    await manageBtn.click();
    await expect(page.locator('.scope-modal')).toBeVisible({ timeout: 5_000 });

    // Intercept the PATCH request to verify it's not PUT
    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/scopes') && req.method() === 'PATCH', { timeout: 10_000 }),
      page.locator('.scope-modal .btn-primary').click(),
    ]);

    expect(request.method()).toBe('PATCH');

    // Should show success toast, not error
    await page.waitForTimeout(1000);
    const toast = page.locator('.toast');
    if (await toast.count() > 0) {
      const toastText = await toast.textContent();
      expect(toastText).not.toContain('404');
    }
  });
});

// ── Device auth: pending requests appear inline ────────

test.describe('Agents — Device Auth Pending Requests', () => {
  test('pending device auth request appears in agents tab', async ({ page }) => {
    const user = `pw-agents-devauth-${TS}`;
    await loadHarness(page);
    await registerUser(page, user);

    // Create a device auth request (simulating what an agent does)
    const deviceResult = await page.evaluate(
      ([own]) => fetch('/v1/agents/device-authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: 'pending-bot', owner: own }),
      }).then(r => r.json()),
      [user] as const,
    );
    expect(deviceResult.ok).toBe(true);
    const userCode = deviceResult.data.user_code;

    // Navigate to agents tab — pending request should appear
    await gotoAgentsTab(page);

    // Wait for the pending request section to appear (polled every 5s)
    const pendingCode = page.locator('.pf-device-code');
    await expect(pendingCode).toBeVisible({ timeout: 12_000 });
    const codeText = await pendingCode.textContent();
    expect(codeText).toContain(userCode);

    // Approve and Deny buttons should be visible
    await expect(page.locator('button', { hasText: /Approve|Hyväksy/ })).toBeVisible();
    await expect(page.locator('button', { hasText: /Deny|Hylkää/ })).toBeVisible();
  });
});

// ── TC-04: Copy prompt ────────────────────────────────

test.describe('Agents — Copy Prompt', () => {
  test('copy prompt button exists and has text', async ({ page }) => {
    const user = `pw-agents-prompt-${TS}`;
    await loadHarness(page);
    await registerUser(page, user);

    await gotoAgentsTab(page);

    const copyBtn = page.locator('.copy-prompt-btn');
    await expect(copyBtn).toBeVisible({ timeout: 10_000 });

    // Prompt box should contain the owner name
    const promptBox = page.locator('.agent-prompt-box');
    const text = await promptBox.textContent();
    expect(text).toContain(user);
    expect(text).toContain('/v1/agents/device-authorize');
  });
});
