/**
 * @file test/unit/workspace-reserved-parts.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which parts of a workspace the node keeps for itself (isNodeReservedPart,
 *   isNodeReservedWorkspaceKey, spaceRowAt), the manifest refusal (normalizeObjectTypes), and the living
 *   config content an owner's allowance binds to (livingConfigContent). secaudit2026nov08 round 14.
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import { describe, it, expect } from 'vitest';
import { isNodeReservedPart, isNodeReservedWorkspaceKey, spaceRowAt } from '../../src/services/workspace-record-key.js';
import { normalizeObjectTypes } from '../../src/services/workspace-meta.js';
import { livingConfigContent } from '../../src/services/living-pulse-spend.js';

const root = 'organism.o1.w.ws-1';

describe('isNodeReservedPart', () => {
    it('names the parts the node writes', () => {
        for (const p of ['meta', 'meta.share', 'meta.manifest', 'meta.intake.f1', 'meta.fingerprint.notes~d1', 'meta.contentclass', 'meta.comments.x', 'meta._schema_lock', 'access', 'access.request.bob', 'skills.s.manifest']) {
            expect(isNodeReservedPart(p), p).toBe(true);
        }
    });
    it('leaves a space under meta. that the node does not write free', () => {
        for (const p of ['meta.goals', 'meta.plans', 'meta.decisions', 'meta.extra', 'notes', 'shared.meta', 'metadata', 'accessible']) {
            expect(isNodeReservedPart(p), p).toBe(false);
        }
    });
});

describe('spaceRowAt and isNodeReservedWorkspaceKey', () => {
    const prefixes = [`${root}.meta.`, `${root}.access.request.`];
    it('reads no row at a node-reserved key, whatever space is declared over it', () => {
        expect(isNodeReservedWorkspaceKey(`${root}.meta.share`)).toBe(true);
        expect(spaceRowAt(`${root}.meta.share`, `${root}.meta.`, prefixes)).toBeNull();
        expect(spaceRowAt(`${root}.access.request.bob`, `${root}.access.request.`, prefixes)).toBeNull();
    });
    it('still reads the declared space\'s own record', () => {
        expect(isNodeReservedWorkspaceKey(`${root}.meta.kept1.latest`)).toBe(false);
        expect(spaceRowAt(`${root}.meta.kept1.latest`, `${root}.meta.`, prefixes)).toEqual({ id: 'kept1', copy: 'latest' });
        expect(spaceRowAt(`${root}.meta.goals.g1.latest`, `${root}.meta.goals.`, [`${root}.meta.goals.`])).toEqual({ id: 'g1', copy: 'latest' });
    });
});

describe('normalizeObjectTypes', () => {
    it('refuses a new space over a reserved part and names it', () => {
        expect(() => normalizeObjectTypes([{ name: 'x', namespace: 'meta.share' }])).toThrow(/"meta\.share"/);
        expect(() => normalizeObjectTypes([{ name: 'x', namespace: 'access.request' }])).toThrow(/shared\.request/);
    });
    it('takes meta.goals, and keeps a reserved space the stored manifest already declares', () => {
        expect(normalizeObjectTypes([{ name: 'goal', namespace: 'meta.goals' }])).toHaveLength(1);
        expect(normalizeObjectTypes([{ name: 'm', namespace: 'meta' }], new Set(['meta']))).toHaveLength(1);
    });
});

describe('livingConfigContent', () => {
    it('ignores the pulse\'s own status and changes with the sections', () => {
        const a = { title: 'T', template: [{ slot: 'a', section: 's' }], status: { pulses: 1 } };
        expect(livingConfigContent(a)).toBe(livingConfigContent({ ...a, status: { pulses: 9, last_pulse: 'x' } }));
        expect(livingConfigContent(a)).not.toBe(livingConfigContent({ ...a, template: [{ slot: 'a', section: 'other' }] }));
    });
});
