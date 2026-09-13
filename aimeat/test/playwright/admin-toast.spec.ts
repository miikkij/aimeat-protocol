/**
 * @file admin-toast.spec.ts
 * @description A toast callback must not restart its consumer's completed read effect.
 * @version-history
 *   v1.0.0 -- 2026-09-13 -- Regression for the CORS overview's render/read loop.
 */
import { test, expect } from '@playwright/test';

test('a completed read stays settled through data and toast rerenders', async ({ page }) => {
  // The SPA supplies the same import map as the operator's page; no account is needed here.
  await page.goto('/v1/admin');
  await page.evaluate(async () => {
    const preactPath = 'preact';
    const hooksPath = 'preact/hooks';
    const sharedPath = '/views/admin/shared.js';
    const { h, render } = await import(preactPath);
    const { useState, useEffect, useCallback } = await import(hooksPath);
    const { useToast } = await import(sharedPath);
    const host = document.createElement('div');
    host.id = 'toast-regression';
    // Keep the isolated test consumer inside the viewport above the SPA's fixed shell.
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:var(--bg);color:var(--text)';
    document.body.append(host);
    let reads = 0;
    function Consumer() {
      const [data, setData] = useState(null);
      const [toast, showError, showSuccess, clear] = useToast();
      const load = useCallback(async () => {
        reads++;
        // Cap the broken case so the regression itself cannot become a busy loop.
        if (reads <= 5) setData(await Promise.resolve({ ready: true }));
      }, [showError]);
      useEffect(() => { void load(); }, [load]);
      return h('section', null,
        h('output', { id: 'read-count' }, String(reads)),
        h('output', { id: 'read-ready' }, String(data?.ready || false)),
        h('output', { id: 'toast-message' }, toast ? `${toast.type}:${toast.text}` : ''),
        h('button', { onClick: () => showError('Refused') }, 'Error'),
        h('button', { onClick: () => showSuccess('Saved') }, 'Success'),
        h('button', { onClick: clear }, 'Clear'));
    }
    render(h(Consumer), host);
  });
  const host = page.locator('#toast-regression');
  await expect(host.locator('#read-ready')).toHaveText('true');
  // Let effects scheduled by the completed read run before asserting that it settled.
  await page.waitForTimeout(250);
  await expect(host.locator('#read-count')).toHaveText('1');
  for (const [button, message] of [['Error', 'error:Refused'], ['Success', 'success:Saved'], ['Clear', '']]) {
    await host.getByRole('button', { name: button, exact: true }).click();
    await expect(host.locator('#toast-message')).toHaveText(message);
    await page.waitForTimeout(100);
    await expect(host.locator('#read-count')).toHaveText('1');
  }
});
