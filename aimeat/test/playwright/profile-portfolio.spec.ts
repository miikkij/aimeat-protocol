import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// E2E: Profile — Portfolio Tab + Portfolio Builder
// Full user journey: profile tab → builder → configure → generate → upload → view
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

// ── Unauthenticated ─────────────────────────────────────

test.describe('Portfolio — Unauthenticated', () => {
  test('shows login prompt, no tab content or portfolio link', async ({ page }) => {
    await page.goto('/v1/profile?tab=portfolio');
    await page.waitForLoadState('networkidle');

    const loginPrompt = page.locator('.login-prompt');
    await expect(loginPrompt).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('.tab-content')).toHaveCount(0);
    await expect(page.locator('.tab-content a.btn.btn-ghost')).toHaveCount(0);
  });

  test('non-existent portfolio shows not-found page', async ({ page }) => {
    await page.goto('/v1/portfolio/nonexistent-user-xyz-999');
    await page.waitForLoadState('networkidle');

    const notFound = page.locator('.portfolio-not-found');
    await expect(notFound).toBeVisible({ timeout: 10_000 });
  });
});

// ── Profile tab → Builder navigation ────────────────────

test.describe('Portfolio — Profile Tab to Builder', () => {
  test('click builder button navigates to portfolio builder page', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, USERNAME, PASSWORD);

    await page.goto('/v1/profile?tab=portfolio');
    await page.waitForLoadState('networkidle');

    const tabContent = page.locator('.tab-content');
    await expect(tabContent).toBeVisible({ timeout: 10_000 });

    // Heading, button, and public link all present
    await expect(tabContent.locator('h3')).toBeVisible();
    const builderBtn = tabContent.locator('button.btn.btn-primary');
    await expect(builderBtn).toBeVisible();

    const publicLink = tabContent.locator('a.btn.btn-ghost');
    await expect(publicLink).toBeVisible();
    expect(await publicLink.getAttribute('href')).toContain(`/v1/portfolio/${encodeURIComponent(USERNAME)}`);
    expect(await publicLink.getAttribute('target')).toBe('_blank');

    // Click the builder button — should navigate away
    await builderBtn.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/v1\/portfolio/);
  });
});

// ── Portfolio Builder — full interactions ────────────────

test.describe('Portfolio Builder', () => {
  test('builder page shows all 5 steps', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-steps-${TS}`, PASSWORD);

    await page.goto('/v1/portfolio');
    await page.waitForLoadState('networkidle');

    const container = page.locator('.portfolio-container');
    await expect(container).toBeVisible({ timeout: 10_000 });
    await expect(container.locator('h1')).toBeVisible();

    // All 5 step numbers (1-5)
    const steps = container.locator('.portfolio-step-number');
    await expect(steps).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await expect(steps.nth(i)).toHaveText(String(i + 1));
    }
  });

  test('select portfolio type and design style (radio buttons)', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-style-${TS}`, PASSWORD);

    await page.goto('/v1/portfolio');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.portfolio-builder')).toBeVisible({ timeout: 10_000 });

    // Portfolio types: first .portfolio-options group (5 options)
    const typeOptions = page.locator('.portfolio-options').first();
    await expect(typeOptions).toBeVisible();

    // Default is "dev" (3rd option, index 2)
    const devRadio = typeOptions.locator('.portfolio-option').nth(2).locator('input[type=radio]');
    await expect(devRadio).toBeChecked();

    // Click "Creative" (2nd, index 1)
    const creativeOption = typeOptions.locator('.portfolio-option').nth(1);
    await creativeOption.click();
    await expect(creativeOption.locator('input[type=radio]')).toBeChecked();
    await expect(devRadio).not.toBeChecked();

    // Click "CV" (1st, index 0)
    const cvOption = typeOptions.locator('.portfolio-option').nth(0);
    await cvOption.click();
    await expect(cvOption.locator('input[type=radio]')).toBeChecked();
    await expect(creativeOption.locator('input[type=radio]')).not.toBeChecked();

    // Design styles: second .portfolio-options group (4 options)
    const styleOptions = page.locator('.portfolio-options').nth(1);
    const darkRadio = styleOptions.locator('.portfolio-option').nth(2).locator('input[type=radio]');
    await expect(darkRadio).toBeChecked(); // default

    // Switch to "Bold" (index 1)
    const boldOption = styleOptions.locator('.portfolio-option').nth(1);
    await boldOption.click();
    await expect(boldOption.locator('input[type=radio]')).toBeChecked();
    await expect(darkRadio).not.toBeChecked();
  });

  test('toggle auth gate checkboxes on and off', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-gates-${TS}`, PASSWORD);

    await page.goto('/v1/portfolio');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.portfolio-builder')).toBeVisible({ timeout: 10_000 });

    const gates = page.locator('.portfolio-auth-gates');
    const checkboxes = gates.locator('input[type=checkbox]');
    await expect(checkboxes).toHaveCount(4);

    // All unchecked initially
    for (let i = 0; i < 4; i++) {
      await expect(checkboxes.nth(i)).not.toBeChecked();
    }

    // Check contact (0) and downloads (2)
    await checkboxes.nth(0).check();
    await checkboxes.nth(2).check();
    await expect(checkboxes.nth(0)).toBeChecked();
    await expect(checkboxes.nth(1)).not.toBeChecked();
    await expect(checkboxes.nth(2)).toBeChecked();
    await expect(checkboxes.nth(3)).not.toBeChecked();

    // Uncheck contact
    await checkboxes.nth(0).uncheck();
    await expect(checkboxes.nth(0)).not.toBeChecked();
    await expect(checkboxes.nth(2)).toBeChecked();
  });

  test('generate prompt — output, copy button, download button, instructions appear', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-prompt-${TS}`, PASSWORD);

    await page.goto('/v1/portfolio');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.portfolio-builder')).toBeVisible({ timeout: 10_000 });

    // No prompt output initially
    await expect(page.locator('.portfolio-prompt-output')).toHaveCount(0);

    // Click Generate in step 4
    const step4 = page.locator('.portfolio-step').nth(3);
    const generateBtn = step4.locator('button.btn-primary');
    await generateBtn.click();

    // Prompt output appears with real content
    const promptOutput = page.locator('.portfolio-prompt-output');
    await expect(promptOutput).toBeVisible({ timeout: 5_000 });
    const text = await promptOutput.textContent();
    expect(text!.length).toBeGreaterThan(100);
    expect(text).toContain('portfolio');

    // Action buttons appear
    const actions = page.locator('.portfolio-prompt-actions');
    await expect(actions.locator('button.btn-primary')).toBeVisible(); // copy
    await expect(actions.locator('button.btn-ghost')).toBeVisible();   // download

    // Instructions list with 4 steps
    const instructions = page.locator('.portfolio-instructions ol li');
    await expect(instructions).toHaveCount(4);
  });

  test('paste HTML, publish, see success, view public portfolio', async ({ page }) => {
    await loadHarness(page);
    const user = `pw-publish-${TS}`;
    await registerUser(page, user, PASSWORD);

    await page.goto('/v1/portfolio');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.portfolio-builder')).toBeVisible({ timeout: 10_000 });

    // Step 5: paste HTML
    const pasteArea = page.locator('.portfolio-paste-area');
    await expect(pasteArea).toBeVisible();

    const portfolioHtml = `<!DOCTYPE html>
<html><head><title>${user} Portfolio</title></head>
<body><h1>Welcome to ${user}'s Portfolio</h1><p>Projects and work.</p></body></html>`;

    await pasteArea.fill(portfolioHtml);

    // "Publish" button appears after pasting
    const publishBtn = page.locator('button.btn-primary', { hasText: /publish|Publish/i });
    await expect(publishBtn).toBeVisible({ timeout: 3_000 });
    await publishBtn.click();

    // Success: "Portfolio published!" text and enabled banner appear
    await expect(page.getByText('Portfolio published!')).toBeVisible({ timeout: 10_000 });

    // Enabled banner (green dot + "published" text) at top
    await expect(page.locator('text=●')).toBeVisible();

    // Now visit the public portfolio
    await page.goto(`/v1/portfolio/${user}`);
    await page.waitForLoadState('networkidle');

    // Viewer renders with iframe
    const viewer = page.locator('.portfolio-viewer');
    await expect(viewer).toBeVisible({ timeout: 10_000 });
    const iframe = viewer.locator('iframe.portfolio-viewer-frame');
    await expect(iframe).toBeVisible();

    // Content inside iframe matches what we published
    const frame = page.frameLocator('.portfolio-viewer-frame');
    await expect(frame.locator('h1')).toContainText(`Welcome to ${user}'s Portfolio`);
  });
});

// ── Tab switching on profile page ───────────────────────

test.describe('Portfolio — Tab Switching', () => {
  test('switch between tabs — portfolio becomes active/inactive', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-tabswitch-${TS}`, PASSWORD);

    await page.goto('/v1/profile');
    await page.waitForLoadState('networkidle');

    const allTabs = page.locator('.tabs button.tab');
    await expect(allTabs.first()).toBeVisible({ timeout: 10_000 });

    // Default tab is agents (2nd), portfolio (1st) is NOT active
    await expect(allTabs.first()).not.toHaveClass(/active/);

    // Click portfolio tab
    await allTabs.first().click();
    await expect(allTabs.first()).toHaveClass(/active/);

    // Portfolio content appears
    const tabContent = page.locator('.tab-content');
    await expect(tabContent).toBeVisible({ timeout: 5_000 });
    await expect(tabContent.locator('button.btn.btn-primary')).toBeVisible();

    // Switch to agents (2nd tab)
    await allTabs.nth(1).click();
    await expect(allTabs.nth(1)).toHaveClass(/active/);
    await expect(allTabs.first()).not.toHaveClass(/active/);

    // Portfolio content hidden
    await expect(tabContent.locator('button.btn.btn-primary')).not.toBeVisible();

    // Switch back to portfolio
    await allTabs.first().click();
    await expect(tabContent.locator('button.btn.btn-primary')).toBeVisible();
  });

  test('?tab=portfolio URL param loads portfolio tab directly', async ({ page }) => {
    await loadHarness(page);
    await registerUser(page, `pw-urlparam-${TS}`, PASSWORD);

    await page.goto('/v1/profile?tab=portfolio');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.tab-content')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.tabs button.tab').first()).toHaveClass(/active/);
  });
});
