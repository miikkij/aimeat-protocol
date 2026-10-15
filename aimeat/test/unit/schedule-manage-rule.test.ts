/**
 * @file test/unit/schedule-manage-rule.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may edit, cancel or run one schedule (services/schedule-write.ts canManageSchedule).
 *
 *   The owner manages every schedule they own. An agent of the same owner manages every schedule an
 *   agent of that owner made, its siblings' included (decision "Core 2026-11 open questions",
 *   2026-10-12, Q4). An app manages only the schedule it made under its own grant: until 2026-10-15
 *   an app grant reached every agent-made schedule of its owner (feature-list audit #85).
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #85).
 */
import { describe, it, expect } from 'vitest';
import { canManageSchedule, type ScheduleWriteCaller } from '../../src/services/schedule-write.js';
import type { ScheduledJobRecord } from '../../src/storage/interface.js';

const OWNER = 'alice@test-node';
const job = (over: Partial<ScheduledJobRecord>): ScheduledJobRecord => ({ id: 'j1', ownerScope: OWNER, ...over }) as ScheduledJobRecord;
const owner: ScheduleWriteCaller = { owner: 'alice', identity: OWNER, isOwnerSession: true, scopes: [] };
const agent: ScheduleWriteCaller = { owner: 'alice', identity: 'bot#alice@test-node', isOwnerSession: false, scopes: ['task:write'] };
const app: ScheduleWriteCaller = { owner: 'alice', identity: OWNER, isOwnerSession: false, scopes: ['task:write'], appGrant: 'grant-1', isApp: true };

describe('canManageSchedule (feature-list audit #85)', () => {
    it('refuses an app a schedule an agent made', () => {
        expect(canManageSchedule(app, OWNER, job({ createdByAgent: true }))).toBe(false);
    });

    it('refuses an app another app\'s schedule and the owner\'s own, and admits it its own', () => {
        expect(canManageSchedule(app, OWNER, job({ createdByAgent: true, createdByApp: 'grant-2' }))).toBe(false);
        expect(canManageSchedule(app, OWNER, job({}))).toBe(false);
        expect(canManageSchedule(app, OWNER, job({ createdByAgent: true, createdByApp: 'grant-1' }))).toBe(true);
    });

    it('refuses an app with no grant id anything at all', () => {
        const bare: ScheduleWriteCaller = { ...app, appGrant: undefined };
        expect(canManageSchedule(bare, OWNER, job({ createdByAgent: true }))).toBe(false);
    });

    it('keeps the agent rule: any agent of the owner manages an agent-made schedule, not the owner\'s own', () => {
        expect(canManageSchedule(agent, OWNER, job({ createdByAgent: true }))).toBe(true);
        expect(canManageSchedule(agent, OWNER, job({}))).toBe(false);
    });

    it('the owner manages everything they own, and nobody reaches another owner\'s', () => {
        expect(canManageSchedule(owner, OWNER, job({}))).toBe(true);
        expect(canManageSchedule(owner, OWNER, job({ ownerScope: 'bob@test-node' }))).toBe(false);
        expect(canManageSchedule(agent, OWNER, job({ ownerScope: 'bob@test-node', createdByAgent: true }))).toBe(false);
    });
});
