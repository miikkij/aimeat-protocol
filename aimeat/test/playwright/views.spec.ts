import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// Frontend Views — E2E Tests
// Verifies SPA routing, view rendering, and interactive elements.
// ═══════════════════════════════════════════════════════

test.describe('SPA Routing', () => {
  test('portal landing page loads with hero title', async ({ page }) => {
    await page.goto('/v1/portal');
    await expect(page.locator('h1, .gn-hero-title, .cl-hero-title')).toBeVisible({ timeout: 10_000 });
  });

  test('profile route loads', async ({ page }) => {
    await page.goto('/v1/profile');
    await expect(page).toHaveURL(/\/v1\/profile/);
  });

  test('hobbies route loads', async ({ page }) => {
    await page.goto('/v1/hobbies');
    await expect(page).toHaveURL(/\/v1\/hobbies/);
  });

  test('marketplace route loads', async ({ page }) => {
    await page.goto('/v1/marketplace');
    await expect(page).toHaveURL(/\/v1\/marketplace/);
  });

  test('dev portal route loads', async ({ page }) => {
    await page.goto('/v1/portal?view=dev');
    await expect(page).toHaveURL(/\/v1\/portal/);
  });

  test('guides route loads', async ({ page }) => {
    await page.goto('/v1/guides');
    await expect(page).toHaveURL(/\/v1\/guides/);
  });

  test('openclaw route loads', async ({ page }) => {
    await page.goto('/v1/openclaw');
    await expect(page).toHaveURL(/\/v1\/openclaw/);
  });

  test('aimeat-os route loads', async ({ page }) => {
    await page.goto('/v1/aimeat-os');
    await expect(page).toHaveURL(/\/v1\/aimeat-os/);
  });
});

test.describe('CSP Headers', () => {
  test('CSP header is present on portal response', async ({ request }) => {
    const resp = await request.get('/v1/portal');
    const csp = resp.headers()['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(csp).toContain("script-src 'self'");
  });

  test('X-Content-Type-Options is set', async ({ request }) => {
    const resp = await request.get('/v1/portal');
    expect(resp.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('X-Frame-Options is set', async ({ request }) => {
    const resp = await request.get('/v1/portal');
    expect(resp.headers()['x-frame-options']).toBe('DENY');
  });
});

test.describe('Portal Landing', () => {
  test('navigation links are present', async ({ page }) => {
    await page.goto('/v1/portal');
    await page.waitForLoadState('networkidle');
    const nav = page.locator('nav, .spa-nav, header');
    await expect(nav).toBeVisible({ timeout: 10_000 });
  });

  test('page title is set', async ({ page }) => {
    await page.goto('/v1/portal');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle(/.+/);
  });
});

test.describe('Profile (unauthenticated)', () => {
  test('shows login prompt when not authenticated', async ({ page }) => {
    await page.goto('/v1/profile');
    await page.waitForLoadState('networkidle');
    // Unauthenticated users should see login/register form or prompt
    const loginElements = page.locator('input[type="password"], button:has-text("Sign In"), button:has-text("Log In"), .pf-login, .pf-auth');
    await expect(loginElements.first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Hobbies', () => {
  test('category list or search is visible', async ({ page }) => {
    await page.goto('/v1/hobbies');
    await page.waitForLoadState('networkidle');
    const content = page.locator('.hb-root, .hb-categories, input[type="search"], input[placeholder]');
    await expect(content.first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Marketplace', () => {
  test('marketplace view renders', async ({ page }) => {
    await page.goto('/v1/marketplace');
    await page.waitForLoadState('networkidle');
    const content = page.locator('.mk-root, .mk-listings, .mk-search');
    await expect(content.first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('OpenClaw', () => {
  test('OpenClaw view renders with content', async ({ page }) => {
    await page.goto('/v1/openclaw');
    await page.waitForLoadState('networkidle');
    const content = page.locator('.oc-root, .oc-hero, h1, h2');
    await expect(content.first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('AIMEAT OS', () => {
  test('AIMEAT OS view renders', async ({ page }) => {
    await page.goto('/v1/aimeat-os');
    await page.waitForLoadState('networkidle');
    const content = page.locator('.os-root, .os-hero, h1, h2');
    await expect(content.first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Portal Classic', () => {
  test('classic portal renders hero and groups', async ({ page }) => {
    await page.goto('/v1/portal?view=classic');
    await page.waitForLoadState('networkidle');
    const hero = page.locator('.cl-hero-title, .cl-root, h1');
    await expect(hero.first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Guides', () => {
  test('guides page renders with content', async ({ page }) => {
    await page.goto('/v1/guides');
    await page.waitForLoadState('networkidle');
    const content = page.locator('h1, h2, .guide-card, article');
    await expect(content.first()).toBeVisible({ timeout: 10_000 });
  });
});
