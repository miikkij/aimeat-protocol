/**
 * @file test/unit/content-risk-settings.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content risk settings' layers (services/content/risk-settings.ts): the node's
 *   defaults, a missing field following the layer above, a person turning the marks off for their own
 *   part, a locked organism holding a floor under a workspace and a person's own AIs, the operator's
 *   floor holding for everyone, the operator's AI limit, the switch that turns everything off, who pays
 *   for rules+ai, and the strict check of a layer's patch.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 */
import { describe, expect, it } from 'vitest';
import { resolveRisk, checkRiskLayer, lenientRiskLayer } from '../../src/services/content/risk-settings.js';
import { RISK_KINDS } from '../../src/services/content/risk-types.js';

const NODE = {
  contentRiskMode: 'on', contentRiskDetect: 'rules', contentRiskAi: 'allow',
  contentRiskOnIntake: 'mark', contentRiskOnSharedWrite: 'mark', contentRiskOnRead: 'mark+warn',
  contentRiskFloorIntake: 'off', contentRiskFloorSharedWrite: 'off', contentRiskFloorRead: 'off',
  contentRiskKinds: RISK_KINDS.join(','),
} as const;
const node = (over: Partial<Record<keyof typeof NODE, string>> = {}) => ({ ...NODE, ...over }) as never;
const ALICE = 'alice@n1';

describe('content risk settings', () => {
  it('takes the node\'s defaults when no layer chooses', () => {
    const r = resolveRisk(node(), [], { homeOwner: ALICE });
    expect(r).toMatchObject({ enabled: true, detect: 'rules', on_intake: 'mark', on_shared_write: 'mark', on_read: 'mark+warn' });
    expect(r.kinds).toEqual([...RISK_KINDS]);
    expect(r.from.on_read).toBe('node');
  });

  it('lets a person turn the marks off for their own content', () => {
    const r = resolveRisk(node(), [{ level: 'person', layer: { enabled: false } }], { homeOwner: ALICE });
    expect(r).toMatchObject({ enabled: false, on_intake: 'off', on_shared_write: 'off', on_read: 'off' });
  });

  it('lets a workspace deviate from an organism that did not lock', () => {
    const r = resolveRisk(node(), [
      { level: 'organism', layer: { on_shared_write: 'hold' } },
      { level: 'workspace', layer: { on_shared_write: 'mark' } },
    ], { homeOwner: null });
    expect(r.on_shared_write).toBe('mark');
    expect(r.from.on_shared_write).toBe('workspace');
  });

  it('holds a locked organism\'s values as a floor under a workspace and a person\'s own AIs', () => {
    const layers = [
      { level: 'organism' as const, layer: { on_shared_write: 'hold' as const, on_read: 'mark+warn' as const, locked: true } },
      { level: 'workspace' as const, layer: { on_shared_write: 'off' as const, enabled: false } },
      { level: 'person' as const, layer: { on_read: 'off' as const }, readOnly: true },
    ];
    const r = resolveRisk(node(), layers, { homeOwner: null });
    expect(r.on_shared_write).toBe('hold');
    expect(r.on_read).toBe('mark+warn');
    expect(r.from.on_read).toBe('floor');
    expect(r.enabled).toBe(true);
  });

  it('lets a person tighten the read for their own AIs, and only the read', () => {
    const r = resolveRisk(node({ contentRiskOnRead: 'mark' }), [
      { level: 'organism', layer: { on_shared_write: 'mark' } },
      { level: 'person', layer: { on_read: 'mark+warn', on_shared_write: 'off' }, readOnly: true },
    ], { homeOwner: null });
    expect(r.on_read).toBe('mark+warn');
    expect(r.on_shared_write).toBe('mark');
  });

  it('keeps the operator\'s floor for everyone', () => {
    const r = resolveRisk(node({ contentRiskFloorIntake: 'mark+warn' }), [{ level: 'person', layer: { enabled: false } }], { homeOwner: ALICE });
    expect(r.on_intake).toBe('mark+warn');
    expect(r.on_read).toBe('off');
    expect(r.enabled).toBe(true);
  });

  it('turns everything off with the node switch, floors included', () => {
    const r = resolveRisk(node({ contentRiskMode: 'off', contentRiskFloorIntake: 'hold' }), [{ level: 'person', layer: { on_intake: 'hold' } }], { homeOwner: ALICE });
    expect(r).toMatchObject({ enabled: false, on_intake: 'off', on_shared_write: 'off', on_read: 'off' });
  });

  it('keeps every layer at rules when the operator denies the AI part', () => {
    const r = resolveRisk(node({ contentRiskAi: 'deny' }), [{ level: 'person', layer: { detect: 'rules+ai', by: ALICE } }], { homeOwner: ALICE });
    expect(r.detect).toBe('rules');
    expect(r.aiPayer).toBeNull();
  });

  it('charges rules+ai to whoever chose it, and to nobody for a workspace on the node\'s default', () => {
    const own = resolveRisk(node({ contentRiskDetect: 'rules+ai' }), [], { homeOwner: ALICE });
    expect(own.aiPayer).toBe(ALICE);
    const ws = resolveRisk(node({ contentRiskDetect: 'rules+ai' }), [{ level: 'organism', layer: {} }], { homeOwner: null });
    expect(ws.aiPayer).toBeNull();
    const chosen = resolveRisk(node(), [
      { level: 'organism', layer: { detect: 'rules+ai', detectBy: 'claude#bob@n1', by: 'carol@n1' } },
    ], { homeOwner: null });
    expect(chosen.aiPayer).toBe('bob@n1');
  });

  it('follows a kind switched off at one layer and back on below it', () => {
    const r = resolveRisk(node(), [
      { level: 'organism', layer: { kinds: { 'encoded-block': false, 'hidden-text': false } } },
      { level: 'workspace', layer: { kinds: { 'hidden-text': true } } },
    ], { homeOwner: null });
    expect(r.kinds).toContain('hidden-text');
    expect(r.kinds).not.toContain('encoded-block');
  });

  it('checks a patch strictly and reads a stored layer leniently', () => {
    expect(() => checkRiskLayer({}, { on_read: 'hold' }, { allowLock: true })).toThrow(/A read has no hold/);
    expect(() => checkRiskLayer({}, { nope: 1 }, { allowLock: true })).toThrow(/risk.nope is not a setting/);
    expect(() => checkRiskLayer({}, { locked: true }, { allowLock: false })).toThrow(/floor for nobody/);
    expect(() => checkRiskLayer({}, { kinds: { 'bad-kind': true } }, { allowLock: true })).toThrow(/not a kind/);
    expect(checkRiskLayer({ on_read: 'mark', detect: 'rules' }, { on_read: null }, { allowLock: false })).toEqual({ detect: 'rules' });
    expect(lenientRiskLayer({ on_read: 'hold', on_intake: 'mark', enabled: 'yes' })).toEqual({ on_intake: 'mark' });
  });
});
