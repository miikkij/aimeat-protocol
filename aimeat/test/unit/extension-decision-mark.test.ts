/**
 * @file test/unit/extension-decision-mark.test.ts
 * @description The `decision: person` mark on an extension action (src/services/extension/decision-mark.ts):
 *   the manifest check, which callers wait for the person, and the manifest builder keeping the mark
 *   (incident mwqdmtk8). The routes are proven by test/e2e-ext-person-decision.ts.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (incident mwqdmtk8).
 */
import { describe, it, expect } from 'vitest';
import { actionDecisionRefusal, isPersonDecision, waitsForPerson } from '../../src/services/extension/decision-mark.js';
import { buildExtensionRecordFromManifest } from '../../src/services/extension/manifest.js';
import type { AimeatConfig } from '../../src/config.js';

describe('the decision mark', () => {
    it('accepts `person` and an absent field, and refuses any other value naming the action', () => {
        expect(actionDecisionRefusal({ id: 'a', decision: 'person' })).toBeNull();
        expect(actionDecisionRefusal({ id: 'a' })).toBeNull();
        expect(actionDecisionRefusal({ id: 'moderate', decision: 'agent' })).toMatch(/Action "moderate": decision must be "person"/);
        expect(actionDecisionRefusal({ id: 'moderate', decision: true })).toMatch(/got true/);
    });

    it('marks only `person`', () => {
        expect(isPersonDecision({ decision: 'person' })).toBe(true);
        expect(isPersonDecision({})).toBe(false);
        expect(isPersonDecision(undefined)).toBe(false);
    });

    it('makes an agent and an ecosystem app wait, and lets every person through', () => {
        expect(waitsForPerson('agent')).toBe(true);
        expect(waitsForPerson('ecosystem')).toBe(true);
        for (const kind of ['owner', 'app', 'party', 'anonymous', 'visitor']) expect(waitsForPerson(kind)).toBe(false);
    });
});

describe('the manifest builder', () => {
    const config = {
        extensionMaxCodeSizeKb: 512, extensionMaxMemoryMb: 64, extensionTimeoutMs: 30_000, extensionMaxApiCalls: 30, extensionMaxDebitPerCall: 100,
    } as unknown as AimeatConfig;
    const scripts = { 'm.js': 'export default async function(){ return {}; }' };
    const build = (y: string) => buildExtensionRecordFromManifest(y, scripts, config, 'alice', new Date().toISOString());
    const yaml = (decision?: string) => [
        'metadata: { name: decided, version: "1.0.0", description: d, author: e }',
        'actions:',
        '  - id: moderate',
        '    method: POST',
        '    path: /moderate',
        '    script: m.js',
        ...(decision ? [`    decision: ${decision}`] : []),
    ].join('\n');

    it('stores the mark on the action, and nothing on an action without it', () => {
        const marked = build(yaml('person'));
        expect(marked.ok ? marked.record.actions[0].decision : `${marked.code}: ${marked.message}`).toBe('person');
        const plain = build(yaml());
        expect(plain.ok ? 'decision' in plain.record.actions[0] : `${plain.code}: ${plain.message}`).toBe(false);
    });

    it('refuses another value with INVALID_MANIFEST', () => {
        const r = build(yaml('robot'));
        expect(r.ok ? 'ok' : r.code).toBe('INVALID_MANIFEST');
    });
});
