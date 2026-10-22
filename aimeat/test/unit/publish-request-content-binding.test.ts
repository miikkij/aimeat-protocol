/**
 * @file test/unit/publish-request-content-binding.test.ts
 * @description The skill and cortex appliers of a publish request, driven against real in-memory
 *   SQLite: a request that carries a content digest publishes only that content, and a request filed
 *   before the digest existed (no `target.digest`) still applies on its version alone, so the requests
 *   waiting on a node at the update keep working. The attack paths over HTTP (delete and create
 *   again, a new manifest under the same version, uninstall and install again) are
 *   e2e-publish-request-content-swap.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/publish-request-content-binding.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, apply-skill.ts:applySkillPublish:semver-restarts-on-delete-recreate,
 *     apply-cortex.ts:applyCortexPublish:version-not-bound-to-manifest-or-reinstalled-libs).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, CortexExtensionRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { PublishRequest } from '../../src/services/publish-requests/store.js';
import { publishSkill } from '../../src/services/skills.js';
import { userSkillState } from '../../src/services/skill-publish-gate.js';
import { applySkillPublish } from '../../src/services/publish-requests/apply-skill.js';
import { applyCortexPublish } from '../../src/services/publish-requests/apply-cortex.js';
import { userSkillContent, cortexContentDigest } from '../../src/services/publish-requests/content-digests.js';

const NODE = 'node-test';
const config = { nodeId: NODE } as unknown as AimeatConfig;
const OWNER = 'alice';
const GHII = `${OWNER}@${NODE}`;
let storage: Storage;

beforeEach(() => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
});

const skillMd = (line: string) => `---
name: brief-guide
description: How to write a short brief for this team. Use when asked to draft a brief.
---

# Brief

${line}
`;

function request(kind: 'skill' | 'cortex', target: Record<string, string>, from: string): PublishRequest {
    return {
        spec: 'aimeat.publish-request/v1', id: '00000000-0000-4000-8000-000000000000', kind, target,
        title: 't', name: 'n', change: { field: 'visibility', from, to: 'public' },
        requested_by: { principal: `agent#${GHII}`, kind: 'agent', sub: `agent#${GHII}` },
        state: 'awaiting_owner', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        decided_at: null, decided_by: null, outcome: null, item_id: null, fingerprint: 'f',
    };
}

async function ownerSkill(line: string): Promise<void> {
    await publishSkill(storage, config, {
        scope: 'user', owner: OWNER, publisher: `agent#${GHII}`, files: new Map([['SKILL.md', skillMd(line)]]),
    });
}

describe('skill publish request', () => {
    it('a request filed before the digest existed applies on its version alone', async () => {
        await ownerSkill('The approved text.');
        const res = await applySkillPublish({ storage, config }, GHII, request('skill', { owner: OWNER, name: 'brief-guide', version: '1.0.0' }, 'owner'));
        expect(res).toEqual({ ok: true });
        expect((await userSkillState({ storage, config }, OWNER, 'brief-guide'))?.visibility).toBe('public');
    });

    it('a request whose digest matches the files applies', async () => {
        await ownerSkill('The approved text.');
        const now = await userSkillContent({ storage, config }, OWNER, 'brief-guide');
        expect(now?.version).toBe('1.0.0');
        const res = await applySkillPublish({ storage, config }, GHII,
            request('skill', { owner: OWNER, name: 'brief-guide', version: '1.0.0', digest: now!.digest }, 'owner'));
        expect(res).toEqual({ ok: true });
    });

    it('a request whose digest names other files is refused and the skill stays at owner', async () => {
        await ownerSkill('The approved text.');
        const asked = (await userSkillContent({ storage, config }, OWNER, 'brief-guide'))!.digest;
        // The same version, other text: what a delete and a publish again under the same name leaves.
        await storage.deleteMemory(GHII, 'skills.brief-guide.manifest');
        await ownerSkill('Text nobody approved.');
        const res = await applySkillPublish({ storage, config }, GHII,
            request('skill', { owner: OWNER, name: 'brief-guide', version: '1.0.0', digest: asked }, 'owner'));
        expect(res).toEqual({ ok: false, reason: 'the skill changed after the request was made' });
        expect((await userSkillState({ storage, config }, OWNER, 'brief-guide'))?.visibility).toBe('owner');
    });
});

describe('cortex publish request', () => {
    const manifest = (description: string) => `apiVersion: cortex.aimeat.org/v1\nkind: Extension\nmetadata:\n  name: cx\n  description: ${description}\n`;
    async function install(description: string, lib: string): Promise<CortexExtensionRecord> {
        const record = await storage.createCortexExtension({
            name: 'cx', namespace: OWNER, shortName: 'cx', apiVersion: 'cortex.aimeat.org/v1', version: '1.0.0',
            description, author: OWNER, tags: [], labels: {}, status: 'inactive', visibility: 'private',
            installedAt: new Date().toISOString(), installedBy: OWNER, manifest: manifest(description),
            components: [{ type: 'lib', name: 'helper', filename: 'helper.js' } as never],
            activationArtifacts: { libFiles: [], seedDataKeys: [] } as never,
        } as CortexExtensionRecord);
        await storage.setCortexLibFile('cx', 'helper.js', lib);
        return record;
    }

    it('a request filed before the digest existed applies on its version alone', async () => {
        await install('ORIGINAL', 'export const a = 1;');
        const res = await applyCortexPublish({ storage, config }, GHII, request('cortex', { name: 'cx', version: '1.0.0' }, 'private'));
        expect(res).toEqual({ ok: true });
        expect((await storage.getCortexExtension('cx'))?.visibility).toBe('public');
    });

    it('a request whose digest matches applies; a new manifest or other libraries under the same version are refused', async () => {
        const record = await install('ORIGINAL', 'export const a = 1;');
        const asked = await cortexContentDigest(storage, record);
        await storage.updateCortexExtension('cx', { manifest: manifest('REPLACED') });
        const swapped = await applyCortexPublish({ storage, config }, GHII, request('cortex', { name: 'cx', version: '1.0.0', digest: asked }, 'private'));
        expect(swapped).toEqual({ ok: false, reason: 'the cortex library changed after the request was made' });
        await storage.updateCortexExtension('cx', { manifest: manifest('ORIGINAL') });
        await storage.setCortexLibFile('cx', 'helper.js', 'export const a = 2;');
        const libs = await applyCortexPublish({ storage, config }, GHII, request('cortex', { name: 'cx', version: '1.0.0', digest: asked }, 'private'));
        expect(libs.ok).toBe(false);
        expect((await storage.getCortexExtension('cx'))?.visibility).toBe('private');
        await storage.setCortexLibFile('cx', 'helper.js', 'export const a = 1;');
        const same = await applyCortexPublish({ storage, config }, GHII, request('cortex', { name: 'cx', version: '1.0.0', digest: asked }, 'private'));
        expect(same).toEqual({ ok: true });
    });
});
