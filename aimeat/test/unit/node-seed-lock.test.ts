/**
 * @file node-seed-lock.test.ts
 * @description A record this node's seeder wrote is recognised by the `system@` prefix, never by the
 *   whole `system@<current node id>` string (src/utils/node-seed-lock.ts). A node whose id changed
 *   after its first boot holds its seeded records under the old id, and a whole-string comparison
 *   reads them as a stranger's: the shipped cortexes went private to every account, and the package
 *   composer counted them as another account's.
 * @structure
 *   - isNodeSeedLock: the prefix, the reserved name, a person's GHII, an account install
 *   - canSeeCortex: a private shipped cortex stored under an earlier node id stays visible
 *   - the source scan: no equality comparison of an installer, lock, registrant or creator with a
 *     `system@…` string in src/
 * @usage cd aimeat && pnpm exec vitest run test/unit/node-seed-lock.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isNodeSeedLock, nodeSeedLock } from '../../src/utils/node-seed-lock.js';
import { canSeeCortex } from '../../src/services/cortex/lifecycle.js';

describe('isNodeSeedLock', () => {
  it('is true for the seeder of this node id and of an earlier one', () => {
    expect(isNodeSeedLock(nodeSeedLock('new-node'))).toBe(true);
    expect(isNodeSeedLock('system@aimeat-local-001-dev')).toBe(true);
  });
  it('is false for a person, an account install, and nothing', () => {
    expect(isNodeSeedLock('alice@new-node')).toBe(false);
    expect(isNodeSeedLock('alice')).toBe(false);
    expect(isNodeSeedLock('systemic@new-node')).toBe(false);
    expect(isNodeSeedLock('')).toBe(false);
    expect(isNodeSeedLock(undefined)).toBe(false);
    expect(isNodeSeedLock(null)).toBe(false);
  });
});

describe('canSeeCortex after a node id change', () => {
  const bob = { ownerName: 'bob', isOperator: false };
  it('shows a private shipped cortex stored under the earlier node id', () => {
    expect(canSeeCortex(bob, { visibility: 'private', installedBy: 'system@old-node' }, 'new-node')).toBe(true);
  });
  it('shows a private shipped cortex stored under the current node id', () => {
    expect(canSeeCortex(bob, { visibility: 'private', installedBy: 'system@new-node' }, 'new-node')).toBe(true);
  });
  it('still hides another account\'s private cortex', () => {
    expect(canSeeCortex(bob, { visibility: 'private', installedBy: 'carol' }, 'new-node')).toBe(false);
  });
});

/** Every .ts file under src/. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('no whole-string comparison with the node seeder identity in src/', () => {
  // `=== \`system@${…}\``, either side, and a seeded field compared with a variable named system*.
  const LITERAL = /([!=]==\s*`system@\$\{)|(`system@\$\{[^`]*\}`\s*[!=]==)/;
  const FIELD = /\b(installedBy|lockedBy|registeredBy|createdBy)\s*[!=]==\s*system\w*\b|\bsystem\w*\s*[!=]==\s*\w+\.(installedBy|lockedBy|registeredBy|createdBy)\b/;
  it('finds none', () => {
    const root = join(process.cwd(), 'src');
    const hits: string[] = [];
    for (const file of sourceFiles(root)) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (LITERAL.test(line) || FIELD.test(line)) hits.push(`${relative(process.cwd(), file).replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`);
      });
    }
    // A node id changes; compare with isNodeSeedLock (src/utils/node-seed-lock.ts) instead.
    expect(hits).toEqual([]);
  });
});
