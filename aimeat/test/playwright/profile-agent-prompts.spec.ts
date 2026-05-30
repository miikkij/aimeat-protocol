import { test, expect, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════
// E2E: Profile — Agent message option-prompts
// An agent attaches a single-select option list to a message; the owner answers
// by clicking a chip; the prompt then locks with the chosen chip highlighted.
// Mirrors the harness/setup pattern of profile-agents-detail.spec.ts.
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

// Create an agent and seed an outbound message carrying a single-select prompt.
async function createAgentWithPrompt(page: Page, agentName: string, owner: string) {
  return page.evaluate(
    async ([name, own]) => {
      const session = (window as any).AIMEAT.auth.getSession();
      const auth = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.jwt };
      const agentRes = await fetch('/v1/agents', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ name, owner: own, display_name: name }),
      }).then(r => r.json());
      const msgRes = await fetch(`/v1/agents/${name}/messages`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({
          direction: 'outbound',
          content: 'What kind of image do you want me to create?',
          metadata: {
            prompt: {
              prompt_id: 'pw-prompt-1',
              question: 'What kind of image do you want me to create?',
              options: ['black and white', 'color', 'photorealistic'],
              allow_other: true,
            },
          },
        }),
      }).then(r => r.json());
      return { agentOk: agentRes.ok === true, msgOk: msgRes.ok === true };
    },
    [agentName, owner] as const,
  );
}

async function openAgentMessagesTab(page: Page) {
  await page.goto('/v1/profile');
  await expect(page.locator('.pf')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  const menuItem = page.locator('.pf-menu-item', { hasText: /Agents|Agentit/i });
  if (await menuItem.count() > 0 && await menuItem.first().isVisible()) {
    await menuItem.first().click();
  }
  const card = page.locator('.pf-agd-card').first();
  await expect(card.locator('.pf-agd-collapsed')).toBeVisible({ timeout: 15_000 });
  await card.locator('.pf-agd-collapsed').click();
  await expect(card.locator('.pf-agd-expanded')).toBeVisible({ timeout: 5_000 });
  const msgsTab = card.locator('.pf-agd-tab', { hasText: /Messages|Viestit/i });
  await msgsTab.click();
  await expect(msgsTab).toHaveClass(/pf-agd-tab--active/);
  return card;
}

test.describe('Agent message option-prompts', () => {
  test('renders chips, answers on click, then locks with the chosen chip highlighted', async ({ page }) => {
    const user = `pw-prompt-${TS}`;
    await loadHarness(page);
    const session = await registerUser(page, user);
    expect(session).toBeTruthy();
    const result = await createAgentWithPrompt(page, `prompt-agent-${TS}`, user);
    expect(result.agentOk).toBe(true);
    expect(result.msgOk).toBe(true);

    const card = await openAgentMessagesTab(page);

    // Chips render, including the implicit "Other".
    const colorChip = card.locator('.agd-msg-prompt-option', { hasText: /^color$/ }).first();
    await expect(colorChip).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('.agd-msg-prompt-option--other')).toBeVisible();

    // Click "color" -> the answer is sent as a new inbound message (pf-prefixed bubble).
    await colorChip.click();
    await expect(card.locator('.pf-agd-msg-bubble', { hasText: /^color$/ }).first()).toBeVisible({ timeout: 15_000 });

    // Prompt is now locked (a newer message exists) and "color" is highlighted.
    await expect(card.locator('.agd-msg-prompt-option--chosen', { hasText: /^color$/ }).first()).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('.agd-msg-prompt-option', { hasText: /^photorealistic$/ }).first()).toBeDisabled();
  });
});
