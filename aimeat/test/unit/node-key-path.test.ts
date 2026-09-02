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
 *   v1.1.0 — 2026-09-03 — The claim helpers apply to ANY key file, not only the legacy one, and the
 *     encrypted case is pinned. The refusal moved to the resolved path; the legacy branch declines
 *     and generates instead, which is what the E2E federation suite needed to start at all.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { __testables } from '../../src/auth/node-keys.js';

const { getNodeKeyPath, getLegacyNodeKeyPath, readKeyFileClaim, stampKeyFileClaim } = __testables;

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
