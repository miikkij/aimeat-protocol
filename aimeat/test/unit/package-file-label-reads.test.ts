/**
 * @file test/unit/package-file-label-reads.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The reads of a data package's stored file that ask the labels the version keeps
 *   (secaudit2026nov08b round 15b), against SqliteStorage(':memory:') with classification on for every
 *   scope and a node policy that hides one label from AI (classification-fixtures.ts):
 *     the AI input loader readAiFile (services/ai/inputs.ts), which the AI job, the workflow step and
 *     the transcription, file and image calls read through: the owner's version whose source is a
 *     record carrying the hidden label reads as absent to an agent; an ordinary file, the owner in
 *     person, and classification off read as before;
 *     a file of the package shape in an agent's namespace (no package belongs to an agent) asks
 *     nothing: before round 15b the ask threw, because an agent has no service namespace;
 *     the MCP resource `aimeat://storage/{key}` (mcp/core-resources.ts), which reads only the agent's
 *     own namespace, reads as before.
 *   The REST reads are in test/e2e-package-file-label-reads.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/package-file-label-reads.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08b round 15b).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { setLabel, memoryTarget, type LabelActor } from '../../src/services/classification/labels.js';
import { readerFor, readerForAgent } from '../../src/services/classification/reader.js';
import { recordVersionLabelSource, packageFileHiddenBySourceLabel } from '../../src/services/datapackage/source-labels.js';
import { registerCoreResources } from '../../src/mcp/core-resources.js';
import { readAiFile } from '../../src/services/ai/inputs.js';
import type { AimeatConfig } from '../../src/config.js';
import { hideFromAiOnNode, HIDDEN_LABEL } from './classification-fixtures.js';

const NODE = 'test-node';
const ALICE = `alice@${NODE}`;
const AGENT = `claude#alice@${NODE}`;
const HASH = 'b'.repeat(64);
const PKG_KEY = `datapkg/pkg/${HASH}/rows.csv`;
const PLAIN_KEY = 'notes/plain.csv';
const person: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };
const aliceAuth = { sub: 'alice', owner: 'alice', roles: ['owner'] };
const on = { classificationMode: 'all', nodeId: NODE } as AimeatConfig;
const off = { classificationMode: 'off', nodeId: NODE } as AimeatConfig;

async function putFile(storage: SqliteStorage, ownerGaii: string, key: string, text: string): Promise<void> {
    const data = Buffer.from(text, 'utf8');
    await storage.createStorageFile({
        key, ownerGaii, visibility: 'private', mimeType: 'text/csv', size: data.length, data, createdAt: '2026-11-08T00:00:00.000Z',
    });
}

/** The two handlers registerCoreResources registers, by name. */
function resources(storage: SqliteStorage, config: AimeatConfig) {
    const handlers = new Map<string, (uri: URL, vars: Record<string, string>) => Promise<{ contents: Array<{ text?: string; blob?: string }> }>>();
    const mcp = { registerResource: (name: string, _t: unknown, _m: unknown, h: never) => { handlers.set(name, h); } } as unknown as McpServer;
    registerCoreResources(mcp, storage, config, AGENT);
    return async (key: string) => {
        const out = await handlers.get('agent-storage')!(new URL(`aimeat://storage/${encodeURIComponent(key)}`), { key: encodeURIComponent(key) });
        return out.contents[0]!.blob ? Buffer.from(out.contents[0]!.blob, 'base64').toString('utf8') : out.contents[0]!.text;
    };
}

describe('the reads of a package file ask the labels the version keeps', () => {
    let storage: SqliteStorage;
    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await hideFromAiOnNode(storage, NODE);
        const secret = memoryTarget(ALICE, 'notes.secret');
        await setLabel({ storage, config: on }, person, secret, { label: HIDDEN_LABEL });
        for (const owner of [ALICE, AGENT]) {
            await putFile(storage, owner, PKG_KEY, 'id,note\n1,SECRET\n');
            await putFile(storage, owner, PLAIN_KEY, 'id,note\n1,PLAIN\n');
        }
        // A package belongs to an account identity: only the owner's version has a label source.
        await recordVersionLabelSource(storage, ALICE, 'pkg', HASH, [secret]);
    });
    afterEach(() => { storage.close(); });

    it('a file of the package shape in an agent\'s namespace asks nothing, and does not throw', async () => {
        const agent = readerForAgent({ storage, config: on }, AGENT);
        expect(await packageFileHiddenBySourceLabel({ storage, config: on }, agent, AGENT, PKG_KEY)).toBe(false);
        expect(await packageFileHiddenBySourceLabel({ storage, config: on }, agent, ALICE, PKG_KEY)).toBe(true);
    });

    it('the MCP resource reads the agent\'s own files as before, a file of the package shape included', async () => {
        expect(await resources(storage, on)(PLAIN_KEY)).toContain('PLAIN');
        expect(await resources(storage, on)(PKG_KEY)).toContain('SECRET');
        expect(await resources(storage, off)(PKG_KEY)).toContain('SECRET');
    });

    it('readAiFile answers an agent null for the owner\'s version whose source is hidden from AI', async () => {
        const agent = readerForAgent({ storage, config: on }, AGENT);
        expect(await readAiFile({ storage, config: on }, agent, ALICE, PKG_KEY, { capability: 'text' })).toBeNull();
    });

    it('readAiFile reads an ordinary file, the owner in person, and classification off as before', async () => {
        const agent = readerForAgent({ storage, config: on }, AGENT);
        expect((await readAiFile({ storage, config: on }, agent, ALICE, PLAIN_KEY, { capability: 'text' }))?.data.toString()).toContain('PLAIN');
        const owner = readerFor({ storage, config: on }, aliceAuth);
        expect((await readAiFile({ storage, config: on }, owner, ALICE, PKG_KEY, { capability: 'text' }))?.data.toString()).toContain('SECRET');
        const agentOff = readerForAgent({ storage, config: off }, AGENT);
        expect((await readAiFile({ storage, config: off }, agentOff, ALICE, PKG_KEY, { capability: 'text' }))?.data.toString()).toContain('SECRET');
    });
});
