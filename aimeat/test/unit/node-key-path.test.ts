/**
 * @file node-key-path.test.ts
 * @description Two nodes on one machine must have two identities.
 *
 *   The path used to be `$HOME/.aimeat/node-key.json` — no node in it, not configurable — so every
 *   node process on one host loaded the SAME keypair. Two local nodes published an identical
 *   federation public key, which means a signature from one verifies as the other and the
 *   unconditional attestation check decides nothing between them. Measured 2026-09-02 while
 *   standing a second node beside the first.
 *
 *   What is pinned here: two node ids resolve to two files, an explicit override wins, the old
 *   shared file is still read so an existing install keeps its identity, and a key file says which
 *   node owns it so a second node never adopts someone else's identity.
 *
 * @usage cd aimeat && pnpm exec vitest run test/unit/node-key-path.test.ts
 * @version-history
 *   v1.2.0 — 2026-10-26 — A key file written while other processes read it is never seen half
 *     written, and the first write keeps the first key. Both went red on the code before the fix:
 *     the E2E sweep of 6e56f34c0 lost 1186 SQLite suites to a key file four lanes wrote at once.
 *   v1.1.0 — 2026-09-03 — The claim helpers apply to ANY key file, not only the legacy one, and the
 *     encrypted case is pinned. The refusal moved to the resolved path; the legacy branch declines
 *     and generates instead, which is what the E2E federation suite needed to start at all.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { __testables } from '../../src/auth/node-keys.js';

const { getNodeKeyPath, getLegacyNodeKeyPath, readKeyFileClaim, stampKeyFileClaim, persistNodeKey } = __testables;
const AIMEAT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let home = '';
const asConfig = (nodeId: string) => ({ nodeId } as never);

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nodekey-'));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.AIMEAT_NODE_KEY_PATH;
});
afterEach(() => {
    delete process.env.AIMEAT_NODE_KEY_PATH;
    try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('where a node keeps its key', () => {
    it('gives two nodes on one machine two different files', () => {
        const a = getNodeKeyPath(asConfig('aimeat-iso-001-a'));
        const b = getNodeKeyPath(asConfig('aimeat-iso-001-b'));
        expect(a).not.toBe(b);
        expect(a).toContain('aimeat-iso-001-a');
        expect(b).toContain('aimeat-iso-001-b');
    });

    it('and neither is the old shared file', () => {
        const legacy = getLegacyNodeKeyPath();
        expect(getNodeKeyPath(asConfig('aimeat-iso-001-a'))).not.toBe(legacy);
    });

    it('lets an operator name the path, and then does not second-guess it', () => {
        process.env.AIMEAT_NODE_KEY_PATH = join(home, 'elsewhere', 'k.json');
        expect(getNodeKeyPath(asConfig('any-node'))).toBe(join(home, 'elsewhere', 'k.json'));
    });

    it('keeps a hostile node id inside one path segment', () => {
        // Separators become underscores, so this is a literal directory name and not a walk.
        const p = getNodeKeyPath(asConfig('../../etc/evil'));
        expect(p).toContain(join('.aimeat', 'nodes'));
        expect(p).toContain('.._.._etc_evil');
    });

    it('and a node id that is nothing but dots does not walk back out', () => {
        // `..` survives a character filter — dots are legal in a filename — and `join(…, '..', …)`
        // then resolves to the LEGACY shared file, which is the exact thing this change stops two
        // nodes sharing. Found by this test, not by reading the code.
        const p = getNodeKeyPath(asConfig('..'));
        expect(p).not.toBe(getLegacyNodeKeyPath());
        expect(p).toContain(join('.aimeat', 'nodes'));
    });
});

describe('who owns a key file', () => {
    const writeKeyFile = (extra: Record<string, unknown> = {}) => {
        const p = getLegacyNodeKeyPath();
        mkdirSync(join(home, '.aimeat'), { recursive: true });
        writeFileSync(p, JSON.stringify({ publicKey: 'pub', privateKey: 'priv', ...extra }));
        return p;
    };

    it('is nobody until a node claims it', () => {
        const p = writeKeyFile();
        expect(readKeyFileClaim(p)).toBeNull();
    });

    it('records the claiming node, and leaves the keypair untouched', () => {
        const p = writeKeyFile();
        stampKeyFileClaim(p, 'aimeat-iso-001-a');
        expect(readKeyFileClaim(p)).toBe('aimeat-iso-001-a');
        const after = JSON.parse(readFileSync(p, 'utf-8'));
        expect(after.publicKey).toBe('pub');
        expect(after.privateKey).toBe('priv');
    });

    it('so a SECOND node can be told the file is not its own', () => {
        // The two branches that read this fact differ, and the difference is the point. On the
        // RESOLVED path (an explicit AIMEAT_NODE_KEY_PATH two nodes share) initializeNode refuses
        // to start and names both. On the legacy shared file it declines quietly and generates its
        // own, because that node has a path of its own and nothing is being shared. What is
        // testable here is that the fact exists and names the other node.
        const p = writeKeyFile();
        stampKeyFileClaim(p, 'aimeat-iso-001-a');
        const claimed = readKeyFileClaim(p);
        expect(claimed).toBe('aimeat-iso-001-a');
        expect(claimed).not.toBe('aimeat-iso-001-b');
    });

    it('and a re-claim by the SAME node is not a conflict', () => {
        const p = writeKeyFile();
        stampKeyFileClaim(p, 'aimeat-iso-001-a');
        stampKeyFileClaim(p, 'aimeat-iso-001-a');
        expect(readKeyFileClaim(p)).toBe('aimeat-iso-001-a');
    });

    it('answers null for an unreadable file rather than guessing a claim', () => {
        const p = getLegacyNodeKeyPath();
        mkdirSync(join(home, '.aimeat'), { recursive: true });
        writeFileSync(p, 'not json at all');
        expect(readKeyFileClaim(p)).toBeNull();
        expect(existsSync(p)).toBe(true);
    });

    it('and the claim survives beside an ENCRYPTED key file, which has no plaintext keypair', () => {
        // The stamp sits outside the encrypted blob on purpose: "who owns this key" must be
        // answerable without AIMEAT_KEY_PASSPHRASE, or the duplicate check cannot run on the
        // deployments that took the trouble to encrypt.
        const p = getLegacyNodeKeyPath();
        mkdirSync(join(home, '.aimeat'), { recursive: true });
        writeFileSync(p, JSON.stringify({ encrypted: true, salt: 's', iv: 'i', authTag: 't', data: 'd' }));
        stampKeyFileClaim(p, 'aimeat-iso-001-a');
        expect(readKeyFileClaim(p)).toBe('aimeat-iso-001-a');
        const after = JSON.parse(readFileSync(p, 'utf-8'));
        expect(after.encrypted).toBe(true);
        expect(after.data).toBe('d');
    });
});

describe('several processes of one node on one key file', () => {
    // One child process per role. They import the module first (a second or more), then wait for
    // one shared start time, so the writes and the reads overlap for the whole window.
    //   write   stamps a claim over and over, alternating two claims so the file changes length
    //   read    parses the file over and over and counts the reads that were not whole JSON
    //   create  does what a starting node does with no key file, for 150 files in turn: writes its
    //           own key, or adopts the key in the file when another process was first
    const CHILD = `
import { readFileSync } from 'node:fs';
const [role, keyPath, startAt, ms, moduleUrl] = process.argv.slice(2);
const { __testables } = await import(moduleUrl);
while (Date.now() < Number(startAt)) { /* wait for the shared start */ }
const end = Number(startAt) + Number(ms);
let runs = 0, bad = 0, firstError = '';
const keys = [];
if (role === 'create') {
    for (let round = 0; round < 150; round++) {
        const path = keyPath + '.' + round + '.json';
        const own = { publicKey: 'pub-' + process.pid + '-' + round, privateKey: 'priv-' + process.pid + '-' + round };
        const outcome = __testables.persistNodeKey(own, path, 'aimeat-iso-001-a');
        keys.push(outcome === 'exists' ? JSON.parse(readFileSync(path, 'utf-8')).publicKey : own.publicKey);
        runs++;
    }
}
while (role !== 'create' && Date.now() < end) {
    if (role === 'write') __testables.stampKeyFileClaim(keyPath, runs % 2 ? 'aimeat-iso-001-a' : 'aimeat-iso-001-with-a-longer-id');
    else {
        try { JSON.parse(readFileSync(keyPath, 'utf-8')); } catch (err) {
            // Windows can show the file missing for an instant while another process renames over
            // it; a missing file is not a half-written one, and only a half-written one is counted.
            if (err.code !== 'ENOENT') { bad++; firstError ||= String(err); }
        }
    }
    runs++;
}
process.stdout.write('\\nRESULT ' + JSON.stringify({ role, runs, bad, firstError, keys }) + '\\n');
`;

    type ChildResult = { role: string; runs: number; bad: number; firstError: string; keys: string[] };
    const runChild = (script: string, args: string[]) => new Promise<ChildResult>((done, fail) => {
        const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], { cwd: AIMEAT, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
        child.stderr.on('data', (c: Buffer) => { out += c.toString(); });
        child.on('error', fail);
        child.on('close', () => {
            const line = out.split('\n').find(l => l.startsWith('RESULT '));
            if (line) done(JSON.parse(line.slice('RESULT '.length)));
            else fail(new Error(`child printed no result:\n${out.slice(-2000)}`));
        });
    });

    it('never shows a reader a half-written file while the claim is stamped', async () => {
        const p = getLegacyNodeKeyPath();
        mkdirSync(join(home, '.aimeat'), { recursive: true });
        writeFileSync(p, JSON.stringify({ publicKey: 'pub', privateKey: 'priv' }, null, 2) + '\n');
        const script = join(home, 'key-file-child.mjs');
        writeFileSync(script, CHILD);
        const moduleUrl = pathToFileURL(join(AIMEAT, 'src', 'auth', 'node-keys.ts')).href;
        const startAt = String(Date.now() + 8000);
        const roles = ['write', 'write', 'read', 'read'];
        const results = await Promise.all(roles.map(role => runChild(script, [role, p, startAt, '1500', moduleUrl])));
        for (const r of results) expect(r.runs).toBeGreaterThan(0);
        expect(results.filter(r => r.role === 'read').map(r => `${r.bad} ${r.firstError}`.trim())).toEqual(['0', '0']);
        const after = JSON.parse(readFileSync(p, 'utf-8'));
        expect(after.publicKey).toBe('pub');
        expect(after.privateKey).toBe('priv');
        // No temporary file is left beside the key file.
        expect(readdirSync(join(home, '.aimeat')).filter(f => f.endsWith('.tmp'))).toEqual([]);
    }, 30_000);

    it('keeps the first key when a second process finds no file and writes its own', () => {
        const p = getNodeKeyPath(asConfig('aimeat-iso-001-a'));
        expect(persistNodeKey({ publicKey: 'pub-first', privateKey: 'priv-first' }, p, 'aimeat-iso-001-a')).toBe('written');
        expect(persistNodeKey({ publicKey: 'pub-second', privateKey: 'priv-second' }, p, 'aimeat-iso-001-a')).toBe('exists');
        const onDisk = JSON.parse(readFileSync(p, 'utf-8'));
        expect(onDisk.publicKey).toBe('pub-first');
        expect(onDisk.privateKey).toBe('priv-first');
        // The claim is in the file from its first write.
        expect(readKeyFileClaim(p)).toBe('aimeat-iso-001-a');
        expect(readdirSync(dirname(p)).filter(f => f.endsWith('.tmp'))).toEqual([]);
    });

    it('gives four processes of one node that start at once one key between them', async () => {
        // What the E2E runner does: four lanes start the same node id with no key file yet.
        const base = join(home, '.aimeat', 'nodes', 'aimeat-iso-001-a', 'node-key');
        mkdirSync(dirname(base), { recursive: true });
        const script = join(home, 'key-file-child.mjs');
        writeFileSync(script, CHILD);
        const moduleUrl = pathToFileURL(join(AIMEAT, 'src', 'auth', 'node-keys.ts')).href;
        const startAt = String(Date.now() + 8000);
        const results = await Promise.all([1, 2, 3, 4].map(() => runChild(script, ['create', base, startAt, '0', moduleUrl])));
        for (let round = 0; round < 150; round++) {
            const onDisk = JSON.parse(readFileSync(`${base}.${round}.json`, 'utf-8'));
            expect(results.map(r => r.keys[round]), `round ${round}`).toEqual([onDisk.publicKey, onDisk.publicKey, onDisk.publicKey, onDisk.publicKey]);
            expect(onDisk.nodeId).toBe('aimeat-iso-001-a');
        }
        expect(readdirSync(dirname(base)).filter(f => f.endsWith('.tmp'))).toEqual([]);
    }, 30_000);
});
