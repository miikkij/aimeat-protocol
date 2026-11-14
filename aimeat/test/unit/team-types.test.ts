/**
 * @file test/unit/team-types.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team types (data/team-kit.ts TEAM_TYPES): the request schema accepts exactly the
 *   types the kit knows, every space a type adds is named in en, fi and es, and the team skill of a
 *   typed team carries the type's line in the team's language.
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (team setup T18).
 */
import { describe, it, expect } from 'vitest';
import { TEAM_TYPES, teamKitFor, teamTypeOf, teamSkillMarkdown, TEAM_WS } from '../../src/data/team-kit.js';
import { TEAM_TYPE_IDS } from '../../src/models/write-body-schemas.js';
import { SPACE_LABELS } from '../../src/data/shape-labels.js';

describe('team types', () => {
    it('the request schema and the kit know the same types', () => {
        expect([...TEAM_TYPE_IDS].sort()).toEqual(TEAM_TYPES.map(t => t.id).sort());
    });

    it('every space a type adds is named in every language', () => {
        for (const t of TEAM_TYPES) for (const s of t.spaces) {
            const label = SPACE_LABELS[s.name];
            expect(label, `${t.id}: ${s.name}`).toBeDefined();
            expect(label.en && label.fi && label.es, `${t.id}: ${s.name}`).toBeTruthy();
        }
    });

    it('a type adds its spaces to the shared workspace only, and an unknown type is a general team', () => {
        const sales = teamKitFor(teamTypeOf('sales'));
        expect(sales.workspaces[TEAM_WS.shared].spaces.map(s => s.name)).toContain('customer');
        expect(sales.workspaces[TEAM_WS.decisions].spaces.map(s => s.name)).not.toContain('customer');
        expect(teamTypeOf('no-such-type').id).toBe('general');
    });

    it('the team skill carries the type line in the team\'s language', () => {
        const ws = { shared: 'ws-a', decisions: 'ws-b', waiting: 'ws-c' };
        const md = teamSkillMarkdown({ lang: 'fi', skillName: 'team-myynti', teamName: 'Myynti', orgId: 'org-1', ws, typeLine: teamTypeOf('sales').skillLine.fi });
        expect(md).toContain('Tämän tiimin työ');
        expect(md).toContain('Asiakkaat ovat tietueita');
        const plain = teamSkillMarkdown({ lang: 'fi', skillName: 'team-x', teamName: 'X', orgId: 'org-1', ws });
        expect(plain).not.toContain('Tämän tiimin työ');
    });
});
