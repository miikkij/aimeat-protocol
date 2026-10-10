/**
 * @file test/unit/package-author-quota.test.ts
 * @description The author quota asked for several new package groups at once, as the set composer asks
 *   before it writes anything (package-compose-set.ts; secaudit 2026-10-10, I20). One group at a time it
 *   answers as it always has.
 * @usage pnpm exec vitest run test/unit/package-author-quota.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import { checkAuthorQuota } from '../../src/services/packages/compose/package-create.js';

const deps = (held: number) => ({
    config: { packageMaxPerAuthor: 10 } as unknown as AimeatConfig,
    storage: { countPackageGroups: async () => held } as unknown as Storage,
});

describe('checkAuthorQuota', () => {
    it('one new group: refused only when the author already holds the maximum', async () => {
        expect(await checkAuthorQuota(deps(9), 'alice')).toBeNull();
        expect(await checkAuthorQuota(deps(10), 'alice')).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' });
    });

    it('several new groups: refused when they do not all fit, before the first is written', async () => {
        expect(await checkAuthorQuota(deps(7), 'alice', 3)).toBeNull();
        expect(await checkAuthorQuota(deps(8), 'alice', 3)).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' });
    });
});
