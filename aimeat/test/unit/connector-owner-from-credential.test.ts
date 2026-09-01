/**
 * @file connector-owner-from-credential.test.ts
 * @description An agent's OWNER comes from its credential, never from a file two owners share.
 *
 *   THE FILE THEY SHARE. Per-agent settings live at `agents/<name>/config.yaml`, keyed by the bare
 *   agent name — so two owners who both have a `concierge` have ONE config file between them, and
 *   its `owner:` field is whichever of them enrolled last. Anything reading the owner from there
 *   attributes one person's work to the other. The ACP adapter did exactly that
 *   (`loaded.config.owner`), so an ACP session for B was reported as A's.
 *
 *   WHERE IT ACTUALLY COMES FROM. The credential filename is owner-qualified
 *   (`concierge@alice.token`), and for a v2 agent the key file stores the GAII outright. `owner`
 *   and `gaii` on a LoadedAgent are built from those and never from the config, so a shared config
 *   cannot move an identity — only settings.
 *
 *   WHAT THIS TEST IS AND IS NOT. It exercises the layer that decides — `loadAllAgents` against a
 *   real temp home with a deliberately mismatched shared config. It cannot prove that no future
 *   caller reads `config.owner` again; the source check at the bottom is a much weaker thing that
 *   catches the one literal spelling, and it is labelled as that rather than as a guarantee.
 *
 * @usage cd aimeat && pnpm exec vitest run test/unit/connector-owner-from-credential.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the ACP owner fix.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify } from 'yaml';

const NODE = 'aimeat-local-001-dev';
const home = resolve(process.cwd(), `test/.tmp-owner-home-${Date.now()}`);

/** A bearer shaped like the node's. Only the payload is read; nothing verifies it. */
function bearerFor(gaii: string): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'EdDSA' })}.${b64({ sub: gaii, owner: gaii.split('#')[1].split('@')[0] })}.sig`;
}

describe('the owner comes from the credential, not from the shared config file', () => {
    let loadAllAgents: typeof import('../../src/cli/connect/config.js')['loadAllAgents'];
    let loadAgentByName: typeof import('../../src/cli/connect/config.js')['loadAgentByName'];

    beforeAll(async () => {
        mkdirSync(join(home, 'tokens'), { recursive: true });
        mkdirSync(join(home, 'agents', 'concierge'), { recursive: true });
        // Two owners, one agent name. The filenames are owner-qualified; the config is not.
        writeFileSync(join(home, 'tokens', 'concierge@alice.token'), bearerFor(`concierge#alice@${NODE}`), 'utf-8');
        writeFileSync(join(home, 'tokens', 'concierge@bob.token'), bearerFor(`concierge#bob@${NODE}`), 'utf-8');
        // ONE config for both, and it names alice — the state a second enrolment leaves behind.
        writeFileSync(
            join(home, 'agents', 'concierge', 'config.yaml'),
            yamlStringify({ agent: 'concierge', owner: 'alice', node_url: 'http://127.0.0.1:1' }),
            'utf-8',
        );

        // CONFIG_DIR is captured at module load, so the env has to be set before the import.
        process.env.AIMEAT_HOME = home;
        vi.resetModules();
        const mod = await import('../../src/cli/connect/config.js');
        loadAllAgents = mod.loadAllAgents;
        loadAgentByName = mod.loadAgentByName;
    });

    afterAll(() => {
        delete process.env.AIMEAT_HOME;
        try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('loads both owners even though they share one config file', async () => {
        const all = await loadAllAgents();
        const mine = all.filter(a => a.agent === 'concierge');
        expect(mine).toHaveLength(2);
        expect(mine.map(a => a.owner).sort()).toEqual(['alice', 'bob']);
    });

    it('and gives each its own owner and identity, not the config file\'s', async () => {
        const all = await loadAllAgents();
        const bob = all.find(a => a.gaii === `concierge#bob@${NODE}`);
        expect(bob, 'bob should be loaded under his own identity').toBeDefined();
        // The credential wins, and the config no longer even states an owner: reading the old
        // shared file copies it into bob's own folder, and that write drops `agent`, `owner` and
        // `mode`, which are the node's and the credential's facts rather than this file's.
        expect(bob!.owner).toBe('bob');
        expect(bob!.config.owner).toBeUndefined();
        const alice = all.find(a => a.gaii === `concierge#alice@${NODE}`);
        expect(alice!.owner).toBe('alice');
    });

    it('loadAgentByName refuses a bare name that two owners share, rather than picking one', async () => {
        await expect(loadAgentByName('concierge')).rejects.toThrow(/multiple owners/i);
        // With the owner given it resolves, and to that owner.
        const bob = await loadAgentByName('concierge', 'bob');
        expect(bob!.owner).toBe('bob');
        expect(bob!.gaii).toBe(`concierge#bob@${NODE}`);
    });

    it('the shared node_url is still shared, which is the config-directory problem, not this one', async () => {
        // Stated rather than fixed: a setting legitimately lives in the config, and two owners on
        // DIFFERENT nodes would both be sent to whichever enrolled last. Scoped in the spec draft.
        const all = await loadAllAgents();
        const urls = new Set(all.filter(a => a.agent === 'concierge').map(a => a.config.node_url));
        expect(urls.size).toBe(1);
    });
});

describe('no connector code reads an owner out of the per-agent config', () => {
    it('has no `.config.owner` read under src/cli/', () => {
        // A WEAK CHECK, and labelled as one: it catches this exact spelling and nothing else — a
        // read through a variable, a destructure or a helper walks past it. It is here because the
        // defect WAS this exact spelling in one file, and a second one would be cheap to catch.
        // The test above is the one that proves the behaviour.
        const root = resolve(process.cwd(), 'src/cli');
        const offenders: string[] = [];
        const walk = (dir: string): void => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                const p = join(dir, e.name);
                if (e.isDirectory()) { walk(p); continue; }
                if (!e.name.endsWith('.ts')) continue;
                const src = readFileSync(p, 'utf-8');
                for (const [i, line] of src.split('\n').entries()) {
                    // The dispatch context's own `config.owner` is built from the credential
                    // (tool-call.ts, local-server.ts) and is a different object; only a read off a
                    // LOADED agent's per-agent config is the defect.
                    if (/\bloaded\.config\.owner\b|\bentry\.config\.owner\b|\ba\.config\.owner\b/.test(line)) {
                        offenders.push(`${p}:${i + 1}`);
                    }
                }
            }
        };
        walk(root);
        expect(offenders).toEqual([]);
    });
});
