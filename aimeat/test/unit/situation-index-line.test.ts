/**
 * @file test/unit/situation-index-line.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The paragraph that tells a connecting AI the person has a situation picture: it is
 *   written only for a person who has the record, it is kept from an agent when the record is
 *   private, and a store that cannot be read leaves the instructions as they were.
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { situationIndexLine, SITUATION_NOW_KEY } from '../../src/services/situation/index-line.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const config = { nodeId: 'node-1' } as AimeatConfig;

function storageWith(row: { visibility: string } | null, seen: { owner?: string; key?: string } = {}): Storage {
    return {
        getMemory: async (owner: string, key: string) => {
            seen.owner = owner;
            seen.key = key;
            return row ? { key, value: { type: 'aimeat.situation.now/v1' }, ...row } : null;
        },
    } as unknown as Storage;
}

describe('situationIndexLine', () => {
    it('reads the one record under the person\'s own identity', async () => {
        const seen: { owner?: string; key?: string } = {};
        await situationIndexLine(storageWith(null, seen), config, 'alice');
        expect(seen).toEqual({ owner: 'alice@node-1', key: SITUATION_NOW_KEY });
    });

    it('says nothing for a person who has no picture', async () => {
        expect(await situationIndexLine(storageWith(null), config, 'alice')).toBeNull();
        expect(await situationIndexLine(storageWith({ visibility: 'owner' }), config, undefined)).toBeNull();
    });

    it('tells the AI when to read the picture, how to correct it and how to ask a colleague', async () => {
        const line = await situationIndexLine(storageWith({ visibility: 'owner' }), config, 'alice');
        expect(line).toMatch(/situation\.now/);
        expect(line).toMatch(/where things stand/);
        expect(line).toMatch(/situated-ai/);
        expect(line).toMatch(/aimeat_help_find/);
        expect(line).toMatch(/proposals/);
    });

    it('keeps a private picture from an agent and shows it to the owner\'s own session', async () => {
        expect(await situationIndexLine(storageWith({ visibility: 'private' }), config, 'alice', true)).toBeNull();
        expect(await situationIndexLine(storageWith({ visibility: 'private' }), config, 'alice', false)).toMatch(/situation\.now/);
    });

    it('answers null when the store cannot be read', async () => {
        const broken = { getMemory: async () => { throw new Error('down'); } } as unknown as Storage;
        expect(await situationIndexLine(broken, config, 'alice')).toBeNull();
    });
});
