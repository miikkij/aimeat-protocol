/**
 * @file test/unit/ready-lanes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The lane count of pnpm ready's sweep follows the machine and, on PostgreSQL, the
 *   server's connection limit (scripts/lib/ready-lanes.ts).
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { postgresLaneNote, postgresLanes, sweepLanes } from '../../scripts/lib/ready-lanes.js';

describe('sweepLanes', () => {
    it('takes one lane per 2.6 logical cores, from 4 to 12', () => {
        expect(sweepLanes(32, undefined)).toBe(12);
        expect(sweepLanes(14, undefined)).toBe(5);
        expect(sweepLanes(8, undefined)).toBe(4);
        expect(sweepLanes(2, undefined)).toBe(4);
        expect(sweepLanes(128, undefined)).toBe(12);
    });

    it('takes the number set by hand when it is one the runner accepts', () => {
        expect(sweepLanes(32, '6')).toBe(6);
        expect(sweepLanes(32, '16')).toBe(16);
        expect(sweepLanes(32, '17')).toBe(12);
        expect(sweepLanes(32, '0')).toBe(12);
        expect(sweepLanes(32, 'many')).toBe(12);
        expect(sweepLanes(32, '')).toBe(12);
    });
});

describe('postgresLanes', () => {
    it('stays at the package script\'s 4 on a server with the default limit of 100', () => {
        expect(postgresLanes(12, 100)).toBe(4);
    });

    it('takes as many lanes as the connection limit carries, 30 connections each and 40 kept back', () => {
        expect(postgresLanes(12, 200)).toBe(5);
        expect(postgresLanes(12, 300)).toBe(8);
        expect(postgresLanes(12, 400)).toBe(12);
        expect(postgresLanes(12, 1000)).toBe(12);
    });

    it('runs 4 lanes when the limit could not be read', () => {
        expect(postgresLanes(12, null)).toBe(4);
        expect(postgresLanes(12, Number.NaN)).toBe(4);
    });

    it('never raises a lane count already at or under 4', () => {
        expect(postgresLanes(4, 1000)).toBe(4);
        expect(postgresLanes(2, 100)).toBe(2);
    });
});

describe('postgresLaneNote', () => {
    it('names the limit and the value that carries the machine\'s lanes when the server holds them back', () => {
        const note = postgresLaneNote(12, 4, 100);
        expect(note).toContain('PostgreSQL runs on 4 lanes, not the 12 this machine carries');
        expect(note).toContain('the server allows 100 connections');
        expect(note).toContain('max_connections = 400');
        expect(postgresLanes(12, 400)).toBe(12);
    });

    it('says the limit could not be read, and nothing when no lane is held back', () => {
        expect(postgresLaneNote(12, 4, null)).toContain('its connection limit could not be read');
        expect(postgresLaneNote(12, 12, 400)).toBeNull();
        expect(postgresLaneNote(4, 4, 100)).toBeNull();
    });
});
