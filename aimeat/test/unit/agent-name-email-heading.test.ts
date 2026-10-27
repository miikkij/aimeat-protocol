/**
 * @file test/unit/agent-name-email-heading.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's display name reaches the heading of the node's own permission-ask and
 *   agent-narrowed emails as text, not as HTML (secaudit2026oct26,
 *   email-templates.ts:wrapHtml:unescaped-heading-agent-display-name). The display name comes from
 *   whoever composed the device request. The use that stays: an ordinary name, non-ASCII letters
 *   included, reads in the subject, the heading and the plain-text part exactly as written.
 * @usage pnpm exec vitest run test/unit/agent-name-email-heading.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, AgentRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { mailOwnerNarrowed } from '../../src/services/scope-auto-narrow.js';
import { sendPermissionAsk } from '../../src/services/permission-ask-notice.js';
import { setActiveEmailService } from '../../src/services/email.js';

const NODE = 'aimeat-test-001';
const OWNER = `alice@${NODE}`;
const config = { nodeId: NODE, baseUrl: 'https://node.test' } as AimeatConfig;
const MARKUP = '<a href="https://elsewhere.example/">Open</a>';
let storage: Storage;

function agent(displayName: string): AgentRecord {
    const now = new Date().toISOString();
    return {
        gaii: `helper#${OWNER}`, name: 'helper', displayName, owner: 'alice', capabilities: [], publicKey: '', trustScore: 50,
        morselBalance: 0, createdAt: now, lastSeen: now, mode: 'task-runner', defaultScopes: ['memory:read'],
    } as AgentRecord;
}

/** The html and text of the one mail sent, after `send` ran. */
async function mailOf(send: () => Promise<void>): Promise<{ subject: string; html: string; text: string }> {
    const sendRaw = vi.fn(async () => true);
    setActiveEmailService({ enabled: true, sendRaw } as never);
    await send();
    expect(sendRaw).toHaveBeenCalledTimes(1);
    const [, subject, html, text] = sendRaw.mock.calls[0] as unknown as string[];
    return { subject, html, text };
}

const heading = (html: string) => /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '';
const title = (html: string) => /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '';

beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const at = new Date().toISOString();
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: at } as never);
    await storage.createGHII({
        username: 'alice', nodeId: NODE, ghii: OWNER, displayName: 'alice', verificationLevel: 1, ownerName: 'alice',
        totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: at, updatedAt: at,
        notificationEmail: 'alice@example.test', emailVerifiedAt: at, locale: 'en',
    } as never);
});

afterEach(() => { setActiveEmailService({ enabled: false } as never); vi.restoreAllMocks(); });

describe('the permission-ask email', () => {
    it('shows markup in an agent display name as text in the heading and title', async () => {
        const m = await mailOf(() => sendPermissionAsk({ storage, config }, OWNER, agent(MARKUP), ['memory:write']));
        expect(m.html).not.toContain(MARKUP);
        expect(heading(m.html)).toContain('&lt;a href=');
        expect(title(m.html)).toContain('&lt;a href=');
    });

    it('usage: an ordinary name with non-ASCII letters reads as written in subject, heading and text', async () => {
        const m = await mailOf(() => sendPermissionAsk({ storage, config }, OWNER, agent('Pääkirjuri Öhman'), ['memory:write']));
        expect(m.subject).toContain('Pääkirjuri Öhman');
        expect(heading(m.html)).toContain('Pääkirjuri Öhman');
        expect(m.text).toContain('Pääkirjuri Öhman');
    });
});

describe('the agent-narrowed email', () => {
    it('shows markup in an agent display name as text in the heading and title', async () => {
        const m = await mailOf(() => mailOwnerNarrowed({ storage, config }, OWNER, agent(MARKUP)));
        expect(m.html).not.toContain(MARKUP);
        expect(heading(m.html)).toContain('&lt;a href=');
        expect(title(m.html)).toContain('&lt;a href=');
    });

    it('usage: an ordinary name with non-ASCII letters reads as written in subject, heading and text', async () => {
        const m = await mailOf(() => mailOwnerNarrowed({ storage, config }, OWNER, agent('Pääkirjuri Öhman')));
        expect(m.subject).toContain('Pääkirjuri Öhman');
        expect(heading(m.html)).toContain('Pääkirjuri Öhman');
        expect(m.text).toContain('Pääkirjuri Öhman');
    });
});
