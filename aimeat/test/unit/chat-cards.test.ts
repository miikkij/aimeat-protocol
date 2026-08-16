/**
 * @file test/unit/chat-cards.test.ts
 * @description The recogniser that turns a finished tool call into something openable, tested
 *   against the shapes this node's tools actually answer with — and against the ones that must NOT
 *   produce a card, which is the half that decides whether the conversation fills with noise.
 * @usage pnpm test -- chat-cards
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { cardFromToolResult } from '../../src/services/chat-cards.js';

/** A tool result as ACP delivers it: content blocks whose text happens to be JSON. */
const acp = (payload: unknown) => ({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'call_1',
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: JSON.stringify(payload) } }],
});

describe('a finished tool call becomes something a person can open', () => {
    it('a published welcome page is a page card with its address', () => {
        const card = cardFromToolResult(acp({ published: true, size_kb: 12, url: 'https://aimeat.io/p/alice' }));
        expect(card?.kind).toBe('page');
        expect(card?.url).toBe('https://aimeat.io/p/alice');
    });

    it('a published app is named by its file and carries its screenshot when there is one', () => {
        const card = cardFromToolResult(acp({
            filename: 'pong.html', url: 'https://alice.apps.aimeat.io/pong.html',
            screenshot_url: 'https://aimeat.io/v1/apps/alice/pong.html/screenshot',
        }));
        expect(card?.kind).toBe('app');
        expect(card?.title).toBe('pong.html');
        expect(card?.image).toContain('/screenshot');
    });

    it('a generated image is shown rather than linked', () => {
        const card = cardFromToolResult(acp({ storage_key: 'img/hero.png', url: 'https://aimeat.io/v1/pub/alice/img/hero.png' }));
        expect(card?.kind).toBe('image');
        expect(card?.image).toContain('hero.png');
    });

    it('a written memory record is a card for its KEY, which is the handle to ask for it back', () => {
        const card = cardFromToolResult(acp({ written: true, key: 'notes.trip.2026', gaii: 'alice@node' }));
        expect(card?.kind).toBe('memory');
        expect(card?.ref).toBe('notes.trip.2026');
    });

    it('a workspace write is addressed by workspace and object', () => {
        const card = cardFromToolResult(acp({ workspace_id: 'ws-1', object_id: 'doc-9', title: 'Plan' }));
        expect(card?.kind).toBe('workspace');
        expect(card?.ref).toBe('ws-1/doc-9');
        expect(card?.title).toBe('Plan');
    });

    // The half that keeps the conversation readable.
    it('a read, a list and a search produce NO card', () => {
        expect(cardFromToolResult(acp({ entries: [{ key: 'a' }, { key: 'b' }], total: 2 }))).toBeNull();
        expect(cardFromToolResult(acp({ value: { note: 'hello' } }))).toBeNull();
        expect(cardFromToolResult(acp({ results: [], query: 'trip' }))).toBeNull();
    });

    it('an address that is neither this node nor http is refused rather than rendered', () => {
        expect(cardFromToolResult(acp({ published: true, url: 'javascript:alert(1)' }))).toBeNull();
        expect(cardFromToolResult(acp({ published: true, url: 'data:text/html,<script>' }))).toBeNull();
    });

    it('a tool that answered with prose rather than JSON is not a card', () => {
        expect(cardFromToolResult({
            content: [{ type: 'content', content: { type: 'text', text: 'Done. Everything looks fine.' } }],
        })).toBeNull();
    });

    it('nothing at all is not a card', () => {
        expect(cardFromToolResult(undefined)).toBeNull();
        expect(cardFromToolResult({})).toBeNull();
    });
});
