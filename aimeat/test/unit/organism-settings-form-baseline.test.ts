/**
 * @file test/unit/organism-settings-form-baseline.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism settings page sends agent_access only when the person changed it. A
 *   live update that brings a changed agent_access while the person edits another field must move
 *   the untouched Agents choice to the new value; the page kept the old one, and the save then sent
 *   it back, in the person's name (2026-11-10). Proven on the pure function the page calls
 *   (public/views/profile/organisms/form-baseline.js refreshUntouched) and on the page's own send
 *   test: agent_access is in the request body only when it differs from the baseline.
 * @usage cd aimeat && pnpm exec vitest run test/unit/organism-settings-form-baseline.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { refreshUntouched } from '../../public/views/profile/organisms/form-baseline.js';

const base = (over: Record<string, unknown> = {}) => ({
    name: 'Client project', description: '', type: 'project', join_policy: 'invite_only',
    visibility: 'private', member_visibility: 'members', agent_access: 'all', interests: ['crm'], ...over,
});
/** What home-settings.js saveEdit sends for agent_access. */
const sentAgentAccess = (form: Record<string, unknown>, baseline: Record<string, unknown>) =>
    form.agent_access !== baseline.agent_access ? { agent_access: form.agent_access } : {};

describe('the settings form follows fresher data field by field', () => {
    it('an Agents setting narrowed elsewhere while the person edits the description is not sent back', () => {
        const before = base();
        const typing = { ...before, description: 'Private project' };
        const after = base({ agent_access: 'listed' });
        const form = refreshUntouched(typing, before, after);
        expect(form.agent_access).toBe('listed');
        expect(form.description).toBe('Private project');
        expect(sentAgentAccess(form, after)).toEqual({});
    });

    it('a field the person changed keeps the typing, the Agents choice included', () => {
        const before = base({ agent_access: 'listed' });
        const picked = { ...before, agent_access: 'all' };
        const form = refreshUntouched(picked, before, base({ agent_access: 'listed', name: 'Renamed elsewhere' }));
        expect(form.agent_access).toBe('all');
        expect(form.name).toBe('Renamed elsewhere');
    });

    it('a list field compares by its items', () => {
        const before = base();
        const form = refreshUntouched({ ...before, interests: [...(before.interests as string[])] }, before, base({ interests: ['crm', 'sales'] }));
        expect(form.interests).toEqual(['crm', 'sales']);
    });
});
