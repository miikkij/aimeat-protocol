/**
 * @file test/unit/check-trusted-keys.test.ts
 * @description Proof that `pnpm check:trusted-keys` fails on the thing it claims to catch. The gate
 *   exists because two server-trusted keys (H-6 `finance.accountants`, H-23 `commerce.psp`) sat off
 *   the denylist for two months while a hand-maintained list was believed to be complete, so the one
 *   property that matters here is that its FAILING case has been seen.
 *
 *   Every case runs the real script against a fixture tree in a temp directory: the script takes its
 *   root from the working directory, so `cwd` alone points it at a miniature src/ and security/. No
 *   test here writes into the repository's own src/, which is the difference between a gate test and
 *   a race with whoever else is editing the tree.
 *
 *   THE FAIL-FIRST MEASUREMENT, recorded because a green test says nothing about what it prevents:
 *   the v1 scanner (inline string literals only, no comment stripping, no exemption-reason check)
 *   was checked out and run against these same fixtures. It passed the H-6 shape (exit 0, "no new
 *   unguarded server-read keys" while `billing.accountants` was there to be found), passed the empty
 *   reason, passed the cross-owner prefix scan, and FAILED the docblock case by reporting a key that
 *   exists only inside a comment.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-trusted-keys.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-05 — The gate runs in-process: the module is re-imported fresh per test with
 *     `--root` on process.argv, console captured and process.exit turned into a throw, instead of a
 *     `node --import tsx` child per test. The child cost 12.8 s for 14 tests; the same assertions
 *     now take about a second. What is asserted is unchanged.
 *   v1.0.0 — 2026-08-14 — Written with the v2 scanner (August 2026 audit, the fourth ratchet).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

let tree: string;

beforeEach(() => {
    tree = mkdtempSync(join(tmpdir(), 'trusted-keys-'));
    mkdirSync(join(tree, 'src', 'services'), { recursive: true });
    mkdirSync(join(tree, 'security'), { recursive: true });
    exemptions({});
});
afterEach(() => rmSync(tree, { recursive: true, force: true }));

function probe(source: string, name = 'probe.ts'): void {
    writeFileSync(join(tree, 'src', 'services', name), source, 'utf8');
}

function exemptions(exempt: Record<string, string>): void {
    writeFileSync(join(tree, 'security', 'trusted-key-exemptions.json'),
        JSON.stringify({ note: 'fixture', exempt }, null, 2), 'utf8');
}

class Exit extends Error {
    constructor(public readonly code: number) { super(`process.exit(${code})`); }
}

/**
 * The real gate, in strict mode, pointed at the fixture tree with --root. The script reads its root
 * and its flags from process.argv at import, so the module is imported FRESH per call (vi.resetModules
 * drops it from the registry) with argv set first; argv[1] is deliberately not the script's own path,
 * so its "run only when invoked directly" guard stays off and main() is called here, once. Console
 * is captured into `out` and process.exit becomes a throw, which is what the child's exit code was.
 */
async function runGate(root = tree): Promise<{ code: number; out: string }> {
    const argv = process.argv;
    process.argv = [argv[0], 'vitest', '--strict', '--root', root];
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    const err = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Exit(code ?? 0); }) as never);
    let code = 0;
    try {
        vi.resetModules();
        const gate = await import('../../scripts/check-trusted-keys.js');
        gate.main();
    } catch (e) {
        if (e instanceof Exit) code = e.code; else throw e;
    } finally {
        process.argv = argv;
        log.mockRestore();
        err.mockRestore();
        exit.mockRestore();
    }
    return { code, out: lines.join('\n') };
}

describe('a key the server reads and acts on', () => {
    it('is caught when the key sits in a module constant behind a helper — the H-6 shape', async () => {
        // Verbatim the shape of services/finance/accountant-access.ts: the literal is in a constant,
        // and the storage call sees only a parameter. The v1 scanner reported nothing here.
        probe(`
import type { Storage } from '../../storage/interface.js';
const ACCOUNTANTS_KEY = 'billing.accountants';

async function readList(storage: Storage, ownerGhii: string, key: string): Promise<string[]> {
  const rec = await storage.getMemory(ownerGhii, key);
  return (rec?.value as { list?: string[] })?.list ?? [];
}

export async function mayReadBooks(storage: Storage, ownerGhii: string, caller: string): Promise<boolean> {
  const list = await readList(storage, ownerGhii, ACCOUNTANTS_KEY);
  return list.includes(caller);
}
`);
        const { code, out } = await runGate();
        expect(out).toContain('billing.accountants');
        expect(code).toBe(1);
    });

    it('is caught when a key-builder function hides the prefix', async () => {
        probe(`
import type { Storage } from '../../storage/interface.js';
const payoutKey = (id: string) => \`payouts.destination.\${id}\`;
export async function payout(storage: Storage, ghii: string, id: string) {
  return storage.getMemory(ghii, payoutKey(id));
}
`);
        const { code, out } = await runGate();
        expect(out).toContain('payouts.destination.');
        expect(code).toBe(1);
    });

    it('is caught when the server scans every owner for a prefix', async () => {
        probe(`
import type { Storage } from '../../storage/interface.js';
export async function splits(storage: Storage) {
  const { items } = await storage.listAllMemory({ prefix: 'revshare.', limit: 5000 });
  return items;
}
`);
        const { code, out } = await runGate();
        expect(out).toContain('revshare.');
        expect(code).toBe(1);
    });

    it('stays caught in the plain inline-literal case the first version already handled', async () => {
        probe(`
import type { Storage } from '../../storage/interface.js';
export const load = (storage: Storage, ghii: string) => storage.getMemory(ghii, 'payouts.address');
`);
        const { code, out } = await runGate();
        expect(out).toContain('payouts.address');
        expect(code).toBe(1);
    });
});

describe('what the gate must stay quiet about', () => {
    it('says nothing about a key the denylist already covers', async () => {
        probe(`
import type { Storage } from '../../storage/interface.js';
export const psp = (storage: Storage, ghii: string) => storage.getMemory(ghii, 'commerce.psp');
`);
        const { code, out } = await runGate();
        expect(code).toBe(0);
        expect(out).toContain('no new unguarded server-read keys');
    });

    it('says nothing about a key stored under a synthetic system identity', async () => {
        // The __name__ convention is the rule, not a list: an owner-scoped token cannot address it.
        probe(`
import type { Storage } from '../../storage/interface.js';
const POLICY_GAII = '__peer_policy__';
const POLICY_KEY = 'peer-policy.active';
export const policy = (storage: Storage) => storage.getMemory(POLICY_GAII, POLICY_KEY);
`);
        expect((await runGate()).code).toBe(0);
    });

    it('does not report a key that appears only in a docblock example', async () => {
        // The v1 scanner failed exactly here, which is how a gate loses its readers.
        probe(`
/**
 * Usage: const rec = await storage.getMemory(sellerGhii, 'documentation.only');
 */
export const nothing = 1;
`);
        const { code, out } = await runGate();
        expect(out).not.toContain('documentation.only');
        expect(code).toBe(0);
    });
});

describe('the exemption file carries a claim, not a filing', () => {
    const source = `
import type { Storage } from '../../storage/interface.js';
export const load = (storage: Storage, ghii: string) => storage.getMemory(ghii, 'scratchpad.notes');
`;

    it('accepts the read once someone has written down why it is safe', async () => {
        probe(source);
        exemptions({
            'src/services/probe.ts:scratchpad.notes':
                'The user\'s own scratch notes, handed straight back to the same user. Nothing in the '
                + 'server branches on the contents.',
        });
        const { code, out } = await runGate();
        expect(code).toBe(0);
        expect(out).toContain('every exemption carries a reason');
    });

    it('rejects an exemption whose reason is empty', async () => {
        probe(source);
        exemptions({ 'src/services/probe.ts:scratchpad.notes': '' });
        const { code, out } = await runGate();
        expect(out).toContain('without a reason');
        expect(out).toContain('scratchpad.notes');
        expect(code).toBe(1);
    });

    it('rejects a reason too short to be one', async () => {
        probe(source);
        exemptions({ 'src/services/probe.ts:scratchpad.notes': 'fine' });
        expect((await runGate()).code).toBe(1);
    });

    it('counts an UNREVIEWED entry as backlog rather than as an answer', async () => {
        probe(source);
        exemptions({
            'src/services/probe.ts:scratchpad.notes':
                'UNREVIEWED: nobody has yet said whether the server acts on this value.',
        });
        const { code, out } = await runGate();
        expect(code).toBe(0);
        expect(out).toMatch(/exempt, UNREVIEWED\s+1/);
    });

    it('names an exemption that no longer matches any read, so the ratchet can turn', async () => {
        probe(source);
        exemptions({
            'src/services/probe.ts:scratchpad.notes': 'The user\'s own notes, handed back unchanged.',
            'src/services/gone.ts:removed.key': 'Was fixed months ago and nobody deleted the line.',
        });
        const { out } = await runGate();
        expect(out).toContain('src/services/gone.ts:removed.key');
        expect(out).toContain('exemption(s) match no read any more');
    });
});

describe('the gate refuses to pass by accident', () => {
    it('fails rather than reporting a clean tree when it scanned nothing', async () => {
        // Run from a directory with no src/ at all: v1 counted zero findings and printed a tick.
        const empty = mkdtempSync(join(tmpdir(), 'trusted-keys-empty-'));
        try {
            const { code, out } = await runGate(empty);
            expect(out).toContain('scanned no files');
            expect(code).toBe(1);
        } finally {
            rmSync(empty, { recursive: true, force: true });
        }
    });

    // The one case that scans the real src/ rather than a fixture: about a second alone, five
    // under the full suite's parallel load, against vitest's five-second default.
    it('passes on the repository as it stands, so the committed seed is the truth', async () => {
        const { code, out } = await runGate(ROOT);
        expect(out).toContain('NEW, not exempt');
        expect(code).toBe(0);
    }, 30_000);
});
