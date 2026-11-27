/**
 * @file test/unit/declared-needs.test.ts
 * @description The needs a published page declares with AIMEAT.atelier.requires, read from its
 *   source, and the ready-made criterion and scenario pair the publish answer offers for `session`.
 *   The scenarios are held to the playtest's own shape (services/app/scenarios.ts), so what the
 *   answer offers can be written as it is.
 * @version-history
 *   v1.0.0 - 2026-11-27 - Initial (wish-atelier-contextual-templates-pyynt-lohko-ask).
 */
import { describe, expect, it } from 'vitest';
import { declaredNeedsOf, needsProof, NEEDS_SIGNED_IN, NEEDS_SIGNED_OUT } from '../../src/services/app/declared-needs.js';

const PAGE = `<script>
  AIMEAT.atelier.requires({ target: '#work', needs: ['session', "ai"], app: 'alice/notes.html', render(host) {} });
  AIMEAT.atelier.requires({
    target: '#club',
    needs: ['member:use', 'session', 'sessoin'],
    app: 'alice/notes.html',
  });
</script>`;

describe('declaredNeedsOf', () => {
  it('reads the literal needs of every requires call, once each, and leaves out unknown words', () => {
    expect(declaredNeedsOf(PAGE)).toEqual(['session', 'ai', 'member:use']);
  });

  it('declares nothing for a page without the call, or one that builds its list at run time', () => {
    expect(declaredNeedsOf('<p>requires nothing</p>')).toEqual([]);
    expect(declaredNeedsOf('AIMEAT.atelier.requires({ needs: list, render() {} })')).toEqual([]);
  });
});

describe('needsProof', () => {
  it('offers the ready-made pair for a page that declares session', () => {
    const out = needsProof('alice', 'notes.html', PAGE) as any;
    expect(out.declared_needs).toEqual(['session', 'ai', 'member:use']);
    expect(out.needs_proof).toContain('aimeat_app_manage { action: "criteria_set", owner: "alice", filename: "notes.html" }');
    expect(out.needs_proof_ready.criteria.map((c: any) => c.id)).toEqual([NEEDS_SIGNED_OUT, NEEDS_SIGNED_IN]);
    const [out1, in1] = out.needs_proof_ready.scenarios;
    expect(out1.signed_in).toBe(false);
    expect(out1.steps).toEqual([{ do: 'expect_visible', target: '[data-ak-requires][data-ak-state="signIn"]' }]);
    expect(in1.signed_in).toBe(true);
    expect(in1.steps[0].target).toBe('[data-ak-requires][data-ak-state="ready"]');
    expect(in1.criteria).toEqual([NEEDS_SIGNED_IN]);
  });

  it('offers nothing when the page does not declare session', () => {
    expect(needsProof('alice', 'map.html', 'AIMEAT.atelier.requires({ needs: ["online"], render() {} })')).toEqual({});
    expect(needsProof('alice', 'plain.html', '<p>no kit call</p>')).toEqual({});
  });

  it('offers nothing once both lines are in the spec', () => {
    const criteria = [
      { id: NEEDS_SIGNED_OUT, text: 'a', check: 'scenario', status: 'open' },
      { id: NEEDS_SIGNED_IN, text: 'b', check: 'scenario', status: 'evidenced' },
    ] as any;
    expect(needsProof('alice', 'notes.html', PAGE, criteria)).toEqual({});
    expect(Object.keys(needsProof('alice', 'notes.html', PAGE, [criteria[0]]))).toContain('needs_proof');
  });
});
