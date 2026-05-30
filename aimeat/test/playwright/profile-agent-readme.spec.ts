import { test, expect, type Page } from '@playwright/test';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

// ═══════════════════════════════════════════════════════
// E2E: Profile — Agent README tab
// The README tab appears (first, selected by default) only when the agent has a
// non-empty agents.<name>.readme memory entry, and renders it as GFM markdown
// with code fences preserved. Absent README -> no tab.
// Setup mirrors profile-agents-detail.spec.ts (harness register + create agent).
// ═══════════════════════════════════════════════════════

const TS = Date.now();
const PASSWORD = 'TestPass42!';
const BASE = process.env.AIMEAT_BASE_URL || 'http://localhost:40251';

// Ed25519 sync-hash shim (same as e2e-agent-messages.ts) so signAsync works.
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
  new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

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

// Memory writes require an agent session (requireRole('agent')); the owner can't
// write memory. So mint an agent JWT from the create-agent private_key, then
// POST the README as the agent (Node-side fetch, not page context).
async function mintAgentToken(gaii: string, privateKeyB64: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const sig = await ed.signAsync(new TextEncoder().encode(gaii + timestamp), Buffer.from(privateKeyB64, 'base64'));
  const res = await fetch(`${BASE}/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gaii, timestamp, signature: Buffer.from(sig).toString('base64') }),
  });
  const body = await res.json() as { data?: { token?: string } };
  return body?.data?.token ?? '';
}

async function writeReadme(agentToken: string, agentName: string, markdown: string) {
  const res = await fetch(`${BASE}/v1/memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${agentToken}` },
    body: JSON.stringify({ key: `agents.${agentName}.readme`, value: markdown, visibility: 'owner' }),
  });
  return res.json() as Promise<{ ok?: boolean; error?: unknown }>;
}

async function gotoAgentsTab(page: Page) {
  await page.goto('/v1/profile');
  await expect(page.locator('.pf')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  const menuItem = page.locator('.pf-menu-item', { hasText: /Agents|Agentit/i });
  if (await menuItem.count() > 0 && await menuItem.first().isVisible()) {
    await menuItem.first().click();
  } else {
    const onboard = page.locator('.pf-onboard-card', { hasText: /agent/i });
    await expect(onboard).toBeVisible({ timeout: 5_000 });
    await onboard.click();
  }
  const card = page.locator('.pf-agd-card').first();
  await expect(card.locator('.pf-agd-collapsed')).toBeVisible({ timeout: 15_000 });
  await card.locator('.pf-agd-collapsed').click();
  await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });
  return card;
}

const README_MD = [
  '# Demo Agent',
  '',
  '```',
  '  ___  ',
  ' / _ \\ ',
  '|_| |_|',
  '```',
  '',
  'Some **bold** help with a [link](https://example.com).',
].join('\n');

test.describe('Agent README tab', () => {
  test('shows README first + selected by default and renders markdown', async ({ page }) => {
    const user = `pw-readme-${TS}`;
    await loadHarness(page);
    expect(await registerUser(page, user)).toBeTruthy();
    const agentName = `readme-agent-${TS}`;
    const created = await createAgent(page, agentName, user);
    expect(created.ok).toBe(true);

    const agentToken = await mintAgentToken(created.data.agent.gaii, created.data.private_key);
    expect(agentToken, 'agent token minted').toBeTruthy();
    const wrote = await writeReadme(agentToken, agentName, README_MD);
    expect(wrote.ok, 'write readme: ' + JSON.stringify(wrote?.error || wrote)).toBe(true);

    const card = await gotoAgentsTab(page);

    // README tab is the FIRST tab and selected by default.
    const tabs = card.locator('.pf-agd-tab');
    await expect(tabs.first()).toHaveText(/README/, { timeout: 15_000 });
    await expect(tabs.first()).toHaveClass(/pf-agd-tab--active/);

    // Markdown renders: heading + code fence (ASCII art) + sanitized link.
    const body = card.locator('.pf-agd-readme');
    await expect(body.locator('h1', { hasText: 'Demo Agent' })).toBeVisible();
    await expect(body.locator('.md-pre .md-code')).toBeVisible();
    await expect(body.locator('a', { hasText: 'link' })).toHaveAttribute('href', 'https://example.com');
  });

  test('hides the README tab when none is published', async ({ page }) => {
    const user = `pw-noreadme-${TS}`;
    await loadHarness(page);
    expect(await registerUser(page, user)).toBeTruthy();
    const agentName = `noreadme-agent-${TS}`;
    expect((await createAgent(page, agentName, user)).ok).toBe(true);

    const card = await gotoAgentsTab(page);

    await expect(card.locator('.pf-agd-tab', { hasText: /Integration|Integraatio/ })).toHaveCount(1);
    await expect(card.locator('.pf-agd-tab', { hasText: /README/ })).toHaveCount(0);
  });
});
