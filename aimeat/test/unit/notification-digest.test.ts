/**
 * @file test/unit/notification-digest.test.ts
 * @description The notification digest email in sections and in the recipient's language: which
 *   section a stored notification belongs to, how its title and body are said from its locale key,
 *   and how the template prints the sections (messages, apps, the rest; an empty one left out).
 * @usage cd aimeat && pnpm exec vitest run test/unit/notification-digest.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { digestSectionOf, digestText } from '../../src/services/notification-sweeps.js';
import { notificationDigestEmail } from '../../src/services/email-templates-digest.js';

describe('digestSectionOf', () => {
    it('puts a direct message and a message request under messages', () => {
        expect(digestSectionOf({ type: 'direct_message', title: 'x' })).toBe('messages');
        expect(digestSectionOf({ type: 'direct_message_request', title: 'x' })).toBe('messages');
    });
    it('puts what an app sent, and the node notice about an app, under apps', () => {
        expect(digestSectionOf({ type: 'report', title: 'Shop: sold', source: { kind: 'app', name: 'Shop', id: 'alice/shop.html' } })).toBe('apps');
        expect(digestSectionOf({ type: 'app', title: 'Shop: sold' })).toBe('apps');
        expect(digestSectionOf({ type: 'app_mail_read_consent', title: 'x' })).toBe('apps');
    });
    it('puts an agent waiting for the owner, and the rest, under other', () => {
        expect(digestSectionOf({ type: 'task_waiting', title: 'postman waits for your OK: x' })).toBe('other');
        expect(digestSectionOf({ type: 'report', title: 'x', source: { kind: 'agent', name: 'postman' } })).toBe('other');
    });
});

describe('digestText', () => {
    const waiting = {
        title: 'postman waits for your OK: Aamuraportti', body: 'The plan has 3 steps.',
        i18n: { key: 'task_waiting', vars: { agent: 'postman', title: 'Aamuraportti', steps: 3 } },
    };
    it('says the title and the body in Finnish from the locale key', () => {
        const out = digestText(waiting, 'fi');
        expect(out.title).toBe('postman odottaa lupaasi: Aamuraportti');
        expect(out.body).toContain('Suunnitelmassa on 3 vaihetta.');
    });
    it('reads a full language tag by its language', () => {
        expect(digestText(waiting, 'fi-FI').title).toBe('postman odottaa lupaasi: Aamuraportti');
    });
    it('keeps the stored words when the notification carries no key', () => {
        expect(digestText({ title: 'Held', body: 'b' }, 'fi')).toEqual({ title: 'Held', body: 'b' });
    });
    it('keeps the stored words when the key has no text', () => {
        expect(digestText({ title: 'T', body: 'B', i18n: { key: 'no_such_kind_here' } }, 'fi')).toEqual({ title: 'T', body: 'B' });
    });
});

describe('notificationDigestEmail sections', () => {
    const items = [
        { title: 'Other one', at: '2026-10-18T10:00:00Z', section: 'other' as const },
        { title: 'From the shop', at: '2026-10-18T09:00:00Z', section: 'apps' as const },
        { title: 'Bea wrote', at: '2026-10-18T08:00:00Z', section: 'messages' as const },
    ];
    it('prints messages, then apps, then the rest, each under its heading with its count', () => {
        const { text, html } = notificationDigestEmail({ count: 3, items, pageUrl: 'https://n/x' }, 'en');
        const order = ['Messages (1)', 'Bea wrote', 'From your apps (1)', 'From the shop', 'Everything else (1)', 'Other one'].map(s => text.indexOf(s));
        expect(order.every(i => i >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(html.indexOf('Messages (1)')).toBeLessThan(html.indexOf('Everything else (1)'));
    });
    it('leaves an empty section out and says the headings in Finnish', () => {
        const { text } = notificationDigestEmail({ count: 1, items: [items[0]], pageUrl: 'https://n/x' }, 'fi');
        expect(text).toContain('Muut (1)');
        expect(text).not.toContain('Viestit');
        expect(text).not.toContain('Sovelluksistasi');
    });
    it('prints a line with no section under the rest', () => {
        const { text } = notificationDigestEmail({ count: 1, items: [{ title: 'Plain', at: '2026-10-18T10:00:00Z' }], pageUrl: 'https://n/x' }, 'en');
        expect(text.indexOf('Everything else (1)')).toBeLessThan(text.indexOf('Plain'));
    });
});
