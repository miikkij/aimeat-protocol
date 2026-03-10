# AIMEAT E2E Test Plans — Profile Tabs

Playwright-based end-to-end test plans for all 19 profile page tabs.

## Prerequisites

- Server running on `http://localhost:40050` (or configured `BASE_URL`)
- Test owner registered with at least one agent
- Authenticated session (JWT in `aimeat_session` localStorage)

## Test Plan Files

| # | Tab | File | Priority |
|---|-----|------|----------|
| 01 | Portfolio | [01-portfolio.md](01-portfolio.md) | Medium |
| 02 | Agents | [02-agents.md](02-agents.md) | High |
| 03 | Chat Sessions | [03-chat-sessions.md](03-chat-sessions.md) | Medium |
| 04 | Wallet | [04-wallet.md](04-wallet.md) | High |
| 05 | Knowledge | [05-knowledge.md](05-knowledge.md) | High |
| 06 | Organisms | [06-organisms.md](06-organisms.md) | Medium |
| 07 | Memory | [07-memory.md](07-memory.md) | High |
| 08 | Work | [08-work.md](08-work.md) | High |
| 09 | Services | [09-services.md](09-services.md) | Medium |
| 10 | Boards | [10-boards.md](10-boards.md) | Medium |
| 11 | Apps | [11-apps.md](11-apps.md) | Low |
| 12 | Extensions | [12-extensions.md](12-extensions.md) | Low |
| 13 | Federation | [13-federation.md](13-federation.md) | Low |
| 14 | Nodes | [14-nodes.md](14-nodes.md) | Low |
| 15 | Access | [15-access.md](15-access.md) | Low |
| 16 | Data Wallet | [16-data-wallet.md](16-data-wallet.md) | High |
| 17 | Node Stats | [17-node-stats.md](17-node-stats.md) | Low |
| 18 | Security | [18-security.md](18-security.md) | Medium |
| 19 | Notifications | [19-notifications.md](19-notifications.md) | Low |

## Shared Test Setup

```typescript
// test/e2e/helpers.ts
import { test as base, expect } from '@playwright/test';

export const BASE_URL = process.env.BASE_URL || 'http://localhost:40050';

export const test = base.extend({
  authenticatedPage: async ({ page }, use) => {
    await page.goto(`${BASE_URL}/v1/profile`);
    // Inject session token from env or fixture
    await page.evaluate((token) => {
      localStorage.setItem('aimeat_session', token);
    }, process.env.TEST_SESSION_TOKEN);
    await page.reload();
    await expect(page.locator('.pf')).toBeVisible();
    await use(page);
  },
});

export async function switchTab(page, tabKey) {
  await page.click(`.tab-btn[data-tab="${tabKey}"]`);
  await page.waitForSelector('.spinner', { state: 'hidden', timeout: 5000 });
}
```

## Common Assertions

- **Spinner disappears**: After tab switch, `.spinner` should vanish within 5s
- **Toast appears**: `.toast` element becomes visible with expected text
- **Empty state**: `.empty` div visible when no data
- **Card expand**: `.card-expanded` or `*-expanded` class added after click
- **Confirmation dialog**: Browser `dialog` event fires on destructive actions
