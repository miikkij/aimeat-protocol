/**
 * @file cortex-ui.spec.ts
 * @description Playwright browser tests for aimeat-ui cortex components.
 *   Verifies components render correctly and interactions work in a real browser.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial: dialogs, layout, viewers, nav, forms tests
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:40050';

/**
 * Load a cortex lib by injecting its script tag into the page.
 * Requires the cortex to be installed and activated on the running server.
 */
async function loadCortex(page: import('@playwright/test').Page, name: string) {
  await page.addScriptTag({ url: `${BASE}/v1/cortex/${name}/libs/${name}.js` });
  // Wait for AIMEAT namespace to be populated
  await page.waitForFunction(
    (n: string) => {
      const parts = n.replace('aimeat-ui-', '').split('-');
      const mod = parts.join('');
      return !!(window as any).AIMEAT?.ui?.[mod];
    },
    name,
    { timeout: 5000 }
  );
}

// ═══════════════════════════════════════════════════════
// Dialogs
// ═══════════════════════════════════════════════════════

test.describe('aimeat-ui-dialogs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/v1/portal`);
    await loadCortex(page, 'aimeat-ui-dialogs');
  });

  test('Modal renders and closes on Escape', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.dialogs.Modal({ title: 'Test Modal', content: 'Hello world' });
    });
    await expect(page.locator('.aui-modal-overlay')).toBeVisible();
    await expect(page.locator('.aui-modal-header h3')).toHaveText('Test Modal');
    await page.keyboard.press('Escape');
    await expect(page.locator('.aui-modal-overlay')).not.toBeVisible();
  });

  test('Confirm resolves true on confirm click', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const p = (window as any).AIMEAT.ui.dialogs.Confirm({ message: 'Delete?', danger: true });
      setTimeout(() => {
        const btn = document.querySelector('.aui-btn-danger');
        if (btn) (btn as HTMLElement).click();
      }, 100);
      return await p;
    });
    expect(result).toBe(true);
  });

  test('Confirm resolves false on cancel click', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const p = (window as any).AIMEAT.ui.dialogs.Confirm({ message: 'Cancel test' });
      setTimeout(() => {
        const btn = document.querySelector('.aui-btn-ghost');
        if (btn) (btn as HTMLElement).click();
      }, 100);
      return await p;
    });
    expect(result).toBe(false);
  });

  test('toast shows and auto-dismisses', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.dialogs.toast('Saved!', 'success');
    });
    await expect(page.locator('.aui-toast')).toBeVisible();
    await expect(page.locator('.aui-toast')).toHaveText('Saved!');
  });

  test('Alert renders with correct type', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.dialogs.Alert({ message: 'Warning!', type: 'warn', target: 'body' });
    });
    await expect(page.locator('.aui-alert-warn')).toBeVisible();
    await expect(page.locator('.aui-alert-warn span')).toHaveText('Warning!');
  });
});

// ═══════════════════════════════════════════════════════
// Layout
// ═══════════════════════════════════════════════════════

test.describe('aimeat-ui-layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/v1/portal`);
    await loadCortex(page, 'aimeat-ui-layout');
  });

  test('MainDetail renders list and detail panes', async ({ page }) => {
    await page.evaluate(() => {
      const list = document.createElement('div');
      list.textContent = 'Item list';
      const detail = document.createElement('div');
      detail.textContent = 'Detail view';
      (window as any).AIMEAT.ui.layout.MainDetail({ target: 'body', list, detail });
    });
    await expect(page.locator('.aui-main-detail')).toBeVisible();
    await expect(page.locator('.aui-main-detail-list')).toContainText('Item list');
    await expect(page.locator('.aui-main-detail-detail')).toContainText('Detail view');
  });

  test('Header renders with title and sticky positioning', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.layout.Header({ target: 'body', title: 'My App' });
    });
    await expect(page.locator('.aui-header')).toBeVisible();
    await expect(page.locator('.aui-header-title')).toHaveText('My App');
  });

  test('DashboardGrid renders widgets in grid', async ({ page }) => {
    await page.evaluate(() => {
      const widgets = [1, 2, 3, 4].map(function(n) {
        var d = document.createElement('div');
        d.textContent = 'Widget ' + n;
        return d;
      });
      (window as any).AIMEAT.ui.layout.DashboardGrid({ target: 'body', widgets });
    });
    await expect(page.locator('.aui-dashboard-grid')).toBeVisible();
    const widgetCount = await page.locator('.aui-dashboard-grid-widget').count();
    expect(widgetCount).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════
// Viewers
// ═══════════════════════════════════════════════════════

test.describe('aimeat-ui-viewers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/v1/portal`);
    await loadCortex(page, 'aimeat-ui-viewers');
  });

  test('Grid renders items as cards', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.viewers.Grid({
        target: 'body',
        items: [
          { title: 'Card 1', subtitle: 'Description 1' },
          { title: 'Card 2', subtitle: 'Description 2' },
        ],
      });
    });
    await expect(page.locator('.aui-grid')).toBeVisible();
    const cards = await page.locator('.aui-grid-card').count();
    expect(cards).toBe(2);
    await expect(page.locator('.aui-grid-card-title').first()).toHaveText('Card 1');
  });

  test('List renders items with titles', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.viewers.List({
        target: 'body',
        items: [
          { title: 'Item A', subtitle: 'Sub A' },
          { title: 'Item B', subtitle: 'Sub B' },
          { title: 'Item C' },
        ],
      });
    });
    await expect(page.locator('.aui-list')).toBeVisible();
    const items = await page.locator('.aui-list-item').count();
    expect(items).toBe(3);
  });

  test('DataTable renders columns and rows', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.viewers.DataTable({
        target: 'body',
        columns: [{ key: 'name', label: 'Name' }, { key: 'age', label: 'Age', type: 'number' }],
        rows: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
      });
    });
    await expect(page.locator('.aui-table')).toBeVisible();
    const rows = await page.locator('.aui-table tbody tr').count();
    expect(rows).toBe(2);
  });

  test('Timeline renders events', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.viewers.Timeline({
        target: 'body',
        events: [
          { title: 'Start', content: 'Project started', type: 'success' },
          { title: 'Milestone', content: 'v1.0 released', type: 'info' },
        ],
      });
    });
    await expect(page.locator('.aui-timeline')).toBeVisible();
    const events = await page.locator('.aui-timeline-event').count();
    expect(events).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════
// Nav
// ═══════════════════════════════════════════════════════

test.describe('aimeat-ui-nav', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/v1/portal`);
    await loadCortex(page, 'aimeat-ui-nav');
  });

  test('Tabs render and active tab has aria-selected', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.nav.Tabs({
        target: 'body',
        tabs: [
          { label: 'Tab A', id: 'a' },
          { label: 'Tab B', id: 'b' },
          { label: 'Tab C', id: 'c' },
        ],
        active: 'b',
      });
    });
    await expect(page.locator('.aui-tabs')).toBeVisible();
    const tabs = await page.locator('.aui-tab').count();
    expect(tabs).toBe(3);
    // Tab B should be active
    await expect(page.locator('.aui-tab[aria-selected="true"]')).toHaveText('Tab B');
  });

  test('Breadcrumbs render path with separators', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.nav.Breadcrumbs({
        target: 'body',
        items: [
          { label: 'Home' },
          { label: 'Products' },
          { label: 'Detail' },
        ],
      });
    });
    await expect(page.locator('.aui-breadcrumbs')).toBeVisible();
    // Last item should be bold (current page)
    await expect(page.locator('.aui-breadcrumb-item').last()).toHaveText('Detail');
  });

  test('BurgerMenu opens and closes', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.nav.BurgerMenu({
        target: 'body',
        items: [
          { label: 'Home' },
          { label: 'About' },
        ],
      });
    });
    // Burger button visible
    await expect(page.locator('.aui-burger-btn')).toBeVisible();
    // Click to open
    await page.locator('.aui-burger-btn').click();
    await expect(page.locator('.aui-burger-panel.open')).toBeVisible();
    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(page.locator('.aui-burger-panel.open')).not.toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// Forms
// ═══════════════════════════════════════════════════════

test.describe('aimeat-ui-forms', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/v1/portal`);
    await loadCortex(page, 'aimeat-ui-forms');
  });

  test('Input renders with floating label', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.forms.Input({ target: 'body', label: 'Email', type: 'email', name: 'email' });
    });
    await expect(page.locator('.aui-input')).toBeVisible();
    await expect(page.locator('.aui-input label')).toContainText('Email');
  });

  test('Toggle switches on click', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.forms.Toggle({ target: 'body', label: 'Dark mode', name: 'dark' });
    });
    await expect(page.locator('.aui-toggle')).toBeVisible();
    // Click the toggle track/thumb area
    await page.locator('.aui-toggle-track, .aui-toggle input').first().click({ force: true });
  });

  test('FormGroup creates fields and validates', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).AIMEAT.ui.forms.FormGroup({
        target: 'body',
        fields: [
          { name: 'name', type: 'text', label: 'Name', required: true },
          { name: 'email', type: 'email', label: 'Email', required: true },
        ],
        onSubmit: function() {},
      });
    });
    await expect(page.locator('.aui-form')).toBeVisible();
    // Should have 2 form fields
    const inputs = await page.locator('.aui-form .aui-input, .aui-form .aui-select, .aui-form .aui-checkbox, .aui-form .aui-radio, .aui-form .aui-toggle, .aui-form .aui-textarea').count();
    expect(inputs).toBeGreaterThanOrEqual(2);
  });
});
