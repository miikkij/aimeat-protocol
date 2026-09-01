/**
 * @file connector-config-layout.test.ts
 * @description The per-agent settings file: what it holds, where it lives, and what an old install
 *   experiences on first start.
 *
 *   THE BOUNDARY THIS PINS. The node holds who an agent is and what it may do. The runtime holds
 *   what the agent does when it runs. This file holds only what is needed to REACH the node
 *   (`node_url`) and to EXECUTE locally (`wake`, `runner`, `poll_interval`, `primary`). `agent`,
 *   `owner` and `mode` were mirrors of facts held elsewhere and are no longer written.
 *
 *   THE LAYOUT. `agents/<owner>/<agent>/config.yaml`, one directory per identity, because
 *   `agents/<agent>/` gave two owners with a `concierge` one shared file — and with it one
 *   `node_url` and one `runner.command`, which is one owner's shell command running for the
 *   other's work.
 *
 *   THE MIGRATION IS READ-TIME AND COPIES. An interrupted run leaves the old file exactly where it
 *   was; the next read finishes the job. Nothing is deleted, ever, automatically.
 *
 * @usage cd aimeat && pnpm exec vitest run test/unit/connector-config-layout.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the slimmed file and the per-owner layout.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';

const NODE = 'aimeat-local-001-dev';
let home = '';
type ConfigModule = typeof import('../../src/cli/connect/config.js');

function bearerFor(gaii: string): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'EdDSA' })}.${b64({ sub: gaii })}.sig`;
}

/** A home in the OLD layout: one shared `agents/<name>/config.yaml`, with the mirrored fields. */
function oldLayoutHome(owners: string[], extra: Record<string, unknown> = {}): void {
    mkdirSync(join(home, 'tokens'), { recursive: true });
    mkdirSync(join(home, 'agents', 'concierge'), { recursive: true });
    for (const o of owners) {
        writeFileSync(join(home, 'tokens', `concierge@${o}.token`), bearerFor(`concierge#${o}@${NODE}`), 'utf-8');
    }
    writeFileSync(
        join(home, 'agents', 'concierge', 'config.yaml'),
        yamlStringify({
            agent: 'concierge', owner: owners[0], mode: 'coordinator',
            node_url: 'http://old.example:1', poll_interval: 45,
            runner: { command: 'echo', args: ['from-the-old-file'] },
            ...extra,
        }),
        'utf-8',
    );
}

async function loadModule(): Promise<ConfigModule> {
    process.env.AIMEAT_HOME = home;
    vi.resetModules();
    return import('../../src/cli/connect/config.js');
}

const newPath = (agent: string, owner: string) => join(home, 'agents', owner, agent, 'config.yaml');
const oldPath = (agent: string) => join(home, 'agents', agent, 'config.yaml');

describe('an old-layout install on first start', () => {
    beforeEach(() => { home = resolve(process.cwd(), `test/.tmp-layout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`); });
    afterEach(() => {
        delete process.env.AIMEAT_HOME;
        try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('is read, and its settings survive', async () => {
        oldLayoutHome(['alice']);
        const { loadAllAgents } = await loadModule();
        const [a] = await loadAllAgents();
        expect(a.owner).toBe('alice');
        expect(a.config.node_url).toBe('http://old.example:1');
        expect(a.config.poll_interval).toBe(45);
        expect(a.config.runner?.command).toBe('echo');
    });

    it('is COPIED forward, and the old file is still there afterwards', async () => {
        oldLayoutHome(['alice']);
        const { loadAllAgents } = await loadModule();
        await loadAllAgents();
        expect(existsSync(newPath('concierge', 'alice'))).toBe(true);
        // Never a move: an interrupted run must leave the old one intact.
        expect(existsSync(oldPath('concierge'))).toBe(true);
    });

    it('and the copy drops the three mirrored fields', async () => {
        oldLayoutHome(['alice']);
        const { loadAllAgents } = await loadModule();
        await loadAllAgents();
        const written = yamlParse(readFileSync(newPath('concierge', 'alice'), 'utf-8')) as Record<string, unknown>;
        expect(written.agent).toBeUndefined();
        expect(written.owner).toBeUndefined();
        expect(written.mode).toBeUndefined();
        // What belongs here is still here.
        expect(written.node_url).toBe('http://old.example:1');
        expect(written.poll_interval).toBe(45);
        expect((written.runner as { command?: string }).command).toBe('echo');
    });

    it('gives TWO owners of one shared file their own copies', async () => {
        oldLayoutHome(['alice', 'bob']);
        const { loadAllAgents } = await loadModule();
        const all = await loadAllAgents();
        expect(all).toHaveLength(2);
        expect(existsSync(newPath('concierge', 'alice'))).toBe(true);
        expect(existsSync(newPath('concierge', 'bob'))).toBe(true);
        // The SAME contents, because that file held nothing else. This is the previous state
        // preserved, not an improvement: bob's node_url is still alice's until he re-enrols.
        // A migration cannot invent information that was never stored.
        expect(all[0].config.node_url).toBe(all[1].config.node_url);
    });

    it('and says how many are still on the old layout, so cleanup is a visible choice', async () => {
        oldLayoutHome(['alice', 'bob']);
        const { agentsOnLegacyLayout } = await loadModule();
        const before = agentsOnLegacyLayout([{ agent: 'concierge', owner: 'alice' }, { agent: 'concierge', owner: 'bob' }]);
        expect(before.sort()).toEqual(['concierge@alice', 'concierge@bob']);

        const { loadAllAgents } = await loadModule();
        await loadAllAgents();
        const after = agentsOnLegacyLayout([{ agent: 'concierge', owner: 'alice' }, { agent: 'concierge', owner: 'bob' }]);
        // Once copied they are no longer "only on the old layout" — the old file remains, but it is
        // not what they are read from any more.
        expect(after).toEqual([]);
    });

    it('a half-finished migration completes on the next read rather than losing anything', async () => {
        oldLayoutHome(['alice']);
        // The interrupted state: the new directory exists, the file does not.
        mkdirSync(join(home, 'agents', 'alice', 'concierge'), { recursive: true });
        const { loadAllAgents } = await loadModule();
        const [a] = await loadAllAgents();
        expect(a.config.node_url).toBe('http://old.example:1');
        expect(existsSync(newPath('concierge', 'alice'))).toBe(true);
    });
});

describe('a new-layout install', () => {
    beforeEach(() => { home = resolve(process.cwd(), `test/.tmp-layout-new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`); });
    afterEach(() => {
        delete process.env.AIMEAT_HOME;
        try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('reads each owner\'s own file, and two owners keep different settings', async () => {
        mkdirSync(join(home, 'tokens'), { recursive: true });
        for (const [o, url] of [['alice', 'http://a.example:1'], ['bob', 'http://b.example:2']]) {
            writeFileSync(join(home, 'tokens', `concierge@${o}.token`), bearerFor(`concierge#${o}@${NODE}`), 'utf-8');
            mkdirSync(join(home, 'agents', o, 'concierge'), { recursive: true });
            writeFileSync(newPath('concierge', o), yamlStringify({ node_url: url }), 'utf-8');
        }
        const { loadAllAgents } = await loadModule();
        const all = await loadAllAgents();
        expect(all.find(a => a.owner === 'alice')!.config.node_url).toBe('http://a.example:1');
        expect(all.find(a => a.owner === 'bob')!.config.node_url).toBe('http://b.example:2');
        // The thing the shared file could not do.
        expect(all[0].config.node_url).not.toBe(all[1].config.node_url);
    });

    it('prefers the new file when both layouts exist, and does not touch the old one', async () => {
        oldLayoutHome(['alice']);
        mkdirSync(join(home, 'agents', 'alice', 'concierge'), { recursive: true });
        writeFileSync(newPath('concierge', 'alice'), yamlStringify({ node_url: 'http://new.example:9' }), 'utf-8');
        const { loadAllAgents } = await loadModule();
        const [a] = await loadAllAgents();
        expect(a.config.node_url).toBe('http://new.example:9');
        expect(yamlParse(readFileSync(oldPath('concierge'), 'utf-8')).node_url).toBe('http://old.example:1');
    });

    it('and a save never writes the mirrored fields back, whatever it is handed', async () => {
        mkdirSync(join(home, 'tokens'), { recursive: true });
        const { savePerAgentConfig } = await loadModule();
        savePerAgentConfig('concierge', 'alice', {
            node_url: 'http://x:1',
            // A caller passing the old shape gets it dropped rather than persisted.
            agent: 'wrong', owner: 'wrong', mode: 'autonomous',
        });
        const written = yamlParse(readFileSync(newPath('concierge', 'alice'), 'utf-8')) as Record<string, unknown>;
        expect(Object.keys(written)).toEqual(['node_url']);
    });
});
