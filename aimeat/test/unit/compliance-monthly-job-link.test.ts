/**
 * @file test/unit/compliance-monthly-job-link.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The monthly compliance notification opens the admin page's Compliance tab. Its link
 *   was `/admin?tab=compliance`, a path the SPA has no route for, so pressing the notification
 *   opened the front page. The test reads the route table from public/spa.html, so it fails again
 *   if either side moves without the other.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-monthly-job-link.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const sent: Array<{ to: string; link?: string }> = [];

vi.mock('../../src/services/notify.js', () => ({
  notify: vi.fn(async (_s: unknown, to: string, input: { link?: string }) => { sent.push({ to, link: input.link }); return {}; }),
}));
vi.mock('../../src/services/compliance-report.js', () => ({
  buildComplianceReport: vi.fn(async () => ({ gaps: [{}], register: { usecases: [] } })),
}));
vi.mock('../../src/services/compliance-register.js', () => ({
  writeStoredReport: vi.fn(async () => {}),
  snapshotIdFor: vi.fn(() => 'x'),
}));

const { runComplianceMonthlyReport } = await import('../../src/services/compliance-monthly-job.js');

/** The paths the SPA router serves a view on, read from its route table in spa.html. */
function spaRoutes(): Set<string> {
  const html = readFileSync(fileURLToPath(new URL('../../public/spa.html', import.meta.url)), 'utf8');
  return new Set([...html.matchAll(/'(\/[a-z0-9/-]*)':\s*\(\)\s*=>\s*import\(/g)].map(m => m[1]));
}

describe('compliance monthly notification link', () => {
  it('points at a page the SPA serves, on the Compliance tab, for the reported month', async () => {
    const storage = { listOwners: async () => [{ name: 'op', roles: ['owner', 'operator'] }] } as unknown as Storage;
    const config = { nodeId: 'node-test' } as AimeatConfig;
    const result = await runComplianceMonthlyReport(config, storage);

    expect(sent).toHaveLength(1);
    const url = new URL(sent[0].link!, 'https://node.example');
    expect(spaRoutes().has(url.pathname), url.pathname).toBe(true);
    expect(url.pathname).toBe('/v1/admin');
    expect(url.searchParams.get('tab')).toBe('compliance');
    expect(url.searchParams.get('month')).toBe(result.month);
  });
});
