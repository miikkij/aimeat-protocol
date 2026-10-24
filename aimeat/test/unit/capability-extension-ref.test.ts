/**
 * @file test/unit/capability-extension-ref.test.ts
 * @description The extension capability ref grammar and the once-per-node step that switches off a
 *   stored capability whose ref names no extension action (src/services/capability-extension-ref.ts,
 *   secaudit2026oct22).
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (secaudit2026oct22).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { CapabilityRecord } from '../../src/storage/interface.js';
import {
    parseExtensionCapabilityRef, splitExtensionRef, disableMalformedExtensionRefsOnce, CAPABILITY_EXTENSION_REF_STEP_KEY,
} from '../../src/services/capability-extension-ref.js';

const NODE = 'unit-node';

function makeCap(id: string, ref: string, override: CapabilityRecord['operatorOverride'] = null): CapabilityRecord {
    const now = new Date().toISOString();
    return {
        id, name: id, summary: '', ownerGhii: `alice@${NODE}`, visibility: 'owner', scope: 'local', status: 'active',
        rejectionReason: null, deprecationMessage: null, replacedBy: null,
        source: { type: 'extension', ref, version: '1.0.0' }, authRequired: 'registered', callable: true,
        inputSchema: null, outputSchema: null, exports: null, usage: '', whenToUse: '', whenNotToUse: '',
        examples: [], dependencies: [], schemaHash: 'x', webhookUrl: null, cost: null, trustRequired: null,
        trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
        redactedFields: [], operatorOverride: override,
        stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
        tags: [], createdAt: now, updatedAt: now,
    };
}

describe('parseExtensionCapabilityRef', () => {
    it('accepts ext:<name>:<action>, a version pin, and a ref without an action', () => {
        expect(parseExtensionCapabilityRef('ext:weather:get')).toEqual({ name: 'weather', pinned: 'weather', action: 'get' });
        expect(parseExtensionCapabilityRef('ext:weather@1.2.0:get_now')).toEqual({ name: 'weather', pinned: 'weather@1.2.0', action: 'get_now' });
        expect(parseExtensionCapabilityRef('ext:demo')).toEqual({ name: 'demo', pinned: 'demo', action: null });
    });

    it('refuses a segment that is not an extension name or an action id', () => {
        for (const ref of ['ext:..:memory', 'ext:a/b:c', 'ext:weather:../x', 'ext:weather:a/b', 'ext:weather:%2e%2e',
            'ext:weather:get:more', 'ext:Weather:get', 'ext:weather@latest:get', 'ext:', 'ext::get', 'extension:weather:get', 'ext:weather:']) {
            expect(parseExtensionCapabilityRef(ref), ref).toBeNull();
        }
    });

    it('splitExtensionRef reads three parts without the grammar, and nothing else', () => {
        expect(splitExtensionRef('ext:weather:get.now')).toEqual({ pinned: 'weather', action: 'get.now' });
        expect(splitExtensionRef('ext:demo')).toBeNull();
        expect(splitExtensionRef('ext:a:b:c')).toBeNull();
    });
});

describe('disableMalformedExtensionRefsOnce', () => {
    let s: SqliteStorage;
    beforeEach(() => { s = new SqliteStorage(':memory:'); });

    it('switches off only a ref that names no installed action, with a note, deletes nothing, and runs once', async () => {
        await s.createCapability(makeCap('bad', 'ext:..:memory'));
        await s.createCapability(makeCap('good', 'ext:weather:get'));
        await s.createCapability(makeCap('parked', 'ext:demo'));
        // An aggregated row over an installed action whose id the grammar would not admit.
        await s.createCapability(makeCap('odd', 'ext:weather:get.now'));
        vi.spyOn(s, 'getExtension').mockImplementation(async (name: string) =>
            (name === 'weather' ? { actions: [{ id: 'get' }, { id: 'get.now' }] } : null) as never);

        const out = await disableMalformedExtensionRefsOnce(s, { nodeId: NODE });
        expect(out).toEqual({ ran: true, disabled: 1 });

        const bad = await s.getCapability('bad');
        expect(bad?.operatorOverride?.disabled).toBe(true);
        expect(bad?.operatorOverride?.notes).toContain('ext:..:memory');
        for (const id of ['good', 'parked', 'odd']) expect((await s.getCapability(id))?.operatorOverride ?? null, id).toBeNull();
        expect((await s.listCapabilitiesBySourceType('extension')).length).toBe(4);

        const step = await s.getMemory(`system@${NODE}`, CAPABILITY_EXTENSION_REF_STEP_KEY);
        expect((step?.value as { disabled?: number }).disabled).toBe(1);
        expect(await disableMalformedExtensionRefsOnce(s, { nodeId: NODE })).toEqual({ ran: false });
    });

    it('keeps the fields of an override the operator already set', async () => {
        await s.createCapability(makeCap('bad', 'ext:x:y/z', { summary: 'operator summary' }));
        vi.spyOn(s, 'getExtension').mockResolvedValue(null as never);
        await disableMalformedExtensionRefsOnce(s, { nodeId: NODE });
        const bad = await s.getCapability('bad');
        expect(bad?.operatorOverride).toMatchObject({ summary: 'operator summary', disabled: true });
    });
});
