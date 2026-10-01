/**
 * @file test/unit/organism-shapes.test.ts
 * @description The starting shapes build workspaces the provisioning service accepts: every records
 *   space has a schema and every document space none, names come in the asked language, the project
 *   shape keeps the template's five spaces and its gate policy, and an unknown shape is named in the
 *   refusal together with the ones that exist.
 * @usage cd aimeat && pnpm exec vitest run test/unit/organism-shapes.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { ORGANISM_SHAPES, shapeById, shapeWorkspaceInput, publicShapes } from '../../src/data/organism-shapes.js';
import { resolveShape } from '../../src/services/organism-shape-apply.js';

describe('organism shapes', () => {
    it('six shapes, each with at least one workspace', () => {
        expect(ORGANISM_SHAPES.map(s => s.id)).toEqual(['own-work', 'team', 'company', 'family', 'club', 'project']);
        for (const s of ORGANISM_SHAPES) expect(s.workspaces.length).toBeGreaterThan(0);
    });

    it('a records space carries a schema, a document space none', () => {
        for (const s of ORGANISM_SHAPES) {
            for (let i = 0; i < s.workspaces.length; i++) {
                const input = shapeWorkspaceInput(s, i, 'en');
                for (const o of input.manifest.objectTypes) {
                    if (o.mode === 'records') expect(input.schemas[o.namespace], `${s.id}/${o.name}`).toBeTruthy();
                    else expect(input.schemas[o.namespace], `${s.id}/${o.name}`).toBeUndefined();
                    expect(o.schemaRef).toMatch(/^schema:/);
                    expect(o.backing).toBe('memory');
                }
            }
        }
    });

    it('names and the readme come in the asked language, English when it is unknown', () => {
        const fi = shapeWorkspaceInput(shapeById('company')!, 1, 'fi');
        expect(fi.name).toBe('Asiakkaat');
        expect(fi.readme).toContain('## Mikä on nyt ajankohtaista');
        expect(shapeWorkspaceInput(shapeById('company')!, 1, 'xx').name).toBe('Customers');
        expect(publicShapes('es').find(s => s.id === 'family')!.label).toBe('Familia');
    });

    it('the project shape keeps the template: five spaces and the gate policy', () => {
        const p = shapeWorkspaceInput(shapeById('project')!, 0, 'en');
        expect(p.manifest.objectTypes.map(o => o.namespace)).toEqual(['meta.goals', 'meta.plans', 'shared.deliverables', 'meta.decisions', 'shared.resources']);
        expect((p.manifest as Record<string, unknown>).policy).toEqual({ agentAutonomy: 'L3', alwaysGate: ['external-release', 'spend', 'data-egress', 'data-model-change'] });
    });

    it('resolveShape: none, a known one, and an unknown one named with the list', () => {
        expect(resolveShape(undefined)).toBeUndefined();
        expect(resolveShape('')).toBeUndefined();
        expect((resolveShape('team') as { id: string }).id).toBe('team');
        expect(resolveShape('castle')).toMatch(/Unknown shape "castle".*own-work, team, company, family, club, project/);
    });
});
